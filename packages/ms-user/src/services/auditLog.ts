import type { Prisma } from '../../node_modules/.prisma-ms-user/client'
import type { FastifyRequest } from 'fastify'
import { audit } from '@ecommerce/shared-security'

export type AuditAction = 'user.create' | 'user.delete' | 'user.role_change' | 'user.status_change'

export interface AuditEntry {
  action: AuditAction
  targetUserId: string
  /** What changed (from/to, e-mail). Never a password, token or hash. */
  details?: Prisma.InputJsonValue
}

/**
 * Writes the durable ms_user.audit_log row. Takes the TRANSACTION client so the
 * row commits or rolls back together with the change it describes: there is no
 * state where a role changed and nobody can tell who did it.
 *
 * It also emits the structured log line (requestId, route, decision) the plan
 * asks for, so the same event is searchable in Loki.
 */
export async function writeAuditLog(
  tx: Prisma.TransactionClient,
  request: FastifyRequest,
  entry: AuditEntry
): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorUserId: request.auth?.userId ?? null,
      actorRole: request.auth?.role ?? null,
      action: entry.action,
      targetUserId: entry.targetUserId,
      ...(entry.details !== undefined ? { details: entry.details } : {}),
    },
  })
  audit(request, 'admin.action', { action: entry.action, targetUserId: entry.targetUserId })
}
