'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, Heart, ExternalLink, ChefHat, Star,
  BookOpen, Calendar, Loader2, Plus
} from 'lucide-react'
import { getRecipeById, parseRecipeContent } from '@/lib/recipes'
import { getRecipeMeta, saveRecipeMeta, addRecipeToWeekPlan, weekIDFromDate } from '@/lib/userdata'
import { useFavorites } from '@/hooks/useFavorites'
import { useAuth } from '@/lib/AuthContext'
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
            className={
              star <= (hover || value)
                ? 'text-amber fill-amber'
                : 'text-faint'
            }
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

  useEffect(() => {
    if (!id) return
    getRecipeById(id).then(r => {
      setRecipe(r)
      setLoading(false)
    })
  }, [id])

  useEffect(() => {
    if (!user || !id) return
    getRecipeMeta(user.uid, id).then(m => {
      if (m) {
        setMeta(m)
        setNote(m.note || '')
        setRating(m.rating || 0)
      }
    })
  }, [user, id])

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

  if (!recipe) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="font-display text-3xl text-faint">Recipe not found</p>
        <button onClick={() => router.back()} className="btn-ghost">Go back</button>
      </div>
    )
  }

  const { ingredients, instructions, description } = parseRecipeContent(recipe.content)
  const fav = isFavorite(recipe.id)

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      {/* Back */}
      <button
        onClick={() => router.back()}
        className="flex items-center gap-2 text-faint hover:text-cream transition-colors mb-6 text-sm font-body"
      >
        <ArrowLeft size={16} />
        Back
      </button>

      {/* Hero image */}
      {recipe.imageURL && (
        <div className="rounded-2xl overflow-hidden aspect-video mb-6 bg-card">
          <img
            src={recipe.imageURL}
            alt={recipe.title}
            className="w-full h-full object-cover"
            onError={e => { (e.target as HTMLImageElement).parentElement!.style.display = 'none' }}
          />
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <h1 className="font-display text-4xl md:text-5xl text-cream font-light leading-tight">
          {recipe.title}
        </h1>
        <button
          onClick={() => toggle(recipe.id)}
          className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all ${
            fav ? 'bg-amber text-ink' : 'bg-card border border-border text-faint hover:text-cream'
          }`}
        >
          <Heart size={16} fill={fav ? 'currentColor' : 'none'} />
        </button>
      </div>

      {/* Tags */}
      <div className="flex flex-wrap gap-2 mb-6">
        {recipe.category && (
          <span className="tag">{recipe.category}</span>
        )}
        {recipe.cuisine && (
          <span className="tag-amber capitalize">{recipe.cuisine}</span>
        )}
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
        {recipe.sourceURL && (
          <a
            href={recipe.sourceURL}
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
      {ingredients.length === 0 && instructions.length === 0 && recipe.content && (
        <section className="mb-8">
          <h2 className="font-display text-2xl text-cream font-light mb-4">Recipe</h2>
          <pre className="text-sm font-body text-muted whitespace-pre-wrap leading-relaxed bg-surface border border-border rounded-xl p-4 overflow-x-auto">
            {recipe.content}
          </pre>
        </section>
      )}

      {/* Notes + Rating (signed in only) */}
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
    </div>
  )
}
