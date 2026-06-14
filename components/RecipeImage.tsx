'use client'

import { useState, useEffect } from 'react'

// Recipe-category → emoji, shared so every image fallback looks the same.
const CATEGORY_ICONS: Record<string, string> = {
  'Chicken & Poultry': '🍗',
  'Vegetarian Mains': '🥦',
  'Salads & Bowls': '🥗',
  'Pasta, Noodles & Rice': '🍝',
  'Soups, Stews & Chili': '🍲',
  'Seafood': '🐟',
  'Beef & Pork': '🥩',
  'Breakfast, Snacks & Sides': '🍳',
}

export function getCategoryIcon(category?: string): string {
  if (!category) return '🍽️'
  return CATEGORY_ICONS[category] || '🍽️'
}

interface RecipeImageProps {
  src?: string | null
  alt: string
  /** Recipe category — picks the fallback emoji. Omit for a generic 🍽️. */
  category?: string
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
        <span className={`opacity-30 ${emojiClassName}`}>{getCategoryIcon(category)}</span>
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
