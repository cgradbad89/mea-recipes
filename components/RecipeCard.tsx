'use client'

import Link from 'next/link'
import { useState, useEffect, useRef } from 'react'
import { CalendarPlus, Check, X, Loader2 } from 'lucide-react'
import { useAuth } from '@/lib/AuthContext'
import { addRecipeToWeekPlan, weekIDFromDate } from '@/lib/userdata'
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
            <svg viewBox="0 0 24 24" className="w-3 h-3 text-faint/30 absolute inset-0" fill="currentColor">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
            </svg>
            {full && (
              <svg viewBox="0 0 24 24" className="w-3 h-3 text-amber absolute inset-0" fill="currentColor">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
              </svg>
            )}
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

function formatWeekLabel(weekID: string, offset: number): string {
  const d = new Date(weekID + 'T12:00:00')
  const short = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  if (offset === 0) return `This week (${short})`
  if (offset === 1) return `Next week (${short})`
  return `${short}`
}

function getWeekOptions(): { weekID: string; label: string; offset: number }[] {
  const now = new Date()
  return [0, 1, 2, 3, 4].map(offset => {
    const d = new Date(now)
    d.setDate(d.getDate() + offset * 7)
    const wid = weekIDFromDate(d)
    return { weekID: wid, label: formatWeekLabel(wid, offset), offset }
  })
}

export default function RecipeCard({ recipe, meta, compact = false }: RecipeCardProps) {
  const { user } = useAuth()
  const displayImageURL = meta?.overrides?.imageURL || recipe.imageURL
  const [showPlanPicker, setShowPlanPicker] = useState(false)
  const [selectedWeek, setSelectedWeek] = useState('')
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!showPlanPicker) return
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowPlanPicker(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showPlanPicker])

  const handleOpenPicker = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!user) return
    const weeks = getWeekOptions()
    setSelectedWeek(weeks[1]?.weekID || weeks[0].weekID)
    setShowPlanPicker(true)
  }

  const handleConfirm = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!user || !selectedWeek) return
    setAdding(true)
    try {
      await addRecipeToWeekPlan(user.uid, selectedWeek, recipe.id)
      setAdded(true)
      setTimeout(() => {
        setAdded(false)
        setShowPlanPicker(false)
      }, 1500)
    } catch (err) {
      console.error('Add to plan error:', err)
    } finally {
      setAdding(false)
    }
  }

  return (
    <Link href={`/recipes/${recipe.id}`} className="recipe-card group block relative">
      <div className="relative aspect-[4/3] overflow-hidden bg-card">
        {displayImageURL ? (
          <img src={displayImageURL} alt={recipe.title}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-card">
            <span className="text-4xl opacity-30">{getCategoryIcon(recipe.category)}</span>
          </div>
        )}
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

      {/* Add-to-Plan button + popover — outside overflow-hidden image wrapper so popover isn't clipped */}
      <div className="absolute top-3 right-3 z-10" ref={popoverRef}>
        <button
          onClick={handleOpenPicker}
          title={user ? 'Add to plan' : 'Sign in to add to plan'}
          disabled={!user}
          className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200 ${
            added
              ? 'bg-green-500 text-white'
              : 'bg-ink/60 text-muted hover:bg-amber hover:text-ink'
          } ${!user ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {added ? <Check size={14} /> : <CalendarPlus size={14} />}
        </button>

        {showPlanPicker && (
          <div
            onClick={e => { e.preventDefault(); e.stopPropagation() }}
            className="absolute top-10 right-0 z-50 bg-surface border border-border rounded-xl shadow-lg p-3 w-48 animate-fade-in"
          >
            <div className="flex items-center justify-between mb-2">
              <p className="text-cream text-xs font-body font-medium">Add to plan</p>
              <button
                onClick={e => { e.preventDefault(); e.stopPropagation(); setShowPlanPicker(false) }}
                className="text-faint hover:text-cream"
              >
                <X size={12} />
              </button>
            </div>
            <div className="space-y-1 mb-2">
              {getWeekOptions().map(w => (
                <button
                  key={w.weekID}
                  onClick={e => { e.preventDefault(); e.stopPropagation(); setSelectedWeek(w.weekID) }}
                  className={`w-full text-left px-2 py-1.5 rounded-lg text-xs font-body transition-colors ${
                    selectedWeek === w.weekID
                      ? 'bg-amber/10 text-amber'
                      : 'text-faint hover:text-cream hover:bg-card'
                  }`}
                >
                  {w.label}
                </button>
              ))}
            </div>
            <button
              onClick={handleConfirm}
              disabled={adding || added}
              className="w-full bg-amber text-ink font-body font-semibold text-xs px-3 py-1.5 rounded-lg hover:bg-amber-glow transition-colors flex items-center justify-center gap-1.5"
            >
              {adding ? <Loader2 size={11} className="animate-spin" /> : added ? <Check size={11} /> : <CalendarPlus size={11} />}
              {added ? 'Added!' : 'Add to Plan'}
            </button>
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
