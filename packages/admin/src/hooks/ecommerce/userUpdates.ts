import { USER_SERVICE_URL } from '../../data/serviceUrls'
import { apiFetch, errorText, toApiError } from '../../data/apiFetch'

export type UserRole = 'ADMIN' | 'CUSTOMER' | 'VENDOR'

export interface UserEdit {
  firstName: string
  lastName: string
  /** Undefined when the role control was disabled (non-admin caller). */
  role?: UserRole
  isActive: boolean
}

export interface UserBaseline {
  id: string
  firstName: string
  lastName: string
  role: string
  isActive: boolean
}

async function patch(path: string, body: unknown): Promise<void> {
  const res = await apiFetch(`${USER_SERVICE_URL}/api/v1/users/${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw await toApiError(res)
}

/**
 * Applies an edit through the three dedicated ms-user routes:
 *   PATCH /users/:id         {firstName, lastName}   (profile only)
 *   PATCH /users/:id/role    {role}                  (ADMIN + aal2, never your own)
 *   PATCH /users/:id/status  {isActive}              (ADMIN, never deactivate yourself)
 * Only fields that changed are sent. Steps are independent, so one refusal
 * (SELF_ROLE_CHANGE, MFA_REQUIRED, FORBIDDEN) does not hide the others;
 * returns one message per failed step.
 */
export async function applyUserEdit(before: UserBaseline, edit: UserEdit): Promise<string[]> {
  const steps: Array<[string, () => Promise<void>]> = []
  if (edit.firstName !== before.firstName || edit.lastName !== before.lastName) {
    steps.push([
      'profile',
      () => patch(before.id, { firstName: edit.firstName, lastName: edit.lastName }),
    ])
  }
  if (edit.role !== undefined && edit.role !== before.role) {
    steps.push(['role', () => patch(`${before.id}/role`, { role: edit.role })])
  }
  if (edit.isActive !== before.isActive) {
    steps.push(['status', () => patch(`${before.id}/status`, { isActive: edit.isActive })])
  }

  const failures: string[] = []
  for (const [label, run] of steps) {
    try {
      await run()
    } catch (err) {
      failures.push(`${label}: ${errorText(err)}`)
    }
  }
  return failures
}

export function setUserStatus(id: string, isActive: boolean): Promise<void> {
  return patch(`${id}/status`, { isActive })
}
