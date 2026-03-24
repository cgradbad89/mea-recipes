'use client'

import Link from 'next/link'
import { Heart, ExternalLink } from 'lucide-react'
import { useFavorites } from '@/hooks/useFavorites'
import type { Recipe } from '@/types/recipe'

function getCuisineClass(cuisine: string): string {
  const c = cuisine.toLowerCase().replace(/\s+/g, '-')
  const map: Record<string, string> = {
    mexican: 'cuisine-mexican',
    asian: 'cuisine-asian',
    american: 'cuisine-american',
    mediterranean: 'cuisine-mediterranean',
    italian: 'cuisine-italian',
    indian: 'cuisine-indian',
    'middle-eastern': 'cuisine-middle-eastern',
    greek: 'cuisine-greek',
  }
  return map[c] || 'cuisine-default'
}

function getCategoryIcon(category: string): string {
  const map: Record<string, string> = {
    'Chicken & Poultry': '🍗',
    'Vegetarian Mains': '🥦',
    'Salads & Bowls': '🥗',
    'Pasta, Noodles & Rice': '🍝',
    'Soups, Stews & Chili': '🍲',
    'Seafood': '🐟',
    'Beef & Pork': '🥩',
    'Breakfast, Snacks & Sides': '🍳',
  }
  return map[category] || '🍽️'
}

interface RecipeCardProps {
  recipe: Recipe
  compact?: boolean
}

export default function RecipeCard({ recipe, compact = false }: RecipeCardProps) {
  const { isFavorite, toggle } = useFavorites()
  const fav = isFavorite(recipe.id)

  const handleFav = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    toggle(recipe.id)
  }

  return (
    <Link href={`/recipes/${recipe.id}`} className="recipe-card group block">
      {/* Image */}
      <div className="relative aspect-[4/3] overflow-hidden bg-card">
        {recipe.imageURL ? (
          <img
            src={recipe.imageURL}
            alt={recipe.title}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
            onError={e => {
              (e.target as HTMLImageElement).style.display = 'none'
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-card">
            <span className="text-4xl opacity-30">
              {getCategoryIcon(recipe.category)}
            </span>
          </div>
        )}

        {/* Favorite button */}
        <button
          onClick={handleFav}
          className={`absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200 ${
            fav
              ? 'bg-amber text-ink'
              : 'bg-ink/60 text-muted hover:bg-ink/80 hover:text-cream'
          }`}
        >
          <Heart size={14} fill={fav ? 'currentColor' : 'none'} />
        </button>

        {/* Cuisine badge */}
        {recipe.cuisine && (
          <div className={`absolute bottom-3 left-3 text-xs font-body font-medium px-2 py-0.5 rounded-md border ${getCuisineClass(recipe.cuisine)}`}>
            {recipe.cuisine}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        <h3 className="font-display text-lg text-cream leading-tight mb-1 line-clamp-2 group-hover:text-amber transition-colors duration-200">
          {recipe.title}
        </h3>
        {!compact && recipe.category && (
          <p className="text-faint text-xs font-body flex items-center gap-1.5">
            <span>{getCategoryIcon(recipe.category)}</span>
            {recipe.category}
          </p>
        )}
      </div>
    </Link>
  )
}
