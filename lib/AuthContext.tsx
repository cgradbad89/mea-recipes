'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithEmailAndPassword,
  EmailAuthProvider,
  linkWithCredential,
  reauthenticateWithPopup,
  updatePassword,
  sendPasswordResetEmail,
  signOut as firebaseSignOut
} from 'firebase/auth'
import { auth, googleProvider } from '@/lib/firebase'

interface AuthContextType {
  user: User | null
  loading: boolean
  // True when the signed-in user already has an email/password credential linked
  // to their account (i.e. their providerData includes the 'password' provider).
  hasPassword: boolean
  // Google sign-in (unchanged from Batch <7).
  signIn: () => Promise<void>
  // Batch 7 — email/password sign-in ONLY (no account creation). Throws the raw
  // Firebase error so callers can map auth/* codes to friendly messages.
  signInWithEmail: (email: string, password: string) => Promise<void>
  // Batch 7 — attach a password credential to the CURRENT user (account linking).
  // Preserves uid/data; transparently re-auths with Google on requires-recent-login.
  linkPassword: (password: string) => Promise<void>
  // Batch 7 — change the password on an already-linked account (re-auths if stale).
  changePassword: (newPassword: string) => Promise<void>
  // Batch 7 — send Firebase's built-in password-reset email.
  sendReset: (email: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  hasPassword: false,
  signIn: async () => {},
  signInWithEmail: async () => {},
  linkPassword: async () => {},
  changePassword: async () => {},
  sendReset: async () => {},
  signOut: async () => {},
})

function isStandaloneMode(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true
  )
}

// Whether a Firebase user already has the email/password provider linked.
function userHasPassword(u: User | null): boolean {
  return !!u?.providerData?.some(p => p.providerId === 'password')
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [hasPassword, setHasPassword] = useState(false)

  useEffect(() => {
    // Handle redirect result on app load (PWA standalone mode)
    getRedirectResult(auth).catch(() => {})

    const unsub = onAuthStateChanged(auth, u => {
      setUser(u)
      setHasPassword(userHasPassword(u))
      setLoading(false)
    })
    return unsub
  }, [])

  const signIn = async () => {
    try {
      if (isStandaloneMode()) {
        await signInWithRedirect(auth, googleProvider)
      } else {
        await signInWithPopup(auth, googleProvider)
      }
    } catch (err) {
      console.error('Sign in error:', err)
    }
  }

  // Email/password SIGN-IN only — never createUserWithEmailAndPassword. A password
  // only exists once the user has linked one via linkPassword() below, so there is
  // no path here that mints a new (separate-uid) account.
  const signInWithEmail = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password)
  }

  // Account LINKING: attach an EmailAuthProvider credential (built from the user's
  // OWN existing email) to the currently signed-in user. This keeps the SAME uid and
  // all existing data — it is NOT a new account. If the Google session is too old,
  // Firebase throws auth/requires-recent-login; we re-authenticate with Google (the
  // user's existing provider) and retry the link once.
  const linkPassword = async (password: string) => {
    const current = auth.currentUser
    if (!current) throw new Error('You must be signed in to set up a password.')
    if (!current.email) throw new Error('Your account has no email address to attach a password to.')

    const credential = EmailAuthProvider.credential(current.email, password)
    try {
      await linkWithCredential(current, credential)
    } catch (err: any) {
      if (err?.code === 'auth/requires-recent-login') {
        // Re-auth with Google (same account, no switch risk), then retry the link.
        await reauthenticateWithPopup(current, googleProvider)
        await linkWithCredential(current, credential)
      } else {
        throw err
      }
    }
    // Linking does not reliably fire onAuthStateChanged, so refresh + flip state
    // ourselves so the settings UI updates immediately.
    await current.reload().catch(() => {})
    setHasPassword(true)
  }

  // Change the password on an already-linked account. Same recent-login handling.
  const changePassword = async (newPassword: string) => {
    const current = auth.currentUser
    if (!current) throw new Error('You must be signed in to change your password.')
    try {
      await updatePassword(current, newPassword)
    } catch (err: any) {
      if (err?.code === 'auth/requires-recent-login') {
        await reauthenticateWithPopup(current, googleProvider)
        await updatePassword(current, newPassword)
      } else {
        throw err
      }
    }
  }

  // Built-in Firebase reset email. Callers show a neutral confirmation regardless of
  // outcome so we never leak which emails are registered.
  const sendReset = async (email: string) => {
    await sendPasswordResetEmail(auth, email)
  }

  const signOut = async () => {
    try {
      await firebaseSignOut(auth)
    } catch (err) {
      console.error('Sign out error:', err)
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        hasPassword,
        signIn,
        signInWithEmail,
        linkPassword,
        changePassword,
        sendReset,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
