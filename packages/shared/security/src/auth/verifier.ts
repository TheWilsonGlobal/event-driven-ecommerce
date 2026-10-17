import {
  SignJWT,
  createRemoteJWKSet,
  decodeJwt,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose'
import type { AuthIdentity, AuthenticatorAssurance, Role } from '../types'

/**
 * Verifies bearer tokens. Two kinds are accepted and they never share a key:
 *
 *  1. USER tokens issued by Supabase Auth, verified against the project's public
 *     JWKS (asymmetric: ES256 here). No secret exists in any service, so a
 *     compromised service cannot mint tokens (finding C3). Keys are cached and
 *     rotated by `kid`; there is no network call per request.
 *  2. SERVICE tokens for service-to-service HTTP calls, HS256 with a secret that
 *     only the internal services hold, issuer `ecommerce-internal`, 60 s life.
 *
 * Which path is used is decided from the UNVERIFIED `iss` claim, which is safe
 * only because each path pins its own algorithm and key: a token claiming the
 * internal issuer must verify with the internal HS256 secret, one claiming
 * anything else must verify against the Supabase JWKS. `alg: none` and
 * HS* against the JWKS are impossible by construction.
 */

export type AuthFailureCode =
  | 'token_malformed'
  | 'token_expired'
  | 'token_not_yet_valid'
  | 'token_signature_invalid'
  | 'token_claims_invalid'
  | 'token_key_unavailable'
  | 'auth_not_configured'

export class AuthFailure extends Error {
  constructor(readonly code: AuthFailureCode) {
    super(code)
    this.name = 'AuthFailure'
  }
}

export const INTERNAL_ISSUER = 'ecommerce-internal'
export const INTERNAL_AUDIENCE = 'ecommerce-services'

const USER_ALGORITHMS = ['ES256', 'RS256', 'EdDSA']

export interface VerifierOptions {
  issuer: string
  audience: string
  jwks: JWTVerifyGetKey
  serviceSecret?: string | null | undefined
  clockToleranceSec?: number | undefined
}

export function createJwks(jwksUrl: string): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(jwksUrl), {
    cooldownDuration: 30_000,
    cacheMaxAge: 10 * 60_000,
    timeoutDuration: 3_000,
  })
}

const BUSINESS_ROLES = new Set(['ADMIN', 'VENDOR', 'CUSTOMER'])

/**
 * The business role. Read ONLY from the custom `app_role` claim (top level, or
 * under `app_metadata`). The standard `role` claim is the Postgres role
 * ("authenticated") and is deliberately ignored: a token without `app_role`
 * gets the least privilege, CUSTOMER, never anything it did not earn.
 */
export function roleFromClaims(payload: JWTPayload): Role {
  const meta = payload.app_metadata as Record<string, unknown> | undefined
  const raw = payload.app_role ?? meta?.app_role
  return typeof raw === 'string' && BUSINESS_ROLES.has(raw) ? (raw as Role) : 'CUSTOMER'
}

function assurance(payload: JWTPayload): AuthenticatorAssurance {
  return payload.aal === 'aal2' ? 'aal2' : 'aal1'
}

function mapJoseError(err: unknown): AuthFailure {
  const name = (err as { code?: string })?.code
  switch (name) {
    case 'ERR_JWT_EXPIRED':
      return new AuthFailure('token_expired')
    case 'ERR_JWT_CLAIM_VALIDATION_FAILED':
      // jose reports nbf/iat problems here too; the claim name tells which.
      return (err as { claim?: string }).claim === 'nbf'
        ? new AuthFailure('token_not_yet_valid')
        : new AuthFailure('token_claims_invalid')
    case 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED':
    case 'ERR_JOSE_ALG_NOT_ALLOWED':
    case 'ERR_JWS_INVALID':
    case 'ERR_JWKS_NO_MATCHING_KEY':
    case 'ERR_JWKS_MULTIPLE_MATCHING_KEYS':
      return new AuthFailure('token_signature_invalid')
    case 'ERR_JWKS_TIMEOUT':
    case 'ERR_JOSE_GENERIC':
      return new AuthFailure('token_key_unavailable')
    default:
      return new AuthFailure('token_malformed')
  }
}

export class TokenVerifier {
  private readonly serviceKey: Uint8Array | null

  constructor(private readonly opts: VerifierOptions) {
    this.serviceKey = opts.serviceSecret ? new TextEncoder().encode(opts.serviceSecret) : null
  }

  async verify(token: string): Promise<AuthIdentity> {
    let unverifiedIssuer: string | undefined
    try {
      unverifiedIssuer = decodeJwt(token).iss
    } catch {
      throw new AuthFailure('token_malformed')
    }

    if (unverifiedIssuer === INTERNAL_ISSUER) return this.verifyService(token)
    return this.verifyUser(token)
  }

  private async verifyUser(token: string): Promise<AuthIdentity> {
    try {
      const { payload } = await jwtVerify(token, this.opts.jwks, {
        issuer: this.opts.issuer,
        audience: this.opts.audience,
        algorithms: USER_ALGORITHMS,
        clockTolerance: this.opts.clockToleranceSec ?? 5,
      })
      if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
        throw new AuthFailure('token_claims_invalid')
      }
      return {
        userId: payload.sub,
        role: roleFromClaims(payload),
        aal: assurance(payload),
        sessionId: typeof payload.session_id === 'string' ? payload.session_id : null,
        email: typeof payload.email === 'string' ? payload.email : null,
        kind: 'user',
      }
    } catch (err) {
      throw err instanceof AuthFailure ? err : mapJoseError(err)
    }
  }

  private async verifyService(token: string): Promise<AuthIdentity> {
    if (!this.serviceKey) throw new AuthFailure('auth_not_configured')
    try {
      const { payload } = await jwtVerify(token, this.serviceKey, {
        issuer: INTERNAL_ISSUER,
        audience: INTERNAL_AUDIENCE,
        algorithms: ['HS256'],
        clockTolerance: 5,
        maxTokenAge: '2m',
      })
      if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
        throw new AuthFailure('token_claims_invalid')
      }
      return {
        userId: payload.sub,
        role: 'SERVICE',
        aal: 'aal1',
        sessionId: null,
        email: null,
        kind: 'service',
      }
    } catch (err) {
      throw err instanceof AuthFailure ? err : mapJoseError(err)
    }
  }
}

/** Mints the short-lived token one service presents to another. */
export async function signServiceToken(
  secret: string,
  serviceName: string,
  ttlSec = 60
): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(INTERNAL_ISSUER)
    .setAudience(INTERNAL_AUDIENCE)
    .setSubject(serviceName)
    .setIssuedAt()
    .setExpirationTime(`${ttlSec}s`)
    .sign(new TextEncoder().encode(secret))
}
