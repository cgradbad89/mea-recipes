'use client'

import { useState, useEffect, useRef } from 'react'
import { X, Save, RotateCcw, Loader2, Check } from 'lucide-react'
import { saveRecipeMeta } from '@/lib/userdata'
import { updateRecipeServings } from '@/lib/recipes'
import { NUTRIENTS, formatNutrient, perServingFromTotal, servingSizeLabel } from '@/lib/nutrition'
import { useAuth } from '@/lib/AuthContext'
import type { Recipe, RecipeNutrition } from '@/types/recipe'
import type { RecipeMeta } from '@/lib/userdata'
import {
  RECIPE_CATEGORIES,
  isRecipeCategory,
  normalizeRecipeCategory,
} from '@/lib/recipeCategories'

interface Props {
  recipe: Recipe
  meta: RecipeMeta | null
  onClose: () => void
  onSaved: (updatedMeta: RecipeMeta) => void | Promise<void>
  onNutritionSaved?: (nutrition: RecipeNutrition) => void
}

export default function RecipeEditModal({ recipe, meta, onClose, onSaved, onNutritionSaved }: Props) {
  const { user } = useAuth()
  const overrides = meta?.overrides || {}

  // ─── Nutrition / servings ────────────────────────────────────────────────
  const nutrition = recipe.nutrition
  const hasNutrition = !!nutrition
  const hasTotal = !!nutrition?.total
  const initServings = nutrition?.servings
  const [servingsInput, setServingsInput] = useState(
    initServings != null ? String(initServings) : '',
  )
  const parsedServings = Number(servingsInput)
  const servingsValid = servingsInput.trim() !== '' && Number.isFinite(parsedServings) && parsedServings > 0
  // Live per-serving preview, recomputed from the durable whole-recipe total.
  const previewPerServing = hasTotal && servingsValid
    ? perServingFromTotal(nutrition!.total, parsedServings)
    : null

  const [title, setTitle] = useState(overrides.title || recipe.title)
  const [cuisine, setCuisine] = useState(overrides.cuisine || recipe.cuisine)
  const initialRawCategory = overrides.category ?? recipe.category
  const initialDisplayCategory = normalizeRecipeCategory(initialRawCategory, recipe.id) ?? initialRawCategory
  const [category, setCategory] = useState(initialDisplayCategory)
  const [content, setContent] = useState(overrides.content || recipe.content)
  const [imageURL, setImageURL] = useState(overrides.imageURL || recipe.imageURL || '')
  const [prepTime, setPrepTime] = useState(overrides.prepTime || (recipe as any).prepTime || '')
  const [cookTime, setCookTime] = useState(overrides.cookTime || (recipe as any).cookTime || '')
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [showDiscardWarning, setShowDiscardWarning] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [privateSaved, setPrivateSaved] = useState(false)
  const [resetSaved, setResetSaved] = useState(false)
  const latestMetaRef = useRef(meta)
  const savedIntentRef = useRef<NonNullable<RecipeMeta['overrides']>>({})
  useEffect(() => { latestMetaRef.current = meta }, [meta])
  const categoryIsCanonical = isRecipeCategory(category)

  // Initial values for dirty check
  const [savedFields, setSavedFields] = useState({
    title, cuisine, category: initialDisplayCategory, content, imageURL, prepTime, cookTime,
  })
  const [savedServings, setSavedServings] = useState(initServings)
  const initTitle = savedFields.title
  const initCuisine = savedFields.cuisine
  const initContent = savedFields.content
  const initImageURL = savedFields.imageURL
  const initPrepTime = savedFields.prepTime
  const initCookTime = savedFields.cookTime

  const categoryChanged = category !== savedFields.category
  const isDirty = title !== initTitle || cuisine !== initCuisine || categoryChanged ||
    content !== initContent || imageURL !== initImageURL || prepTime !== initPrepTime ||
    cookTime !== initCookTime || (servingsValid && parsedServings !== savedServings)

  // Auto-reset confirmReset after 3 seconds
  useEffect(() => {
    if (!confirmReset) return
    const timer = setTimeout(() => setConfirmReset(false), 3000)
    return () => clearTimeout(timer)
  }, [confirmReset])

  const handleSave = async () => {
    if (!user || saving || resetting || resetSaved) return
    setSaving(true)
    setSaveError('')
    // Only changed controls belong in the patch. Keep own undefined values as
    // explicit field clears; omit untouched siblings, including personal servings.
    // The category's initial display may be a read-time legacy normalization, so
    // opening the modal or changing another control must not persist that value.
    const overridePatch: NonNullable<RecipeMeta['overrides']> = {}
    const fields = [
      ['title', title, initTitle, recipe.title],
      ['cuisine', cuisine, initCuisine, recipe.cuisine],
      ['category', category, savedFields.category, recipe.category],
      ['content', content, initContent, recipe.content],
      ['imageURL', imageURL, initImageURL, recipe.imageURL || ''],
      ['prepTime', prepTime, initPrepTime, recipe.prepTime || ''],
      ['cookTime', cookTime, initCookTime, recipe.cookTime || ''],
    ] as const
    for (const [key, value, initialValue, sharedValue] of fields) {
      if (value === initialValue) continue
      overridePatch[key] = value !== sharedValue ? value : undefined
    }
    let stage: 'private' | 'shared' | 'readback' = 'private'
    try {
      if (!privateSaved || Object.keys(overridePatch).length > 0) {
        await saveRecipeMeta(user.uid, recipe.id, { overrides: overridePatch })
        // Advance the baseline only after persistence. A retry sends new deltas,
        // never a previous override map or snapshot notes/ratings/servings.
        setPrivateSaved(true)
        savedIntentRef.current = { ...savedIntentRef.current, ...overridePatch }
        setSavedFields({ title, cuisine, category, content, imageURL, prepTime, cookTime })
      }
      stage = 'shared'
      if (hasNutrition && servingsValid && parsedServings !== savedServings) {
        const updatedNutrition = await updateRecipeServings(recipe.id, parsedServings, nutrition!)
        setSavedServings(parsedServings)
        stage = 'readback'
        onNutritionSaved?.(updatedNutrition)
      }
      stage = 'readback'
      const currentMeta = latestMetaRef.current
      const clean = { ...currentMeta?.overrides }
      for (const [key, value] of Object.entries(savedIntentRef.current)) {
        if (value === undefined) delete clean[key as keyof typeof clean]
        else Object.assign(clean, { [key]: value })
      }
      await onSaved({ ...currentMeta, overrides: Object.keys(clean).length ? clean : undefined })
      setSaveSuccess(true)
    } catch {
      setSaveError(stage === 'private'
        ? 'Couldn’t save your recipe edits. Please try again.'
        : stage === 'shared'
          ? 'Recipe edits were saved, but the shared servings update failed. Please try again.'
          : 'Saved, but couldn’t refresh the latest recipe data. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (!saveSuccess) return
    const timer = setTimeout(onClose, 1500)
    return () => clearTimeout(timer)
  }, [saveSuccess, onClose])

  const handleResetClick = () => {
    if (!confirmReset && !resetSaved) { setConfirmReset(true); return }
    void handleReset()
  }

  const handleReset = async () => {
    if (!user || saving || resetting) return
    setResetting(true)
    setConfirmReset(false)
    setSaveError('')
    let persisted = resetSaved
    try {
      if (!persisted) {
        await saveRecipeMeta(user.uid, recipe.id, { overrides: undefined })
        persisted = true
        setResetSaved(true)
        setTitle(recipe.title)
        setCuisine(recipe.cuisine)
        setCategory(normalizeRecipeCategory(recipe.category, recipe.id) ?? recipe.category)
        setContent(recipe.content)
        setImageURL(recipe.imageURL || '')
        setPrepTime(recipe.prepTime || '')
        setCookTime(recipe.cookTime || '')
        setServingsInput(initServings != null ? String(initServings) : '')
      }
      await onSaved({ ...latestMetaRef.current, overrides: undefined })
      onClose()
    } catch {
      setSaveError(persisted
        ? 'Reset saved, but couldn’t refresh the latest recipe data. Please retry the refresh.'
        : 'Couldn’t reset your recipe edits. Please try again.')
    } finally {
      setResetting(false)
    }
  }

  const handleClose = () => {
    if (saving || resetting) return
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
          <button onClick={handleClose} disabled={saving || resetting} className="text-faint hover:text-cream transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <fieldset disabled={saving || resetting || resetSaved || saveSuccess} className="space-y-4">
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
                <option value="" disabled>Select category</option>
                {category && !categoryIsCanonical && (
                  <option value={category}>Legacy / unresolved: {category}</option>
                )}
                {RECIPE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
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

          {/* Nutrition — SHARED recipe-default servings (corrects a genuinely wrong
              stored default for everyone). Distinct from the personal "Your serving
              size" control on the detail page, which only affects this user. */}
          {hasNutrition && (
            <div className="border-t border-border pt-4">
              <label className="text-faint text-xs font-body uppercase tracking-widest mb-1.5 block">
                Recipe default servings · shared
              </label>
              <p className="text-faint/80 text-[11px] font-body mb-2 -mt-0.5">
                Corrects the recipe&apos;s real default for everyone. To change just your
                own per-serving view, use “Your serving size” on the recipe page.
              </p>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  value={servingsInput}
                  onChange={e => setServingsInput(e.target.value)}
                  className="input-field w-32"
                  placeholder="e.g. 4"
                />
                {servingsValid && (
                  <span className="text-faint text-xs font-body">{servingSizeLabel(parsedServings)}</span>
                )}
              </div>

              {!hasTotal && (
                <p className="text-amber/70 text-xs font-body mt-2">
                  No whole-recipe total stored — saving updates the servings count, but per-serving
                  values can&apos;t be recomputed.
                </p>
              )}

              {previewPerServing && (
                <div className="mt-3">
                  <p className="text-faint text-[11px] font-body uppercase tracking-wide mb-2">
                    Per-serving preview
                  </p>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    {NUTRIENTS.map(({ key, label, unit }) => (
                      <div key={key} className="text-center bg-card border border-border rounded-lg py-2">
                        <p className="font-display text-lg text-cream font-light leading-none">
                          {formatNutrient(key, previewPerServing[key])}
                          {unit && <span className="text-xs text-faint ml-0.5">{unit}</span>}
                        </p>
                        <p className="text-faint text-[10px] font-body uppercase tracking-wide mt-1">
                          {label}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Content */}
          <div>
            <label className="text-faint text-xs font-body uppercase tracking-widest mb-1.5 block">
              Ingredients &amp; Instructions
            </label>
            <textarea value={content} onChange={e => setContent(e.target.value)} rows={12} className="input-field resize-none text-xs leading-relaxed" />
          </div>

          </fieldset>

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

          {saveError && <p role="alert" className="text-red-400 text-xs font-body">{saveError}</p>}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            {(hasOverrides || resetSaved) && (
              <button onClick={handleResetClick} disabled={resetting || saving || saveSuccess} className={`btn-ghost flex items-center gap-2 ${confirmReset ? 'text-red-400 border-red-400/30' : 'text-faint'}`}>
                {resetting ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                {resetSaved ? 'Retry refresh' : confirmReset ? 'Click again to reset' : 'Reset to original'}
              </button>
            )}
            <div className="flex-1" />
            <button onClick={handleClose} disabled={saving || resetting} className="btn-ghost">Cancel</button>
            <button onClick={handleSave} disabled={saving || resetting || resetSaved || saveSuccess} className={`btn-primary flex items-center gap-2 ${saveSuccess ? 'bg-green-500 hover:bg-green-500' : ''}`}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : saveSuccess ? <Check size={14} /> : <Save size={14} />}
              {saveSuccess ? 'Saved!' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
