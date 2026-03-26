'use client'

import { useState } from 'react'
import { useAuth } from '@/lib/AuthContext'
import { X, LogIn } from 'lucide-react'

export default function SignInBanner() {
  const { user, loading, signIn } = useAuth()
  const [dismissed, setDismissed] = useState(false)

  // Don't show if loading, signed in, or dismissed
  if (loading || user || dismissed) return null

  return (
    <div className="w-full bg-amber/10 border-b border-amber/20 px-4 py-2.5 flex items-center gap-3">
      <p className="text-amber text-xs font-body flex-1">
        Sign in to save favorites, plan meals and sync with your iPhone.
      </p>
      <button
        onClick={signIn}
        className="flex items-center gap-1.5 bg-amber text-ink text-xs font-body font-semibold px-3 py-1.5 rounded-lg shrink-0 hover:bg-amber-glow transition-colors"
      >
        <LogIn size={12} />
        Sign in
      </button>
      <button
        onClick={() => setDismissed(true)}
        className="text-amber/60 hover:text-amber transition-colors shrink-0"
      >
        <X size={14} />
      </button>
    </div>
  )
}
