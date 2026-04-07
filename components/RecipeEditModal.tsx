'use client'

import { useState, useEffect } from 'react'
import { X, Save, RotateCcw, Loader2, Check } from 'lucide-react'
import { saveRecipeMeta } from '@/lib/userdata'
import { useAuth } from '@/lib/AuthContext'
import type { Recipe } from '@/types/recipe'
import type { RecipeMeta } from '@/lib/userdata'

const CATEGORIES = [
  'Chicken & Poultry', 'Vegetarian Mains', 'Salads & Bowls',
  'Pasta, Noodles & Rice', 'Soups, Stews & Chili',
  'Seafood', 'Beef & Pork', 'Breakfast, Snacks & Sides',
]

interface Props {
  recipe: Recipe
  meta: RecipeMeta | null
  onClose: () => void
  onSaved: (updatedMeta: RecipeMeta) => void
}

export default function RecipeEditModal({ recipe, meta, onClose, onSaved }: Props) {
  const { user } = useAuth()
  const overrides = meta?.overrides || {}

  const [title, setTitle] = useState(overrides.title || recipe.title)
  const [cuisine, setCuisine] = useState(overrides.cuisine || recipe.cuisine)
  const [category, setCategory] = useState(overrides.category || recipe.category)
  const [content, setContent] = useState(overrides.content || recipe.content)
  const [imageURL, setImageURL] = useState(overrides.imageURL || recipe.imageURL || '')
  const [prepTime, setPrepTime] = useState(overrides.prepTime || (recipe as any).prepTime || '')
  const [cookTime, setCookTime] = useState(overrides.cookTime || (recipe as any).cookTime || '')
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [showDiscardWarning, setShowDiscardWarning] = useState(false)

  // Initial values for dirty check
  const initTitle = overrides.title || recipe.title
  const initCuisine = overrides.cuisine || recipe.cuisine
  const initCategory = overrides.category || recipe.category
  const initContent = overrides.content || recipe.content
  const initImageURL = overrides.imageURL || recipe.imageURL || ''
  const initPrepTime = overrides.prepTime || (recipe as any).prepTime || ''
  const initCookTime = overrides.cookTime || (recipe as any).cookTime || ''

  const isDirty = title !== initTitle || cuisine !== initCuisine || category !== initCategory ||
    content !== initContent || imageURL !== initImageURL || prepTime !== initPrepTime || cookTime !== initCookTime

  // Auto-reset confirmReset after 3 seconds
  useEffect(() => {
    if (!confirmReset) return
    const timer = setTimeout(() => setConfirmReset(false), 3000)
    return () => clearTimeout(timer)
  }, [confirmReset])

  const handleSave = async () => {
    if (!user) return
    setSaving(true)
    const newOverrides: Record<string, string | undefined> = {
      title: title !== recipe.title ? title : undefined,
      cuisine: cuisine !== recipe.cuisine ? cuisine : undefined,
      category: category !== recipe.category ? category : undefined,
      content: content !== recipe.content ? content : undefined,
      imageURL: imageURL !== (recipe.imageURL || '') ? imageURL : undefined,
      prepTime: prepTime !== ((recipe as any).prepTime || '') ? prepTime : undefined,
      cookTime: cookTime !== ((recipe as any).cookTime || '') ? cookTime : undefined,
    }
    const clean = Object.fromEntries(Object.entries(newOverrides).filter(([, v]) => v !== undefined))
    const updatedMeta: RecipeMeta = {
      ...meta,
      overrides: Object.keys(clean).length > 0 ? clean : undefined,
    }
    await saveRecipeMeta(user.uid, recipe.id, updatedMeta)
    setSaving(false)
    setSaveSuccess(true)
    onSaved(updatedMeta)
    setTimeout(() => onClose(), 1500)
  }

  const handleResetClick = () => {
    if (!confirmReset) { setConfirmReset(true); return }
    handleReset()
  }

  const handleReset = async () => {
    if (!user) return
    setResetting(true)
    setConfirmReset(false)
    const updatedMeta: RecipeMeta = { ...meta, overrides: undefined }
    await saveRecipeMeta(user.uid, recipe.id, updatedMeta)
    setTitle(recipe.title)
    setCuisine(recipe.cuisine)
    setCategory(recipe.category)
    setContent(recipe.content)
    setImageURL(recipe.imageURL || '')
    setPrepTime((recipe as any).prepTime || '')
    setCookTime((recipe as any).cookTime || '')
    setResetting(false)
    onSaved(updatedMeta)
    onClose()
  }

  const handleClose = () => {
    if (isDirty) { setShowDiscardWarning(true); return }
    onClose()
  }

  const hasOverrides = meta?.overrides && Object.keys(meta.overrides).length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-4 bg-ink/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-2xl max-w-[calc(100vw-2rem)] max-h-[90vh] overflow-y-auto animate-slide-up">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h2 className="font-display text-2xl text-cream font-light">Edit Recipe</h2>
            <p className="text-faint text-xs font-body mt-0.5">
              Changes are personal — the shared recipe stays the same for other users
            </p>
          </div>
          <button onClick={handleClose} className="text-faint hover:text-cream transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Title */}
          <div>
            <label className="text-faint text-xs font-body uppercase tracking-widest mb-1.5 block">Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} className="input-field" />
          </div>

          {/* Cuisine + Category */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-faint text-xs font-body uppercase tracking-widest mb-1.5 block">Cuisine</label>
              <input value={cuisine} onChange={e => setCuisine(e.target.value.toLowerCase())} className="input-field" placeholder="e.g. italian" />
            </div>
            <div>
              <label className="text-faint text-xs font-body uppercase tracking-widest mb-1.5 block">Category</label>
              <select value={category} onChange={e => setCategory(e.target.value)} className="input-field">
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* Image URL */}
          <div>
            <label className="text-faint text-xs font-body uppercase tracking-widest mb-1.5 block">Image URL</label>
            <input value={imageURL} onChange={e => setImageURL(e.target.value)} className="input-field" placeholder="https://..." />
          </div>
          {imageURL && (
            <img src={imageURL} alt="" className="w-full aspect-video object-cover rounded-xl"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
          )}

          {/* Prep + Cook time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-faint text-xs font-body uppercase tracking-widest mb-1.5 block">Prep time</label>
              <input value={prepTime} onChange={e => setPrepTime(e.target.value)} className="input-field" placeholder="e.g. 15 min" />
            </div>
            <div>
              <label className="text-faint text-xs font-body uppercase tracking-widest mb-1.5 block">Cook time</label>
              <input value={cookTime} onChange={e => setCookTime(e.target.value)} className="input-field" placeholder="e.g. 30 min" />
            </div>
          </div>

          {/* Content */}
          <div>
            <label className="text-faint text-xs font-body uppercase tracking-widest mb-1.5 block">
              Ingredients &amp; Instructions
            </label>
            <textarea value={content} onChange={e => setContent(e.target.value)} rows={12} className="input-field resize-none text-xs leading-relaxed" />
          </div>

          {/* Unsaved changes warning */}
          {showDiscardWarning && (
            <div className="bg-amber/10 border border-amber/20 rounded-xl p-3 flex items-center justify-between gap-3 animate-fade-in">
              <p className="text-amber text-xs font-body">You have unsaved changes. Discard them?</p>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => setShowDiscardWarning(false)} className="text-xs font-body text-cream hover:text-amber">Keep editing</button>
                <button onClick={onClose} className="text-xs font-body text-red-400 font-semibold hover:text-red-300">Discard</button>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            {hasOverrides && (
              <button onClick={handleResetClick} disabled={resetting} className={`btn-ghost flex items-center gap-2 ${confirmReset ? 'text-red-400 border-red-400/30' : 'text-faint'}`}>
                {resetting ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                {confirmReset ? 'Click again to reset' : 'Reset to original'}
              </button>
            )}
            <div className="flex-1" />
            <button onClick={handleClose} className="btn-ghost">Cancel</button>
            <button onClick={handleSave} disabled={saving || saveSuccess} className={`btn-primary flex items-center gap-2 ${saveSuccess ? 'bg-green-500 hover:bg-green-500' : ''}`}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : saveSuccess ? <Check size={14} /> : <Save size={14} />}
              {saveSuccess ? 'Saved!' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
