// Decouples apiFetch (plain module) from the React AuthProvider. The provider
// registers these callbacks on mount; tests register fakes.

export interface AuthBridge {
  /** Current access token, or null when signed out. */
  getToken: () => string | null
  /** Force a token refresh. Resolves the new token, or null if it failed. */
  refresh: () => Promise<string | null>
  /** Open the MFA verify/enroll flow. Resolves true once aal2 is reached. */
  requestMfa: () => Promise<boolean>
  /** Session is unrecoverable: clear it and show sign-in. */
  onSessionExpired: () => void
  /** Non-fatal user-facing notices (rate limited, forbidden, ...). */
  notify: (message: string) => void
}

const noop: AuthBridge = {
  getToken: () => null,
  refresh: async () => null,
  requestMfa: async () => false,
  onSessionExpired: () => {},
  notify: () => {},
}

let current: AuthBridge = noop

export const getBridge = () => current
export function setAuthBridge(bridge: AuthBridge | null) {
  current = bridge ?? noop
}
