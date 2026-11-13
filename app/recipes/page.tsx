'use client'

import { useState, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import Fuse from 'fuse.js'
import { getTotalTime } from '@/lib/recipes'
import { useAuth } from '@/lib/AuthContext'
import { useAppData } from '@/components/AppDataProvider'
import { getAllWeekPlans } from '@/lib/userdata'
import RecipeCard from '@/components/RecipeCard'
import type { SourceFilter } from '@/components/RecipeFilters'
import RecipeListingControls from '@/components/RecipeListingControls'
import AddRecipeModal from '@/components/AddRecipeModal'
import { Plus } from 'lucide-react'
import LoadingErrorRetry from '@/components/LoadingErrorRetry'
import type { Recipe } from '@/types/recipe'
import { normalizeRecipeCategory } from '@/lib/recipeCategories'
import { Bookmark } from 'lucide-react'
import Link from 'next/link'
import { parsePlanDestination, destinationLabel } from '@/lib/planDestination'

type SortOption = 'default' | 'rating' | 'mine' | 'az' | 'recent'
type TimeFilter = 0 | 30 | 45 | 60
type FilterOption = 'none' | 'cookedRecently' | 'wantToTry'

function SkeletonCard() {
  return (
    <div className="recipe-card">
      <div className="aspect-[4/3] skeleton" />
      <div className="p-4 space-y-2">
        <div className="h-5 skeleton rounded w-3/4" />
        <div className="h-3 skeleton rounded w-1/2" />
      </div>
    </div>
  )
}

function readLS<T>(key: string, fallback: T, parser: (v: string) => T = (v: any) => v): T {
  try {
    if (typeof window === 'undefined') return fallback
    const v = window.localStorage.getItem(key)
    if (v === null) return fallback
    return parser(v)
  } catch {
    return fallback
  }
}

// Defer reading persisted browser preferences until hydration has completed. A
// different server/client selection can otherwise leave stale ARIA attributes.
const subscribeHydration = () => () => {}
const clientSnapshot = () => true
const serverSnapshot = () => false

export default function RecipesPage() {
  const hydrated = useSyncExternalStore(subscribeHydration, clientSnapshot, serverSnapshot)
  return hydrated ? <RecipesContent /> : (
    <div className="recipes-listing"><div className="recipes-listing-inner" role="status">Loading recipes…</div></div>
  )
}

function RecipesContent() {
  const { user } = useAuth()
  const [params, setParams] = useState(() => new URLSearchParams(window.location.search))
  const hasDestination = params.has('week') || params.has('day')
  const destination = parsePlanDestination(params.get('week'), params.get('day'))
  const {
    metas,
    recipes,
    recipesLoading: loading,
    recipesError,
    metasError,
    wantToTry,
    wantToTryLoading,
    wantToTryError,
    refetchWantToTry,
    refetchRecipes,
    refetchMetas,
  } = useAppData()
  const [search, setSearch] = useState(() => readLS('mea_recipes_search', ''))
  const [debouncedSearch, setDebouncedSearch] = useState(search)
  const [cuisine, setCuisine] = useState<string[]>(() => {
    const val = readLS<string>('mea_recipes_cuisine', 'All')
    if (val === 'All' || !val) return []
    if (val.startsWith('[')) {
      try {
        return JSON.parse(val)
      } catch {
        return []
      }
    }
    return [val]
  })
  const [category, setCategory] = useState(() => {
    const stored = readLS('mea_recipes_category', 'All')
    return stored === 'All' ? stored : (normalizeRecipeCategory(stored) ?? 'All')
  })
  const [minRating, setMinRating] = useState(() => readLS<number>('mea_recipes_minRating', 0, v => parseInt(v, 10) || 0))
  const [source, setSource] = useState<SourceFilter>(() => readLS<SourceFilter>('mea_recipes_source', 'all', v => (v as SourceFilter)))
  const [sort, setSort] = useState<SortOption>(() => readLS<SortOption>('mea_recipes_sort', 'default', v => (v as SortOption)))
  const [filter, setFilter] = useState<FilterOption>(() => readLS<FilterOption>('mea_recipes_filter', 'none', v => (v as FilterOption)))
  const [timeFilter, setTimeFilter] = useState<TimeFilter>(() => readLS<TimeFilter>('mea_recipes_timeFilter', 0, v => (parseInt(v, 10) || 0) as TimeFilter))
  const [showAdd, setShowAdd] = useState(false)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const [cookedRecentlyIDs, setCookedRecentlyIDs] = useState<Set<string> | null>(null)
  const [loadingCooked, setLoadingCooked] = useState(false)
  const [cookedRecentlyError, setCookedRecentlyError] = useState('')
  const [cookedLoadAttempt, setCookedLoadAttempt] = useState(0)

  // Persist filters to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('mea_recipes_search', search)
      localStorage.setItem('mea_recipes_cuisine', JSON.stringify(cuisine))
      localStorage.setItem('mea_recipes_category', category)
      localStorage.setItem('mea_recipes_minRating', String(minRating))
      localStorage.setItem('mea_recipes_source', source)
      localStorage.setItem('mea_recipes_sort', sort)
      localStorage.setItem('mea_recipes_filter', filter)
      localStorage.setItem('mea_recipes_timeFilter', String(timeFilter))
    } catch {}
  }, [search, cuisine, category, minRating, source, sort, filter, timeFilter])

  useEffect(() => {
    if (!search.trim()) {
      setDebouncedSearch('')
      return
    }
    const timer = setTimeout(() => setDebouncedSearch(search), 150)
    return () => clearTimeout(timer)
  }, [search])

  // Source filter defaults to "All recipes". It initializes from localStorage
  // (fallback 'all') above, and the user's manual choice persists per browser.
  // Signed-in users are no longer auto-switched to "Added by me" on first load.


  // Lazy load cooked recently IDs when that filter is selected
  useEffect(() => {
    if (filter !== 'cookedRecently' || !user || cookedRecentlyIDs !== null) return
    let active = true
    setLoadingCooked(true)
    setCookedRecentlyError('')
    getAllWeekPlans(user.uid)
      .then(plans => {
        if (!active) return
        const fourWeeksAgo = new Date()
        fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28)
        const cutoff = fourWeeksAgo.toISOString().split('T')[0]
        const ids = new Set<string>()
        plans
          .filter(p => p.weekStartISO >= cutoff)
          .forEach(p => p.cookedRecipeIDs.forEach(id => ids.add(id)))
        setCookedRecentlyIDs(ids)
      })
      .catch(error => {
        if (active) setCookedRecentlyError(error instanceof Error ? error.message : 'Failed to load cooking history')
      })
      .finally(() => { if (active) setLoadingCooked(false) })
    return () => { active = false }
  }, [filter, user, cookedRecentlyIDs, cookedLoadAttempt])

  const fuse = useMemo(() => new Fuse(recipes, {
    keys: [
      { name: 'title', weight: 0.5 },
      { name: 'cuisine', weight: 0.2 },
      { name: 'category', weight: 0.15 },
      { name: 'content', weight: 0.15 },
    ],
    threshold: 0.35,
    includeScore: true,
  }), [recipes])

  const filtered = useMemo(() => {
    const searchTerm = debouncedSearch.trim()
    const baseList = searchTerm.length >= 1
      ? fuse.search(searchTerm).map(r => r.item)
      : recipes

    const f = baseList.filter(r => {
      const matchCuisine = cuisine.length === 0 || cuisine.some(c => r.cuisine.toLowerCase() === c.toLowerCase())
      const rawCategory = metas[r.id]?.overrides?.category ?? r.category
      const matchCategory = category === 'All' || normalizeRecipeCategory(rawCategory, r.id) === category
      const recipeRating = metas[r.id]?.rating || 0
      const matchRating = minRating === 0 || recipeRating >= minRating
      const matchSource = source === 'all' ||
        (source === 'mine' && r.addedBy === user?.uid) ||
        (source === 'others' && r.addedBy !== user?.uid)

      // Extra filters
      if (timeFilter > 0) {
        const meta = metas[r.id]
        const prepTime = meta?.overrides?.prepTime || (r as any).prepTime || ''
        const cookTime = meta?.overrides?.cookTime || (r as any).cookTime || ''
        const total = getTotalTime(prepTime, cookTime).minutes
        if (total === 0 || total >= timeFilter) return false
      }
      if (filter === 'cookedRecently') {
        // Until the history request succeeds there is no valid filtered result.
        // Never fall through to the full recipe list and mislabel it as filtered.
        if (!cookedRecentlyIDs || !cookedRecentlyIDs.has(r.id)) return false
      }
      if (filter === 'wantToTry' && !wantToTry.has(r.id)) return false

      return matchCuisine && matchCategory && matchRating && matchSource
    })

    // Sort
    const sorted = [...f]
    if (sort === 'rating') {
      sorted.sort((a, b) => (metas[b.id]?.rating || 0) - (metas[a.id]?.rating || 0))
    } else if (sort === 'mine') {
      sorted.sort((a, b) => {
        const aIsMine = a.addedBy === user?.uid ? -1 : 1
        const bIsMine = b.addedBy === user?.uid ? -1 : 1
        return aIsMine - bIsMine
      })
    } else if (sort === 'az') {
      sorted.sort((a, b) => a.title.localeCompare(b.title))
    } else if (sort === 'recent') {
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
      sorted.sort((a, b) => {
        const aDate = new Date(a.created).getTime()
        const bDate = new Date(b.created).getTime()
        const aRecent = aDate >= thirtyDaysAgo ? 1 : 0
        const bRecent = bDate >= thirtyDaysAgo ? 1 : 0
        if (aRecent !== bRecent) return bRecent - aRecent
        return bDate - aDate
      })
    }
    return sorted
  }, [recipes, debouncedSearch, cuisine, category, minRating, source, metas, user, sort, filter, timeFilter, cookedRecentlyIDs, wantToTry, fuse])

  return (
    <div className="recipes-listing">
      <div className="recipes-listing-inner">
        <header className="listing-heading">
          <div><h1>Recipes</h1><p>Your shared recipe collection</p></div>
          <button ref={addButtonRef} type="button" className="listing-add" onClick={() => setShowAdd(true)}><Plus size={18} aria-hidden="true" /> Add Recipe</button>
        </header>
        {hasDestination && <div className="listing-destination" role="status">
          {destination ? <><strong>Adding to {destinationLabel(destination)}</strong><Link href={`/plan?week=${destination.weekID}`}>Return to Meal Plan or change day</Link></> : <strong>Invalid plan destination. Return to Meal Plan and choose a day.</strong>}
          <button onClick={() => { window.history.replaceState(null, '', '/recipes'); setParams(new URLSearchParams()) }}>Cancel destination</button>
        </div>}
        <RecipeListingControls
          search={search} setSearch={setSearch} cuisine={cuisine} setCuisine={setCuisine}
          category={category} setCategory={setCategory} minRating={minRating} setMinRating={setMinRating}
          source={source} setSource={setSource} sort={sort} setSort={setSort}
          timeFilter={timeFilter} setTimeFilter={setTimeFilter} filter={filter} setFilter={setFilter}
          signedIn={!!user} count={filtered.length} total={recipes.length} loading={loading}
        />
      <LoadingErrorRetry
        loading={loading || (filter === 'cookedRecently' && loadingCooked) || (filter === 'wantToTry' && wantToTryLoading)}
        error={recipesError || metasError || (filter === 'cookedRecently' ? cookedRecentlyError : '') || (filter === 'wantToTry' ? wantToTryError : '')}
        retry={() => {
          if (cookedRecentlyError) setCookedLoadAttempt(attempt => attempt + 1)
          else if (wantToTryError) void refetchWantToTry()
          else void Promise.allSettled([refetchRecipes(), refetchMetas(), refetchWantToTry()])
        }}
        errorPrefix={cookedRecentlyError
          ? 'Couldn’t apply the Cooked recently filter.'
          : wantToTryError
            ? 'Couldn’t apply the Want to Try filter.'
            : 'Couldn’t load your recipes.'}
        loadingFallback={(
          <div className="listing-grid">
            {Array.from({ length: 12 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        )}
      >
        {filtered.length === 0 && filter === 'wantToTry' && wantToTry.size === 0 ? (
          <div className="listing-empty">
            <Bookmark size={40} className="mx-auto mb-4" />
            <p className="font-display text-3xl mb-2">No recipes to try yet</p>
            <p className="text-sm font-body mb-6">Tap the bookmark on any recipe to keep it in your Want to Try list</p>
            <button onClick={() => setFilter('none')} className="listing-filter-toggle">Clear Want to Try filter</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="listing-empty">
            <p className="font-display text-3xl mb-2">No recipes found</p>
            <p className="text-sm font-body">Try adjusting your filters</p>
          </div>
        ) : (
          <div className="listing-grid">
            {filtered.map(recipe => (
              <RecipeCard key={recipe.id} recipe={recipe} meta={metas[recipe.id]} warm destination={destination} invalidDestination={hasDestination && !destination} />
            ))}
          </div>
        )}
      </LoadingErrorRetry>
      {showAdd && <AddRecipeModal onClose={() => { setShowAdd(false); addButtonRef.current?.focus() }} />}
      </div>
    </div>
  )
}
