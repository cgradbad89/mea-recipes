'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import Fuse from 'fuse.js'
import { Heart, Loader2 } from 'lucide-react'
import { useAuth } from '@/lib/AuthContext'
import { useFavorites } from '@/hooks/useFavorites'
import { useRecipeMetas } from '@/hooks/useRecipeMetas'
import { getAllRecipes, getTotalTime } from '@/lib/recipes'
import { getAllWeekPlans } from '@/lib/userdata'
import RecipeCard from '@/components/RecipeCard'
import RecipeFilters, { SourceFilter } from '@/components/RecipeFilters'
import SignInOptions from '@/components/SignInOptions'
import type { Recipe } from '@/types/recipe'

type SortOption = 'default' | 'rating' | 'mine' | 'az' | 'recent'
type TimeFilter = 0 | 30 | 45 | 60
type FilterOption = 'none' | 'cookedRecently'

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

export default function FavoritesPage() {
  const { user } = useAuth()
  const { favorites, loaded } = useFavorites()
  const metas = useRecipeMetas()
  const [allRecipes, setAllRecipes] = useState<Recipe[]>([])
  const [loadingRecipes, setLoadingRecipes] = useState(true)

  const [search, setSearch] = useState(() => readLS('mea_favorites_search', ''))
  const [cuisine, setCuisine] = useState<string[]>(() => {
    const val = readLS<string>('mea_favorites_cuisine', 'All')
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
  const [category, setCategory] = useState(() => readLS('mea_favorites_category', 'All'))
  const [minRating, setMinRating] = useState(() => readLS<number>('mea_favorites_minRating', 0, v => parseInt(v, 10) || 0))
  const [source, setSource] = useState<SourceFilter>(() => readLS<SourceFilter>('mea_favorites_source', 'all', v => (v as SourceFilter)))
  const [sort, setSort] = useState<SortOption>(() => readLS<SortOption>('mea_favorites_sort', 'default', v => (v as SortOption)))
  const [filter, setFilter] = useState<FilterOption>(() => readLS<FilterOption>('mea_favorites_filter', 'none', v => (v as FilterOption)))
  const [timeFilter, setTimeFilter] = useState<TimeFilter>(() => readLS<TimeFilter>('mea_favorites_timeFilter', 0, v => (parseInt(v, 10) || 0) as TimeFilter))
  const [timeDropdownOpen, setTimeDropdownOpen] = useState(false)
  const [cookedRecentlyIDs, setCookedRecentlyIDs] = useState<Set<string> | null>(null)
  const [loadingCooked, setLoadingCooked] = useState(false)

  // Persist filters to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('mea_favorites_search', search)
      localStorage.setItem('mea_favorites_cuisine', JSON.stringify(cuisine))
      localStorage.setItem('mea_favorites_category', category)
      localStorage.setItem('mea_favorites_minRating', String(minRating))
      localStorage.setItem('mea_favorites_source', source)
      localStorage.setItem('mea_favorites_sort', sort)
      localStorage.setItem('mea_favorites_filter', filter)
      localStorage.setItem('mea_favorites_timeFilter', String(timeFilter))
    } catch {}
  }, [search, cuisine, category, minRating, source, sort, filter, timeFilter])

  useEffect(() => {
    getAllRecipes().then(r => {
      setAllRecipes(r)
      setLoadingRecipes(false)
    })
  }, [])

  // Lazy load cooked recently IDs when that filter is selected
  useEffect(() => {
    if (filter !== 'cookedRecently' || !user || cookedRecentlyIDs !== null) return
    setLoadingCooked(true)
    getAllWeekPlans(user.uid).then(plans => {
      const fourWeeksAgo = new Date()
      fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28)
      const cutoff = fourWeeksAgo.toISOString().split('T')[0]
      const ids = new Set<string>()
      plans
        .filter(p => p.weekStartISO >= cutoff)
        .forEach(p => p.cookedRecipeIDs.forEach(id => ids.add(id)))
      setCookedRecentlyIDs(ids)
      setLoadingCooked(false)
    })
  }, [filter, user, cookedRecentlyIDs])

  // Base list: only the user's favorite recipes
  const favoriteRecipes = useMemo(
    () => allRecipes.filter(r => favorites.has(r.id)),
    [allRecipes, favorites]
  )

  const fuse = useMemo(() => new Fuse(favoriteRecipes, {
    keys: [
      { name: 'title', weight: 0.5 },
      { name: 'cuisine', weight: 0.2 },
      { name: 'category', weight: 0.15 },
      { name: 'content', weight: 0.15 },
    ],
    threshold: 0.35,
    includeScore: true,
  }), [favoriteRecipes])

  const filtered = useMemo(() => {
    const baseList = search.length >= 2
      ? fuse.search(search).map(r => r.item)
      : favoriteRecipes

    const f = baseList.filter(r => {
      const matchCuisine = cuisine.length === 0 || cuisine.some(c => r.cuisine.toLowerCase() === c.toLowerCase())
      const matchCategory = category === 'All' || r.category === category
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
      if (filter === 'cookedRecently' && cookedRecentlyIDs) {
        if (!cookedRecentlyIDs.has(r.id)) return false
      }

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
  }, [favoriteRecipes, search, cuisine, category, minRating, source, metas, user, sort, filter, timeFilter, cookedRecentlyIDs, fuse])

  const SORT_OPTIONS: { value: SortOption; label: string }[] = [
    { value: 'default', label: 'Default' },
    { value: 'rating', label: 'Top rated' },
    { value: 'mine', label: 'Mine first' },
    { value: 'az', label: 'A → Z' },
    { value: 'recent', label: 'Added recently' },
  ]

  const TIME_OPTIONS: { value: TimeFilter; label: string }[] = [
    { value: 0, label: 'Any total time' },
    { value: 30, label: 'Total under 30 min' },
    { value: 45, label: 'Total under 45 min' },
    { value: 60, label: 'Total under 1 hour' },
  ]

  const FILTER_OPTIONS: { value: FilterOption; label: string; requiresAuth?: boolean }[] = [
    { value: 'none', label: 'All' },
    { value: 'cookedRecently', label: 'Cooked recently', requiresAuth: true },
  ]

  const loading = loadingRecipes || !loaded

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-5 p-6">
        <div className="w-16 h-16 rounded-full bg-amber/10 flex items-center justify-center">
          <Heart size={28} className="text-amber" />
        </div>
        <h2 className="font-display text-3xl text-cream font-light">Favorites</h2>
        <p className="text-muted text-sm font-body text-center max-w-xs">
          Sign in to save favorites and sync them across all your devices.
        </p>
        <SignInOptions />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="font-display text-5xl text-cream font-light tracking-tight mb-1">
          Favorites
        </h1>
        <p className="text-faint text-sm font-body">
          {loading ? 'Loading...' : `${favoriteRecipes.length} saved recipe${favoriteRecipes.length !== 1 ? 's' : ''}`}
        </p>
      </div>

      {!loading && favoriteRecipes.length > 0 && (
        <>
          <div className="mb-6">
            <RecipeFilters
              search={search} cuisine={cuisine} category={category}
              minRating={minRating} source={source}
              onSearchChange={setSearch} onCuisineChange={setCuisine}
              onCategoryChange={setCategory} onMinRatingChange={setMinRating}
              onSourceChange={setSource}
              totalCount={favoriteRecipes.length} filteredCount={filtered.length}
              isSignedIn={!!user}
            />
          </div>

          {/* Sort & filter buttons */}
          <div className="flex items-center gap-2 mb-4">
            <div className="flex items-center gap-2 overflow-x-auto pb-1 flex-1 min-w-0">
              <span className="text-faint text-xs font-body uppercase tracking-widest shrink-0">Sort</span>
              {SORT_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setSort(opt.value)}
                  className={`text-xs px-3 py-1.5 rounded-lg font-body font-medium transition-all border shrink-0 ${
                    sort === opt.value
                      ? 'bg-amber/10 text-amber border-amber/30'
                      : 'bg-card text-faint border-border hover:border-amber/20 hover:text-muted'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Time filter dropdown */}
            <div className="relative ml-1 shrink-0">
              <button
                onClick={() => setTimeDropdownOpen(!timeDropdownOpen)}
                className={`text-xs px-3 py-1.5 rounded-lg font-body font-medium transition-all border flex items-center gap-1 ${
                  timeFilter > 0
                    ? 'bg-amber/10 text-amber border-amber/30'
                    : 'bg-card text-faint border-border hover:border-amber/20 hover:text-muted'
                }`}
              >
                {timeFilter === 0 ? 'Total time' : TIME_OPTIONS.find(o => o.value === timeFilter)?.label}
                <svg width="10" height="10" viewBox="0 0 10 10" className="opacity-60"><path d="M2 4l3 3 3-3" stroke="currentColor" fill="none" strokeWidth="1.5" /></svg>
              </button>
              {timeDropdownOpen && (
                <div className="absolute left-0 top-9 z-50 bg-card border border-border rounded-xl shadow-lg py-1 w-40 animate-fade-in">
                  {TIME_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => { setTimeFilter(opt.value); setTimeDropdownOpen(false) }}
                      className={`w-full text-left px-3 py-2 text-xs font-body transition-colors ${
                        timeFilter === opt.value ? 'text-amber bg-amber/5' : 'text-muted hover:text-cream hover:bg-surface'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Cooked recently filter */}
            {user && FILTER_OPTIONS
              .filter(opt => opt.value !== 'none' && (!opt.requiresAuth || !!user))
              .map(opt => (
              <button
                key={opt.value}
                onClick={() => setFilter(filter === opt.value ? 'none' : opt.value)}
                className={`text-xs px-3 py-1.5 rounded-lg font-body font-medium transition-all border shrink-0 ${
                  filter === opt.value
                    ? 'bg-amber/10 text-amber border-amber/30'
                    : 'bg-card text-faint border-border hover:border-amber/20 hover:text-muted'
                }`}
              >
                {opt.label}
                {opt.value === 'cookedRecently' && loadingCooked && filter === 'cookedRecently' ? '…' : ''}
              </button>
            ))}
          </div>
        </>
      )}

      {loading ? (
        <div className="flex justify-center py-24">
          <Loader2 className="animate-spin text-amber" size={24} />
        </div>
      ) : favoriteRecipes.length === 0 ? (
        <div className="text-center py-24">
          <Heart size={40} className="text-faint mx-auto mb-4" />
          <p className="font-display text-3xl text-faint font-light mb-2">No favorites yet</p>
          <p className="text-faint text-sm font-body mb-6">
            Tap the heart on any recipe to save it here
          </p>
          <a href="/recipes" className="btn-ghost">Browse recipes</a>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-24">
          <p className="font-display text-3xl text-faint font-light mb-2">No recipes found</p>
          <p className="text-faint text-sm font-body">Try adjusting your filters</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 animate-fade-in">
          {filtered.map(recipe => (
            <RecipeCard key={recipe.id} recipe={recipe} meta={metas[recipe.id]} />
          ))}
        </div>
      )}
    </div>
  )
}
