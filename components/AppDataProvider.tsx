'use client'

import React, { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/lib/AuthContext'
import type { Recipe } from '@/types/recipe'
import type { RecipeMeta, PlannedElement } from '@/lib/userdata'
import { getFavoriteIDs, removeFavorite, addFavorite } from '@/lib/userdata'
import { getAllRecipes as fetchAllRecipes } from '@/lib/recipes'

// We need to define WeekPlanData since we are replacing useCookingHistory
export interface WeekPlanData {
  weekID: string
  weekStartISO: string
  plannedRecipeIDs: PlannedElement[]
  cookedRecipeIDs: string[]
}

interface AppDataContextType {
  recipes: Recipe[]
  recipesLoading: boolean
  recipesError: string | null
  refetchRecipes: () => Promise<void>

  metas: Record<string, RecipeMeta>
  metasLoading: boolean
  metasError: string | null
  refetchMetas: () => Promise<void>

  favorites: Set<string>
  favoritesLoading: boolean
  favoritesError: string | null
  refetchFavorites: () => Promise<void>
  toggleFavorite: (id: string) => Promise<void>
  isFavorite: (id: string) => boolean

  cookingHistory: WeekPlanData[]
  cookingHistoryLoading: boolean
  cookingHistoryError: string | null
  refetchCookingHistory: () => Promise<void>
}

const AppDataContext = createContext<AppDataContextType>({
  recipes: [], recipesLoading: true, recipesError: null, refetchRecipes: async () => {},
  metas: {}, metasLoading: true, metasError: null, refetchMetas: async () => {},
  favorites: new Set(), favoritesLoading: true, favoritesError: null, refetchFavorites: async () => {},
  toggleFavorite: async () => {}, isFavorite: () => false,
  cookingHistory: [], cookingHistoryLoading: true, cookingHistoryError: null, refetchCookingHistory: async () => {},
})

const LOCAL_FAV_KEY = 'mea-favorites'
const EMPTY_FAVORITES = new Set<string>()

export function AppDataProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth()

  // --- Recipes (Global) ---
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [recipesLoading, setRecipesLoading] = useState(true)
  const [recipesError, setRecipesError] = useState<string | null>(null)

  const refetchRecipes = useCallback(async () => {
    try {
      setRecipesLoading(true)
      const data = await fetchAllRecipes()
      setRecipes(data)
      setRecipesError(null)
    } catch (e: any) {
      setRecipesError(e.message)
    } finally {
      setRecipesLoading(false)
    }
  }, [])

  useEffect(() => {
    refetchRecipes()
  }, [refetchRecipes])

  // --- Metas (User-scoped) ---
  const [metas, setMetas] = useState<Record<string, RecipeMeta>>({})
  const [metasLoading, setMetasLoading] = useState(true)
  const [metasError, setMetasError] = useState<string | null>(null)

  const refetchMetas = useCallback(async () => {
    if (!user) {
      setMetas({})
      setMetasLoading(false)
      return
    }
    try {
      setMetasLoading(true)
      const path = collection(db, 'users', user.uid, 'recipes', 'root', 'meta')
      const snap = await getDocs(path)
      const map: Record<string, RecipeMeta> = {}
      snap.docs.forEach(d => { map[d.id] = d.data() as RecipeMeta })
      setMetas(map)
      setMetasError(null)
    } catch (e: any) {
      setMetasError(e.message)
    } finally {
      setMetasLoading(false)
    }
  }, [user])

  // --- Favorites (User-scoped, + anon local storage) ---
  const [favoritesState, setFavoritesState] = useState<{
    ownerUid: string | null
    ids: Set<string>
  } | null>(null)
  const [favoritesLoading, setFavoritesLoading] = useState(true)
  const [favoritesError, setFavoritesError] = useState<string | null>(null)
  const favoritesRequestRef = useRef(0)
  const currentFavoritesOwnerUid = user?.uid ?? null
  const currentFavoritesOwnerRef = useRef(currentFavoritesOwnerUid)

  useEffect(() => {
    currentFavoritesOwnerRef.current = currentFavoritesOwnerUid
  }, [currentFavoritesOwnerUid])

  // Never expose a previous uid's set while the current identity is changing.
  // The auth-triggered refetch below replaces this with the signed-in user's
  // Firestore data or the actual anonymous localStorage data.
  const favorites = favoritesState?.ownerUid === currentFavoritesOwnerUid
    ? favoritesState.ids
    : EMPTY_FAVORITES
  const currentFavoritesLoading = favoritesLoading
    || favoritesState?.ownerUid !== currentFavoritesOwnerUid

  const refetchFavorites = useCallback(async () => {
    const ownerUid = user?.uid ?? null
    if (currentFavoritesOwnerRef.current !== ownerUid) return
    const requestId = ++favoritesRequestRef.current

    setFavoritesError(null)

    if (!ownerUid) {
      let anonymousFavorites = new Set<string>()
      try {
        const stored = localStorage.getItem(LOCAL_FAV_KEY)
        if (stored) anonymousFavorites = new Set(JSON.parse(stored))
      } catch {}
      if (favoritesRequestRef.current !== requestId
        || currentFavoritesOwnerRef.current !== ownerUid) return
      setFavoritesState({ ownerUid, ids: anonymousFavorites })
      setFavoritesLoading(false)
      return
    }
    try {
      setFavoritesLoading(true)
      const ids = await getFavoriteIDs(ownerUid)
      if (favoritesRequestRef.current !== requestId
        || currentFavoritesOwnerRef.current !== ownerUid) return
      setFavoritesState({ ownerUid, ids })
      setFavoritesError(null)
    } catch (e: any) {
      if (favoritesRequestRef.current !== requestId
        || currentFavoritesOwnerRef.current !== ownerUid) return
      setFavoritesError(e.message)
    } finally {
      if (favoritesRequestRef.current !== requestId
        || currentFavoritesOwnerRef.current !== ownerUid) return
      setFavoritesLoading(false)
    }
  }, [user])

  const toggleFavorite = useCallback(async (id: string) => {
    const isFav = favorites.has(id)
    if (user) {
      try {
        if (isFav) await removeFavorite(user.uid, id)
        else await addFavorite(user.uid, id)
        await refetchFavorites() // update local state
      } catch (err: any) {
        console.error('Failed to toggle favorite:', err)
        alert('Failed to update favorite. Please try again.')
      }
    } else {
      setFavoritesState(prev => {
        const current = prev?.ownerUid === null ? prev.ids : EMPTY_FAVORITES
        const next = new Set(current)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        try { localStorage.setItem(LOCAL_FAV_KEY, JSON.stringify(Array.from(next))) } catch {}
        return { ownerUid: null, ids: next }
      })
    }
  }, [user, favorites, refetchFavorites])

  const isFavorite = useCallback((id: string) => favorites.has(id), [favorites])

  // --- Cooking History (User-scoped) ---
  const [cookingHistory, setCookingHistory] = useState<WeekPlanData[]>([])
  const [cookingHistoryLoading, setCookingHistoryLoading] = useState(true)
  const [cookingHistoryError, setCookingHistoryError] = useState<string | null>(null)

  const refetchCookingHistory = useCallback(async () => {
    if (!user) {
      setCookingHistory([])
      setCookingHistoryLoading(false)
      return
    }
    try {
      setCookingHistoryLoading(true)
      const ref = collection(db, 'users', user.uid, 'pantry', 'root', 'weekPlans')
      // Note: we can't easily import `orderBy` and `query` without adding them above, 
      // let's do it dynamically or add them to imports.
      const { orderBy, query } = await import('firebase/firestore')
      const snap = await getDocs(query(ref, orderBy('weekStartISO', 'desc')))
      const data = snap.docs.map(d => d.data() as WeekPlanData)
      setCookingHistory(data)
      setCookingHistoryError(null)
    } catch (e: any) {
      setCookingHistoryError(e.message)
    } finally {
      setCookingHistoryLoading(false)
    }
  }, [user])

  // Fetch user-scoped data when auth finishes loading and user changes
  useEffect(() => {
    if (authLoading) return
    refetchMetas()
    refetchFavorites()
    refetchCookingHistory()
  }, [authLoading, user, refetchMetas, refetchFavorites, refetchCookingHistory])

  return (
    <AppDataContext.Provider
      value={{
        recipes, recipesLoading, recipesError, refetchRecipes,
        metas, metasLoading, metasError, refetchMetas,
        favorites, favoritesLoading: currentFavoritesLoading, favoritesError, refetchFavorites, toggleFavorite, isFavorite,
        cookingHistory, cookingHistoryLoading, cookingHistoryError, refetchCookingHistory
      }}
    >
      {children}
    </AppDataContext.Provider>
  )
}

export function useAppData() {
  return useContext(AppDataContext)
}
