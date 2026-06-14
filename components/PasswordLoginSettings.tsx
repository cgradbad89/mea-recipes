'use client'

// Batch 7 — "Set up password login" control for the account/profile area (rendered
// inside AuthButton, where sign-out lives). Visible only when signed in. Detects an
// existing password credential via AuthContext.hasPassword (derived from the user's
// providerData 'password' entry):
//   • no password linked  → "Add a password" form → linkPassword() (account LINKING,
//     same uid/data — never a new account)
//   • password linked     → "Password login enabled" + optional "Change password"
// All writes go through the signed-in user, so this only attaches/updates a credential
// on the EXISTING account.

import { useState } from 'react'
import { useAuth } from '@/lib/AuthContext'
import { KeyRound, Check, Loader2, X } from 'lucide-react'

const MIN_LEN = 6 // Firebase's minimum password length.

export default function PasswordLoginSettings() {
  const { user, hasPassword, linkPassword, changePassword } = useAuth()

  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  if (!user) return null

  const changing = hasPassword // in "change password" mode when one is already linked

  const reset = () => {
    setOpen(false); setPassword(''); setConfirm(''); setError(null); setDone(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password.length < MIN_LEN) {
      setError(`Password must be at least ${MIN_LEN} characters.`)
      return
    }
    if (password !== confirm) {
      setError('Passwords don’t match.')
      return
    }
    setBusy(true)
    try {
      if (changing) {
        await changePassword(password)
      } else {
        await linkPassword(password)
      }
      setDone(true)
      setPassword(''); setConfirm('')
    } catch (err: any) {
      setError(mapLinkError(err))
    } finally {
      setBusy(false)
    }
  }

  // ── Success confirmation ────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="flex items-start gap-2 px-2 py-2 rounded-xl bg-amber/10 border border-amber/20">
        <Check size={13} className="text-amber mt-0.5 shrink-0" />
        <p className="text-amber text-xs font-body">
          {changing
            ? 'Password updated.'
            : 'Password set. You can now sign in with your email and password.'}
        </p>
      </div>
    )
  }

  // ── Collapsed entry point ────────────────────────────────────────────────────
  if (!open) {
    if (changing) {
      return (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 px-2 py-1.5 text-faint text-xs font-body">
            <KeyRound size={12} className="text-amber" />
            Password login enabled
          </div>
          <button
            onClick={() => setOpen(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-faint text-xs font-body hover:text-cream hover:bg-card transition-all"
          >
            Change password
          </button>
        </div>
      )
    }
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-3 py-2 rounded-xl text-faint text-xs font-body hover:text-cream hover:bg-card transition-all"
      >
        <KeyRound size={13} />
        Set up password login
      </button>
    )
  }

  // ── Expanded form ────────────────────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 px-2 py-2 rounded-xl bg-card border border-border">
      <div className="flex items-center justify-between">
        <span className="text-cream text-xs font-body font-medium">
          {changing ? 'Change password' : 'Add a password'}
        </span>
        <button type="button" onClick={reset} className="text-faint hover:text-cream transition-colors">
          <X size={13} />
        </button>
      </div>
      {!changing && (
        <p className="text-faint text-[11px] font-body leading-snug">
          Adds email + password sign-in to <span className="text-muted">{user.email}</span> — your same account.
        </p>
      )}
      <input
        type="password"
        autoComplete="new-password"
        placeholder={changing ? 'New password' : 'Password'}
        value={password}
        onChange={e => setPassword(e.target.value)}
        className="input-field text-sm py-2"
      />
      <input
        type="password"
        autoComplete="new-password"
        placeholder="Confirm password"
        value={confirm}
        onChange={e => setConfirm(e.target.value)}
        className="input-field text-sm py-2"
      />
      {error && <p className="text-red-400 text-[11px] font-body">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="btn-primary w-full flex items-center justify-center gap-2 text-xs py-2 disabled:opacity-40"
      >
        {busy
          ? <><Loader2 size={13} className="animate-spin" /> Saving…</>
          : (changing ? 'Update password' : 'Set password')}
      </button>
    </form>
  )
}

// Map the Firebase auth/* error codes the linking + change flows can raise to clear,
// user-facing messages. requires-recent-login is handled inside AuthContext (re-auth
// + retry), so a code reaching here means the re-auth popup itself failed/was closed.
function mapLinkError(err: any): string {
  const code = err?.code || ''
  switch (code) {
    case 'auth/weak-password':
      return `Password must be at least ${MIN_LEN} characters.`
    case 'auth/email-already-in-use':
    case 'auth/credential-already-in-use':
      return 'That email is already linked to a different account, so it can’t be attached here.'
    case 'auth/provider-already-linked':
      return 'Password login is already set up for this account.'
    case 'auth/operation-not-allowed':
      return 'Email/password sign-in must be enabled in the Firebase console first.'
    case 'auth/requires-recent-login':
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
    case 'auth/popup-blocked':
      return 'Please re-confirm your Google sign-in to continue, then try again.'
    default:
      return err?.message || 'Something went wrong. Please try again.'
  }
}
