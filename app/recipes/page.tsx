'use client'

import { useState, useEffect, useMemo } from 'react'
import { getAllRecipes } from '@/lib/recipes'
import RecipeCard from '@/components/RecipeCard'
import RecipeFilters from '@/components/RecipeFilters'
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
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [cuisine, setCuisine] = useState('All')
  const [category, setCategory] = useState('All')

  useEffect(() => {
    getAllRecipes().then(r => {
      setRecipes(r)
      setLoading(false)
    })
  }, [])

  const filtered = useMemo(() => {
    return recipes.filter(r => {
      const matchSearch = !search ||
        r.title.toLowerCase().includes(search.toLowerCase()) ||
        r.cuisine.toLowerCase().includes(search.toLowerCase()) ||
        r.category.toLowerCase().includes(search.toLowerCase())
      const matchCuisine = cuisine === 'All' || r.cuisine.toLowerCase() === cuisine.toLowerCase()
      const matchCategory = category === 'All' || r.category === category
      return matchSearch && matchCuisine && matchCategory
    })
  }, [recipes, search, cuisine, category])

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-display text-5xl text-cream font-light tracking-tight mb-1">
          Recipes
        </h1>
        <p className="text-faint text-sm font-body">Your personal collection</p>
      </div>

      {/* Filters */}
      <div className="mb-8">
        <RecipeFilters
          search={search}
          cuisine={cuisine}
          category={category}
          onSearchChange={setSearch}
          onCuisineChange={setCuisine}
          onCategoryChange={setCategory}
          totalCount={recipes.length}
          filteredCount={filtered.length}
        />
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-24">
          <p className="font-display text-3xl text-faint font-light mb-2">No recipes found</p>
          <p className="text-faint text-sm font-body">Try adjusting your filters</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 animate-fade-in">
          {filtered.map(recipe => (
            <RecipeCard key={recipe.id} recipe={recipe} />
          ))}
        </div>
      )}
    </div>
  )
}
