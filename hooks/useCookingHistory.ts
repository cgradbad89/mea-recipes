'use client'

import { useState, useEffect } from 'react'
import { collection, getDocs, orderBy, query } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/lib/AuthContext'

export interface WeekPlanData {
  weekID: string
  weekStartISO: string
  plannedRecipeIDs: string[]
  cookedRecipeIDs: string[]
}

export function useCookingHistory() {
  const { user } = useAuth()
  const [weeks, setWeeks] = useState<WeekPlanData[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) { setWeeks([]); setLoading(false); return }
    const ref = collection(db, 'users', user.uid, 'pantry', 'root', 'weekPlans')
    getDocs(query(ref, orderBy('weekStartISO', 'desc'))).then(snap => {
      const data = snap.docs.map(d => d.data() as WeekPlanData)
      setWeeks(data)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [user])

  return { weeks, loading }
}
