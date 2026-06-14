'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, Heart, ExternalLink, ChefHat,
  BookOpen, Calendar, Loader2, Pencil, Trash2, Clock, Sparkles, Send
} from 'lucide-react'
import { getRecipeById, parseRecipeContent, deleteRecipe, getTotalTime, detectIngredientHeader } from '@/lib/recipes'
import { getRecipeMeta, saveRecipeMeta, setServingsOverride, addRecipeToWeekPlan, weekIDFromDate } from '@/lib/userdata'
import { logCookEvent } from '@/lib/consumptionLog'
import { perServingForViewer } from '@/lib/nutrition'
import { useFavorites } from '@/hooks/useFavorites'
import { useAuth } from '@/lib/AuthContext'
import RecipeEditModal from '@/components/RecipeEditModal'
import CookingMode from '@/components/CookingMode'
import StarRating from '@/components/StarRating'
import NutritionSection from '@/components/NutritionSection'
import RecipeImage from '@/components/RecipeImage'
import type { Recipe, RecipeNutrition } from '@/types/recipe'
import type { RecipeMeta } from '@/lib/userdata'

function formatWeekLabel(weekID: string): string {
  const start = new Date(weekID + 'T12:00:00')
  const end = new Date(weekID + 'T12:00:00')
  end.setDate(end.getDate() + 6)
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${fmt(start)} – ${fmt(end)}`
}

function getWeekOptions(): { weekID: string; label: string }[] {
  const now = new Date()
  return [0, 1, 2, 3, 4].map(offset => {
    const d = new Date(now)
    d.setDate(d.getDate() + offset * 7)
    const wid = weekIDFromDate(d)
    return { weekID: wid, label: formatWeekLabel(wid) }
  })
}

export default function RecipeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { user } = useAuth()
  const { isFavorite, toggle } = useFavorites()

  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [meta, setMeta] = useState<RecipeMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [note, setNote] = useState('')
  const [rating, setRating] = useState(0)
  const [savingNote, setSavingNote] = useState(false)
  const [showPlanPicker, setShowPlanPicker] = useState(false)
  const [selectedWeek, setSelectedWeek] = useState('')
  const [addingToPlan, setAddingToPlan] = useState(false)
  const [planAddedLabel, setPlanAddedLabel] = useState('')
  const [showEdit, setShowEdit] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [showUnsavedBanner, setShowUnsavedBanner] = useState(false)
  const [showCookingMode, setShowCookingMode] = useState(false)
  const [assistantMessages, setAssistantMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([])
  const [assistantInput, setAssistantInput] = useState('')
  const [assistantLoading, setAssistantLoading] = useState(false)
  const [assistantError, setAssistantError] = useState('')

  useEffect(() => {
    if (!id) return
    getRecipeById(id).then(r => { setRecipe(r); setLoading(false) })
  }, [id])

  useEffect(() => {
    if (!user || !id) return
    getRecipeMeta(user.uid, id).then(m => {
      if (m) { setMeta(m); setNote(m.note || ''); setRating(m.rating || 0) }
    })
  }, [user, id])

  // Warn on tab close if notes are unsaved
  const notesDirty = note !== (meta?.note || '') || rating !== (meta?.rating || 0)
  useEffect(() => {
    if (!notesDirty) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [notesDirty])

  const handleBack = () => {
    if (notesDirty) { setShowUnsavedBanner(true); return }
    router.back()
  }

  const displayRecipe = recipe ? {
    ...recipe,
    title: meta?.overrides?.title || recipe.title,
    cuisine: meta?.overrides?.cuisine || recipe.cuisine,
    category: meta?.overrides?.category || recipe.category,
    content: meta?.overrides?.content || recipe.content,
    imageURL: meta?.overrides?.imageURL || recipe.imageURL,
    prepTime: meta?.overrides?.prepTime || (recipe as any).prepTime || '',
    cookTime: meta?.overrides?.cookTime || (recipe as any).cookTime || '',
  } : null

  const handleSaveNote = async () => {
    if (!user || !id) return
    setSavingNote(true)
    setSaveError('')
    setSaveSuccess(false)
    try {
      await saveRecipeMeta(user.uid, id, { note, rating })
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2000)
    } catch (e: any) {
      setSaveError(e?.message || 'Failed to save notes')
    } finally {
      setSavingNote(false)
    }
  }

  // Per-user servings override (Batch 3): writes THIS user's meta.overrides.servings,
  // never the shared recipe doc. Optimistically reflected so the per-serving macros
  // (and any cooked-capture below) recompute live from the shared nutrition.total.
  const handleSetServings = async (servings: number | null) => {
    if (!user || !id) return
    setMeta(prev => {
      const overrides = { ...(prev?.overrides || {}) }
      if (servings == null) delete overrides.servings
      else overrides.servings = servings
      return { ...(prev || {}), overrides: Object.keys(overrides).length ? overrides : undefined }
    })
    try {
      await setServingsOverride(user.uid, id, servings)
    } catch {
      /* best-effort — the live view already reflects the user's intent */
    }
  }

  const handleOpenPlanPicker = () => {
    const weeks = getWeekOptions()
    setSelectedWeek(weeks[1]?.weekID || weeks[0].weekID) // default to next week
    setShowPlanPicker(true)
    setPlanAddedLabel('')
  }

  const handleConfirmAddToPlan = async () => {
    if (!user || !recipe || !selectedWeek) return
    setAddingToPlan(true)
    await addRecipeToWeekPlan(user.uid, selectedWeek, recipe.id)
    setAddingToPlan(false)
    setPlanAddedLabel(formatWeekLabel(selectedWeek))
    setTimeout(() => { setShowPlanPicker(false); setPlanAddedLabel('') }, 2000)
  }

  const handleDelete = async () => {
    if (!user || !recipe) return
    setDeleting(true)
    setDeleteError('')
    try {
      await deleteRecipe(recipe.id)
      router.push('/recipes')
    } catch (e: any) {
      setDeleteError(e?.message || 'Failed to delete recipe')
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6 animate-fade-in">
        {/* Back placeholder */}
        <div className="h-4 w-16 skeleton rounded mb-6" />
        {/* Hero image */}
        <div className="aspect-video rounded-2xl skeleton mb-6" />
        {/* Title */}
        <div className="h-10 skeleton rounded-lg w-2/3 mb-4" />
        {/* Tags */}
        <div className="flex gap-2 mb-8">
          <div className="h-6 w-20 skeleton rounded-lg" />
          <div className="h-6 w-24 skeleton rounded-lg" />
          <div className="h-6 w-16 skeleton rounded-lg" />
        </div>
        {/* Ingredient lines */}
        <div className="h-6 w-40 skeleton rounded mb-4" />
        <div className="space-y-3">
          {[90, 75, 82, 68, 78].map((w, i) => (
            <div key={i} className="h-4 skeleton rounded" style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>
    )
  }

  if (!displayRecipe) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="font-display text-3xl text-faint">Recipe not found</p>
        <button onClick={() => router.back()} className="btn-ghost">Go back</button>
      </div>
    )
  }

  const { ingredients, instructions, description } = parseRecipeContent(displayRecipe.content)
  const fav = isFavorite(displayRecipe.id)
  // "edited" badge reflects content edits only — a personal servings override has
  // its own "Your serving size" UI and shouldn't read as the recipe being edited.
  const hasOverrides = !!meta?.overrides &&
    Object.keys(meta.overrides).some(k => k !== 'servings')
  const canDelete = !!user

  const sendAssistantMessage = async (content: string) => {
    const trimmed = content.trim()
    if (!trimmed || assistantLoading) return
    if (!user) {
      setAssistantError("Couldn't get a response, please try again.")
      return
    }
    const nextMessages = [...assistantMessages, { role: 'user' as const, content: trimmed }]
    setAssistantMessages(nextMessages)
    setAssistantInput('')
    setAssistantLoading(true)
    setAssistantError('')
    try {
      const token = await user.getIdToken()
      const res = await fetch('/api/recipe-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          recipe: {
            title: displayRecipe.title,
            ingredients,
            instructions,
            cuisine: displayRecipe.cuisine,
            category: displayRecipe.category,
          },
          messages: nextMessages,
        }),
      })
      if (!res.ok) throw new Error('Request failed')
      const data = await res.json()
      setAssistantMessages([...nextMessages, { role: 'assistant' as const, content: data.reply || '' }])
    } catch {
      setAssistantError("Couldn't get a response, please try again.")
    } finally {
      setAssistantLoading(false)
    }
  }

  const assistantChips = [
    "I'm missing an ingredient",
    'Make it healthier',
    'Make it vegetarian',
    'Scale the servings',
  ]

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      {showUnsavedBanner && (
        <div className="bg-amber/10 border border-amber/20 rounded-xl p-3 mb-4 flex items-center justify-between gap-3 animate-fade-in">
          <p className="text-amber text-xs font-body">You have unsaved notes. Save before leaving?</p>
          <div className="flex gap-2 shrink-0">
            <button onClick={async () => { await handleSaveNote(); router.back() }} className="text-xs font-body text-amber font-semibold">Save now</button>
            <button onClick={() => { setShowUnsavedBanner(false); router.back() }} className="text-xs font-body text-faint hover:text-cream">Leave anyway</button>
          </div>
        </div>
      )}
      <button onClick={handleBack}
        className="flex items-center gap-2 text-faint hover:text-cream transition-colors mb-6 text-sm font-body"
      >
        <ArrowLeft size={16} /> Back
      </button>

      {displayRecipe.imageURL && (
        <div className="rounded-2xl overflow-hidden aspect-video mb-6 bg-card">
          <RecipeImage
            src={displayRecipe.imageURL}
            alt={displayRecipe.title}
            category={displayRecipe.category}
            className="w-full h-full"
            emojiClassName="text-6xl"
            loading="eager"
          />
        </div>
      )}

      <div className="flex items-start justify-between gap-3 mb-4">
        <h1 className="font-display text-3xl md:text-5xl text-cream font-light leading-tight min-w-0 flex-1">
          {displayRecipe.title}
        </h1>
        <div className="flex items-center gap-2 shrink-0">
          {user && (
            <button onClick={() => setShowEdit(true)}
              aria-label="Edit recipe"
              className="w-10 h-10 rounded-full flex items-center justify-center bg-card border border-border text-faint hover:text-cream hover:border-amber/30 transition-all"
            >
              <Pencil size={14} />
            </button>
          )}
          {canDelete && !confirmDelete && (
            <button onClick={() => setConfirmDelete(true)}
              aria-label="Delete recipe"
              className="w-10 h-10 rounded-full flex items-center justify-center bg-card border border-border text-faint hover:text-red-400 hover:border-red-400/30 transition-all"
            >
              <Trash2 size={14} />
            </button>
          )}
          {confirmDelete && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
              <span className="text-red-400 text-xs font-body">Delete?</span>
              <button onClick={handleDelete} disabled={deleting}
                className="text-red-400 text-xs font-body font-semibold hover:text-red-300"
              >
                {deleting ? <Loader2 size={12} className="animate-spin" /> : 'Yes'}
              </button>
              <button onClick={() => setConfirmDelete(false)} className="text-faint text-xs font-body hover:text-cream">No</button>
              {deleteError && <span className="text-red-400 text-xs font-body">{deleteError}</span>}
            </div>
          )}
          <button onClick={() => toggle(displayRecipe.id)}
            aria-label={fav ? 'Remove from favorites' : 'Add to favorites'}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
              fav ? 'bg-amber text-ink' : 'bg-card border border-border text-faint hover:text-cream'
            }`}
          >
            <Heart size={16} fill={fav ? 'currentColor' : 'none'} />
          </button>
        </div>
      </div>

      {/* Tags */}
      <div className="flex flex-wrap gap-2 mb-3">
        {displayRecipe.category && <span className="tag">{displayRecipe.category}</span>}
        {displayRecipe.cuisine && <span className="tag-amber capitalize">{displayRecipe.cuisine}</span>}
        {displayRecipe.prepTime && (
          <span className="tag flex items-center gap-1"><Clock size={10} /> Prep {displayRecipe.prepTime}</span>
        )}
        {displayRecipe.cookTime && (
          <span className="tag flex items-center gap-1"><Clock size={10} /> Cook {displayRecipe.cookTime}</span>
        )}
        {(() => {
          const total = getTotalTime(displayRecipe.prepTime, displayRecipe.cookTime)
          return total.minutes > 0 ? (
            <span className="tag-amber flex items-center gap-1"><Clock size={10} /> Total {total.display}</span>
          ) : null
        })()}
        {hasOverrides && <span className="text-xs px-2.5 py-1 rounded-lg bg-amber/5 border border-amber/10 text-amber/60 font-body">edited</span>}
        {meta?.rating ? <StarRating value={meta.rating} /> : null}
      </div>

      {/* Action buttons */}
      <div className="flex gap-3 mb-8 relative">
        {user && (
          <div className="relative">
            <button onClick={handleOpenPlanPicker}
              className="btn-primary flex items-center gap-2"
            >
              <Calendar size={15} />
              Add to Plan
            </button>

            {showPlanPicker && (
              <div className="absolute left-0 top-12 z-20 bg-surface border border-border rounded-xl shadow-lg w-64 max-w-[calc(100vw-2rem)] animate-fade-in">
                {planAddedLabel ? (
                  <div className="p-4 text-center">
                    <p className="text-green-400 text-sm font-body font-medium">
                      Added to {planAddedLabel}!
                    </p>
                  </div>
                ) : (
                  <>
                    <p className="text-cream text-sm font-body font-medium px-4 pt-3 pb-2">Add to meal plan</p>
                    <div className="px-2 pb-2">
                      {getWeekOptions().map((w, i) => (
                        <button
                          key={w.weekID}
                          onClick={() => setSelectedWeek(w.weekID)}
                          className={`w-full text-left px-3 py-2 rounded-lg text-sm font-body transition-colors flex items-center gap-2 ${
                            selectedWeek === w.weekID
                              ? 'bg-amber/10 text-amber'
                              : 'text-faint hover:text-cream hover:bg-card'
                          }`}
                        >
                          <span className={`w-3 h-3 rounded-full border-2 shrink-0 ${
                            selectedWeek === w.weekID ? 'border-amber bg-amber' : 'border-faint/30'
                          }`} />
                          {w.label}
                          {i === 0 && <span className="text-faint/40 text-xs ml-auto">this week</span>}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2 px-4 pb-3">
                      <button onClick={() => setShowPlanPicker(false)} className="btn-ghost text-xs flex-1">Cancel</button>
                      <button
                        onClick={handleConfirmAddToPlan}
                        disabled={addingToPlan}
                        className="btn-primary text-xs flex-1 flex items-center justify-center gap-1.5"
                      >
                        {addingToPlan ? <Loader2 size={12} className="animate-spin" /> : null}
                        Add
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
        {(ingredients.length > 0 || instructions.length > 0) && (
          <button onClick={() => setShowCookingMode(true)} className="btn-primary flex items-center gap-2">
            <ChefHat size={15} /> Cooking Mode
          </button>
        )}
        {displayRecipe.sourceURL && (
          <a href={displayRecipe.sourceURL} target="_blank" rel="noopener noreferrer" className="btn-ghost flex items-center gap-2">
            <ExternalLink size={14} /> Source
          </a>
        )}
      </div>

      {description && (
        <p className="text-muted font-body text-sm leading-relaxed mb-8 border-l-2 border-amber/30 pl-4 italic">
          {description}
        </p>
      )}

      <NutritionSection
        nutrition={recipe?.nutrition}
        recipeId={recipe?.id}
        overrideServings={meta?.overrides?.servings}
        onSetOverrideServings={handleSetServings}
        onCalculated={(nutrition: RecipeNutrition) =>
          setRecipe(r => (r ? { ...r, nutrition, servings: nutrition.servings ?? r.servings } : r))
        }
      />

      {ingredients.length > 0 && (
        <section className="mb-8">
          <h2 className="font-display text-2xl text-cream font-light mb-4 flex items-center gap-2">
            <ChefHat size={20} className="text-amber" /> Ingredients
          </h2>
          <ul className="space-y-2">
            {ingredients.map((ing, i) => {
              const header = detectIngredientHeader(ing)
              if (header.isHeader) {
                return (
                  <li key={i} className="list-none -ml-5 pt-3 first:pt-0">
                    <h4 className="font-display text-lg text-cream font-medium tracking-wide">
                      {header.text}
                    </h4>
                  </li>
                )
              }
              return (
                <li key={i} className="flex items-start gap-3 text-sm font-body text-muted">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber mt-2 shrink-0" />
                  {ing}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {instructions.length > 0 && (
        <section className="mb-8">
          <h2 className="font-display text-2xl text-cream font-light mb-4 flex items-center gap-2">
            <BookOpen size={20} className="text-amber" /> Instructions
          </h2>
          <ol className="space-y-5">
            {instructions.map((step, i) => (
              <li key={i} className="flex gap-4">
                <span className="font-display text-2xl text-amber/60 font-light leading-none mt-0.5 w-6 shrink-0">{i + 1}</span>
                <p className="text-sm font-body text-muted leading-relaxed">{step}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      {ingredients.length === 0 && instructions.length === 0 && displayRecipe.content && (
        <section className="mb-8">
          <h2 className="font-display text-2xl text-cream font-light mb-4">Recipe</h2>
          <pre className="text-sm font-body text-muted whitespace-pre-wrap leading-relaxed bg-surface border border-border rounded-xl p-4 overflow-x-auto">
            {displayRecipe.content}
          </pre>
        </section>
      )}

      <section className="bg-surface border border-border rounded-2xl p-5 mb-8">
        <h2 className="font-display text-2xl text-cream font-light mb-1 flex items-center gap-2">
          <Sparkles size={20} className="text-amber" /> Recipe Assistant
        </h2>
        <p className="text-faint text-sm font-body mb-4">
          Missing an ingredient or want to switch it up? Ask for suggestions.
        </p>

        {/* Quick-action chips */}
        <div className="flex flex-wrap gap-2 mb-4">
          {assistantChips.map(chip => (
            <button
              key={chip}
              onClick={() => sendAssistantMessage(chip)}
              disabled={assistantLoading}
              className="text-xs font-body px-3 py-1.5 rounded-lg bg-amber/5 border border-amber/20 text-amber hover:bg-amber/10 transition-colors disabled:opacity-50"
            >
              {chip}
            </button>
          ))}
        </div>

        {/* Conversation thread */}
        {assistantMessages.length > 0 && (
          <div className="flex flex-col gap-3 mb-4">
            {assistantMessages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm font-body whitespace-pre-wrap leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-amber text-ink'
                      : 'bg-card border border-border text-muted'
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {assistantLoading && (
              <div className="flex justify-start">
                <div className="bg-card border border-border rounded-xl px-3.5 py-2.5">
                  <Loader2 size={16} className="animate-spin text-amber" />
                </div>
              </div>
            )}
          </div>
        )}

        {assistantError && (
          <p className="text-red-400 text-xs font-body mb-3">{assistantError}</p>
        )}

        {/* Free-text input */}
        <div className="flex gap-2">
          <input
            type="text"
            value={assistantInput}
            onChange={e => setAssistantInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); sendAssistantMessage(assistantInput) } }}
            placeholder="Ask about substitutions, scaling, dietary swaps..."
            className="input-field flex-1"
          />
          <button
            onClick={() => sendAssistantMessage(assistantInput)}
            disabled={assistantLoading || !assistantInput.trim()}
            className="btn-primary flex items-center justify-center px-4 disabled:opacity-50"
            aria-label="Send"
          >
            {assistantLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
      </section>

      {user && (
        <section className="bg-surface border border-border rounded-2xl p-5">
          <h2 className="font-display text-xl text-cream font-light mb-4">My Notes</h2>
          <div className="mb-4">
            <p className="text-faint text-xs font-body uppercase tracking-widest mb-2">Rating</p>
            <StarRating value={rating} onChange={setRating} />
            {rating > 0 && <p className="text-amber text-xs font-body mt-1">{rating} star{rating !== 1 ? 's' : ''}</p>}
          </div>
          <div className="mb-4">
            <textarea value={note} onChange={e => setNote(e.target.value)}
              placeholder="Add your notes, modifications, tips..." rows={4} className="input-field resize-none" />
          </div>
          <button onClick={handleSaveNote} disabled={savingNote} className="btn-primary flex items-center gap-2">
            {savingNote ? <Loader2 size={14} className="animate-spin" /> : null}
            Save Notes
          </button>
          {saveSuccess && <p className="text-green-400 text-xs font-body mt-2">Saved!</p>}
          {saveError && <p className="text-red-400 text-xs font-body mt-2">{saveError}</p>}
        </section>
      )}

      {showCookingMode && (
        <CookingMode
          title={displayRecipe.title}
          ingredients={ingredients}
          instructions={instructions}
          sourceURL={displayRecipe.sourceURL}
          onClose={() => setShowCookingMode(false)}
          onMarkCooked={user ? async (servingsEaten: number) => {
            // One shared cooked-capture pathway with the plan page checkmark:
            // updates this week's plan + writes a single is_cook_event log entry.
            await logCookEvent(user.uid, {
              recipeId: displayRecipe.id,
              recipeName: displayRecipe.title,
              // Log the macros THIS user sees — derived from their effective
              // serving size (override ?? shared default), not the shared default.
              perServing: perServingForViewer(recipe?.nutrition, meta?.overrides?.servings),
              servingsEaten,
            })
          } : undefined}
        />
      )}

      {showEdit && recipe && (
        <RecipeEditModal
          recipe={recipe}
          meta={meta}
          onClose={() => setShowEdit(false)}
          onSaved={updatedMeta => setMeta(updatedMeta)}
          onNutritionSaved={(nutrition: RecipeNutrition) =>
            setRecipe(r => (r ? { ...r, nutrition, servings: nutrition.servings ?? r.servings } : r))
          }
        />
      )}
    </div>
  )
}
