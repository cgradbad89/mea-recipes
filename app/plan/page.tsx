'use client'

import { useState, useEffect, useRef } from 'react'
import { ChevronLeft, ChevronRight, Check, X, Loader2, ShoppingCart, ArrowRightLeft, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { useAuth } from '@/lib/AuthContext'
import {
  subscribeWeekPlan, weekIDFromDate, removeRecipeFromWeekPlan,
  markRecipeCooked, addRecipeIngredientsToGrocery, getAllWeekPlans,
  moveRecipeToWeek, saveRecipeMeta, getRecipeMeta, rebuildGroceryFromPlan,
  type WeekPlan, type RecipeMeta
} from '@/lib/userdata'
import { getAllRecipes, parseRecipeContent, getRecipeById } from '@/lib/recipes'
import type { Recipe } from '@/types/recipe'

function getWeekDates(weekID: string): string[] {
  const dates = []
  const start = new Date(weekID + 'T12:00:00')
  for (let i = 0; i < 7; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    dates.push(d.toISOString().split('T')[0])
  }
  return dates
}

function formatWeekLabel(weekID: string): string {
  const start = new Date(weekID + 'T12:00:00')
  const end = new Date(weekID + 'T12:00:00')
  end.setDate(end.getDate() + 6)
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${fmt(start)} – ${fmt(end)}`
}

function addWeeks(weekID: string, delta: number): string {
  const d = new Date(weekID + 'T12:00:00')
  d.setDate(d.getDate() + delta * 7)
  return weekIDFromDate(d)
}

// Half-star interactive rating component (same pattern as recipes/[id]/page.tsx)
function StarRating({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  const [hover, setHover] = useState(0)

  const handleMouseMove = (e: React.MouseEvent<HTMLButtonElement>, star: number) => {
    if (!onChange) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    setHover(x < rect.width / 2 ? star - 0.5 : star)
  }

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>, star: number) => {
    if (!onChange) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const newRating = x < rect.width / 2 ? star - 0.5 : star
    onChange(newRating === value ? 0 : newRating)
  }

  const display = hover || value

  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(star => {
        const full = display >= star
        const half = !full && display >= star - 0.5
        return (
          <button
            key={star}
            onMouseMove={e => handleMouseMove(e, star)}
            onMouseLeave={() => setHover(0)}
            onClick={e => handleClick(e, star)}
            disabled={!onChange}
            className="relative w-6 h-6 transition-transform hover:scale-110"
          >
            <svg viewBox="0 0 24 24" className="w-6 h-6 text-faint/30 absolute inset-0" fill="currentColor">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
            </svg>
            {full && (
              <svg viewBox="0 0 24 24" className="w-6 h-6 text-amber absolute inset-0" fill="currentColor">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
              </svg>
            )}
            {half && (
              <svg viewBox="0 0 24 24" className="w-6 h-6 text-amber absolute inset-0" fill="currentColor">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77V2z"/>
              </svg>
            )}
          </button>
        )
      })}
    </div>
  )
}

// Inline modal shown after marking a recipe cooked (if no existing rating)
function CookRatingModal({
  recipeName,
  onSave,
  onSkip,
}: {
  recipeName: string
  onSave: (rating: number, note: string) => void
  onSkip: () => void
}) {
  const [rating, setRating] = useState(0)
  const [note, setNote] = useState('')

  return (
    <div className="bg-card border border-amber/20 rounded-xl p-4 mt-2 animate-fade-in">
      <p className="text-cream text-sm font-body font-medium mb-3">
        How was <span className="text-amber">{recipeName}</span>?
      </p>
      <div className="mb-3">
        <StarRating value={rating} onChange={setRating} />
      </div>
      <textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        placeholder="Any notes? (optional)"
        rows={2}
        className="input-field resize-none text-sm mb-3"
      />
      <div className="flex gap-2">
        <button
          onClick={() => onSave(rating, note)}
          disabled={rating === 0}
          className="btn-primary text-xs px-3 py-1.5 disabled:opacity-40"
        >
          Save
        </button>
        <button onClick={onSkip} className="btn-ghost text-xs px-3 py-1.5">
          Skip
        </button>
      </div>
    </div>
  )
}

export default function PlanPage() {
  const { user, signIn } = useAuth()
  const [weekID, setWeekID] = useState(() => weekIDFromDate(new Date()))
  const [plan, setPlan] = useState<WeekPlan | null>(null)
  const [recipes, setRecipes] = useState<Record<string, Recipe>>({})
  const [loadingRecipes, setLoadingRecipes] = useState(true)
  const [addingToGrocery, setAddingToGrocery] = useState<string | null>(null)
  const [moveOpenFor, setMoveOpenFor] = useState<string | null>(null)
  const [movingRecipe, setMovingRecipe] = useState<string | null>(null)
  const [ratingPromptFor, setRatingPromptFor] = useState<string | null>(null)
  const [metas, setMetas] = useState<Record<string, RecipeMeta>>({})
  const [showRebuildConfirm, setShowRebuildConfirm] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  const [rebuildDone, setRebuildDone] = useState(false)

  // Load all recipes for lookup
  useEffect(() => {
    getAllRecipes().then(list => {
      const map: Record<string, Recipe> = {}
      list.forEach(r => { map[r.id] = r })
      setRecipes(map)
      setLoadingRecipes(false)
    })
  }, [])

  // Subscribe to week plan
  useEffect(() => {
    if (!user) return
    const unsub = subscribeWeekPlan(user.uid, weekID, setPlan)
    return unsub
  }, [user, weekID])

  // Load metas for planned recipes (to check existing ratings)
  useEffect(() => {
    if (!user || !plan) return
    const ids = plan.plannedRecipeIDs || []
    ids.forEach(id => {
      if (metas[id] !== undefined) return
      getRecipeMeta(user.uid, id).then(m => {
        setMetas(prev => ({ ...prev, [id]: m || {} }))
      })
    })
  }, [user, plan])

  const plannedIDs = plan?.plannedRecipeIDs || []
  const cookedIDs = new Set(plan?.cookedRecipeIDs || [])
  const uncookedPlanned = plannedIDs.filter(id => !cookedIDs.has(id))
  const cooked = plannedIDs.filter(id => cookedIDs.has(id))

  // Surrounding weeks for move dropdown (2 before, 2 after)
  const surroundingWeeks = [-2, -1, 1, 2].map(delta => ({
    weekID: addWeeks(weekID, delta),
    label: formatWeekLabel(addWeeks(weekID, delta)),
  }))

  const handleMarkCooked = async (recipeID: string, isCooked: boolean) => {
    if (!user) return
    // On check (not uncheck), show rating prompt if no existing rating
    if (isCooked && !metas[recipeID]?.rating) {
      await markRecipeCooked(user.uid, weekID, recipeID, true)
      setRatingPromptFor(recipeID)
      return
    }
    await markRecipeCooked(user.uid, weekID, recipeID, isCooked)
  }

  const handleRatingSave = async (recipeID: string, rating: number, note: string) => {
    if (!user) return
    const data: Partial<RecipeMeta> = { rating }
    if (note.trim()) data.note = note
    await saveRecipeMeta(user.uid, recipeID, data)
    setMetas(prev => ({ ...prev, [recipeID]: { ...prev[recipeID], ...data } }))
    setRatingPromptFor(null)
  }

  const handleRatingSkip = () => {
    setRatingPromptFor(null)
  }

  const handleRemove = async (recipeID: string) => {
    if (!user) return
    await removeRecipeFromWeekPlan(user.uid, weekID, recipeID)
  }

  const handleMoveToWeek = async (recipeID: string, targetWeekID: string) => {
    if (!user) return
    setMovingRecipe(recipeID)
    await moveRecipeToWeek(user.uid, weekID, targetWeekID, recipeID)
    setMoveOpenFor(null)
    setMovingRecipe(null)
  }

  const handleAddToGrocery = async (recipeID: string) => {
    if (!user) return
    const recipe = recipes[recipeID]
    if (!recipe) return
    setAddingToGrocery(recipeID)
    const { ingredients } = parseRecipeContent(recipe.content)
    await addRecipeIngredientsToGrocery(user.uid, recipeID, ingredients)
    setAddingToGrocery(null)
  }

  const handleRebuildGrocery = async () => {
    if (!user || !plan) return
    setRebuilding(true)
    setShowRebuildConfirm(false)
    await rebuildGroceryFromPlan(user.uid, plan.plannedRecipeIDs || [], getRecipeById, parseRecipeContent)
    setRebuilding(false)
    setRebuildDone(true)
    setTimeout(() => setRebuildDone(false), 2000)
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-5 p-6">
        <div className="w-16 h-16 rounded-full bg-amber/10 flex items-center justify-center">
          <span className="font-display text-3xl">📅</span>
        </div>
        <h2 className="font-display text-3xl text-cream font-light">Meal Planning</h2>
        <p className="text-muted text-sm font-body text-center max-w-xs">
          Sign in to plan your meals for the week and keep everything in sync across devices.
        </p>
        <button onClick={signIn} className="btn-primary">Sign in with Google</button>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      {/* Header + week picker */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-display text-4xl text-cream font-light">Meal Plan</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekID(w => addWeeks(w, -1))}
            className="w-8 h-8 rounded-lg border border-border flex items-center justify-center text-faint hover:text-cream hover:border-amber/30 transition-all"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm font-body text-muted w-36 text-center">
            {formatWeekLabel(weekID)}
          </span>
          <button
            onClick={() => setWeekID(w => addWeeks(w, 1))}
            className="w-8 h-8 rounded-lg border border-border flex items-center justify-center text-faint hover:text-cream hover:border-amber/30 transition-all"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Rebuild grocery button */}
      {plannedIDs.length > 0 && (
        <div className="mb-8">
          {showRebuildConfirm ? (
            <div className="bg-surface border border-amber/20 rounded-xl p-4 animate-fade-in">
              <p className="text-cream text-sm font-body mb-3">
                This will remove recipe-sourced items and re-add fresh ingredients from this week&apos;s planned recipes. Your manually added items will be kept.
              </p>
              <div className="flex gap-2">
                <button onClick={handleRebuildGrocery} className="btn-primary text-xs px-3 py-1.5">Rebuild</button>
                <button onClick={() => setShowRebuildConfirm(false)} className="btn-ghost text-xs px-3 py-1.5">Cancel</button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => rebuildDone ? null : setShowRebuildConfirm(true)}
              disabled={rebuilding}
              className="flex items-center gap-2 text-sm font-body text-faint hover:text-amber transition-colors"
            >
              {rebuilding ? <Loader2 size={14} className="animate-spin" /> : rebuildDone ? <Check size={14} className="text-green-400" /> : <RefreshCw size={14} />}
              {rebuilding ? 'Rebuilding…' : rebuildDone ? 'Done!' : 'Rebuild grocery list'}
            </button>
          )}
        </div>
      )}

      {loadingRecipes ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-amber" size={24} />
        </div>
      ) : (
        <>
          {/* Planned section */}
          <section className="mb-8">
            <h2 className="font-display text-xl text-cream font-light mb-4">
              Planned
              {uncookedPlanned.length > 0 && (
                <span className="ml-2 text-faint text-sm font-body">{uncookedPlanned.length}</span>
              )}
            </h2>

            {uncookedPlanned.length === 0 ? (
              <div className="bg-surface border border-border rounded-2xl p-6 text-center">
                <p className="text-faint text-sm font-body mb-3">No recipes planned this week</p>
                <Link href="/recipes" className="btn-ghost text-xs">Browse recipes →</Link>
              </div>
            ) : (
              <div className="space-y-2">
                {uncookedPlanned.map(id => {
                  const recipe = recipes[id]
                  if (!recipe) return null
                  return (
                    <div key={id}>
                      <div className="bg-surface border border-border rounded-xl p-3 flex items-center gap-3">
                        {recipe.imageURL && (
                          <img src={recipe.imageURL} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0"
                            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                        )}
                        <div className="flex-1 min-w-0">
                          <Link href={`/recipes/${id}`}>
                            <p className="text-cream text-sm font-body font-medium truncate hover:text-amber transition-colors">
                              {recipe.title}
                            </p>
                          </Link>
                          <p className="text-faint text-xs font-body capitalize">{recipe.cuisine}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {/* Move to week */}
                          <div className="relative">
                            <button
                              onClick={() => setMoveOpenFor(moveOpenFor === id ? null : id)}
                              className="w-8 h-8 rounded-lg border border-border flex items-center justify-center text-faint hover:text-amber hover:border-amber/30 transition-all"
                              title="Move to another week"
                            >
                              {movingRecipe === id
                                ? <Loader2 size={13} className="animate-spin" />
                                : <ArrowRightLeft size={13} />
                              }
                            </button>
                            {moveOpenFor === id && (
                              <div className="absolute right-0 top-9 z-10 bg-card border border-border rounded-xl shadow-lg py-1 w-48 animate-fade-in">
                                <p className="text-faint text-[10px] font-body uppercase tracking-widest px-3 py-1.5">Move to week</p>
                                {surroundingWeeks.map(w => (
                                  <button
                                    key={w.weekID}
                                    onClick={() => handleMoveToWeek(id, w.weekID)}
                                    className="w-full text-left px-3 py-2 text-sm font-body text-muted hover:text-cream hover:bg-surface transition-colors"
                                  >
                                    {w.label}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          <button
                            onClick={() => handleAddToGrocery(id)}
                            className="w-8 h-8 rounded-lg border border-border flex items-center justify-center text-faint hover:text-amber hover:border-amber/30 transition-all"
                            title="Add ingredients to grocery list"
                          >
                            {addingToGrocery === id
                              ? <Loader2 size={13} className="animate-spin" />
                              : <ShoppingCart size={13} />
                            }
                          </button>
                          <button
                            onClick={() => handleMarkCooked(id, true)}
                            className="w-8 h-8 rounded-lg border border-border flex items-center justify-center text-faint hover:text-green-400 hover:border-green-400/30 transition-all"
                            title="Mark as cooked"
                          >
                            <Check size={13} />
                          </button>
                          <button
                            onClick={() => handleRemove(id)}
                            className="w-8 h-8 rounded-lg border border-border flex items-center justify-center text-faint hover:text-red-400 hover:border-red-400/30 transition-all"
                            title="Remove from plan"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      </div>
                      {/* Rating prompt after marking cooked */}
                      {ratingPromptFor === id && (
                        <CookRatingModal
                          recipeName={recipe.title}
                          onSave={(r, n) => handleRatingSave(id, r, n)}
                          onSkip={handleRatingSkip}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* Cooked section */}
          {cooked.length > 0 && (
            <section>
              <h2 className="font-display text-xl text-cream font-light mb-4">
                Cooked
                <span className="ml-2 text-faint text-sm font-body">{cooked.length}</span>
              </h2>
              <div className="space-y-2">
                {cooked.map(id => {
                  const recipe = recipes[id]
                  if (!recipe) return null
                  return (
                    <div key={id}>
                      <div className="bg-surface border border-border rounded-xl p-3 flex items-center gap-3 opacity-60">
                        <div className="w-12 h-12 rounded-lg bg-card flex items-center justify-center shrink-0">
                          <Check size={16} className="text-green-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <Link href={`/recipes/${id}`}>
                            <p className="text-muted text-sm font-body font-medium truncate line-through">
                              {recipe.title}
                            </p>
                          </Link>
                        </div>
                        <button
                          onClick={() => handleMarkCooked(id, false)}
                          className="text-faint text-xs font-body hover:text-muted transition-colors px-2"
                        >
                          Undo
                        </button>
                      </div>
                      {ratingPromptFor === id && (
                        <CookRatingModal
                          recipeName={recipe.title}
                          onSave={(r, n) => handleRatingSave(id, r, n)}
                          onSkip={handleRatingSkip}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
