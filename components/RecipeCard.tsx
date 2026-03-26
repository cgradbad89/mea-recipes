'use client'

import Link from 'next/link'
import { Heart } from 'lucide-react'
import { useFavorites } from '@/hooks/useFavorites'
import type { Recipe } from '@/types/recipe'
import type { RecipeMeta } from '@/lib/userdata'

function getCuisineClass(cuisine: string): string {
  const c = cuisine.toLowerCase().replace(/\s+/g, '-')
  const map: Record<string, string> = {
    mexican: 'cuisine-mexican', asian: 'cuisine-asian', american: 'cuisine-american',
    mediterranean: 'cuisine-mediterranean', italian: 'cuisine-italian', indian: 'cuisine-indian',
    'middle-eastern': 'cuisine-middle-eastern', greek: 'cuisine-greek',
  }
  return map[c] || 'cuisine-default'
}

function getCategoryIcon(category: string): string {
  const map: Record<string, string> = {
    'Chicken & Poultry': '🍗', 'Vegetarian Mains': '🥦', 'Salads & Bowls': '🥗',
    'Pasta, Noodles & Rice': '🍝', 'Soups, Stews & Chili': '🍲',
    'Seafood': '🐟', 'Beef & Pork': '🥩', 'Breakfast, Snacks & Sides': '🍳',
  }
  return map[category] || '🍽️'
}

function HalfStarDisplay({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(star => {
        const full = rating >= star
        const half = !full && rating >= star - 0.5
        return (
          <span key={star} className="relative inline-block w-3 h-3">
            {/* Empty star background */}
            <svg viewBox="0 0 24 24" className="w-3 h-3 text-faint/30 absolute inset-0" fill="currentColor">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
            </svg>
            {/* Full star */}
            {full && (
              <svg viewBox="0 0 24 24" className="w-3 h-3 text-amber absolute inset-0" fill="currentColor">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
              </svg>
            )}
            {/* Half star */}
            {half && (
              <svg viewBox="0 0 24 24" className="w-3 h-3 text-amber absolute inset-0" fill="currentColor">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77V2z"/>
              </svg>
            )}
          </span>
        )
      })}
      <span className="text-amber text-xs font-body font-semibold ml-0.5">{rating}</span>
    </div>
  )
}

interface RecipeCardProps {
  recipe: Recipe
  meta?: RecipeMeta
  compact?: boolean
}

export default function RecipeCard({ recipe, meta, compact = false }: RecipeCardProps) {
  const { isFavorite, toggle } = useFavorites()
  const fav = isFavorite(recipe.id)

  const handleFav = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    toggle(recipe.id)
  }

  return (
    <Link href={`/recipes/${recipe.id}`} className="recipe-card group block">
      <div className="relative aspect-[4/3] overflow-hidden bg-card">
        {recipe.imageURL ? (
          <img src={recipe.imageURL} alt={recipe.title}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-card">
            <span className="text-4xl opacity-30">{getCategoryIcon(recipe.category)}</span>
          </div>
        )}
        <button onClick={handleFav}
          className={`absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200 ${
            fav ? 'bg-amber text-ink' : 'bg-ink/60 text-muted hover:bg-ink/80 hover:text-cream'
          }`}
        >
          <Heart size={14} fill={fav ? 'currentColor' : 'none'} />
        </button>
        {meta?.rating && meta.rating > 0 && (
          <div className="absolute top-3 left-3 flex items-center gap-1 bg-ink/70 backdrop-blur-sm rounded-lg px-2 py-1">
            <HalfStarDisplay rating={meta.rating} />
          </div>
        )}
        {recipe.cuisine && (
          <div className={`absolute bottom-3 left-3 text-xs font-body font-medium px-2 py-0.5 rounded-md border ${getCuisineClass(recipe.cuisine)}`}>
            {recipe.cuisine}
          </div>
        )}
      </div>
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
