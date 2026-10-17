import { useEffect, useState, type ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { DevMockMfaBadge, DevMockMfaScreen } from './DevMockMfa'
import { canUseCockpit } from './permissions'
import {
  AccessDeniedScreen,
  ConfigMissingScreen,
  MfaScreen,
  RoleErrorScreen,
  SignInScreen,
  StatusScreen,
} from './AuthScreens'

/**
 * Gates the whole app. Admin data is never rendered (and so never fetched)
 * until: session present, role resolved and allowed, and -- for ADMIN -- aal2.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { status, role, roleState, aal, mfa } = useAuth()
  // DEV-ONLY mock of the TOTP step. Both conditions are read inline (not from a shared
  // constant) so the production build folds `DEV === true` to false and drops the mock code.
  // Evaluated per render; never driven by a URL/localStorage switch. In-memory state only.
  const mockMfa = import.meta.env.DEV === true && import.meta.env.VITE_MOCK_MFA === 'true'
  const [mockPassed, setMockPassed] = useState(false)

  useEffect(() => {
    // A new sign-in must pass the mock step again.
    if (status === 'signed-out') setMockPassed(false)
  }, [status])

  if (status === 'unconfigured') return <ConfigMissingScreen />
  if (status === 'loading') return <StatusScreen title="Checking session" />
  if (status === 'signed-out') return <SignInScreen />

  if (roleState === 'loading') return <StatusScreen title="Checking permissions" />
  if (roleState === 'error') return <RoleErrorScreen />
  if (!canUseCockpit(role)) return <AccessDeniedScreen />

  if (role === 'ADMIN' && aal !== 'aal2' && !(mockMfa && mockPassed)) {
    if (import.meta.env.DEV === true && mockMfa) {
      return <DevMockMfaScreen onPass={() => setMockPassed(true)} />
    }
    return <MfaScreen />
  }

  return (
    <>
      {import.meta.env.DEV === true && mockMfa && <DevMockMfaBadge />}
      {children}
      {mfa.pending && <MfaScreen overlay />}
    </>
  )
}
