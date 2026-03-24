'use client'

import { useState, useEffect } from 'react'
import { Heart, Loader2 } from 'lucide-react'
import { useAuth } from '@/lib/AuthContext'
import { useFavorites } from '@/hooks/useFavorites'
import { getAllRecipes } from '@/lib/recipes'
import RecipeCard from '@/components/RecipeCard'
import type { Recipe } from '@/types/recipe'

export default function FavoritesPage() {
  const { user, signIn } = useAuth()
  const { favorites, loaded } = useFavorites()
  const [allRecipes, setAllRecipes] = useState<Recipe[]>([])
  const [loadingRecipes, setLoadingRecipes] = useState(true)

  useEffect(() => {
    getAllRecipes().then(r => {
      setAllRecipes(r)
      setLoadingRecipes(false)
    })
  }, [])

  const favoriteRecipes = allRecipes.filter(r => favorites.has(r.id))
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
        <button onClick={signIn} className="btn-primary">Sign in with Google</button>
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
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 animate-fade-in">
          {favoriteRecipes.map(recipe => (
            <RecipeCard key={recipe.id} recipe={recipe} />
          ))}
        </div>
      )}
    </div>
  )
}
