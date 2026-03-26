'use client'

import { useState } from 'react'
import { X, Save, RotateCcw, Loader2 } from 'lucide-react'
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
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)

  const handleSave = async () => {
    if (!user) return
    setSaving(true)
    const newOverrides = {
      title: title !== recipe.title ? title : undefined,
      cuisine: cuisine !== recipe.cuisine ? cuisine : undefined,
      category: category !== recipe.category ? category : undefined,
      content: content !== recipe.content ? content : undefined,
    }
    // Remove undefined keys
    const clean = Object.fromEntries(Object.entries(newOverrides).filter(([, v]) => v !== undefined))
    const updatedMeta: RecipeMeta = {
      ...meta,
      overrides: Object.keys(clean).length > 0 ? clean : undefined,
    }
    await saveRecipeMeta(user.uid, recipe.id, updatedMeta)
    setSaving(false)
    onSaved(updatedMeta)
    onClose()
  }

  const handleReset = async () => {
    if (!user) return
    setResetting(true)
    const updatedMeta: RecipeMeta = { ...meta, overrides: undefined }
    await saveRecipeMeta(user.uid, recipe.id, updatedMeta)
    // Reset local state to original
    setTitle(recipe.title)
    setCuisine(recipe.cuisine)
    setCategory(recipe.category)
    setContent(recipe.content)
    setResetting(false)
    onSaved(updatedMeta)
    onClose()
  }

  const hasOverrides = meta?.overrides && Object.keys(meta.overrides).length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-4 bg-ink/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h2 className="font-display text-2xl text-cream font-light">Edit Recipe</h2>
            <p className="text-faint text-xs font-body mt-0.5">
              Changes are personal — the shared recipe stays the same for other users
            </p>
          </div>
          <button onClick={onClose} className="text-faint hover:text-cream transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Title */}
          <div>
            <label className="text-faint text-xs font-body uppercase tracking-widest mb-1.5 block">Title</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="input-field"
            />
            {title !== recipe.title && (
              <p className="text-faint text-xs font-body mt-1">
                Original: <span className="text-muted">{recipe.title}</span>
              </p>
            )}
          </div>

          {/* Cuisine + Category */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-faint text-xs font-body uppercase tracking-widest mb-1.5 block">Cuisine</label>
              <input
                value={cuisine}
                onChange={e => setCuisine(e.target.value.toLowerCase())}
                className="input-field"
                placeholder="e.g. italian"
              />
            </div>
            <div>
              <label className="text-faint text-xs font-body uppercase tracking-widest mb-1.5 block">Category</label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="input-field"
              >
                {CATEGORIES.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Content */}
          <div>
            <label className="text-faint text-xs font-body uppercase tracking-widest mb-1.5 block">
              Ingredients &amp; Instructions
            </label>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              rows={14}
              className="input-field resize-none text-xs leading-relaxed"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            {hasOverrides && (
              <button
                onClick={handleReset}
                disabled={resetting}
                className="btn-ghost flex items-center gap-2 text-faint"
              >
                {resetting ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                Reset to original
              </button>
            )}
            <div className="flex-1" />
            <button onClick={onClose} className="btn-ghost">Cancel</button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-primary flex items-center gap-2"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Save changes
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
