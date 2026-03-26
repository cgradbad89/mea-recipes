'use client'

import { useState, useEffect, useMemo } from 'react'
import { getAllRecipes } from '@/lib/recipes'
import { useAuth } from '@/lib/AuthContext'
import { useRecipeMetas } from '@/hooks/useRecipeMetas'
import RecipeCard from '@/components/RecipeCard'
import RecipeFilters, { SourceFilter } from '@/components/RecipeFilters'
import type { Recipe } from '@/types/recipe'

type SortOption = 'default' | 'rating' | 'mine' | 'az'

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

  useEffect(() => {
    getAllRecipes().then(r => { setRecipes(r); setLoading(false) })
  }, [])

  const filtered = useMemo(() => {
    const f = recipes.filter(r => {
      const matchSearch = !search ||
        r.title.toLowerCase().includes(search.toLowerCase()) ||
        r.cuisine.toLowerCase().includes(search.toLowerCase()) ||
        r.category.toLowerCase().includes(search.toLowerCase())
      const matchCuisine = cuisine === 'All' || r.cuisine.toLowerCase() === cuisine.toLowerCase()
      const matchCategory = category === 'All' || r.category === category
      const recipeRating = metas[r.id]?.rating || 0
      const matchRating = minRating === 0 || recipeRating >= minRating
      const matchSource = source === 'all' ||
        (source === 'mine' && r.addedBy === user?.uid) ||
        (source === 'others' && r.addedBy !== user?.uid)
      return matchSearch && matchCuisine && matchCategory && matchRating && matchSource
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
    }
    return sorted
  }, [recipes, search, cuisine, category, minRating, source, metas, user, sort])

  const SORT_OPTIONS: { value: SortOption; label: string }[] = [
    { value: 'default', label: 'Default' },
    { value: 'rating', label: 'Top rated' },
    { value: 'mine', label: 'Mine first' },
    { value: 'az', label: 'A → Z' },
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

      {/* Sort buttons */}
      <div className="flex items-center gap-2 mb-6">
        <span className="text-faint text-xs font-body uppercase tracking-widest shrink-0">Sort</span>
        {SORT_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => setSort(opt.value)}
            className={`text-xs px-3 py-1.5 rounded-lg font-body font-medium transition-all border ${
              sort === opt.value
                ? 'bg-amber/10 text-amber border-amber/30'
                : 'bg-card text-faint border-border hover:border-amber/20 hover:text-muted'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

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
