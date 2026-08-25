'use client'

import { useState, useEffect } from 'react'
import {
  normalizeRecipeCategory,
  type RecipeCategory,
} from '@/lib/recipeCategories'

// Recipe-category → emoji, shared so every image fallback looks the same.
const CATEGORY_ICONS: Record<RecipeCategory, string> = {
  'Chicken & Poultry': '🍗',
  'Beef & Pork': '🥩',
  'Seafood': '🐟',
  'Vegetarian Mains': '🥦',
  'Pasta, Noodles & Rice': '🍝',
  'Salads & Bowls': '🥗',
  'Soups, Stews & Chili': '🍲',
  Breakfast: '🍳',
  Snacks: '🥨',
  Drinks: '🥤',
  'Sauces & Condiments': '🫙',
  Sides: '🥕',
}

export function getCategoryIcon(category?: string, recipeID?: string): string {
  const canonical = normalizeRecipeCategory(category, recipeID)
  return canonical ? CATEGORY_ICONS[canonical] : '🍽️'
}

interface RecipeImageProps {
  src?: string | null
  alt: string
  /** Recipe category — picks the fallback emoji. Omit for a generic 🍽️. */
  category?: string
  /** Recipe ID enables exact compatibility for heterogeneous legacy categories. */
  recipeID?: string
  /** Sizing/shape classes, applied to both the <img> and the fallback. */
  className?: string
  /** Size class for the fallback emoji, e.g. "text-4xl". */
  emojiClassName?: string
  loading?: 'lazy' | 'eager'
}

/**
 * Thin <img> wrapper with a graceful fallback. On a missing `src` OR a load
 * error it renders a centered category emoji on a `bg-card` placeholder instead
 * of showing alt text, a broken-image icon, or nothing. Plain <img> by design —
 * the codebase uses zero next/image.
 */
export default function RecipeImage({
  src,
  alt,
  category,
  recipeID,
  className = '',
  emojiClassName = 'text-2xl',
  loading = 'lazy',
}: RecipeImageProps) {
  const [errored, setErrored] = useState(false)

  // Reset on src change so a later valid image isn't stuck on the fallback.
  useEffect(() => { setErrored(false) }, [src])

  if (!src || errored) {
    return (
      <div className={`flex items-center justify-center bg-card ${className}`} aria-hidden="true">
        <span className={`opacity-30 ${emojiClassName}`}>{getCategoryIcon(category, recipeID)}</span>
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={alt}
      loading={loading}
      onError={() => setErrored(true)}
      className={`object-cover ${className}`}
    />
  )
}
