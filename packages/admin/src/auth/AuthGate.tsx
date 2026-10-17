import type { ReactNode } from 'react'
import { useAuth } from './AuthContext'
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

  if (status === 'unconfigured') return <ConfigMissingScreen />
  if (status === 'loading') return <StatusScreen title="Checking session" />
  if (status === 'signed-out') return <SignInScreen />

  if (roleState === 'loading') return <StatusScreen title="Checking permissions" />
  if (roleState === 'error') return <RoleErrorScreen />
  if (!canUseCockpit(role)) return <AccessDeniedScreen />

  if (role === 'ADMIN' && aal !== 'aal2') return <MfaScreen />

  return (
    <>
      {children}
      {mfa.pending && <MfaScreen overlay />}
    </>
  )
}
