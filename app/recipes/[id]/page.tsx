'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, Heart, ExternalLink, ChefHat,
  Star, BookOpen, Calendar, Loader2, Pencil
} from 'lucide-react'
import { getRecipeById, parseRecipeContent } from '@/lib/recipes'
import { getRecipeMeta, saveRecipeMeta, addRecipeToWeekPlan, weekIDFromDate } from '@/lib/userdata'
import { useFavorites } from '@/hooks/useFavorites'
import { useAuth } from '@/lib/AuthContext'
import RecipeEditModal from '@/components/RecipeEditModal'
import type { Recipe } from '@/types/recipe'
import type { RecipeMeta } from '@/lib/userdata'

function StarRating({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  const [hover, setHover] = useState(0)
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(star => (
        <button
          key={star}
          onClick={() => onChange?.(star)}
          onMouseEnter={() => onChange && setHover(star)}
          onMouseLeave={() => onChange && setHover(0)}
          className="transition-colors"
          disabled={!onChange}
        >
          <Star
            size={18}
            className={star <= (hover || value) ? 'text-amber fill-amber' : 'text-faint'}
          />
        </button>
      ))}
    </div>
  )
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
  const [addedToPlan, setAddedToPlan] = useState(false)
  const [showEdit, setShowEdit] = useState(false)

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

  // Apply per-user overrides on top of shared recipe
  const displayRecipe = recipe ? {
    ...recipe,
    title: meta?.overrides?.title || recipe.title,
    cuisine: meta?.overrides?.cuisine || recipe.cuisine,
    category: meta?.overrides?.category || recipe.category,
    content: meta?.overrides?.content || recipe.content,
  } : null

  const handleSaveNote = async () => {
    if (!user || !id) return
    setSavingNote(true)
    await saveRecipeMeta(user.uid, id, { note, rating })
    setSavingNote(false)
  }

  const handleAddToPlan = async () => {
    if (!user || !recipe) return
    const weekID = weekIDFromDate(new Date())
    await addRecipeToWeekPlan(user.uid, weekID, recipe.id)
    setAddedToPlan(true)
    setTimeout(() => setAddedToPlan(false), 2000)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="animate-spin text-amber" size={28} />
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
  const hasOverrides = meta?.overrides && Object.keys(meta.overrides).length > 0

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <button
        onClick={() => router.back()}
        className="flex items-center gap-2 text-faint hover:text-cream transition-colors mb-6 text-sm font-body"
      >
        <ArrowLeft size={16} />
        Back
      </button>

      {/* Hero image */}
      {displayRecipe.imageURL && (
        <div className="rounded-2xl overflow-hidden aspect-video mb-6 bg-card">
          <img
            src={displayRecipe.imageURL}
            alt={displayRecipe.title}
            className="w-full h-full object-cover"
            onError={e => { (e.target as HTMLImageElement).parentElement!.style.display = 'none' }}
          />
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <h1 className="font-display text-4xl md:text-5xl text-cream font-light leading-tight">
          {displayRecipe.title}
        </h1>
        <div className="flex items-center gap-2 shrink-0">
          {user && (
            <button
              onClick={() => setShowEdit(true)}
              className="w-10 h-10 rounded-full flex items-center justify-center bg-card border border-border text-faint hover:text-cream hover:border-amber/30 transition-all"
              title="Edit recipe"
            >
              <Pencil size={14} />
            </button>
          )}
          <button
            onClick={() => toggle(displayRecipe.id)}
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
        {hasOverrides && <span className="text-xs px-2.5 py-1 rounded-lg bg-amber/5 border border-amber/10 text-amber/60 font-body">edited</span>}
        {meta?.rating ? <StarRating value={meta.rating} /> : null}
      </div>

      {/* Action buttons */}
      <div className="flex gap-3 mb-8">
        {user && (
          <button
            onClick={handleAddToPlan}
            className={`btn-primary flex items-center gap-2 ${addedToPlan ? 'bg-green-600' : ''}`}
          >
            <Calendar size={15} />
            {addedToPlan ? 'Added!' : 'Add to Plan'}
          </button>
        )}
        {displayRecipe.sourceURL && (
          <a
            href={displayRecipe.sourceURL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost flex items-center gap-2"
          >
            <ExternalLink size={14} />
            Source
          </a>
        )}
      </div>

      {description && (
        <p className="text-muted font-body text-sm leading-relaxed mb-8 border-l-2 border-amber/30 pl-4 italic">
          {description}
        </p>
      )}

      {/* Ingredients */}
      {ingredients.length > 0 && (
        <section className="mb-8">
          <h2 className="font-display text-2xl text-cream font-light mb-4 flex items-center gap-2">
            <ChefHat size={20} className="text-amber" />
            Ingredients
          </h2>
          <ul className="space-y-2">
            {ingredients.map((ing, i) => (
              <li key={i} className="flex items-start gap-3 text-sm font-body text-muted">
                <span className="w-1.5 h-1.5 rounded-full bg-amber mt-2 shrink-0" />
                {ing}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Instructions */}
      {instructions.length > 0 && (
        <section className="mb-8">
          <h2 className="font-display text-2xl text-cream font-light mb-4 flex items-center gap-2">
            <BookOpen size={20} className="text-amber" />
            Instructions
          </h2>
          <ol className="space-y-5">
            {instructions.map((step, i) => (
              <li key={i} className="flex gap-4">
                <span className="font-display text-2xl text-amber/60 font-light leading-none mt-0.5 w-6 shrink-0">
                  {i + 1}
                </span>
                <p className="text-sm font-body text-muted leading-relaxed">{step}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Raw content fallback */}
      {ingredients.length === 0 && instructions.length === 0 && displayRecipe.content && (
        <section className="mb-8">
          <h2 className="font-display text-2xl text-cream font-light mb-4">Recipe</h2>
          <pre className="text-sm font-body text-muted whitespace-pre-wrap leading-relaxed bg-surface border border-border rounded-xl p-4 overflow-x-auto">
            {displayRecipe.content}
          </pre>
        </section>
      )}

      {/* Notes + Rating */}
      {user && (
        <section className="bg-surface border border-border rounded-2xl p-5">
          <h2 className="font-display text-xl text-cream font-light mb-4">My Notes</h2>
          <div className="mb-4">
            <p className="text-faint text-xs font-body uppercase tracking-widest mb-2">Rating</p>
            <StarRating value={rating} onChange={setRating} />
          </div>
          <div className="mb-4">
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Add your notes, modifications, tips..."
              rows={4}
              className="input-field resize-none"
            />
          </div>
          <button
            onClick={handleSaveNote}
            disabled={savingNote}
            className="btn-primary flex items-center gap-2"
          >
            {savingNote ? <Loader2 size={14} className="animate-spin" /> : null}
            Save Notes
          </button>
        </section>
      )}

      {/* Edit modal */}
      {showEdit && recipe && (
        <RecipeEditModal
          recipe={recipe}
          meta={meta}
          onClose={() => setShowEdit(false)}
          onSaved={updatedMeta => setMeta(updatedMeta)}
        />
      )}
    </div>
  )
}
