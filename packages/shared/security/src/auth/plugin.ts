import fp from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'
import type { AuthIdentity } from '../types'
import { AuthFailure, type TokenVerifier } from './verifier'

export interface AuthPluginOptions {
  /** null when SUPABASE_URL is not configured: every presented token then fails closed. */
  verifier: TokenVerifier | null
  /**
   * Optional immediate-revocation check (e.g. a Redis deny-list keyed by
   * session id). Access tokens are short-lived, so this is only for the case
   * "this admin must stop NOW".
   */
  isRevoked?: ((identity: AuthIdentity) => Promise<boolean>) | undefined
}

/**
 * Parses `Authorization: Bearer <jwt>` and attaches `request.auth`.
 *
 * This hook only ESTABLISHES identity. It never rejects: whether a route needs
 * one, and what happens to an invalid token, is decided by the policy hook
 * (rbac/hooks.ts), so report-mode rollout can observe both without blocking.
 *
 * Identity comes from the verified token and from nowhere else: no
 * `X-User-Id` style header is ever read.
 */
export const authPlugin = fp<AuthPluginOptions>(
  async (server: FastifyInstance, opts) => {
    server.decorateRequest('auth', null)
    server.decorateRequest('authError', null)

    server.addHook('onRequest', async (request) => {
      const header = request.headers.authorization
      if (!header) return

      const match = /^Bearer\s+([A-Za-z0-9._~+/=-]+)$/.exec(header.trim())
      if (!match) {
        request.authError = 'token_malformed'
        return
      }
      if (!opts.verifier) {
        request.authError = 'auth_not_configured'
        return
      }
      try {
        const identity = await opts.verifier.verify(match[1] as string)
        if (opts.isRevoked && (await opts.isRevoked(identity))) {
          request.authError = 'token_revoked'
          return
        }
        request.auth = identity
      } catch (err) {
        request.authError = err instanceof AuthFailure ? err.code : 'token_malformed'
      }
    })
  },
  { name: 'shared-security-auth' }
)
