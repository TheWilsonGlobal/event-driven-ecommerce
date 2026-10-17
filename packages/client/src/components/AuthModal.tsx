'use client'

import React, { useEffect, useId, useRef, useState } from 'react'
import { useAuth } from './authContext'

type Mode = 'signin' | 'signup' | 'magic'

export const MIN_PASSWORD_LENGTH = 10
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface AuthModalProps {
  isOpen: boolean
  reason?: string | undefined
  onClose: () => void
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

const inputClass =
  'w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 font-medium outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200'

export default function AuthModal({ isOpen, reason, onClose }: AuthModalProps) {
  const { signInWithPassword, signUp, sendMagicLink, configured } = useAuth()
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [touched, setTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<'confirm' | 'link' | null>(null)

  const dialogRef = useRef<HTMLDivElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const uid = useId()
  const titleId = `${uid}-title`
  const emailId = `${uid}-email`
  const passwordId = `${uid}-password`
  const hintId = `${uid}-hint`
  const emailErrId = `${uid}-email-err`

  // Focus management: move focus in on open, restore on close.
  useEffect(() => {
    if (!isOpen) return
    returnFocus.current = document.activeElement as HTMLElement | null
    setMode('signin')
    setPassword('')
    setTouched(false)
    setError('')
    setNotice(null)
    const t = setTimeout(() => emailRef.current?.focus(), 0)
    return () => {
      clearTimeout(t)
      returnFocus.current?.focus?.()
    }
  }, [isOpen])

  if (!isOpen) return null

  const emailValid = EMAIL_RE.test(email.trim())
  const passwordLongEnough = password.length >= MIN_PASSWORD_LENGTH
  const needsPassword = mode !== 'magic'
  const passwordOk = mode === 'signup' ? passwordLongEnough : password.length > 0

  const emailError = touched && !emailValid ? 'Enter a valid email address.' : ''
  const passwordError =
    touched && needsPassword && !passwordOk
      ? mode === 'signup'
        ? `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
        : 'Enter your password.'
      : ''

  const switchMode = (next: Mode) => {
    setMode(next)
    setError('')
    setTouched(false)
    setNotice(null)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab') return
    const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE)
    if (!nodes || nodes.length === 0) return
    const first = nodes[0]
    const last = nodes[nodes.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setTouched(true)
    setError('')
    if (!emailValid || (needsPassword && !passwordOk)) return
    setSubmitting(true)
    try {
      const addr = email.trim()
      if (mode === 'signin') {
        const res = await signInWithPassword(addr, password)
        if (!res.ok) setError(res.error ?? 'Could not sign in.')
        // On success the provider closes the modal and resumes checkout.
      } else if (mode === 'signup') {
        const res = await signUp(addr, password)
        if (!res.ok) setError(res.error ?? 'Could not create the account.')
        else if (res.needsEmailConfirmation) setNotice('confirm')
      } else {
        const res = await sendMagicLink(addr)
        if (!res.ok) setError(res.error ?? 'Could not send the link.')
        else setNotice('link')
      }
    } finally {
      setPassword('')
      setSubmitting(false)
    }
  }

  const heading =
    notice !== null
      ? 'Check your email'
      : mode === 'signin'
        ? 'Sign in'
        : mode === 'signup'
          ? 'Create your account'
          : 'Email me a sign-in link'

  const tabClass = (m: Mode) =>
    `px-3 py-1.5 rounded-lg text-xs font-bold ${
      mode === m ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
    }`

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm"
      onKeyDown={onKeyDown}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-slate-200 relative p-8"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <span aria-hidden="true">✕</span>
        </button>

        <h2 id={titleId} className="text-xl font-black text-slate-900 mb-1">
          {heading}
        </h2>
        {reason && notice === null && <p className="text-xs text-slate-600 mb-3">{reason}</p>}

        {!configured && (
          <p role="alert" className="text-xs text-rose-600 font-semibold mb-3">
            Sign-in is not configured for this storefront.
          </p>
        )}

        {notice !== null ? (
          <div className="space-y-4 text-sm text-slate-700" role="status">
            <p>
              {notice === 'confirm'
                ? 'We sent a confirmation link to '
                : 'We sent a sign-in link to '}
              <b>{email.trim()}</b>.{' '}
              {notice === 'confirm'
                ? 'Click it to activate your account, then come back and sign in.'
                : 'Click it to sign in. Your cart is saved on this device.'}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs px-6 py-3 rounded-xl"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            <div className="flex gap-2 my-4" role="group" aria-label="Sign-in method">
              <button
                type="button"
                className={tabClass('signin')}
                aria-pressed={mode === 'signin'}
                onClick={() => switchMode('signin')}
              >
                Sign in
              </button>
              <button
                type="button"
                className={tabClass('signup')}
                aria-pressed={mode === 'signup'}
                onClick={() => switchMode('signup')}
              >
                Sign up
              </button>
              <button
                type="button"
                className={tabClass('magic')}
                aria-pressed={mode === 'magic'}
                onClick={() => switchMode('magic')}
              >
                Magic link
              </button>
            </div>

            <form onSubmit={onSubmit} noValidate className="space-y-4 text-xs">
              <div>
                <label htmlFor={emailId} className="font-bold text-slate-700 block mb-1">
                  Email
                </label>
                <input
                  ref={emailRef}
                  id={emailId}
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={emailError ? true : undefined}
                  aria-describedby={emailError ? emailErrId : undefined}
                  className={inputClass}
                />
                {emailError && (
                  <p id={emailErrId} className="text-[11px] text-rose-600 font-semibold mt-1">
                    {emailError}
                  </p>
                )}
              </div>

              {needsPassword && (
                <div>
                  <label htmlFor={passwordId} className="font-bold text-slate-700 block mb-1">
                    Password
                  </label>
                  <input
                    id={passwordId}
                    type="password"
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    aria-invalid={passwordError ? true : undefined}
                    aria-describedby={mode === 'signup' ? hintId : undefined}
                    className={inputClass}
                  />
                  {mode === 'signup' && (
                    <p
                      id={hintId}
                      className={`text-[11px] mt-1 ${
                        passwordError
                          ? 'text-rose-600 font-semibold'
                          : passwordLongEnough
                            ? 'text-emerald-700'
                            : 'text-slate-500'
                      }`}
                    >
                      {passwordError ||
                        `At least ${MIN_PASSWORD_LENGTH} characters${
                          passwordLongEnough
                            ? ' - looks good'
                            : ` (${password.length}/${MIN_PASSWORD_LENGTH})`
                        }.`}
                    </p>
                  )}
                  {mode === 'signin' && passwordError && (
                    <p className="text-[11px] text-rose-600 font-semibold mt-1">{passwordError}</p>
                  )}
                </div>
              )}

              {mode === 'magic' && (
                <p className="text-[11px] text-slate-500">
                  We will email you a one-time link. No password needed.
                </p>
              )}

              <div aria-live="polite" aria-atomic="true">
                {error && (
                  <p
                    role="alert"
                    className="text-[11px] text-rose-600 font-semibold bg-rose-50 border border-rose-200 rounded-lg p-2.5"
                  >
                    {error}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={submitting || !configured}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm py-3 rounded-xl transition disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                {submitting
                  ? 'Please wait...'
                  : mode === 'signin'
                    ? 'Sign in'
                    : mode === 'signup'
                      ? 'Create account'
                      : 'Send magic link'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
