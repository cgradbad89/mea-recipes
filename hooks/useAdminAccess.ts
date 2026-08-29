'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/AuthContext'
import { hasAdminAccessClaims } from '@/lib/admin'

/**
 * Client-side admin-affordance check (reuses the existing recipe-admin
 * identity policy from `lib/admin.ts` — mirrors the pattern already used in
 * `app/recipes/[id]/page.tsx` for the delete-recipe gate). This never grants
 * access on its own: every mutation still goes through a server-verified
 * `verifyAdminToken` check. It only decides whether to render the
 * `/mapping-review` affordance at all.
 */
export function useAdminAccess(): { isAdmin: boolean; checked: boolean } {
  const { user } = useAuth()
  const [isAdmin, setIsAdmin] = useState(false)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    let active = true
    if (!user) {
      setIsAdmin(false)
      setChecked(true)
      return () => { active = false }
    }

    const verifiedEmailAdmin = hasAdminAccessClaims({
      email: user.email,
      email_verified: user.emailVerified,
    })
    if (verifiedEmailAdmin) {
      setIsAdmin(true)
      setChecked(true)
      return () => { active = false }
    }

    setChecked(false)
    user.getIdTokenResult()
      .then(result => {
        if (!active) return
        setIsAdmin(hasAdminAccessClaims({
          admin: result.claims.admin,
          email: result.claims.email,
          email_verified: result.claims.email_verified,
        }))
        setChecked(true)
      })
      .catch(() => {
        if (active) {
          setIsAdmin(false)
          setChecked(true)
        }
      })
    return () => { active = false }
  }, [user])

  return { isAdmin, checked }
}
