'use client'

// Log-food entry sheet (Surface 3): three modes — USDA search / my recipes /
// manual macros — plus a recents+favorites quick row. Writes consumption_log
// entries with is_cook_event: false. NEVER touches the plan or cooked status
// (cooked capture is Cooking Mode / the plan checkmark — see lib/consumptionLog
// logCookEvent). In Session B this mounts in the Today view; until then a
// temporary entry button lives on the Recipes page.

import { useState, useEffect, useRef, useMemo } from 'react'
import { X, Search, Star, Loader2, Check, ChefHat, PencilLine } from 'lucide-react'
import { useAuth } from '@/lib/AuthContext'
import {
  addLogEntry, saveFavorite, getSavedFoods, getRecents, autoMealForTime, scaleMacros,
} from '@/lib/consumptionLog'
import { getAllRecipes } from '@/lib/recipes'
import { perServingOf, sourceLabel, NUTRIENTS, formatNutrient } from '@/lib/nutrition'
import type { Recipe, NutritionMacros } from '@/types/recipe'
import type { Meal, SavedFood, RecentFood } from '@/types/nutrition'

type Mode = 'search' | 'recipes' | 'manual'

interface FoodResult {
  name: string
  nutrition: NutritionMacros          // per serving
  source: 'usda' | 'ai_estimate'
  confidence?: string
}

const MEALS: Meal[] = ['breakfast', 'lunch', 'snack', 'dinner']

function MacroGrid({ macros }: { macros: NutritionMacros }) {
  return (
    <div className="grid grid-cols-3 gap-x-4 gap-y-1.5">
      {NUTRIENTS.map(n => (
        <div key={n.key} className="flex items-baseline justify-between gap-2">
          <span className="text-faint text-[11px] font-body">{n.label}</span>
          <span className="text-cream text-xs font-body font-medium">
            {formatNutrient(n.key, macros[n.key])}{n.unit}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function LogFoodSheet({ onClose, onLogged }: { onClose: () => void; onLogged?: () => void }) {
  const { user } = useAuth()
  const [mode, setMode] = useState<Mode>('search')

  // shared entry fields
  const [servingsInput, setServingsInput] = useState('1')
  const [meal, setMeal] = useState<Meal>(autoMealForTime())
  const [saving, setSaving] = useState(false)
  const [loggedOk, setLoggedOk] = useState(false)
  const [saveError, setSaveError] = useState('')

  // mode 1 — search
  const [query, setQuery] = useState('')
  const [lookupLoading, setLookupLoading] = useState(false)
  const [result, setResult] = useState<FoodResult | null>(null)
  const [lookupError, setLookupError] = useState('')
  const [starred, setStarred] = useState(false)
  const skipNextLookup = useRef(false)
  const lookupSeq = useRef(0)

  // mode 2 — my recipes
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [recipesLoading, setRecipesLoading] = useState(true)
  const [recipeQuery, setRecipeQuery] = useState('')
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null)

  // mode 3 — manual
  const [manualName, setManualName] = useState('')
  const [manualMacros, setManualMacros] = useState<Record<string, string>>({
    calories: '', protein_g: '', carbs_g: '', fat_g: '', fiber_g: '', sugar_g: '',
  })

  // recents + favorites quick row
  const [recents, setRecents] = useState<RecentFood[]>([])
  const [favorites, setFavorites] = useState<SavedFood[]>([])

  useEffect(() => {
    if (!user) return
    getRecents(user.uid, 5).then(setRecents).catch(() => {})
    getSavedFoods(user.uid).then(setFavorites).catch(() => {})
  }, [user])

  useEffect(() => {
    getAllRecipes()
      .then(list => setRecipes(list.filter(r => perServingOf(r.nutrition))))
      .finally(() => setRecipesLoading(false))
  }, [])

  // debounced USDA lookup (mode 1)
  useEffect(() => {
    if (mode !== 'search' || !user) return
    if (skipNextLookup.current) { skipNextLookup.current = false; return }
    const q = query.trim()
    setResult(null); setLookupError(''); setStarred(false)
    if (q.length < 2) { setLookupLoading(false); return }
    setLookupLoading(true)
    const seq = ++lookupSeq.current
    const t = setTimeout(async () => {
      try {
        const token = await user.getIdToken()
        const res = await fetch('/api/nutrition-lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ type: 'food', name: q }),
        })
        if (seq !== lookupSeq.current) return   // stale response — a newer query is in flight
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          throw new Error(d.error || 'Lookup failed')
        }
        const data = await res.json()
        setResult({
          name: data.name || q,
          nutrition: data.nutrition,
          source: data.source === 'ai_estimate' ? 'ai_estimate' : 'usda',
          confidence: data.confidence,
        })
      } catch (e: any) {
        if (seq === lookupSeq.current) setLookupError(e?.message || 'Lookup failed — try manual entry')
      } finally {
        if (seq === lookupSeq.current) setLookupLoading(false)
      }
    }, 500)
    return () => clearTimeout(t)
  }, [query, mode, user])

  const servings = parseFloat(servingsInput)
  const servingsValid = Number.isFinite(servings) && servings > 0

  const selectedRecipe = useMemo(
    () => recipes.find(r => r.id === selectedRecipeId) || null,
    [recipes, selectedRecipeId],
  )
  const selectedRecipePer = selectedRecipe ? perServingOf(selectedRecipe.nutrition) : null

  const filteredRecipes = useMemo(() => {
    const q = recipeQuery.trim().toLowerCase()
    const list = q ? recipes.filter(r => r.title.toLowerCase().includes(q)) : recipes
    return list.slice(0, 50)
  }, [recipes, recipeQuery])

  const manualPerServing: NutritionMacros | null = useMemo(() => {
    const num = (k: string) => {
      const v = manualMacros[k].trim()
      if (v === '') return 0
      const n = Number(v)
      return Number.isFinite(n) && n >= 0 ? n : NaN
    }
    const m = {
      calories: num('calories'), protein_g: num('protein_g'), carbs_g: num('carbs_g'),
      fat_g: num('fat_g'), fiber_g: num('fiber_g'), sugar_g: num('sugar_g'),
    }
    if (Object.values(m).some(v => Number.isNaN(v))) return null
    if (manualMacros.calories.trim() === '') return null   // calories is required
    return m
  }, [manualMacros])

  const canConfirm = servingsValid && !saving && (
    (mode === 'search' && !!result) ||
    (mode === 'recipes' && !!selectedRecipe && !!selectedRecipePer) ||
    (mode === 'manual' && manualName.trim().length > 0 && !!manualPerServing)
  )

  const handleConfirm = async () => {
    if (!user || !canConfirm) return
    setSaving(true)
    setSaveError('')
    try {
      if (mode === 'search' && result) {
        await addLogEntry(user.uid, {
          meal, type: 'quick_food', is_cook_event: false, recipe_id: null,
          name: result.name, servings_eaten: servings,
          nutrition: scaleMacros(result.nutrition, servings), source: result.source,
        })
      } else if (mode === 'recipes' && selectedRecipe && selectedRecipePer) {
        // leftover/eat-a-serving path: log only — plan & cooked state untouched
        await addLogEntry(user.uid, {
          meal, type: 'recipe', is_cook_event: false, recipe_id: selectedRecipe.id,
          name: selectedRecipe.title, servings_eaten: servings,
          nutrition: scaleMacros(selectedRecipePer, servings), source: 'recipe',
        })
      } else if (mode === 'manual' && manualPerServing) {
        await addLogEntry(user.uid, {
          meal, type: 'manual', is_cook_event: false, recipe_id: null,
          name: manualName.trim(), servings_eaten: servings,
          nutrition: scaleMacros(manualPerServing, servings), source: 'manual',
        })
      }
      setLoggedOk(true)
      onLogged?.()
      setTimeout(onClose, 700)
    } catch {
      setSaveError("Couldn't save the entry — try again.")
      setSaving(false)
    }
  }

  const handleStar = async () => {
    if (!user || !result || starred) return
    try {
      await saveFavorite(user.uid, { name: result.name, nutrition: result.nutrition, source: result.source })
      setStarred(true)
      getSavedFoods(user.uid).then(setFavorites).catch(() => {})
    } catch { /* non-fatal */ }
  }

  // recents/favorites chip tap → prefill the right mode
  const prefill = (item: { name: string; nutrition: NutritionMacros; source: string; type?: string; recipe_id?: string | null }) => {
    setSaveError('')
    if (item.type === 'recipe' && item.recipe_id) {
      setMode('recipes')
      setSelectedRecipeId(item.recipe_id)
      setRecipeQuery('')
      return
    }
    if (item.source === 'manual') {
      setMode('manual')
      setManualName(item.name)
      setManualMacros({
        calories: String(item.nutrition.calories), protein_g: String(item.nutrition.protein_g),
        carbs_g: String(item.nutrition.carbs_g), fat_g: String(item.nutrition.fat_g),
        fiber_g: String(item.nutrition.fiber_g), sugar_g: String(item.nutrition.sugar_g),
      })
      return
    }
    skipNextLookup.current = true
    setMode('search')
    setQuery(item.name)
    setResult({
      name: item.name,
      nutrition: item.nutrition,
      source: item.source === 'ai_estimate' ? 'ai_estimate' : 'usda',
    })
    setLookupError('')
  }

  const quickRow: { key: string; label: string; item: Parameters<typeof prefill>[0]; fav: boolean }[] = [
    ...favorites.map(f => ({ key: `fav-${f.id}`, label: f.name, item: f as any, fav: true })),
    ...recents
      .filter(r => !favorites.some(f => f.name.toLowerCase() === r.name.toLowerCase()))
      .map((r, i) => ({ key: `rec-${i}`, label: r.name, item: r as any, fav: false })),
  ]

  return (
    <div className="fixed inset-0 z-[95]">
      <div className="absolute inset-0 bg-ink/80 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className="absolute bottom-0 left-0 right-0 max-w-2xl mx-auto bg-surface border border-border rounded-t-3xl max-h-[88vh] flex flex-col animate-fade-in">
        {/* header */}
        <div className="shrink-0 px-5 pt-4 pb-3 flex items-center justify-between border-b border-border">
          <h2 className="font-display text-2xl text-cream font-light">Log food</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 rounded-full flex items-center justify-center bg-card border border-border text-faint hover:text-cream transition-all"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* recents + favorites quick row */}
          {quickRow.length > 0 && (
            <div className="mb-4">
              <p className="text-faint text-[10px] font-body uppercase tracking-widest mb-2">Recent & saved</p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {quickRow.map(({ key, label, item, fav }) => (
                  <button
                    key={key}
                    onClick={() => prefill(item)}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-card border border-border text-muted text-xs font-body hover:text-cream hover:border-amber/30 transition-all"
                  >
                    {fav && <Star size={10} className="text-amber" fill="currentColor" />}
                    <span className="max-w-[140px] truncate">{label}</span>
                    <span className="text-faint">{Math.round(item.nutrition.calories)} cal</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* mode pills */}
          <div className="flex gap-2 mb-4">
            {([
              { m: 'search' as Mode, label: 'Search food', icon: <Search size={13} /> },
              { m: 'recipes' as Mode, label: 'My recipes', icon: <ChefHat size={13} /> },
              { m: 'manual' as Mode, label: 'Manual', icon: <PencilLine size={13} /> },
            ]).map(({ m, label, icon }) => (
              <button
                key={m}
                onClick={() => { setMode(m); setSaveError('') }}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-body font-medium transition-all ${
                  mode === m ? 'bg-amber text-ink' : 'bg-card border border-border text-muted hover:text-cream'
                }`}
              >
                {icon} {label}
              </button>
            ))}
          </div>

          {/* mode 1 — search */}
          {mode === 'search' && (
            <div>
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder='Try "Big Mac", "greek yogurt", "pad thai"…'
                className="input-field mb-3"
                autoFocus
              />
              {lookupLoading && (
                <div className="flex items-center gap-2 text-faint text-sm font-body py-3">
                  <Loader2 size={14} className="animate-spin text-amber" /> Looking up…
                </div>
              )}
              {lookupError && !lookupLoading && (
                <p className="text-red-400 text-xs font-body py-2">{lookupError}</p>
              )}
              {result && !lookupLoading && (
                <div className="bg-card border border-border rounded-xl p-4 mb-1">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0">
                      <p className="text-cream text-sm font-body font-medium truncate">{result.name}</p>
                      <span className="inline-block mt-1 text-[10px] font-body px-2 py-0.5 rounded-md bg-amber/10 text-amber">
                        {sourceLabel(result.source)}{result.confidence ? ` · ${result.confidence}` : ''} · per serving
                      </span>
                    </div>
                    <button
                      onClick={handleStar}
                      aria-label="Save to favorites"
                      className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center border transition-all ${
                        starred ? 'bg-amber/15 border-amber/40 text-amber' : 'bg-surface border-border text-faint hover:text-amber'
                      }`}
                    >
                      <Star size={15} fill={starred ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                  <MacroGrid macros={result.nutrition} />
                </div>
              )}
            </div>
          )}

          {/* mode 2 — my recipes */}
          {mode === 'recipes' && (
            <div>
              <input
                type="text"
                value={recipeQuery}
                onChange={e => setRecipeQuery(e.target.value)}
                placeholder="Search your recipes…"
                className="input-field mb-3"
              />
              {recipesLoading ? (
                <div className="flex items-center gap-2 text-faint text-sm font-body py-3">
                  <Loader2 size={14} className="animate-spin text-amber" /> Loading recipes…
                </div>
              ) : filteredRecipes.length === 0 ? (
                <p className="text-faint text-sm font-body py-3">No recipes with nutrition data match.</p>
              ) : (
                <div className="max-h-44 overflow-y-auto rounded-xl border border-border divide-y divide-border mb-3">
                  {filteredRecipes.map(r => {
                    const per = perServingOf(r.nutrition)
                    const active = r.id === selectedRecipeId
                    return (
                      <button
                        key={r.id}
                        onClick={() => setSelectedRecipeId(r.id)}
                        className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors ${
                          active ? 'bg-amber/10' : 'bg-card hover:bg-surface'
                        }`}
                      >
                        <span className={`text-sm font-body truncate ${active ? 'text-amber' : 'text-cream'}`}>{r.title}</span>
                        <span className="text-faint text-xs font-body shrink-0">{per ? `${Math.round(per.calories)} cal` : ''}</span>
                      </button>
                    )
                  })}
                </div>
              )}
              {selectedRecipe && selectedRecipePer && (
                <div className="bg-card border border-border rounded-xl p-4">
                  <p className="text-cream text-sm font-body font-medium mb-1 truncate">{selectedRecipe.title}</p>
                  <span className="inline-block mb-3 text-[10px] font-body px-2 py-0.5 rounded-md bg-amber/10 text-amber">
                    recipe · per serving — logs as eaten, won&apos;t mark cooked
                  </span>
                  <MacroGrid macros={selectedRecipePer} />
                </div>
              )}
            </div>
          )}

          {/* mode 3 — manual */}
          {mode === 'manual' && (
            <div>
              <input
                type="text"
                value={manualName}
                onChange={e => setManualName(e.target.value)}
                placeholder="Food name"
                className="input-field mb-3"
                autoFocus
              />
              <div className="grid grid-cols-3 gap-2 mb-1">
                {NUTRIENTS.map(n => (
                  <label key={n.key} className="block">
                    <span className="text-faint text-[10px] font-body uppercase tracking-widest">
                      {n.label}{n.unit ? ` (${n.unit})` : ''}
                    </span>
                    <input
                      type="number"
                      min="0"
                      inputMode="decimal"
                      value={manualMacros[n.key]}
                      onChange={e => setManualMacros(prev => ({ ...prev, [n.key]: e.target.value }))}
                      placeholder={n.key === 'calories' ? 'required' : '0'}
                      className="input-field mt-1 text-sm"
                    />
                  </label>
                ))}
              </div>
              <p className="text-faint text-[11px] font-body">Values are per serving.</p>
            </div>
          )}

          {/* shared: servings + meal */}
          <div className="mt-4 flex flex-wrap items-end gap-4">
            <label className="block">
              <span className="text-faint text-[10px] font-body uppercase tracking-widest">Servings</span>
              <input
                type="number"
                min="0.25"
                step="0.25"
                inputMode="decimal"
                value={servingsInput}
                onChange={e => setServingsInput(e.target.value)}
                className="input-field mt-1 w-24 text-sm"
              />
            </label>
            <div>
              <span className="text-faint text-[10px] font-body uppercase tracking-widest">Meal</span>
              <div className="flex gap-1.5 mt-1">
                {MEALS.map(m => (
                  <button
                    key={m}
                    onClick={() => setMeal(m)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-body capitalize transition-all ${
                      meal === m ? 'bg-amber text-ink' : 'bg-card border border-border text-muted hover:text-cream'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* footer */}
        <div className="shrink-0 px-5 py-4 border-t border-border">
          {saveError && <p className="text-red-400 text-xs font-body mb-2">{saveError}</p>}
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-40"
          >
            {loggedOk ? (<><Check size={16} /> Logged!</>) :
              saving ? (<><Loader2 size={16} className="animate-spin" /> Saving…</>) :
              'Log it'}
          </button>
        </div>
      </div>
    </div>
  )
}
