'use client'

import { useState, useEffect, useMemo } from 'react'
import { getAllRecipes } from '@/lib/recipes'
import { useAuth } from '@/lib/AuthContext'
import { useRecipeMetas } from '@/hooks/useRecipeMetas'
import RecipeCard from '@/components/RecipeCard'
import RecipeFilters, { SourceFilter } from '@/components/RecipeFilters'
import type { Recipe } from '@/types/recipe'

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

  useEffect(() => {
    getAllRecipes().then(r => { setRecipes(r); setLoading(false) })
  }, [])

  const filtered = useMemo(() => {
    return recipes.filter(r => {
      const matchSearch = !search ||
        r.title.toLowerCase().includes(search.toLowerCase()) ||
        r.cuisine.toLowerCase().includes(search.toLowerCase()) ||
        r.category.toLowerCase().includes(search.toLowerCase())

      const matchCuisine = cuisine === 'All' || r.cuisine.toLowerCase() === cuisine.toLowerCase()
      const matchCategory = category === 'All' || r.category === category

      // Rating filter — check user meta
      const recipeRating = metas[r.id]?.rating || 0
      const matchRating = minRating === 0 || recipeRating >= minRating

      // Source filter
      const matchSource = source === 'all' ||
        (source === 'mine' && r.addedBy === user?.uid) ||
        (source === 'others' && r.addedBy !== user?.uid)

      return matchSearch && matchCuisine && matchCategory && matchRating && matchSource
    })
  }, [recipes, search, cuisine, category, minRating, source, metas, user])

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="font-display text-5xl text-cream font-light tracking-tight mb-1">Recipes</h1>
        <p className="text-faint text-sm font-body">Your personal collection</p>
      </div>

      <div className="mb-8">
        <RecipeFilters
          search={search}
          cuisine={cuisine}
          category={category}
          minRating={minRating}
          source={source}
          onSearchChange={setSearch}
          onCuisineChange={setCuisine}
          onCategoryChange={setCategory}
          onMinRatingChange={setMinRating}
          onSourceChange={setSource}
          totalCount={recipes.length}
          filteredCount={filtered.length}
          isSignedIn={!!user}
        />
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
