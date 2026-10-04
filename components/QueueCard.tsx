'use client'

import { useState } from 'react'
import { useAuth } from '@/lib/AuthContext'
import { deleteFromQueue, updateQueueItem, buildRecipeContent, publishQueuedRecipe, QueuedRecipe } from '@/lib/queue'
import { computeAndStoreNutrition, prepareCookingStepIngredientMap, triggerCookingModeMappingGeneration } from '@/lib/recipes'
import { slugify } from '@/lib/utils'
import { Loader2, Trash2, Check, ExternalLink, Edit3, X, Save } from 'lucide-react'
import RecipeImage from '@/components/RecipeImage'
import { RECIPE_CATEGORIES, isRecipeCategory } from '@/lib/recipeCategories'

export function QueueCard({
  item, uid, onPublish, onDiscard
}: {
  item: QueuedRecipe
  uid: string
  onPublish: (id: string) => void
  onDiscard: (id: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [title, setTitle] = useState(item.title)
  const [cuisine, setCuisine] = useState(item.cuisine)
  const [category, setCategory] = useState(item.category)
  const [ingredients, setIngredients] = useState((item.ingredients || []).join('\n'))
  const [instructions, setInstructions] = useState((item.instructions || []).join('\n\n'))
  const [imageURL, setImageURL] = useState(item.imageURL || '')
  // null = idle, 'saving' = writing recipe doc, 'nutrition' = computing nutrition
  const [publishStage, setPublishStage] = useState<null | 'saving' | 'nutrition'>(null)
  const publishing = publishStage !== null
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState('')
  const [publishError, setPublishError] = useState('')
  const [publishedRecipeId, setPublishedRecipeId] = useState(item.publishedRecipeId || null)
  const { user } = useAuth()

  const handleSaveEdit = async () => {
    setSaving(true)
    setEditError('')
    try {
      await updateQueueItem(uid, item.id!, {
        title,
        cuisine,
        category,
        imageURL,
        ingredients: ingredients.split('\n').map(l => l.trim()).filter(Boolean),
        instructions: instructions.split('\n\n').map(l => l.trim()).filter(Boolean),
      })
      setEditing(false)
    } catch (error) {
      setEditError(error instanceof Error ? error.message : 'Couldn’t save your changes. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const handlePublish = async () => {
    setPublishError('')
    if (!isRecipeCategory(category)) {
      setPublishError('Choose a canonical category before publishing this recipe.')
      return
    }
    if (!user) {
      setPublishError('Sign in again before publishing this recipe.')
      return
    }
    setPublishStage('saving')
    try {
      const updatedItem: QueuedRecipe = {
        ...item,
        title, cuisine, category, imageURL,
        ingredients: ingredients.split('\n').map(l => l.trim()).filter(Boolean),
        instructions: instructions.split('\n\n').map(l => l.trim()).filter(Boolean),
      }
      const content = buildRecipeContent(updatedItem)
      const token = await user.getIdToken()
      const alreadyPublished = item.status === 'published' || Boolean(publishedRecipeId)
      const cookingStepIngredientMap = alreadyPublished
        ? undefined
        : await prepareCookingStepIngredientMap(content, token)
      const publication = await publishQueuedRecipe(uid, item.id!, {
        recipeID: slugify(title),
        title: title.trim(),
        content,
        category,
        cuisine: cuisine.toLowerCase(),
        imageURL,
        sourceURL: item.sourceURL || '',
        sourceFile: slugify(title) + '.json',
        labels: 'Recipes',
        hasImage: imageURL ? 'true' : 'false',
        created: new Date().toString(),
        modified: new Date().toString(),
        ...(updatedItem.prepTime ? { prepTime: updatedItem.prepTime } : {}),
        ...(updatedItem.cookTime ? { cookTime: updatedItem.cookTime } : {}),
        ...(cookingStepIngredientMap ? { cookingStepIngredientMap } : {}),
        ...(updatedItem.sourceNutrition ? {
          nutrition: updatedItem.sourceNutrition,
          nutritionStatus: 'computed' as const,
        } : {}),
      }, uid)
      const recipeId = publication.recipeId
      setPublishedRecipeId(recipeId)
      // Auto-nutrition + Cooking Mode mapping generation: both run concurrently
      // as independent, timeout-guarded, never-throwing post-save enrichments —
      // neither blocks publishing, and neither's failure affects the other
      // (Implementation 6, Phase 6/7). computeAndStoreNutrition and
      // triggerCookingModeMappingGeneration each flag/log their own failure
      // instead of throwing, so this Promise.allSettled never rejects.
      if (publication.created) {
        if (!updatedItem.sourceNutrition) setPublishStage('nutrition')
        await Promise.allSettled([
          ...(updatedItem.sourceNutrition ? [] : [computeAndStoreNutrition(recipeId, token)]),
          triggerCookingModeMappingGeneration(recipeId, token),
        ])
      }
      try {
        await deleteFromQueue(uid, item.id!)
      } catch {
        setPublishError('The recipe is published, but removing it from the queue failed. Retry to finish cleanup; the recipe will not be published again.')
        setPublishStage(null)
        return
      }
      onPublish(item.id!)
    } catch (err) {
      console.error('Publish error:', err)
      setPublishError(err instanceof Error ? `Couldn’t publish this recipe: ${err.message}` : 'Couldn’t publish this recipe — try again.')
      setPublishStage(null)
    }
  }

  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden">
      {/* Image */}
      {imageURL && !editing && (
        <div className="aspect-video overflow-hidden bg-card">
          <RecipeImage
            src={imageURL}
            alt={title}
            category={category}
            className="w-full h-full"
            emojiClassName="text-5xl"
          />
        </div>
      )}

      <div className="p-5">
        {editing ? (
          <div className="space-y-3">
            <div>
              <label className="text-faint text-xs font-body uppercase tracking-widest mb-1 block">Title</label>
              <input value={title} onChange={e => setTitle(e.target.value)} className="input-field" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-faint text-xs font-body uppercase tracking-widest mb-1 block">Cuisine</label>
                <input value={cuisine} onChange={e => setCuisine(e.target.value)} className="input-field" />
              </div>
              <div>
                <label className="text-faint text-xs font-body uppercase tracking-widest mb-1 block">Category</label>
                <select value={category} onChange={e => setCategory(e.target.value)} className="input-field">
                  <option value="" disabled>Select category</option>
                  {category && !isRecipeCategory(category) && (
                    <option value={category}>Legacy / unresolved: {category}</option>
                  )}
                  {RECIPE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                {!isRecipeCategory(category) && (
                  <p className="text-amber/80 text-[11px] font-body mt-1">
                    Select a canonical category before publishing.
                  </p>
                )}
              </div>
            </div>
            <div>
              <label className="text-faint text-xs font-body uppercase tracking-widest mb-1 block">Image URL</label>
              <input value={imageURL} onChange={e => setImageURL(e.target.value)} className="input-field" />
            </div>
            <div>
              <label className="text-faint text-xs font-body uppercase tracking-widest mb-1 block">Ingredients (one per line)</label>
              <textarea value={ingredients} onChange={e => setIngredients(e.target.value)} rows={6} className="input-field resize-none text-xs" />
            </div>
            <div>
              <label className="text-faint text-xs font-body uppercase tracking-widest mb-1 block">Instructions (one step per paragraph)</label>
              <textarea value={instructions} onChange={e => setInstructions(e.target.value)} rows={6} className="input-field resize-none text-xs" />
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setEditing(false)} className="btn-ghost flex items-center gap-1.5 text-xs"><X size={12} />Cancel</button>
              <button onClick={handleSaveEdit} disabled={saving} className="btn-primary flex items-center gap-1.5 text-xs">
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}Save
              </button>
            </div>
            {editError && <p role="alert" className="text-red-400 text-xs font-body">{editError}</p>}
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3 mb-3">
              <h3 className="font-display text-2xl text-cream font-light leading-tight">{title}</h3>
              <button aria-label="Edit queued recipe" onClick={() => { setEditError(''); setEditing(true) }} className="text-faint hover:text-cream transition-colors shrink-0">
                <Edit3 size={14} />
              </button>
            </div>
            <div className="flex gap-2 mb-3 flex-wrap">
              {cuisine && <span className="tag-amber capitalize">{cuisine}</span>}
              {category && (
                <span className="tag">
                  {isRecipeCategory(category) ? category : `Unresolved: ${category}`}
                </span>
              )}
              {item.prepTime && <span className="tag">Prep {item.prepTime}</span>}
              {item.cookTime && <span className="tag">Cook {item.cookTime}</span>}
            </div>
            {item.description && (
              <p className="text-muted text-sm font-body leading-relaxed mb-3 italic">{item.description}</p>
            )}
            {/* Ingredient preview */}
            {item.ingredients?.length > 0 && (
              <div className="mb-3">
                <p className="text-faint text-xs font-body uppercase tracking-widest mb-1.5">Ingredients ({item.ingredients.length})</p>
                <ul className="space-y-1">
                  {item.ingredients.slice(0, 5).map((ing, i) => (
                    <li key={i} className="text-muted text-xs font-body flex items-start gap-2">
                      <span className="w-1 h-1 rounded-full bg-amber mt-1.5 shrink-0" />
                      {ing}
                    </li>
                  ))}
                  {item.ingredients.length > 5 && (
                    <li className="text-faint text-xs font-body">+{item.ingredients.length - 5} more</li>
                  )}
                </ul>
              </div>
            )}
            {item.sourceURL && (
              <a href={item.sourceURL} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-faint text-xs font-body hover:text-amber transition-colors mb-4">
                <ExternalLink size={11} />
                <span className="truncate">{item.sourceURL}</span>
              </a>
            )}
          </>
        )}

        {/* Actions */}
        {!editing && (
          <div className="pt-2 border-t border-border space-y-2">
            {confirmDiscard && (
              <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 animate-fade-in">
                <span className="text-red-400 text-xs font-body">Discard this recipe?</span>
                <button onClick={() => onDiscard(item.id!)} className="text-red-400 text-xs font-body font-semibold hover:text-red-300">Yes</button>
                <button onClick={() => setConfirmDiscard(false)} className="text-faint text-xs font-body hover:text-cream">Cancel</button>
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDiscard(true)}
                className="btn-ghost flex items-center gap-1.5 text-xs text-faint hover:text-red-400"
              >
                <Trash2 size={12} />Discard
              </button>
              <div className="flex-1" />
              <button
                onClick={handlePublish}
                disabled={publishing}
                className={`flex items-center gap-1.5 text-xs font-body font-semibold px-5 py-2.5 rounded-xl transition-all duration-200 ${
                  publishing
                    ? 'bg-green-600 text-white'
                    : 'bg-amber text-ink hover:bg-amber-glow active:scale-95'
                }`}
              >
                {publishing ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                {publishStage === 'nutrition' ? 'Calculating nutrition…'
                  : publishStage === 'saving' ? 'Adding…'
                  : publishedRecipeId || item.status === 'published' ? 'Finish publishing'
                  : 'Publish to collection'}
              </button>
            </div>
            {publishError && <p role="alert" className="text-red-400 text-xs font-body">{publishError}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
