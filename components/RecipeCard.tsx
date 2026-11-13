'use client'

import Link from 'next/link'
import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Bookmark, BookmarkCheck, CalendarPlus, Check, X, Loader2, Clock } from 'lucide-react'
import { getTotalTime, parseTimeToMinutes } from '@/lib/recipes'
import { useAuth } from '@/lib/AuthContext'
import { addRecipeToWeekPlan, addRecipeToDestination, weekIDFromDate, resolveRecipeRole } from '@/lib/userdata'
import { useAppData } from '@/components/AppDataProvider'
import RecipeImage, { getCategoryIcon } from '@/components/RecipeImage'
import type { Recipe } from '@/types/recipe'
import type { RecipeMeta } from '@/lib/userdata'
import { normalizeRecipeCategory } from '@/lib/recipeCategories'
import { destinationLabel, parsePlanDestination, type PlanDestination } from '@/lib/planDestination'

function getCuisineClass(cuisine: string): string {
  const c = cuisine.toLowerCase().replace(/\s+/g, '-')
  const map: Record<string, string> = {
    mexican: 'cuisine-mexican', asian: 'cuisine-asian', american: 'cuisine-american',
    mediterranean: 'cuisine-mediterranean', italian: 'cuisine-italian', indian: 'cuisine-indian',
    'middle-eastern': 'cuisine-middle-eastern', greek: 'cuisine-greek',
  }
  return map[c] || 'cuisine-default'
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
  warm?: boolean
  destination?: PlanDestination | null
  invalidDestination?: boolean
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

export default function RecipeCard({ recipe, meta, compact = false, warm = false, destination = null, invalidDestination = false }: RecipeCardProps) {
  const { user } = useAuth()
  const { isWantToTry, toggleWantToTry } = useAppData()
  const displayImageURL = meta?.overrides?.imageURL || recipe.imageURL
  const rawCategory = meta?.overrides?.category ?? recipe.category
  const displayCategory = normalizeRecipeCategory(rawCategory, recipe.id) ?? rawCategory
  const [showPlanPicker, setShowPlanPicker] = useState(false)
  const [selectedWeek, setSelectedWeek] = useState('')
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState(false)
  const [destinationResult, setDestinationResult] = useState('')
  const [conflict, setConflict] = useState<{ label: string; token: string } | null>(null)
  const [planError, setPlanError] = useState('')
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const wanted = isWantToTry(recipe.id)
  const prepTime = meta?.overrides?.prepTime || recipe.prepTime
  const cookTime = meta?.overrides?.cookTime || recipe.cookTime
  // A missing or unparseable component is not evidence of zero minutes.
  const time = parseTimeToMinutes(prepTime) > 0 && parseTimeToMinutes(cookTime) > 0
    ? getTotalTime(prepTime, cookTime).display : ''

  useEffect(() => {
    if (!showPlanPicker) return
    if (destinationResult) popoverRef.current?.querySelector<HTMLElement>('[data-plan-result]')?.focus()
    else if (conflict) popoverRef.current?.querySelector<HTMLButtonElement>('[data-plan-move]')?.focus()
  }, [showPlanPicker, destinationResult, conflict])

  // Close on outside click — exclude the button itself
  useEffect(() => {
    if (!showPlanPicker) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (buttonRef.current && buttonRef.current.contains(target)) return
      if (popoverRef.current && !popoverRef.current.contains(target)) {
        setShowPlanPicker(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showPlanPicker])

  useEffect(() => {
    if (!showPlanPicker) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setShowPlanPicker(false); buttonRef.current?.focus() }
    }
    document.addEventListener('keydown', closeOnEscape)
    popoverRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [showPlanPicker])

  // Close on scroll/resize while open
  useEffect(() => {
    if (!showPlanPicker) return
    const close = (event: Event) => {
      if (event.type === 'scroll' && event.target instanceof Node && popoverRef.current?.contains(event.target)) return
      setShowPlanPicker(false)
    }
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [showPlanPicker])

  const handleOpenPicker = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!user) return
    setDestinationResult(''); setConflict(null); setPlanError('')
    const weeks = getWeekOptions()
    setSelectedWeek(weeks[1]?.weekID || weeks[0].weekID)
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect) {
      // w-48 = 192px. Clamp left so popover stays in viewport on small screens
      const left = Math.max(8, Math.min(window.innerWidth - 200, rect.right - 192))
      setPopoverPos({ top: Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 375)), left })
    }
    setShowPlanPicker(true)
  }

  const handleConfirm = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!user || !selectedWeek) return
    setAdding(true)
    try {
      await addRecipeToWeekPlan(
        user.uid,
        selectedWeek,
        recipe.id,
        resolveRecipeRole({ ...recipe, category: displayCategory }),
      )
      setAdded(true)
      setTimeout(() => {
        setAdded(false)
        if (popoverRef.current?.contains(document.activeElement)) buttonRef.current?.focus()
        setShowPlanPicker(false)
      }, 1500)
    } catch (err) {
      console.error('Add to plan error:', err)
    } finally {
      setAdding(false)
    }
  }

  const handleDestination = async (expected?: string) => {
    if (!user || !destination || adding) return
    setAdding(true); setPlanError('')
    try {
      const result = await addRecipeToDestination(user.uid, destination.weekID, recipe.id, destination.day, resolveRecipeRole({ ...recipe, category: displayCategory }), expected)
      if (result.status === 'conflict') {
        if (!result.existing || !result.token) { setConflict(null); setPlanError('The plan changed. Review and try again.'); return }
        const day = typeof result.existing === 'string' ? null : result.existing.day ?? null
        setConflict({ label: day && parsePlanDestination(destination.weekID, day) ? destinationLabel({ weekID: destination.weekID, day }) : day || 'Unscheduled', token: result.token })
        setPlanError(expected ? 'The placement changed. Review it before moving.' : '')
      } else {
        setConflict(null)
        setDestinationResult(result.status === 'already' ? 'Already planned for this destination.' : result.status === 'moved' ? 'Moved successfully.' : 'Added successfully.')
      }
    } catch { setPlanError('Couldn’t update the plan. Try again.') }
    finally { setAdding(false) }
  }

  const handleToggleWantToTry = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    void toggleWantToTry(recipe.id)
  }

  return (
    <article className={`recipe-card group relative ${warm ? 'warm-recipe-card' : ''}`}>
      <Link href={`/recipes/${recipe.id}`} className="block recipe-card-link">
        <div className="relative aspect-[4/3] overflow-hidden bg-card">
          <RecipeImage src={displayImageURL} alt="" category={displayCategory} recipeID={recipe.id}
            className="w-full h-full transition-transform duration-500 group-hover:scale-105" emojiClassName="text-4xl" />
          {!warm && recipe.cuisine && <div className={`absolute bottom-3 left-3 text-xs font-body font-medium px-2 py-0.5 rounded-md border ${getCuisineClass(recipe.cuisine)}`}>{recipe.cuisine}</div>}
        </div>
        <div className="recipe-card-copy p-4">
          <h3 className={`font-display text-lg text-cream leading-tight mb-1 ${warm ? '' : 'line-clamp-2 group-hover:text-amber'}`}>{recipe.title}</h3>
          {warm && time && <p className="warm-recipe-time"><Clock size={16} aria-hidden="true" /> {time}</p>}
          {!compact && displayCategory && <p className="recipe-card-category text-faint text-xs font-body">{!warm && <span>{getCategoryIcon(displayCategory, recipe.id)} </span>}{displayCategory}</p>}
          {meta?.rating && meta.rating > 0 ? <div className="recipe-card-rating" aria-label={`Rating ${meta.rating} out of 5`}><HalfStarDisplay rating={meta.rating} /></div> : null}
        </div>
      </Link>
      <button onClick={handleToggleWantToTry}
        aria-label={wanted ? `Remove ${recipe.title} from Want to Try` : `Mark ${recipe.title} as Want to Try`}
        aria-pressed={wanted} title={wanted ? 'Remove from Want to Try' : 'Want to Try'}
        className={`recipe-bookmark hidden sm:flex absolute z-10 rounded-full flex items-center justify-center ${warm ? 'warm-bookmark' : 'bottom-3 right-3 w-10 h-10 sm:w-8 sm:h-8 bg-ink/60 text-muted hover:bg-amber hover:text-ink'} ${wanted ? (warm ? 'is-wanted' : 'bg-amber text-ink') : ''}`}>
        {wanted ? <BookmarkCheck size={18} /> : <Bookmark size={18} />}
      </button>
      <button ref={buttonRef} onClick={handleOpenPicker} title={user ? 'Add to plan' : 'Sign in to add to plan'}
        aria-label={user ? `Add ${recipe.title} to plan` : `Sign in to add ${recipe.title} to plan`}
        aria-expanded={showPlanPicker} disabled={!user || invalidDestination}
        className={warm ? 'warm-plan-button' : `absolute top-3 right-3 z-10 w-8 h-8 rounded-full flex items-center justify-center bg-ink/60 text-muted ${!user ? 'opacity-50 cursor-not-allowed' : ''}`}>
        {added ? <Check size={16} /> : <CalendarPlus size={16} />}{warm && <span>{added ? 'Added!' : 'Add to Plan'}</span>}
      </button>
      {typeof window !== 'undefined' && showPlanPicker && popoverPos && createPortal(
        <div
          ref={popoverRef}
          role="dialog" aria-label={`Add ${recipe.title} to plan`}
          onClick={e => { e.preventDefault(); e.stopPropagation() }}
          style={{ position: 'fixed', top: popoverPos.top, left: popoverPos.left }}
          className="recipe-plan-picker z-[100] bg-surface border border-border rounded-xl shadow-lg p-3 w-48 animate-fade-in"
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-cream text-xs font-body font-medium">{destination ? recipe.title : 'Add to plan'}</p>
            <button
              onClick={e => { e.preventDefault(); e.stopPropagation(); setShowPlanPicker(false); buttonRef.current?.focus() }}
              aria-label="Close add to plan"
              className="text-faint hover:text-cream"
            >
              <X size={12} />
            </button>
          </div>
          {destination ? <div className="space-y-3 text-sm text-cream">
            <p>Destination: {destinationLabel(destination)}</p>
            {planError && <p role="alert">{planError}</p>}
            {destinationResult ? <><p role="status" data-plan-result tabIndex={-1}>{destinationResult}</p><Link className="underline block py-2" href={`/plan?week=${destination.weekID}`}>Return to Meal Plan</Link></> : conflict ? <>
              <p>Already planned: {conflict.label}. Move it to {destinationLabel(destination)}?</p>
              <button data-plan-move className="w-full bg-amber text-ink rounded-lg px-2 py-2" disabled={adding} onClick={() => void handleDestination(conflict.token)}>Move recipe</button>
              <button className="w-full text-left" onClick={() => { setConflict(null); setShowPlanPicker(false); buttonRef.current?.focus() }}>Cancel</button>
            </> : <button className="w-full bg-amber text-ink rounded-lg px-2 py-2" disabled={adding} onClick={() => void handleDestination()}>{adding ? 'Adding…' : destination.day ? 'Add to this day' : 'Add to Unscheduled'}</button>}
          </div> : <>
          <div className="space-y-1 mb-2">
            {getWeekOptions().map(w => (
              <button
                key={w.weekID}
                aria-pressed={selectedWeek === w.weekID}
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
          </>}
        </div>,
        document.body
      )}
    </article>
  )
}
