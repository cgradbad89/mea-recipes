'use client'

import { useState } from 'react'
import { useAuth } from '@/lib/AuthContext'
import { LogIn, LogOut, Loader2 } from 'lucide-react'

export default function AuthButton() {
  const { user, loading, signIn, signOut } = useAuth()
  const [confirming, setConfirming] = useState(false)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-2">
        <Loader2 size={16} className="animate-spin text-faint" />
      </div>
    )
  }

  if (user) {
    return (
      <div className="flex flex-col gap-1">
        {/* User info */}
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          {user.photoURL ? (
            <img src={user.photoURL} alt="" className="w-6 h-6 rounded-full" />
          ) : (
            <div className="w-6 h-6 rounded-full bg-amber/20 flex items-center justify-center">
              <span className="text-amber text-xs font-body font-semibold">
                {(user.displayName || user.email || '?')[0].toUpperCase()}
              </span>
            </div>
          )}
          <span className="text-muted text-xs font-body truncate flex-1">
            {user.displayName || user.email}
          </span>
        </div>

        {/* Sign out — with confirmation */}
        {confirming ? (
          <div className="flex gap-2 px-2">
            <button
              onClick={() => setConfirming(false)}
              className="flex-1 text-xs font-body py-1.5 rounded-lg border border-border text-faint hover:text-cream transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => { signOut(); setConfirming(false) }}
              className="flex-1 text-xs font-body py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors"
            >
              Sign out
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-faint text-xs font-body hover:text-cream hover:bg-card transition-all"
          >
            <LogOut size={13} />
            Sign out
          </button>
        )}
      </div>
    )
  }

  return (
    <button
      onClick={signIn}
      className="flex items-center gap-2 w-full px-3 py-2.5 rounded-xl border border-border text-muted text-sm font-body hover:border-amber/30 hover:text-cream transition-all"
    >
      <LogIn size={14} />
      Sign in with Google
    </button>
  )
}
