import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWK,
  type JWTVerifyGetKey,
} from 'jose'
import type { Role } from './types'

/**
 * Test helpers: a throwaway ES256 key pair, a local key set that stands in for
 * Supabase's JWKS, and a token signer. Lets every service test its real
 * authentication path (signature, issuer, audience, expiry) with no network.
 */
export interface TestAuth {
  jwks: JWTVerifyGetKey
  issuer: string
  audience: string
  sign(claims?: TestClaims): Promise<string>
  /** A token signed by a DIFFERENT key, to prove forged tokens are refused. */
  signForged(claims?: TestClaims): Promise<string>
}

export interface TestClaims {
  sub?: string
  role?: Role | null
  aal?: 'aal1' | 'aal2'
  email?: string
  issuer?: string
  audience?: string
  /** Seconds from now; negative for an already-expired token. */
  expiresInSec?: number
  extra?: Record<string, unknown>
}

export async function createTestAuth(
  issuer = 'https://test-project.supabase.co/auth/v1'
): Promise<TestAuth> {
  const { publicKey, privateKey } = await generateKeyPair('ES256')
  const forged = await generateKeyPair('ES256')
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'ES256', use: 'sig' }

  const make =
    (key: CryptoKey | Uint8Array | object, kid: string) =>
    async (c: TestClaims = {}) => {
      const claims: Record<string, unknown> = {
        role: 'authenticated', // the Postgres role claim: must be ignored for RBAC
        aal: c.aal ?? 'aal1',
        session_id: `sess-${c.sub ?? 'user-1'}`,
        ...(c.email ? { email: c.email } : {}),
        ...(c.role === null ? {} : { app_role: c.role ?? 'CUSTOMER' }),
        ...(c.extra ?? {}),
      }
      return new SignJWT(claims)
        .setProtectedHeader({ alg: 'ES256', kid })
        .setIssuer(c.issuer ?? issuer)
        .setAudience(c.audience ?? 'authenticated')
        .setSubject(c.sub ?? 'user-1')
        .setIssuedAt()
        .setExpirationTime(Math.floor(Date.now() / 1000) + (c.expiresInSec ?? 600))
        .sign(key as CryptoKey)
    }

  return {
    jwks: createLocalJWKSet({ keys: [jwk] }),
    issuer,
    audience: 'authenticated',
    sign: make(privateKey, 'test-key'),
    signForged: make(forged.privateKey, 'test-key'),
  }
}
