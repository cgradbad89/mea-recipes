'use client'

import { useState, useEffect, useMemo } from 'react'
import Fuse from 'fuse.js'
import { getAllRecipes } from '@/lib/recipes'
import { collection, getDocs, writeBatch, doc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/lib/AuthContext'
import { useRecipeMetas } from '@/hooks/useRecipeMetas'
import { getAllWeekPlans } from '@/lib/userdata'
import RecipeCard from '@/components/RecipeCard'
import RecipeFilters, { SourceFilter } from '@/components/RecipeFilters'
import type { Recipe } from '@/types/recipe'

type SortOption = 'default' | 'rating' | 'mine' | 'az' | 'recent'
type TimeFilter = 0 | 30 | 45 | 60
type FilterOption = 'none' | 'cookedRecently'

/** Parse a time string like "30 min", "1h 30min", "PT1H30M" into minutes. Returns Infinity if unparseable. */
function parseMinutes(s?: string): number {
  if (!s || !s.trim()) return Infinity
  const t = s.trim()

  // ISO 8601 duration: PT30M, PT1H30M, PT1H
  const iso = t.match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/i)
  if (iso) {
    const h = parseInt(iso[1] || '0', 10)
    const m = parseInt(iso[2] || '0', 10)
    return h * 60 + m
  }

  // "1 hr 30 min", "1h 30min", "1 hour 30 minutes", "1h30min"
  const compound = t.match(/(\d+)\s*(?:hr|hour|h)\s*(?:(\d+)\s*(?:min(?:ute)?s?)?)?/i)
  if (compound) {
    const h = parseInt(compound[1], 10)
    const m = parseInt(compound[2] || '0', 10)
    return h * 60 + m
  }

  // "30 min", "30 minutes", "30min"
  const mins = t.match(/^(\d+)\s*(?:min(?:ute)?s?)$/i)
  if (mins) return parseInt(mins[1], 10)

  return Infinity
}

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

export default function RecipesPage() {
  const { user } = useAuth()
  const metas = useRecipeMetas()
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [cuisine, setCuisine] = useState('All')
  const [category, setCategory] = useState('All')
  const [minRating, setMinRating] = useState(0)
  const [source, setSource] = useState<SourceFilter>('all')
  const [sort, setSort] = useState<SortOption>('default')
  const [filter, setFilter] = useState<FilterOption>('none')
  const [timeFilter, setTimeFilter] = useState<TimeFilter>(0)
  const [timeDropdownOpen, setTimeDropdownOpen] = useState(false)
  const [cookedRecentlyIDs, setCookedRecentlyIDs] = useState<Set<string> | null>(null)
  const [loadingCooked, setLoadingCooked] = useState(false)
  const [taggingAll, setTaggingAll] = useState(false)
  const [tagProgress, setTagProgress] = useState('')
  const [tagDone, setTagDone] = useState(false)

  useEffect(() => {
    getAllRecipes().then(r => { setRecipes(r); setLoading(false) })
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
    const baseList = search.length >= 2
      ? fuse.search(search).map(r => r.item)
      : recipes

    const f = baseList.filter(r => {
      const matchCuisine = cuisine === 'All' || r.cuisine.toLowerCase() === cuisine.toLowerCase()
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
        if (parseMinutes(prepTime) + parseMinutes(cookTime) >= timeFilter) return false
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
  }, [recipes, search, cuisine, category, minRating, source, metas, user, sort, filter, timeFilter, cookedRecentlyIDs, fuse])

  const handleTagAllAsMine = async () => {
    if (!user) return
    setTaggingAll(true)
    try {
      const snap = await getDocs(collection(db, 'recipes'))
      const docs = snap.docs
      const total = docs.length
      // writeBatch max 500 operations
      for (let i = 0; i < total; i += 500) {
        const batch = writeBatch(db)
        const chunk = docs.slice(i, i + 500)
        chunk.forEach(d => {
          batch.update(doc(db, 'recipes', d.id), { addedBy: user.uid })
        })
        await batch.commit()
        setTagProgress(`Updating ${Math.min(i + 500, total)}/${total} recipes...`)
      }
      setTagDone(true)
      // Refresh recipes to pick up addedBy
      const refreshed = await getAllRecipes()
      setRecipes(refreshed)
    } catch (e) {
      console.error('Tag all error:', e)
    } finally {
      setTaggingAll(false)
    }
  }

  const SORT_OPTIONS: { value: SortOption; label: string }[] = [
    { value: 'default', label: 'Default' },
    { value: 'rating', label: 'Top rated' },
    { value: 'mine', label: 'Mine first' },
    { value: 'az', label: 'A → Z' },
    { value: 'recent', label: 'Added recently' },
  ]

  const TIME_OPTIONS: { value: TimeFilter; label: string }[] = [
    { value: 0, label: 'Any time' },
    { value: 30, label: 'Under 30 min' },
    { value: 45, label: 'Under 45 min' },
    { value: 60, label: 'Under 1 hour' },
  ]

  const FILTER_OPTIONS: { value: FilterOption; label: string; requiresAuth?: boolean }[] = [
    { value: 'none', label: 'All' },
    { value: 'cookedRecently', label: 'Cooked recently', requiresAuth: true },
  ]

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="font-display text-5xl text-cream font-light tracking-tight mb-1">Recipes</h1>
        <p className="text-faint text-sm font-body">Your personal collection</p>
      </div>

      <div className="mb-6">
        <RecipeFilters
          search={search} cuisine={cuisine} category={category}
          minRating={minRating} source={source}
          onSearchChange={setSearch} onCuisineChange={setCuisine}
          onCategoryChange={setCategory} onMinRatingChange={setMinRating}
          onSourceChange={setSource}
          totalCount={recipes.length} filteredCount={filtered.length}
          isSignedIn={!!user}
        />
      </div>

      {/* Sort & filter buttons */}
      <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1">
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

        {/* Time filter dropdown */}
        <div className="relative ml-1">
          <button
            onClick={() => setTimeDropdownOpen(!timeDropdownOpen)}
            className={`text-xs px-3 py-1.5 rounded-lg font-body font-medium transition-all border flex items-center gap-1 ${
              timeFilter > 0
                ? 'bg-amber/10 text-amber border-amber/30'
                : 'bg-card text-faint border-border hover:border-amber/20 hover:text-muted'
            }`}
          >
            {TIME_OPTIONS.find(o => o.value === timeFilter)?.label}
            <svg width="10" height="10" viewBox="0 0 10 10" className="opacity-60"><path d="M2 4l3 3 3-3" stroke="currentColor" fill="none" strokeWidth="1.5" /></svg>
          </button>
          {timeDropdownOpen && (
            <div className="absolute left-0 top-9 z-10 bg-card border border-border rounded-xl shadow-lg py-1 w-40 animate-fade-in">
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
            className={`text-xs px-3 py-1.5 rounded-lg font-body font-medium transition-all border ${
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

      {/* One-time bulk tag button */}
      {user && !tagDone && (
        <div className="mb-4">
          <button
            onClick={handleTagAllAsMine}
            disabled={taggingAll}
            className="text-xs font-body text-faint/50 hover:text-faint transition-colors"
          >
            {taggingAll ? tagProgress : 'Fix: Tag all as mine'}
          </button>
        </div>
      )}
      {tagDone && (
        <p className="text-xs font-body text-green-400 mb-4">Done! All recipes tagged.</p>
      )}

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {Array.from({ length: 12 }).map((_, i) => <SkeletonCard key={i} />)}
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
