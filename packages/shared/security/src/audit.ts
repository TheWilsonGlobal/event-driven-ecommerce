import type { FastifyRequest } from 'fastify'

/**
 * Security audit trail, written through the request's own Pino logger so every
 * line carries the requestId and ships to Loki with the rest of the logs.
 *
 * It records WHO (user id, role), WHAT (route, decision) and WHY (code), and
 * never the Authorization header, a token, a password or a request body.
 */
export type AuditEvent =
  | 'access.denied'
  | 'access.granted'
  | 'rate_limit.exceeded'
  | 'rate_limit.unavailable'
  | 'auth.token_rejected'
  | 'admin.action'

export function audit(
  request: FastifyRequest,
  event: AuditEvent,
  details: Record<string, unknown> = {}
): void {
  request.log.warn(
    {
      audit: {
        event,
        userId: request.auth?.userId ?? null,
        role: request.auth?.role ?? null,
        aal: request.auth?.aal ?? null,
        method: request.method,
        route: request.routeOptions?.url ?? request.url.split('?')[0],
        ip: request.ip,
        authError: request.authError,
        ...details,
      },
    },
    `audit ${event}`
  )
}
