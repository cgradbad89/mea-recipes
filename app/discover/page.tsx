'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { useAuth } from '@/lib/AuthContext'
import { useCookingHistory } from '@/hooks/useCookingHistory'
import { useRecipeMetas } from '@/hooks/useRecipeMetas'
import { useFavorites } from '@/hooks/useFavorites'
import { getAllRecipes } from '@/lib/recipes'
import { addToQueue } from '@/lib/queue'
import { Sparkles, RefreshCw, Loader2, Star, ChefHat, Compass, Clock, Wand2, Search, Plus } from 'lucide-react'
import type { Recipe } from '@/types/recipe'

const CACHE_KEY = 'mea-recommendations-cache'
const NEW_CACHE_KEY = 'mea-new-suggestions-cache'

interface Recommendation {
  title: string
  reason: string
}

interface RecommendationSet {
  cookAgain: Recommendation[]
  tryNew: Recommendation[]
  longTime: Recommendation[]
}

interface CacheEntry {
  data: RecommendationSet
  timestamp: number
}

interface NewSuggestion {
  title: string
  cuisine: string
  category: string
  description: string
  searchQuery: string
}

function RecipeRecommendationCard({
  rec, recipe, meta,
}: {
  rec: Recommendation
  recipe?: Recipe
  meta?: { rating?: number }
}) {
  if (!recipe) return null
  return (
    <Link href={`/recipes/${recipe.id}`} className="group flex gap-4 items-start p-4 bg-card rounded-2xl border border-border hover:border-amber/30 transition-all duration-200">
      <div className="w-16 h-16 rounded-xl overflow-hidden bg-surface shrink-0">
        {recipe.imageURL ? (
          <img src={recipe.imageURL} alt={recipe.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            onError={e => { (e.target as HTMLImageElement).parentElement!.className = 'w-16 h-16 rounded-xl bg-surface flex items-center justify-center shrink-0' }} />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-2xl">🍽️</div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-body font-medium text-cream text-sm leading-snug mb-1 group-hover:text-amber transition-colors line-clamp-1">{recipe.title}</h3>
        <p className="text-faint text-xs font-body leading-relaxed line-clamp-2">{rec.reason}</p>
        <div className="flex items-center gap-2 mt-1.5">
          {recipe.cuisine && <span className="text-faint text-xs font-body capitalize">{recipe.cuisine}</span>}
          {meta?.rating && (
            <span className="flex items-center gap-0.5 text-amber text-xs">
              <Star size={10} fill="currentColor" />{meta.rating}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}

function Section({ title, icon: Icon, color, items, recipes, metas }: {
  title: string
  icon: any
  color: string
  items: Recommendation[]
  recipes: Recipe[]
  metas: Record<string, any>
}) {
  const recipeMap = useMemo(() => {
    const map: Record<string, Recipe> = {}
    recipes.forEach(r => { map[r.title.toLowerCase()] = r })
    return map
  }, [recipes])

  const matched = items
    .map(rec => ({
      rec,
      recipe: recipeMap[rec.title.toLowerCase()] ||
        recipes.find(r => r.title.toLowerCase().includes(rec.title.toLowerCase().slice(0, 15)))
    }))
    .filter(({ recipe }) => recipe)

  if (!matched.length) return null

  return (
    <div>
      <div className="flex items-center gap-2.5 mb-4">
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${color}`}>
          <Icon size={15} className="text-ink" />
        </div>
        <h2 className="font-display text-2xl text-cream font-light">{title}</h2>
      </div>
      <div className="space-y-3">
        {matched.map(({ rec, recipe }) => (
          <RecipeRecommendationCard key={rec.title} rec={rec} recipe={recipe} meta={recipe ? metas[recipe.id] : undefined} />
        ))}
      </div>
    </div>
  )
}

export default function DiscoverPage() {
  const { user } = useAuth()
  const { weeks } = useCookingHistory()
  const metas = useRecipeMetas()
  const { favorites } = useFavorites()
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [recs, setRecs] = useState<RecommendationSet | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [newSuggestions, setNewSuggestions] = useState<NewSuggestion[]>([])
  const [loadingNew, setLoadingNew] = useState(false)
  const [errorNew, setErrorNew] = useState('')
  const [addingToQueue, setAddingToQueue] = useState<string | null>(null)

  useEffect(() => {
    getAllRecipes().then(setRecipes)
  }, [])

  useEffect(() => {
    try {
      const cached = localStorage.getItem(CACHE_KEY)
      if (cached) {
        const entry: CacheEntry = JSON.parse(cached)
        setRecs(entry.data)
        setLastUpdated(new Date(entry.timestamp))
      }
    } catch {}
  }, [])

  // Load new suggestions cache
  useEffect(() => {
    try {
      const cached = localStorage.getItem(NEW_CACHE_KEY)
      if (cached) {
        const entry = JSON.parse(cached)
        setNewSuggestions(entry.data)
      }
    } catch {}
  }, [])

  const cookCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    weeks.forEach(w => {
      ;(w.cookedRecipeIDs || []).forEach(id => {
        counts[id] = (counts[id] || 0) + 1
      })
    })
    return counts
  }, [weeks])

  const ratings = useMemo(() => {
    const r: Record<string, number> = {}
    Object.entries(metas).forEach(([id, m]) => { if (m.rating) r[id] = m.rating })
    return r
  }, [metas])

  const handleGetSuggestions = useCallback(async () => {
    if (!user || !recipes.length) return
    setLoading(true)
    setError('')
    try {
      const token = await user.getIdToken()
      const res = await fetch('/api/recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          recipes: recipes.map(r => ({ id: r.id, title: r.title, cuisine: r.cuisine, category: r.category })),
          cookCounts,
          ratings,
          favorites: Array.from(favorites),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to get recommendations')
      setRecs(data)
      const now = new Date()
      setLastUpdated(now)
      localStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: now.getTime() }))
    } catch (e: any) {
      setError(e.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }, [user, recipes, cookCounts, ratings, favorites])

  const handleGetNewSuggestions = async () => {
    if (!user || !recipes.length) return
    setLoadingNew(true)
    setErrorNew('')
    try {
      const cuisineCounts: Record<string, number> = {}
      const categoryCounts: Record<string, number> = {}
      Object.entries(cookCounts).forEach(([id, count]) => {
        const r = recipes.find(r => r.id === id)
        if (r?.cuisine) cuisineCounts[r.cuisine] = (cuisineCounts[r.cuisine] || 0) + count
        if (r?.category) categoryCounts[r.category] = (categoryCounts[r.category] || 0) + count
      })
      const topCuisines = Object.entries(cuisineCounts).sort(([, a], [, b]) => b - a).slice(0, 4).map(([c]) => c)
      const topCategories = Object.entries(categoryCounts).sort(([, a], [, b]) => b - a).slice(0, 3).map(([c]) => c)
      const recentTitles = Object.entries(cookCounts)
        .sort(([, a], [, b]) => b - a).slice(0, 8)
        .map(([id]) => recipes.find(r => r.id === id)?.title).filter(Boolean)

      const token = await user.getIdToken()
      const res = await fetch('/api/new-recipe-suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ topCuisines, topCategories, recentTitles }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      const newData = Array.isArray(data) ? data : []
      setNewSuggestions(newData)
      localStorage.setItem(NEW_CACHE_KEY, JSON.stringify({ data: newData, timestamp: Date.now() }))
    } catch (e: any) {
      setErrorNew(e.message || 'Something went wrong')
    } finally {
      setLoadingNew(false)
    }
  }

  const handleAddNewToQueue = async (suggestion: NewSuggestion) => {
    if (!user) return
    setAddingToQueue(suggestion.title)
    try {
      // Generate full recipe + try to find an image via search
      const token = await user.getIdToken()
      const res = await fetch('/api/ai-ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ generate: suggestion.title + ' ' + suggestion.cuisine + ' recipe' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      await addToQueue(user.uid, {
        title: data.title || suggestion.title,
        cuisine: data.cuisine || suggestion.cuisine,
        category: data.category || suggestion.category,
        imageURL: data.imageURL || '',
        description: suggestion.description,
        servings: data.servings || '',
        prepTime: data.prepTime || '',
        cookTime: data.cookTime || '',
        ingredients: data.ingredients || [],
        instructions: data.instructions || [],
        sourceURL: '',
      })
      setNewSuggestions(prev => prev.filter(s => s.title !== suggestion.title))
    } catch (e: any) {
      setErrorNew(e.message)
    } finally {
      setAddingToQueue(null)
    }
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 p-6">
        <Sparkles size={48} className="text-faint" />
        <p className="font-display text-3xl text-faint font-light">Sign in to get recommendations</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="font-display text-5xl text-cream font-light tracking-tight mb-1">Discover</h1>
        <p className="text-faint text-sm font-body">AI suggestions based on your cooking history and taste</p>
      </div>

      {/* ── From your collection ── */}
      {!recs ? (
        <div className="flex flex-col items-center py-16 gap-6 border border-border rounded-2xl bg-surface">
          <div className="w-16 h-16 rounded-2xl bg-amber/10 flex items-center justify-center">
            <Sparkles size={28} className="text-amber" />
          </div>
          <div className="text-center">
            <p className="font-display text-2xl text-cream font-light mb-2">What should I cook?</p>
            <p className="text-faint text-sm font-body max-w-xs">
              Claude will look at your history, ratings, and favorites to suggest recipes from your collection.
            </p>
          </div>
          {error && <p className="text-red-400 text-sm font-body">{error}</p>}
          <button
            onClick={handleGetSuggestions}
            disabled={loading || !recipes.length}
            className="btn-primary flex items-center gap-2 px-6"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {loading ? 'Thinking...' : 'Get Suggestions'}
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-6 text-faint text-xs font-body">
            {lastUpdated && (
              <span>Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            )}
            <button
              onClick={() => { localStorage.removeItem(CACHE_KEY); setRecs(null); setLastUpdated(null) }}
              className="flex items-center gap-1.5 hover:text-cream transition-colors ml-auto"
            >
              <RefreshCw size={11} /> Refresh suggestions
            </button>
          </div>

          {error && <p className="text-red-400 text-sm font-body mb-4">{error}</p>}

          <div className="space-y-10">
            <Section title="Cook Again Soon" icon={ChefHat} color="bg-amber" items={recs.cookAgain} recipes={recipes} metas={metas} />
            <Section title="Try Something New" icon={Compass} color="bg-emerald-500" items={recs.tryNew} recipes={recipes} metas={metas} />
            <Section title="Haven't Made In A While" icon={Clock} color="bg-violet-500" items={recs.longTime} recipes={recipes} metas={metas} />
          </div>

          <div className="mt-12 flex justify-center">
            <button onClick={handleGetSuggestions} disabled={loading} className="btn-ghost flex items-center gap-2">
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {loading ? 'Getting new suggestions...' : 'Get new suggestions'}
            </button>
          </div>
        </>
      )}

      {/* ── Discover brand new recipes ── */}
      <div className="mt-16 pt-10 border-t border-border">
        <div className="mb-4">
          <h2 className="font-display text-2xl text-cream font-light flex items-center gap-2">
            <Wand2 size={20} className="text-amber" />
            Discover New Recipes
          </h2>
          <p className="text-faint text-xs font-body mt-1">
            Recipes outside your collection — add any to your queue to import
          </p>
        </div>

        {newSuggestions.length === 0 ? (
          <div>
            {errorNew && <p className="text-red-400 text-sm font-body mb-3">{errorNew}</p>}
            <button
              onClick={handleGetNewSuggestions}
              disabled={loadingNew}
              className="btn-ghost flex items-center gap-2 border border-border hover:border-amber/30"
            >
              {loadingNew ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
              {loadingNew ? 'Finding recipes...' : 'Suggest new recipes to try'}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {errorNew && <p className="text-red-400 text-sm font-body">{errorNew}</p>}
            {newSuggestions.map(suggestion => (
              <div key={suggestion.title} className="flex gap-4 items-start p-4 bg-card rounded-2xl border border-border">
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <h3 className="font-body font-medium text-cream text-sm">{suggestion.title}</h3>
                    <span className="text-faint text-xs font-body capitalize shrink-0">{suggestion.cuisine}</span>
                  </div>
                  <p className="text-faint text-xs font-body leading-relaxed mb-3">{suggestion.description}</p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleAddNewToQueue(suggestion)}
                      disabled={addingToQueue === suggestion.title}
                      className="flex items-center gap-1.5 text-xs font-body px-3 py-1.5 rounded-lg bg-amber/10 text-amber border border-amber/20 hover:bg-amber/20 transition-colors"
                    >
                      {addingToQueue === suggestion.title ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                      Add to queue
                    </button>
                    <a
                      href={`https://www.google.com/search?q=${encodeURIComponent(suggestion.searchQuery || suggestion.title + ' recipe')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs font-body px-3 py-1.5 rounded-lg border border-border text-faint hover:text-cream transition-colors"
                    >
                      <Search size={11} />
                      Find recipe
                    </a>
                  </div>
                </div>
              </div>
            ))}
            <button
              onClick={() => { setNewSuggestions([]); localStorage.removeItem(NEW_CACHE_KEY); handleGetNewSuggestions() }}
              disabled={loadingNew}
              className="btn-ghost flex items-center gap-2 text-xs mt-2"
            >
              {loadingNew ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Suggest different recipes
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
