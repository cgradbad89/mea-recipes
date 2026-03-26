'use client'

import { useState, useEffect } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/lib/AuthContext'
import type { RecipeMeta } from '@/lib/userdata'

export function useRecipeMetas(): Record<string, RecipeMeta> {
  const { user } = useAuth()
  const [metas, setMetas] = useState<Record<string, RecipeMeta>>({})

  useEffect(() => {
    if (!user) { setMetas({}); return }
    const path = collection(db, 'users', user.uid, 'recipes', 'root', 'meta')
    getDocs(path).then(snap => {
      const map: Record<string, RecipeMeta> = {}
      snap.docs.forEach(d => { map[d.id] = d.data() as RecipeMeta })
      setMetas(map)
    })
  }, [user])

  return metas
}
