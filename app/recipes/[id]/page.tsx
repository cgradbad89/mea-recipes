'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, Heart, ExternalLink, ChefHat,
  BookOpen, Calendar, Loader2, Pencil, Trash2, Clock
} from 'lucide-react'
import { getRecipeById, parseRecipeContent, deleteRecipe } from '@/lib/recipes'
import { getRecipeMeta, saveRecipeMeta, addRecipeToWeekPlan, weekIDFromDate } from '@/lib/userdata'
import { useFavorites } from '@/hooks/useFavorites'
import { useAuth } from '@/lib/AuthContext'
import RecipeEditModal from '@/components/RecipeEditModal'
import type { Recipe } from '@/types/recipe'
import type { RecipeMeta } from '@/lib/userdata'

// Half-star interactive rating component
function StarRating({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  const [hover, setHover] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

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
    <div ref={containerRef} className="flex gap-1">
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
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

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

  const handleDelete = async () => {
    if (!user || !recipe) return
    setDeleting(true)
    await deleteRecipe(recipe.id)
    router.push('/recipes')
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
  const canDelete = !!user && recipe?.addedBy === user.uid

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <button onClick={() => router.back()}
        className="flex items-center gap-2 text-faint hover:text-cream transition-colors mb-6 text-sm font-body"
      >
        <ArrowLeft size={16} /> Back
      </button>

      {displayRecipe.imageURL && (
        <div className="rounded-2xl overflow-hidden aspect-video mb-6 bg-card">
          <img src={displayRecipe.imageURL} alt={displayRecipe.title}
            className="w-full h-full object-cover"
            onError={e => { (e.target as HTMLImageElement).parentElement!.style.display = 'none' }}
          />
        </div>
      )}

      <div className="flex items-start justify-between gap-4 mb-4">
        <h1 className="font-display text-4xl md:text-5xl text-cream font-light leading-tight">
          {displayRecipe.title}
        </h1>
        <div className="flex items-center gap-2 shrink-0">
          {user && (
            <button onClick={() => setShowEdit(true)}
              className="w-10 h-10 rounded-full flex items-center justify-center bg-card border border-border text-faint hover:text-cream hover:border-amber/30 transition-all"
            >
              <Pencil size={14} />
            </button>
          )}
          {canDelete && !confirmDelete && (
            <button onClick={() => setConfirmDelete(true)}
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
            </div>
          )}
          <button onClick={() => toggle(displayRecipe.id)}
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
        {hasOverrides && <span className="text-xs px-2.5 py-1 rounded-lg bg-amber/5 border border-amber/10 text-amber/60 font-body">edited</span>}
        {meta?.rating ? <StarRating value={meta.rating} /> : null}
      </div>

      {/* Action buttons */}
      <div className="flex gap-3 mb-8">
        {user && (
          <button onClick={handleAddToPlan}
            className={`btn-primary flex items-center gap-2 ${addedToPlan ? 'bg-green-600' : ''}`}
          >
            <Calendar size={15} />
            {addedToPlan ? 'Added!' : 'Add to Plan'}
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

      {ingredients.length > 0 && (
        <section className="mb-8">
          <h2 className="font-display text-2xl text-cream font-light mb-4 flex items-center gap-2">
            <ChefHat size={20} className="text-amber" /> Ingredients
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
        </section>
      )}

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
