'use client'

import { useState, useEffect, useRef, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Check, X, Loader2, ShoppingCart, ArrowRightLeft, RefreshCw, Calendar, Plus, GripVertical } from 'lucide-react'
import Link from 'next/link'
import { getDocs, collection } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/lib/AuthContext'
import {
  subscribeWeekPlan, weekIDFromDate, removeRecipeFromWeekPlan, getWeekPlan,
  markRecipeCooked, addRecipeIngredientsToGrocery,
  moveRecipeToWeek, saveRecipeMeta, getRecipeMeta, rebuildGroceryFromPlan,
  publishSharedPlan, subscribeSharedWeekPlans, addRecipeToWeekPlan,
  assignRecipeToDay, setPlannedRecipeRole, resolveRecipeRole,
  normalizePlanned, plannedRecipeIDList,
  type WeekPlan, type RecipeMeta, type SharedPlanEntry, type PlannedEntry, type PlannedRole
} from '@/lib/userdata'
import { getAllRecipes, parseRecipeContent, getRecipeById } from '@/lib/recipes'
import { logCookEvent, getTodayCookEventForRecipe } from '@/lib/consumptionLog'
import { perServingForViewer } from '@/lib/nutrition'
import StarRating from '@/components/StarRating'
import RecipeImage from '@/components/RecipeImage'
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

// Inline prompt shown when ticking "cooked": captures servings eaten so the
// cook event lands in the consumption log (Surface 2). "Just mark cooked"
// updates the plan without logging.
function CookServingsModal({
  recipeName,
  onConfirm,
  onSkip,
}: {
  recipeName: string
  onConfirm: (servingsEaten: number) => Promise<void>
  onSkip: () => Promise<void>
}) {
  const [servings, setServings] = useState('1')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const v = parseFloat(servings)
  const valid = Number.isFinite(v) && v > 0

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try { await fn() } catch { setError("Couldn't save — try again."); setBusy(false) }
  }

  return (
    <div className="bg-card border border-amber/20 rounded-xl p-4 animate-fade-in">
      <p className="text-cream text-sm font-body font-medium mb-1">
        Cooked <span className="text-amber">{recipeName}</span> — log it to today?
      </p>
      <p className="text-faint text-xs font-body mb-3">Servings you ate:</p>
      <div className="flex items-center gap-2 mb-3">
        <input
          type="number"
          min="0.25"
          step="0.25"
          inputMode="decimal"
          value={servings}
          onChange={e => setServings(e.target.value)}
          className="input-field w-24 text-sm"
          autoFocus
        />
      </div>
      {error && <p className="text-red-400 text-xs font-body mb-2">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={() => valid && run(() => onConfirm(v))}
          disabled={!valid || busy}
          className="btn-primary text-xs px-3 py-1.5 disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Log & mark cooked'}
        </button>
        <button onClick={() => run(onSkip)} disabled={busy} className="btn-ghost text-xs px-3 py-1.5">
          Just mark cooked
        </button>
      </div>
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
    <div className="bg-card border border-amber/20 rounded-xl p-4 animate-fade-in">
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

// Centered overlay wrapper so inline prompts read well even from a narrow day column.
function CenteredOverlay({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm p-6"
      onClick={onClose}
    >
      <div className="w-full max-w-sm" onClick={e => e.stopPropagation()}>
        {children}
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
  const [dayOpenFor, setDayOpenFor] = useState<string | null>(null)
  const [movingRecipe, setMovingRecipe] = useState<string | null>(null)
  const [ratingPromptFor, setRatingPromptFor] = useState<string | null>(null)
  const [servingsPromptFor, setServingsPromptFor] = useState<string | null>(null)
  const [metas, setMetas] = useState<Record<string, RecipeMeta>>({})
  const [showRebuildConfirm, setShowRebuildConfirm] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  const [rebuildDone, setRebuildDone] = useState(false)
  const [friendPlans, setFriendPlans] = useState<SharedPlanEntry[]>([])
  const [addedFriendRecipe, setAddedFriendRecipe] = useState<string | null>(null)
  const [addedToGrocery, setAddedToGrocery] = useState<string | null>(null)
  const [bulkAddingGrocery, setBulkAddingGrocery] = useState(false)
  const [bulkAddResult, setBulkAddResult] = useState<string | null>(null)
  const [confirmRemoveFor, setConfirmRemoveFor] = useState<string | null>(null)
  // Desktop drag-and-drop (Batch 5.1): additive to the tap day-picker. Native HTML5
  // drag — desktop-only (the grid is `hidden lg:grid`); touch/mobile keep the picker.
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  const defaultCheckedRef = useRef(false)

  // First-mount: restore last-viewed week from sessionStorage OR auto-default to next week if current is empty
  useEffect(() => {
    if (!user || defaultCheckedRef.current) return
    defaultCheckedRef.current = true

    let remembered: string | null = null
    try {
      remembered = sessionStorage.getItem('mea_plan_last_week')
    } catch {}

    if (remembered) {
      setWeekID(remembered)
      return
    }

    let cancelled = false
    const decide = async () => {
      const currentWeekID = weekIDFromDate(new Date())
      const nextDate = new Date()
      nextDate.setDate(nextDate.getDate() + 7)
      const nextWeekID = weekIDFromDate(nextDate)
      try {
        const [cur, nxt] = await Promise.all([
          getWeekPlan(user.uid, currentWeekID),
          getWeekPlan(user.uid, nextWeekID),
        ])
        if (cancelled) return
        const curHas = (cur?.plannedRecipeIDs || []).length > 0
        const nxtHas = (nxt?.plannedRecipeIDs || []).length > 0
        if (!curHas && nxtHas) {
          setWeekID(nextWeekID)
        }
      } catch (err) {
        console.error('Default week check failed:', err)
      }
    }
    decide()
    return () => { cancelled = true }
  }, [user])

  // Persist active week to sessionStorage
  useEffect(() => {
    if (!weekID) return
    try {
      sessionStorage.setItem('mea_plan_last_week', weekID)
    } catch {}
  }, [weekID])

  // Auto-clear remove confirm after 3 seconds
  useEffect(() => {
    if (!confirmRemoveFor) return
    const timer = setTimeout(() => setConfirmRemoveFor(null), 3000)
    return () => clearTimeout(timer)
  }, [confirmRemoveFor])

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
    const ids = plannedRecipeIDList(plan.plannedRecipeIDs)
    ids.forEach(id => {
      if (metas[id] !== undefined) return
      getRecipeMeta(user.uid, id).then(m => {
        setMetas(prev => ({ ...prev, [id]: m || {} }))
      })
    })
  }, [user, plan])

  // Publish shared plan whenever local plan changes (mirror stays a flat ID list —
  // friends never see the owner's private day/role assignments)
  useEffect(() => {
    if (!user || !plan) return
    const displayName = user.displayName || user.email || 'Anonymous'
    const photoURL = user.photoURL || ''
    publishSharedPlan(user.uid, displayName, photoURL, weekID, plan.plannedRecipeIDs || [])
  }, [user, plan, weekID])

  // Subscribe to friends' shared plans
  useEffect(() => {
    if (!user) return
    const unsub = subscribeSharedWeekPlans(weekID, user.uid, setFriendPlans)
    return unsub
  }, [user, weekID])

  const handleAddFriendRecipe = async (recipeID: string) => {
    if (!user) return
    await addRecipeToWeekPlan(user.uid, weekID, recipeID, resolveRecipeRole(recipes[recipeID]))
    setAddedFriendRecipe(recipeID)
    setTimeout(() => setAddedFriendRecipe(null), 1500)
  }

  // ─── Derived plan state (day + role aware) ────────────────────────────────
  const weekDates = getWeekDates(weekID)
  const weekDateSet = new Set(weekDates)
  // Read-time adapter: legacy string entries normalize to Unscheduled + a role
  // derived from the recipe's category; object entries keep their stored day/role.
  const plannedEntries = normalizePlanned(plan?.plannedRecipeIDs, id => recipes[id]?.category)
  const cookedSet = new Set(plan?.cookedRecipeIDs || [])
  const plannedIDList = plannedRecipeIDList(plan?.plannedRecipeIDs)
  const uncookedEntries = plannedEntries.filter(e => !cookedSet.has(e.recipeID))
  const cooked = plannedIDList.filter(id => cookedSet.has(id))

  // Mains before sides within a day for readability.
  const sortByRole = (a: PlannedEntry, b: PlannedEntry) =>
    (a.role === 'main' ? 0 : 1) - (b.role === 'main' ? 0 : 1)
  const dayBuckets = weekDates.map(date => ({
    date,
    entries: uncookedEntries.filter(e => e.day === date).sort(sortByRole),
  }))
  // Anything without a day (or a stale day outside this week) → Unscheduled.
  const unscheduledEntries = uncookedEntries
    .filter(e => !e.day || !weekDateSet.has(e.day))
    .sort(sortByRole)

  // Surrounding weeks for move dropdown (2 before, 2 after)
  const surroundingWeeks = [-2, -1, 1, 2].map(delta => ({
    weekID: addWeeks(weekID, delta),
    label: formatWeekLabel(addWeeks(weekID, delta)),
  }))

  const maybePromptRating = (recipeID: string) => {
    if (!metas[recipeID]?.rating) setRatingPromptFor(recipeID)
  }

  const handleMarkCooked = async (recipeID: string, isCooked: boolean) => {
    if (!user) return
    if (!isCooked) {
      // un-tick keeps its original behavior: plan-only, never touches the log
      await markRecipeCooked(user.uid, weekID, recipeID, false)
      return
    }
    // Tick: if a cook-event was already logged today (e.g. via Cooking Mode),
    // only update the plan — never create a duplicate log entry.
    const existing = await getTodayCookEventForRecipe(user.uid, recipeID)
    if (existing) {
      await markRecipeCooked(user.uid, weekID, recipeID, true)
      maybePromptRating(recipeID)
      return
    }
    // Otherwise capture servings eaten first; the write happens on confirm.
    setServingsPromptFor(recipeID)
  }

  const handleServingsConfirm = async (recipeID: string, servingsEaten: number) => {
    if (!user) return
    // Shared cooked-capture pathway (same as Cooking Mode): plan + one log entry.
    await logCookEvent(user.uid, {
      recipeId: recipeID,
      recipeName: recipes[recipeID]?.title || recipeID,
      // Override-aware: log the per-serving macros this user actually sees.
      perServing: perServingForViewer(recipes[recipeID]?.nutrition, metas[recipeID]?.overrides?.servings),
      servingsEaten,
      weekID,
    })
    setServingsPromptFor(null)
    maybePromptRating(recipeID)
  }

  const handleServingsSkip = async (recipeID: string) => {
    if (!user) return
    await markRecipeCooked(user.uid, weekID, recipeID, true)
    setServingsPromptFor(null)
    maybePromptRating(recipeID)
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

  const handleMoveToWeek = async (recipeID: string, targetWeekID: string, role: PlannedRole) => {
    if (!user) return
    setMovingRecipe(recipeID)
    await moveRecipeToWeek(user.uid, weekID, targetWeekID, recipeID, role)
    setMoveOpenFor(null)
    setMovingRecipe(null)
  }

  // Assign (or clear) a planned entry's day. Passes the entry's current role so a
  // legacy-string upgrade keeps the role the user is looking at.
  const handleAssignDay = async (entry: PlannedEntry, day: string | null) => {
    if (!user) return
    setDayOpenFor(null)
    await assignRecipeToDay(user.uid, weekID, entry.recipeID, day, entry.role)
  }

  // Manual main/side override (persists on the entry; re-derivation won't clobber it).
  const handleToggleRole = async (entry: PlannedEntry) => {
    if (!user) return
    await setPlannedRecipeRole(user.uid, weekID, entry.recipeID, entry.role === 'main' ? 'side' : 'main')
  }

  // Drop a dragged tile onto a day (or null = Unscheduled) — same write path as the
  // tap day-picker, so drag and tap stay one system. Carries the entry's role over.
  const handleDropOnDay = async (day: string | null) => {
    const id = draggingId
    setDragOverKey(null)
    setDraggingId(null)
    if (!user || !id) return
    const role = plannedEntries.find(e => e.recipeID === id)?.role ?? 'main'
    await assignRecipeToDay(user.uid, weekID, id, day, role)
  }

  const handleAddToGrocery = async (recipeID: string) => {
    if (!user) return
    const recipe = recipes[recipeID]
    if (!recipe) {
      console.warn('Recipe not found for ID:', recipeID)
      return
    }
    setAddingToGrocery(recipeID)
    try {
      const effectiveContent = metas[recipeID]?.overrides?.content || recipe.content
      const { ingredients } = parseRecipeContent(effectiveContent)
      if (!ingredients.length) {
        console.warn('No ingredients parsed for recipe:', recipe.title)
      }
      await addRecipeIngredientsToGrocery(user.uid, recipeID, ingredients)
      setAddedToGrocery(recipeID)
      setTimeout(() => setAddedToGrocery(null), 2000)
    } catch (e) {
      console.error('Failed to add ingredients to grocery:', e)
    } finally {
      setAddingToGrocery(null)
    }
  }

  const handleRebuildGrocery = async () => {
    if (!user || !plan) return
    setRebuilding(true)
    setShowRebuildConfirm(false)
    // rebuild pulls ALL planned recipes regardless of day/role.
    await rebuildGroceryFromPlan(user.uid, plan.plannedRecipeIDs || [], getRecipeById, parseRecipeContent, metas)
    setRebuilding(false)
    setRebuildDone(true)
    setTimeout(() => setRebuildDone(false), 2000)
  }

  const handleBulkAddToGrocery = async () => {
    if (!user) return
    setBulkAddingGrocery(true)
    setBulkAddResult(null)
    try {
      const grocerySnap = await getDocs(collection(db, 'users', user.uid, 'pantry', 'root', 'groceryItems'))
      const alreadyAdded = new Set<string>()
      grocerySnap.docs.forEach(d => {
        const data = d.data()
        if (data.sourceRecipeIDs && Array.isArray(data.sourceRecipeIDs)) {
          data.sourceRecipeIDs.forEach((rid: string) => alreadyAdded.add(rid))
        }
      })
      let addedCount = 0
      for (const entry of uncookedEntries) {
        if (alreadyAdded.has(entry.recipeID)) continue
        const recipe = recipes[entry.recipeID]
        if (!recipe) continue
        const effectiveContent = metas[entry.recipeID]?.overrides?.content || recipe.content
        const { ingredients } = parseRecipeContent(effectiveContent)
        await addRecipeIngredientsToGrocery(user.uid, entry.recipeID, ingredients)
        addedCount++
      }
      setBulkAddResult(addedCount > 0 ? `Done! ${addedCount} added` : 'Already up to date')
      setTimeout(() => setBulkAddResult(null), 2000)
    } catch (e) {
      console.error('Bulk add to grocery error:', e)
      setBulkAddResult(null)
    } finally {
      setBulkAddingGrocery(false)
    }
  }

  // ─── A single planned recipe card (reused: day grid, mobile stack, Unscheduled) ──
  const renderPlannedCard = (entry: PlannedEntry) => {
    const id = entry.recipeID
    const recipe = recipes[id]
    if (!recipe) return null
    // Task 3 — subtle left-edge color accent (inset shadow respects rounded corners):
    // amber (#E8A838) = main, muted (#A89880) = side. Theme tokens, paired with the
    // existing Main/Side text label below, so color is never the sole signal.
    const roleAccent = entry.role === 'main'
      ? 'shadow-[inset_3px_0_0_0_#E8A838]'
      : 'shadow-[inset_3px_0_0_0_#A89880]'
    return (
      <div
        key={id}
        draggable
        onDragStart={e => {
          setDraggingId(id)
          e.dataTransfer.effectAllowed = 'move'
          try { e.dataTransfer.setData('text/plain', id) } catch {}
        }}
        onDragEnd={() => { setDraggingId(null); setDragOverKey(null) }}
        className={`bg-surface border border-border rounded-xl p-2.5 cursor-grab active:cursor-grabbing transition-opacity ${roleAccent} ${draggingId === id ? 'opacity-50' : ''}`}
      >
        <div className="flex items-start gap-2">
          <GripVertical size={12} className="hidden lg:block text-faint/30 shrink-0 mt-0.5" aria-hidden="true" />
          <RecipeImage
            src={metas[id]?.overrides?.imageURL || recipe.imageURL}
            alt=""
            category={recipe.category}
            className="w-10 h-10 rounded-lg shrink-0"
            emojiClassName="text-lg"
          />
          <div className="flex-1 min-w-0">
            <Link href={`/recipes/${id}`}>
              <p className="text-cream text-xs font-body font-medium truncate hover:text-amber transition-colors" title={recipe.title}>
                {recipe.title}
              </p>
            </Link>
            <div className="flex items-center gap-1.5 mt-1">
              <button
                onClick={() => handleToggleRole(entry)}
                className={`text-[10px] font-body px-1.5 py-0.5 rounded-md border transition-colors ${
                  entry.role === 'main'
                    ? 'border-amber/30 text-amber bg-amber/10'
                    : 'border-border text-faint hover:text-cream'
                }`}
                title="Toggle main / side"
              >
                {entry.role === 'main' ? 'Main' : 'Side'}
              </button>
              <span className="text-faint text-[10px] font-body capitalize truncate">{recipe.cuisine}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 mt-2 flex-wrap">
          {/* Assign to day */}
          <div className="relative">
            <button
              onClick={() => { setDayOpenFor(dayOpenFor === id ? null : id); setMoveOpenFor(null) }}
              className="w-7 h-7 rounded-lg border border-border flex items-center justify-center text-faint hover:text-amber hover:border-amber/30 transition-all"
              title="Assign to a day"
            >
              <Calendar size={12} />
            </button>
            {dayOpenFor === id && (
              <div className="absolute right-0 top-8 z-20 bg-card border border-border rounded-xl shadow-lg py-1 w-44 max-w-[calc(100vw-2rem)] animate-fade-in">
                <p className="text-faint text-[10px] font-body uppercase tracking-widest px-3 py-1.5">Assign to day</p>
                {weekDates.map(date => {
                  const d = new Date(date + 'T12:00:00')
                  return (
                    <button
                      key={date}
                      onClick={() => handleAssignDay(entry, date)}
                      className={`w-full text-left px-3 py-2 text-sm font-body transition-colors ${
                        entry.day === date ? 'text-amber' : 'text-muted hover:text-cream hover:bg-surface'
                      }`}
                    >
                      {d.toLocaleDateString('en-US', { weekday: 'long' })}
                      <span className="text-faint ml-1">{d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                    </button>
                  )
                })}
                <button
                  onClick={() => handleAssignDay(entry, null)}
                  className={`w-full text-left px-3 py-2 text-sm font-body border-t border-border/50 transition-colors ${
                    !entry.day || !weekDateSet.has(entry.day) ? 'text-amber' : 'text-muted hover:text-cream hover:bg-surface'
                  }`}
                >
                  Unscheduled
                </button>
              </div>
            )}
          </div>
          {/* Move to another week */}
          <div className="relative">
            <button
              onClick={() => { setMoveOpenFor(moveOpenFor === id ? null : id); setDayOpenFor(null) }}
              className="w-7 h-7 rounded-lg border border-border flex items-center justify-center text-faint hover:text-amber hover:border-amber/30 transition-all"
              title="Move to another week"
            >
              {movingRecipe === id ? <Loader2 size={12} className="animate-spin" /> : <ArrowRightLeft size={12} />}
            </button>
            {moveOpenFor === id && (
              <div className="absolute right-0 top-8 z-20 bg-card border border-border rounded-xl shadow-lg py-1 w-48 max-w-[calc(100vw-2rem)] animate-fade-in">
                <p className="text-faint text-[10px] font-body uppercase tracking-widest px-3 py-1.5">Move to week</p>
                {surroundingWeeks.map(w => (
                  <button
                    key={w.weekID}
                    onClick={() => handleMoveToWeek(id, w.weekID, entry.role)}
                    className="w-full text-left px-3 py-2 text-sm font-body text-muted hover:text-cream hover:bg-surface transition-colors"
                  >
                    {w.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Add ingredients to grocery */}
          <button
            onClick={() => handleAddToGrocery(id)}
            disabled={addingToGrocery === id || addedToGrocery === id}
            className={`w-7 h-7 rounded-lg border flex items-center justify-center transition-all ${
              addedToGrocery === id
                ? 'border-green-400/30 text-green-400 bg-green-400/10'
                : 'border-border text-faint hover:text-amber hover:border-amber/30'
            }`}
            title="Add ingredients to grocery list"
          >
            {addingToGrocery === id
              ? <Loader2 size={12} className="animate-spin" />
              : addedToGrocery === id
              ? <Check size={12} />
              : <ShoppingCart size={12} />}
          </button>
          {/* Mark cooked */}
          <button
            onClick={() => handleMarkCooked(id, true)}
            className="w-7 h-7 rounded-lg border border-border flex items-center justify-center text-faint hover:text-green-400 hover:border-green-400/30 transition-all"
            title="Mark as cooked"
          >
            <Check size={12} />
          </button>
          {/* Remove */}
          <button
            onClick={() => setConfirmRemoveFor(id)}
            className="w-7 h-7 rounded-lg border border-border flex items-center justify-center text-faint hover:text-red-400 hover:border-red-400/30 transition-all"
            title="Remove from plan"
          >
            <X size={12} />
          </button>
        </div>
      </div>
    )
  }

  const emptyDayAffordance = (
    <Link
      href="/recipes"
      className="flex items-center justify-center border border-dashed border-border rounded-xl py-5 text-faint/40 hover:text-amber hover:border-amber/30 transition-all"
      title="Browse recipes to add"
    >
      <Plus size={16} />
    </Link>
  )

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
    <div className="max-w-6xl mx-auto p-6">
      {/* Remove from plan confirmation modal */}
      {confirmRemoveFor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm p-6"
          onClick={() => setConfirmRemoveFor(null)}
        >
          <div
            className="bg-surface border border-border rounded-2xl p-6 max-w-sm w-full animate-fade-in"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="font-display text-2xl text-cream font-light mb-2">Remove from plan?</h3>
            <p className="text-faint text-sm font-body mb-5">
              This will remove &quot;{recipes[confirmRemoveFor]?.title || 'this recipe'}&quot; from your week plan.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmRemoveFor(null)} className="btn-ghost text-sm">Cancel</button>
              <button
                onClick={() => { handleRemove(confirmRemoveFor); setConfirmRemoveFor(null) }}
                className="btn-primary text-sm bg-red-500 hover:bg-red-600"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cooked-servings prompt (centered overlay so it reads well from any column) */}
      {servingsPromptFor && recipes[servingsPromptFor] && (
        <CenteredOverlay onClose={() => setServingsPromptFor(null)}>
          <CookServingsModal
            recipeName={recipes[servingsPromptFor].title}
            onConfirm={s => handleServingsConfirm(servingsPromptFor, s)}
            onSkip={() => handleServingsSkip(servingsPromptFor)}
          />
        </CenteredOverlay>
      )}

      {/* Post-cook rating prompt */}
      {ratingPromptFor && recipes[ratingPromptFor] && (
        <CenteredOverlay onClose={handleRatingSkip}>
          <CookRatingModal
            recipeName={recipes[ratingPromptFor].title}
            onSave={(r, n) => handleRatingSave(ratingPromptFor, r, n)}
            onSkip={handleRatingSkip}
          />
        </CenteredOverlay>
      )}

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
      {plannedIDList.length > 0 && (
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
          {/* Planned section — day view */}
          <section className="mb-10">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-xl text-cream font-light">
                Planned
                {uncookedEntries.length > 0 && (
                  <span className="ml-2 text-faint text-sm font-body">{uncookedEntries.length}</span>
                )}
              </h2>
              {uncookedEntries.length > 0 && (
                <button
                  onClick={handleBulkAddToGrocery}
                  disabled={bulkAddingGrocery}
                  className="btn-ghost flex items-center gap-1.5 text-xs"
                >
                  {bulkAddingGrocery ? <Loader2 size={13} className="animate-spin" /> : <ShoppingCart size={13} />}
                  {bulkAddResult || (bulkAddingGrocery ? 'Adding...' : 'Add all to grocery')}
                </button>
              )}
            </div>

            {uncookedEntries.length === 0 ? (
              <div className="bg-surface border border-border rounded-2xl p-6 text-center">
                <p className="text-faint text-sm font-body mb-3">No recipes planned this week</p>
                <Link href="/recipes" className="btn-ghost text-xs">Browse recipes →</Link>
              </div>
            ) : (
              <>
                {/* DESKTOP: 7-column week grid */}
                <div className="hidden lg:grid grid-cols-7 gap-2">
                  {dayBuckets.map(({ date, entries }) => {
                    const d = new Date(date + 'T12:00:00')
                    return (
                      <div
                        key={date}
                        onDragOver={e => { if (draggingId) { e.preventDefault(); setDragOverKey(date) } }}
                        onDragLeave={() => setDragOverKey(k => (k === date ? null : k))}
                        onDrop={e => { e.preventDefault(); handleDropOnDay(date) }}
                        className={`min-w-0 rounded-xl p-1 -m-1 transition-colors ${dragOverKey === date ? 'bg-amber/5 ring-1 ring-amber/40' : ''}`}
                      >
                        <div className="text-center mb-2">
                          <p className="text-faint text-[10px] font-body uppercase tracking-wider">
                            {d.toLocaleDateString('en-US', { weekday: 'short' })}
                          </p>
                          <p className="text-muted text-sm font-body">{d.getDate()}</p>
                        </div>
                        <div className="space-y-2">
                          {entries.length > 0
                            ? entries.map(renderPlannedCard)
                            : emptyDayAffordance}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* MOBILE: stacked day sections */}
                <div className="lg:hidden space-y-5">
                  {dayBuckets.map(({ date, entries }) => {
                    const d = new Date(date + 'T12:00:00')
                    return (
                      <div key={date}>
                        <div className="flex items-baseline gap-2 mb-2">
                          <span className="text-cream text-sm font-body font-medium">
                            {d.toLocaleDateString('en-US', { weekday: 'long' })}
                          </span>
                          <span className="text-faint text-xs font-body">
                            {d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </span>
                          {entries.length > 0 && (
                            <span className="text-faint text-xs font-body ml-auto">{entries.length}</span>
                          )}
                        </div>
                        <div className="space-y-2">
                          {entries.length > 0
                            ? entries.map(renderPlannedCard)
                            : emptyDayAffordance}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Unscheduled (shared by both layouts) + drop target. Shown when it
                    has items, or — empty — while a drag is in progress so a scheduled
                    tile can be dragged back to Unscheduled (desktop). */}
                {(unscheduledEntries.length > 0 || draggingId) && (
                  <div
                    onDragOver={e => { if (draggingId) { e.preventDefault(); setDragOverKey('unscheduled') } }}
                    onDragLeave={() => setDragOverKey(k => (k === 'unscheduled' ? null : k))}
                    onDrop={e => { e.preventDefault(); handleDropOnDay(null) }}
                    className={`mt-8 rounded-xl p-2 -m-2 transition-colors ${dragOverKey === 'unscheduled' ? 'bg-amber/5 ring-1 ring-amber/40' : ''}`}
                  >
                    <div className="flex items-baseline gap-2 mb-3">
                      <h3 className="text-cream text-sm font-body font-medium uppercase tracking-wider">Unscheduled</h3>
                      {unscheduledEntries.length > 0 && (
                        <span className="text-faint text-xs font-body">{unscheduledEntries.length}</span>
                      )}
                    </div>
                    {unscheduledEntries.length > 0 ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                        {unscheduledEntries.map(renderPlannedCard)}
                      </div>
                    ) : (
                      <div className="border border-dashed border-border rounded-xl py-6 text-center text-faint/40 text-xs font-body">
                        Drop here to unschedule
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </section>

          <div className="max-w-3xl mx-auto">
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
                      <div
                        key={id}
                        className="bg-surface border border-border rounded-xl p-3 flex items-center gap-3 opacity-60"
                      >
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
                    )
                  })}
                </div>
              </section>
            )}

            {/* Friends' plans section */}
            {friendPlans.filter(fp => fp.plannedRecipeIDs.length > 0).length > 0 && (
              <section className="mt-10">
                <h2 className="font-display text-xl text-cream font-light mb-4">
                  Everyone&apos;s plan this week
                </h2>
                <div className="space-y-6">
                  {friendPlans
                    .filter(fp => fp.plannedRecipeIDs.length > 0)
                    .map(fp => (
                      <div key={fp.uid}>
                        {/* Friend header */}
                        <div className="flex items-center gap-2 mb-3">
                          {fp.photoURL ? (
                            <img
                              src={fp.photoURL}
                              alt=""
                              className="w-7 h-7 rounded-full object-cover"
                              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                            />
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-amber/20 flex items-center justify-center">
                              <span className="text-amber text-xs font-body font-bold">
                                {(fp.displayName || '?')[0].toUpperCase()}
                              </span>
                            </div>
                          )}
                          <span className="text-cream text-sm font-body font-medium">
                            {fp.displayName}
                          </span>
                        </div>
                        {/* Friend's recipes */}
                        <div className="space-y-2">
                          {fp.plannedRecipeIDs.map(rid => {
                            const recipe = recipes[rid]
                            if (!recipe) return null
                            return (
                              <div
                                key={rid}
                                className="bg-surface border border-border rounded-xl p-3 flex items-center gap-3"
                              >
                                <RecipeImage
                                  src={metas[rid]?.overrides?.imageURL || recipe.imageURL}
                                  alt=""
                                  category={recipe.category}
                                  className="w-10 h-10 rounded-lg shrink-0"
                                  emojiClassName="text-lg"
                                />
                                <div className="flex-1 min-w-0">
                                  <p className="text-cream text-sm font-body font-medium truncate">
                                    {recipe.title}
                                  </p>
                                  <p className="text-faint text-xs font-body capitalize">{recipe.cuisine}</p>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <Link
                                    href={`/recipes/${rid}`}
                                    className="px-2.5 py-1 rounded-lg border border-border text-faint text-xs font-body hover:text-amber hover:border-amber/30 transition-all"
                                  >
                                    View
                                  </Link>
                                  <button
                                    onClick={() => handleAddFriendRecipe(rid)}
                                    className="px-2.5 py-1 rounded-lg border border-border text-faint text-xs font-body hover:text-amber hover:border-amber/30 transition-all"
                                  >
                                    {addedFriendRecipe === rid ? 'Added!' : 'Add to my plan'}
                                  </button>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                </div>
              </section>
            )}
          </div>
        </>
      )}
    </div>
  )
}
