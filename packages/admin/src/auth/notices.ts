// Tiny bridge from non-React code (apiFetch) to the app toast.
export const NOTICE_EVENT = 'admin:notice'

export function emitNotice(message: string) {
  window.dispatchEvent(new CustomEvent(NOTICE_EVENT, { detail: message }))
}
