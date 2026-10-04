'use client'

import React, { createContext, useContext, useEffect, useLayoutEffect, useState, useCallback, useRef, ReactNode } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/lib/AuthContext'
import type { Recipe } from '@/types/recipe'
import type { RecipeMeta, PlannedElement } from '@/lib/userdata'
import {
  getFavoriteIDs,
  removeFavorite,
  addFavorite,
  getWantToTryIDs,
  removeWantToTry,
  addWantToTry,
} from '@/lib/userdata'
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

  wantToTry: Set<string>
  wantToTryLoading: boolean
  wantToTryError: string | null
  refetchWantToTry: () => Promise<void>
  toggleWantToTry: (id: string) => Promise<void>
  isWantToTry: (id: string) => boolean

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
  wantToTry: new Set(), wantToTryLoading: true, wantToTryError: null, refetchWantToTry: async () => {},
  toggleWantToTry: async () => {}, isWantToTry: () => false,
  cookingHistory: [], cookingHistoryLoading: true, cookingHistoryError: null, refetchCookingHistory: async () => {},
})

const LOCAL_FAV_KEY = 'mea-favorites'
const EMPTY_FAVORITES = new Set<string>()
const LOCAL_WANT_TO_TRY_KEY = 'mea-want-to-try'
const EMPTY_WANT_TO_TRY = new Set<string>()
const EMPTY_METAS: Record<string, RecipeMeta> = {}

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
  const metasOwnerUid = user?.uid ?? null
  const [metasState, setMetasState] = useState<{
    ownerUid: string | null
    data: Record<string, RecipeMeta>
    loading: boolean
    error: string | null
  } | null>(null)
  const metasRequestRef = useRef(0)
  const metasOwnerRef = useRef(metasOwnerUid)
  const metasActiveRef = useRef(false)

  useLayoutEffect(() => {
    metasOwnerRef.current = metasOwnerUid
    metasActiveRef.current = !authLoading
    const requestCounter = metasRequestRef
    return () => {
      metasActiveRef.current = false
      ++requestCounter.current
    }
  }, [metasOwnerUid, authLoading])

  // Bind the render as well as async publication to the authenticated owner.
  const metasCurrent = !authLoading && metasState?.ownerUid === metasOwnerUid
  const metas = metasCurrent ? metasState.data : EMPTY_METAS
  const metasLoading = !metasCurrent || metasState.loading
  const metasError = metasCurrent ? metasState.error : null

  const refetchMetas = useCallback(async () => {
    const ownerUid = metasOwnerUid
    if (!metasActiveRef.current || metasOwnerRef.current !== ownerUid) {
      throw new Error('Recipe data refresh is no longer current. Please retry.')
    }
    const requestId = ++metasRequestRef.current
    const isCurrent = () => metasActiveRef.current
      && metasOwnerRef.current === ownerUid && metasRequestRef.current === requestId
    if (!ownerUid) {
      setMetasState({ ownerUid, data: {}, loading: false, error: null })
      return
    }
    setMetasState(previous => ({
      ownerUid, data: previous?.ownerUid === ownerUid ? previous.data : {},
      loading: true, error: null,
    }))
    try {
      const path = collection(db, 'users', ownerUid, 'recipes', 'root', 'meta')
      const snap = await getDocs(path)
      if (!isCurrent()) throw new Error('Recipe data refresh was superseded. Please retry.')
      const map: Record<string, RecipeMeta> = {}
      snap.docs.forEach(d => { map[d.id] = d.data() as RecipeMeta })
      setMetasState({ ownerUid, data: map, loading: false, error: null })
    } catch (error) {
      if (isCurrent()) {
        setMetasState(previous => ({
          ownerUid, data: previous?.ownerUid === ownerUid ? previous.data : {},
          loading: false, error: error instanceof Error ? error.message : 'Failed to load recipe data',
        }))
      }
      // Imperative readback must distinguish failure (including retirement) from
      // a result actually published. Passive loads explicitly handle rejection.
      throw error
    } finally {
      if (isCurrent()) setMetasState(previous => previous ? { ...previous, loading: false } : previous)
    }
  }, [metasOwnerUid])

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

  // --- Want to Try (User-scoped, + anon local storage) ---
  // Mirrors Favorites deliberately: a signed-in user's list is Firestore-backed,
  // while a visitor can use the bookmark before deciding to sign in.
  const [wantToTryState, setWantToTryState] = useState<{
    ownerUid: string | null
    ids: Set<string>
  } | null>(null)
  const [wantToTryLoading, setWantToTryLoading] = useState(true)
  const [wantToTryError, setWantToTryError] = useState<string | null>(null)
  const wantToTryRequestRef = useRef(0)
  const currentWantToTryOwnerUid = user?.uid ?? null
  const currentWantToTryOwnerRef = useRef(currentWantToTryOwnerUid)

  useEffect(() => {
    currentWantToTryOwnerRef.current = currentWantToTryOwnerUid
  }, [currentWantToTryOwnerUid])

  const wantToTry = wantToTryState?.ownerUid === currentWantToTryOwnerUid
    ? wantToTryState.ids
    : EMPTY_WANT_TO_TRY
  const currentWantToTryLoading = wantToTryLoading
    || wantToTryState?.ownerUid !== currentWantToTryOwnerUid

  const refetchWantToTry = useCallback(async () => {
    const ownerUid = user?.uid ?? null
    if (currentWantToTryOwnerRef.current !== ownerUid) return
    const requestId = ++wantToTryRequestRef.current

    setWantToTryError(null)

    if (!ownerUid) {
      let anonymousWantToTry = new Set<string>()
      try {
        const stored = localStorage.getItem(LOCAL_WANT_TO_TRY_KEY)
        if (stored) anonymousWantToTry = new Set(JSON.parse(stored))
      } catch {}
      if (wantToTryRequestRef.current !== requestId
        || currentWantToTryOwnerRef.current !== ownerUid) return
      setWantToTryState({ ownerUid, ids: anonymousWantToTry })
      setWantToTryLoading(false)
      return
    }
    try {
      setWantToTryLoading(true)
      const ids = await getWantToTryIDs(ownerUid)
      if (wantToTryRequestRef.current !== requestId
        || currentWantToTryOwnerRef.current !== ownerUid) return
      setWantToTryState({ ownerUid, ids })
      setWantToTryError(null)
    } catch (e: any) {
      if (wantToTryRequestRef.current !== requestId
        || currentWantToTryOwnerRef.current !== ownerUid) return
      setWantToTryError(e.message)
    } finally {
      if (wantToTryRequestRef.current !== requestId
        || currentWantToTryOwnerRef.current !== ownerUid) return
      setWantToTryLoading(false)
    }
  }, [user])

  const toggleWantToTry = useCallback(async (id: string) => {
    const isWanted = wantToTry.has(id)
    if (user) {
      try {
        if (isWanted) await removeWantToTry(user.uid, id)
        else await addWantToTry(user.uid, id)
        await refetchWantToTry()
      } catch (err: any) {
        console.error('Failed to toggle Want to Try:', err)
        alert('Failed to update Want to Try. Please try again.')
      }
    } else {
      setWantToTryState(prev => {
        const current = prev?.ownerUid === null ? prev.ids : EMPTY_WANT_TO_TRY
        const next = new Set(current)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        try { localStorage.setItem(LOCAL_WANT_TO_TRY_KEY, JSON.stringify(Array.from(next))) } catch {}
        return { ownerUid: null, ids: next }
      })
    }
  }, [user, wantToTry, refetchWantToTry])

  const isWantToTry = useCallback((id: string) => wantToTry.has(id), [wantToTry])

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
    void refetchMetas().catch(() => {}) // failure is already exposed as metasError
    refetchFavorites()
    refetchWantToTry()
    refetchCookingHistory()
  }, [authLoading, user, refetchMetas, refetchFavorites, refetchWantToTry, refetchCookingHistory])

  return (
    <AppDataContext.Provider
      value={{
        recipes, recipesLoading, recipesError, refetchRecipes,
        metas, metasLoading, metasError, refetchMetas,
        favorites, favoritesLoading: currentFavoritesLoading, favoritesError, refetchFavorites, toggleFavorite, isFavorite,
        wantToTry, wantToTryLoading: currentWantToTryLoading, wantToTryError, refetchWantToTry, toggleWantToTry, isWantToTry,
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
