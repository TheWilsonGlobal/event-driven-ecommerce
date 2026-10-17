import type { ReactNode } from 'react'
import { vi } from 'vitest'
import { AuthContext, type AuthValue } from '../auth/AuthContext'

export function fakeAuth(overrides: Partial<AuthValue> = {}): AuthValue {
  return {
    status: 'ready',
    email: 'admin@example.com',
    role: 'ADMIN',
    roleState: 'resolved',
    aal: 'aal2',
    session: { access_token: 'test-token' },
    signIn: vi.fn(async () => null),
    signOut: vi.fn(async () => {}),
    retryRole: vi.fn(),
    mfa: {
      pending: false,
      findFactor: vi.fn(async () => 'factor-1'),
      enroll: vi.fn(async () => ({
        factorId: 'f2',
        qrCode: 'data:image/svg+xml;base64,AA',
        secret: 'ABCDEF',
      })),
      verify: vi.fn(async () => null),
      cancel: vi.fn(),
    },
    ...overrides,
  }
}

export function WithAuth({ value, children }: { value?: Partial<AuthValue>; children: ReactNode }) {
  return <AuthContext.Provider value={fakeAuth(value)}>{children}</AuthContext.Provider>
}
