'use client'

// Batch 7 — login-screen controls. Keeps the existing "Continue with Google" button
// and ADDS an email/password SIGN-IN form (no signup path — a password only exists
// after a user links one in settings) plus a "Forgot password?" reset flow. Dropped
// into the existing sign-in gates (favorites, plan) in place of the lone Google button.

import { useState } from 'react'
import { useAuth } from '@/lib/AuthContext'
import { LogIn, Loader2, ArrowLeft } from 'lucide-react'

export default function SignInOptions() {
  const { signIn, signInWithEmail, sendReset } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showHint, setShowHint] = useState(false)
  const [busy, setBusy] = useState(false)

  // Forgot-password sub-view state.
  const [forgot, setForgot] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resetMsg, setResetMsg] = useState<string | null>(null)
  const [resetBusy, setResetBusy] = useState(false)

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setShowHint(false)
    if (!email.trim() || !password) {
      setError('Enter your email and password.')
      return
    }
    setBusy(true)
    try {
      await signInWithEmail(email.trim(), password)
      // onAuthStateChanged flips the gate — nothing else to do here.
    } catch (err: any) {
      const code = err?.code || ''
      if (code === 'auth/invalid-email') {
        setError('That doesn’t look like a valid email address.')
      } else if (code === 'auth/too-many-requests') {
        setError('Too many attempts. Please wait a few minutes and try again.')
      } else if (code === 'auth/operation-not-allowed') {
        setError('Email/password sign-in isn’t enabled yet — please use Google for now.')
      } else {
        // wrong-password / user-not-found / invalid-credential — keep it friendly and
        // do not reveal which emails are registered. Surface the no-password hint.
        setError('Email or password is incorrect.')
        setShowHint(true)
      }
    } finally {
      setBusy(false)
    }
  }

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setResetMsg(null)
    if (!resetEmail.trim()) {
      setResetMsg('Enter the email address for your account.')
      return
    }
    setResetBusy(true)
    try {
      await sendReset(resetEmail.trim())
    } catch (err: any) {
      // Only invalid-email is worth flagging; everything else (incl. user-not-found
      // and operation-not-allowed) falls through to the neutral confirmation so we
      // never leak whether an email is registered or has a password.
      if (err?.code === 'auth/invalid-email') {
        setResetMsg('That doesn’t look like a valid email address.')
        setResetBusy(false)
        return
      }
    }
    setResetMsg('If an account with a password exists for that email, a reset link is on its way. Check your inbox.')
    setResetBusy(false)
  }

  // ── Forgot-password sub-view ───────────────────────────────────────────────
  if (forgot) {
    return (
      <div className="w-full max-w-xs flex flex-col gap-3">
        <form onSubmit={handleReset} className="flex flex-col gap-3">
          <p className="text-muted text-sm font-body text-center">
            Enter your email and we’ll send a password reset link.
          </p>
          <input
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={resetEmail}
            onChange={e => setResetEmail(e.target.value)}
            className="input-field text-sm"
          />
          <button
            type="submit"
            disabled={resetBusy}
            className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-40"
          >
            {resetBusy ? <><Loader2 size={15} className="animate-spin" /> Sending…</> : 'Send reset link'}
          </button>
        </form>
        {resetMsg && <p className="text-amber text-xs font-body text-center">{resetMsg}</p>}
        <button
          onClick={() => { setForgot(false); setResetMsg(null) }}
          className="flex items-center justify-center gap-1.5 text-faint text-xs font-body hover:text-cream transition-colors"
        >
          <ArrowLeft size={12} /> Back to sign in
        </button>
      </div>
    )
  }

  // ── Main sign-in view ──────────────────────────────────────────────────────
  return (
    <div className="w-full max-w-xs flex flex-col gap-4">
      {/* Google — unchanged behaviour */}
      <button
        onClick={signIn}
        className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl border border-border text-cream text-sm font-body font-medium hover:border-amber/30 hover:bg-card transition-all"
      >
        <LogIn size={15} />
        Continue with Google
      </button>

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-border" />
        <span className="text-faint text-[11px] font-body uppercase tracking-widest">or</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      {/* Email + password sign-in (no signup) */}
      <form onSubmit={handleEmailSignIn} className="flex flex-col gap-2.5">
        <input
          type="email"
          autoComplete="email"
          placeholder="Email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          className="input-field text-sm"
        />
        <input
          type="password"
          autoComplete="current-password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="input-field text-sm"
        />
        <button
          type="submit"
          disabled={busy}
          className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-40"
        >
          {busy ? <><Loader2 size={15} className="animate-spin" /> Signing in…</> : 'Sign in'}
        </button>
      </form>

      {error && <p className="text-red-400 text-xs font-body text-center">{error}</p>}
      {showHint && (
        <p className="text-faint text-xs font-body text-center">
          No password set? Sign in with Google first, then add a password in settings.
        </p>
      )}

      <button
        onClick={() => { setForgot(true); setError(null); setShowHint(false) }}
        className="text-faint text-xs font-body hover:text-cream transition-colors"
      >
        Forgot password?
      </button>
    </div>
  )
}
