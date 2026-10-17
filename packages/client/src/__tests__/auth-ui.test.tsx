import React from 'react'
import { render, screen, renderHook, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AuthModal from '../components/AuthModal'
import StorefrontHeader from '../components/StorefrontHeader'
import { AuthContext, type AuthContextValue } from '../components/authContext'
import { useCheckout } from '../app/hooks/useCheckout'

jest.mock('../lib/supabase/browser', () => ({ getBrowserSupabase: () => null }))

function ctx(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    configured: true,
    loading: false,
    user: null,
    isOps: false,
    openAuthModal: jest.fn(),
    closeAuthModal: jest.fn(),
    signInWithPassword: jest.fn().mockResolvedValue({ ok: true }),
    signUp: jest.fn().mockResolvedValue({ ok: true, needsEmailConfirmation: true }),
    sendMagicLink: jest.fn().mockResolvedValue({ ok: true, linkSent: true }),
    signOut: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function renderModal(value: AuthContextValue, onClose = jest.fn()) {
  render(
    <AuthContext.Provider value={value}>
      <AuthModal isOpen reason="Sign in to check out." onClose={onClose} />
    </AuthContext.Provider>
  )
  return onClose
}

describe('AuthModal', () => {
  it('is an accessible modal dialog with labelled fields', () => {
    renderModal(ctx())
    const dialog = screen.getByRole('dialog', { name: 'Sign in' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  it('moves focus into the dialog and closes on Escape', async () => {
    const onClose = renderModal(ctx())
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5))
    })
    expect(screen.getByLabelText('Email')).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('traps Tab focus inside the dialog', async () => {
    renderModal(ctx())
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5))
    })
    const close = screen.getByRole('button', { name: 'Close' })
    close.focus()
    await userEvent.tab({ shift: true })
    // Shift+Tab from the first focusable element wraps to the last one (the submit button).
    expect(document.activeElement).toHaveAttribute('type', 'submit')
    await userEvent.tab()
    expect(document.activeElement).toBe(close)
  })

  it('validates the email before calling Supabase', async () => {
    const value = ctx()
    renderModal(value)
    await userEvent.type(screen.getByLabelText('Email'), 'not-an-email')
    await userEvent.type(screen.getByLabelText('Password'), 'whatever')
    await userEvent.click(screen.getAllByRole('button', { name: 'Sign in' }).pop()!)
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument()
    expect(value.signInWithPassword).not.toHaveBeenCalled()
  })

  it('enforces the 10 character password rule on sign-up with an inline hint', async () => {
    const value = ctx()
    renderModal(value)
    await userEvent.click(screen.getByRole('button', { name: 'Sign up' }))
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co')
    await userEvent.type(screen.getByLabelText('Password'), 'short')
    expect(screen.getByText(/At least 10 characters \(5\/10\)/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(screen.getByText('Password must be at least 10 characters.')).toBeInTheDocument()
    expect(value.signUp).not.toHaveBeenCalled()
  })

  it('shows the "check your email" state after sign-up', async () => {
    const value = ctx()
    renderModal(value)
    await userEvent.click(screen.getByRole('button', { name: 'Sign up' }))
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co')
    await userEvent.type(screen.getByLabelText('Password'), 'longenough-pw1')
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(value.signUp).toHaveBeenCalledWith('a@b.co', 'longenough-pw1')
    expect(await screen.findByRole('dialog', { name: 'Check your email' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('a@b.co')
  })

  it('announces sign-in errors through an alert in a live region', async () => {
    const value = ctx({
      signInWithPassword: jest
        .fn()
        .mockResolvedValue({ ok: false, error: 'Incorrect email or password.' }),
    })
    renderModal(value)
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co')
    await userEvent.type(screen.getByLabelText('Password'), 'pw')
    await userEvent.click(screen.getAllByRole('button', { name: 'Sign in' }).pop()!)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Incorrect email or password.')
    expect(alert.parentElement).toHaveAttribute('aria-live', 'polite')
  })

  it('magic link mode needs no password', async () => {
    const value = ctx()
    renderModal(value)
    await userEvent.click(screen.getByRole('button', { name: 'Magic link' }))
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co')
    await userEvent.click(screen.getByRole('button', { name: 'Send magic link' }))
    expect(value.sendMagicLink).toHaveBeenCalledWith('a@b.co')
    expect(await screen.findByRole('dialog', { name: 'Check your email' })).toBeInTheDocument()
  })
})

describe('StorefrontHeader', () => {
  const props = { searchQuery: '', onSearch: jest.fn(), totalCartCount: 0, onOpenCart: jest.fn() }

  it('offers Sign in when signed out and opens the modal', async () => {
    const value = ctx()
    render(
      <AuthContext.Provider value={value}>
        <StorefrontHeader {...props} />
      </AuthContext.Provider>
    )
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(value.openAuthModal).toHaveBeenCalled()
  })

  it('shows the email and a sign-out button when signed in', async () => {
    const value = ctx({ user: { id: 'u1', email: 'me@shop.test' } })
    render(
      <AuthContext.Provider value={value}>
        <StorefrontHeader {...props} />
      </AuthContext.Provider>
    )
    expect(screen.getByText('me@shop.test')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(value.signOut).toHaveBeenCalled()
  })

  it('renders nothing auth-related when Supabase is not configured (anonymous storefront)', () => {
    render(
      <AuthContext.Provider value={ctx({ configured: false })}>
        <StorefrontHeader {...props} />
      </AuthContext.Provider>
    )
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Cart/ })).toBeInTheDocument()
  })
})

describe('checkout requires sign-in', () => {
  const base = {
    cart: [],
    subtotal: 0,
    estimatedTax: 0,
    shippingFee: 0,
    discountAmount: 0,
    finalTotal: 0,
    clearCart: jest.fn(),
    showToast: jest.fn(),
  }
  const wrap = (value: AuthContextValue) =>
    function Wrapper({ children }: { children: React.ReactNode }) {
      return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
    }

  it('opens the sign-in modal when signed out and resumes checkout after sign-in', () => {
    const value = ctx()
    const { result } = renderHook(() => useCheckout(base), { wrapper: wrap(value) })
    act(() => result.current.beginCheckout())
    expect(value.openAuthModal).toHaveBeenCalledTimes(1)
    expect(result.current.isCheckoutOpen).toBe(false)

    const { onSignedIn } = (value.openAuthModal as jest.Mock).mock.calls[0][0]
    act(() => onSignedIn())
    expect(result.current.isCheckoutOpen).toBe(true)
    expect(result.current.checkoutStep).toBe('shipping')
  })

  it('goes straight to checkout when signed in', () => {
    const value = ctx({ user: { id: 'u1', email: 'me@shop.test' } })
    const { result } = renderHook(() => useCheckout(base), { wrapper: wrap(value) })
    act(() => result.current.beginCheckout())
    expect(value.openAuthModal).not.toHaveBeenCalled()
    expect(result.current.isCheckoutOpen).toBe(true)
  })
})
