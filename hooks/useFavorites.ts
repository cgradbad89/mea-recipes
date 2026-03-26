'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/lib/AuthContext'
import { subscribeFavorites, addFavorite, removeFavorite } from '@/lib/userdata'

const LOCAL_KEY = 'mea-favorites'

export function useFavorites() {
  const { user } = useAuth()
  const [favorites, setFavorites] = useState<Set<string>>(new Set())
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (user) {
      const unsub = subscribeFavorites(user.uid, ids => {
        setFavorites(ids)
        setLoaded(true)
      })
      return unsub
    } else {
      try {
        const stored = localStorage.getItem(LOCAL_KEY)
        if (stored) setFavorites(new Set(JSON.parse(stored)))
      } catch {}
      setLoaded(true)
    }
  }, [user])

  const toggle = useCallback(async (id: string) => {
    const isFav = favorites.has(id)
    if (user) {
      if (isFav) await removeFavorite(user.uid, id)
      else await addFavorite(user.uid, id)
    } else {
      setFavorites(prev => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        try { localStorage.setItem(LOCAL_KEY, JSON.stringify(Array.from(next))) } catch {}
        return next
      })
    }
  }, [user, favorites])

  const isFavorite = useCallback((id: string) => favorites.has(id), [favorites])

  return { favorites, toggle, isFavorite, loaded }
}
