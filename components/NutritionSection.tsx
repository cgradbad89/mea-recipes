'use client'

import { useState, useEffect } from 'react'
import { Flame, ShieldCheck, AlertTriangle, Loader2, Minus, Plus, RotateCcw } from 'lucide-react'
import type { RecipeNutrition } from '@/types/recipe'
import { useAuth } from '@/lib/AuthContext'
import { computeAndStoreNutrition } from '@/lib/recipes'
import {
  NUTRIENTS,
  formatNutrient,
  perServingFromTotal,
  perServingOf,
  trustBadge,
  servingsAssumed,
} from '@/lib/nutrition'

interface Props {
  nutrition?: RecipeNutrition
  recipeId?: string
  // This viewer's personal servings override (meta.overrides.servings), if set.
  // Scoped to their uid — it never touches the shared recipe doc.
  overrideServings?: number
  // Persist / clear this user's personal servings override (null clears it,
  // falling back to the shared recipe default).
  onSetOverrideServings?: (servings: number | null) => void
  // Called with the freshly-computed nutrition after a manual "Calculate nutrition".
  onCalculated?: (nutrition: RecipeNutrition) => void
}

export default function NutritionSection({
  nutrition,
  recipeId,
  overrideServings,
  onSetOverrideServings,
  onCalculated,
}: Props) {
  const { user } = useAuth()
  const [calculating, setCalculating] = useState(false)
  const [calcError, setCalcError] = useState('')

  // Local, live serving-size state for THIS viewer. Seeded from the persisted
  // override, else the shared default. Drives the per-serving macros live as the
  // user edits — the shared recipe doc is never mutated by this.
  const defaultServings = nutrition?.servings
  const [servingsInput, setServingsInput] = useState<string>(
    String(overrideServings ?? defaultServings ?? ''),
  )
  useEffect(() => {
    setServingsInput(String(overrideServings ?? defaultServings ?? ''))
  }, [overrideServings, defaultServings])

  // Manual fix-path for recipes whose auto-nutrition failed/timed out (or were
  // never computed): re-runs the engine on demand and writes the result.
  const handleCalculate = async () => {
    if (!recipeId || !user || calculating) return
    setCalculating(true)
    setCalcError('')
    try {
      const token = await user.getIdToken()
      // Give the user-initiated retry a longer window than the publish guard.
      const result = await computeAndStoreNutrition(recipeId, token, 45000)
      if (result) onCalculated?.(result)
      else setCalcError('Could not calculate nutrition — please try again.')
    } catch {
      setCalcError('Could not calculate nutrition — please try again.')
    } finally {
      setCalculating(false)
    }
  }

  // Empty state — no nutrition object on the recipe yet.
  if (!nutrition) {
    return (
      <section className="mb-8">
        <h2 className="font-display text-2xl text-cream font-light mb-4 flex items-center gap-2">
          <Flame size={20} className="text-amber" /> Nutrition
        </h2>
        <div className="bg-surface border border-border rounded-2xl p-5">
          <p className="text-faint text-sm font-body mb-4">No nutrition data yet.</p>
          {recipeId && user && (
            <button
              onClick={handleCalculate}
              disabled={calculating}
              className="btn-primary inline-flex items-center gap-2 text-xs disabled:opacity-60"
            >
              {calculating ? <Loader2 size={13} className="animate-spin" /> : <Flame size={13} />}
              {calculating ? 'Calculating nutrition…' : 'Calculate nutrition'}
            </button>
          )}
          {calcError && <p className="text-red-400 text-xs font-body mt-3">{calcError}</p>}
        </div>
      </section>
    )
  }

  const hasTotal = !!nutrition.total
  const hasOverride =
    typeof overrideServings === 'number' && Number.isFinite(overrideServings) && overrideServings > 0
  // The override only counts as "active" (differing from the shared default) when
  // it actually changes the divisor — so resetting to the default clears the UI.
  const overrideActive = hasOverride && (defaultServings == null || overrideServings !== defaultServings)

  // Live effective servings the macros below are derived from.
  const parsed = Number(servingsInput)
  const parsedValid = servingsInput.trim() !== '' && Number.isFinite(parsed) && parsed > 0
  const liveServings = parsedValid ? parsed : overrideServings ?? defaultServings

  // Per-serving for this viewer — live from the durable whole-recipe total
  // ÷ liveServings; falls back to the recipe's stored per-serving basis when no
  // total exists (an override can't be honored without the total).
  const derived = hasTotal ? perServingFromTotal(nutrition.total, liveServings) : null
  const perServing =
    derived ||
    perServingOf(nutrition) || {
      calories: nutrition.calories,
      protein_g: nutrition.protein_g,
      carbs_g: nutrition.carbs_g,
      fat_g: nutrition.fat_g,
      fiber_g: nutrition.fiber_g,
      sugar_g: nutrition.sugar_g,
    }

  // ─── Per-user servings control plumbing ──────────────────────────────────────
  // Persist a value (or clear the override when it equals the shared default).
  const commitServings = (value: number | null) => {
    if (value == null || (defaultServings != null && value === defaultServings)) {
      onSetOverrideServings?.(null)
    } else {
      onSetOverrideServings?.(value)
    }
  }
  const commitInput = () => {
    if (parsedValid) commitServings(parsed)
    else setServingsInput(String(overrideServings ?? defaultServings ?? '')) // revert junk
  }
  const step = (delta: number) => {
    const base = parsedValid ? parsed : overrideServings ?? defaultServings ?? 1
    const next = Math.max(1, Math.round(base + delta))
    setServingsInput(String(next))
    commitServings(next)
  }
  const resetToDefault = () => {
    setServingsInput(String(defaultServings ?? ''))
    onSetOverrideServings?.(null)
  }

  // ─── Confidence + assumed-servings affordances ───────────────────────────────
  // Confidence is PER-RECIPE (nutrition.confidence: high|medium|low), not
  // per-field — so we gate at the section level: dim the whole macro block once.
  // A user-supplied serving count resolves the assumed-servings basis behind a
  // 'low' recipe rating, so we stop dimming once they've personalized servings.
  const isLowConfidence = (nutrition.confidence || '').toLowerCase() === 'low'
  const dimMacros = isLowConfidence && !overrideActive
  // "Servings were assumed" is moot once THIS user has set their own real count.
  const assumed = servingsAssumed(nutrition) && !overrideActive

  const sizeLabel = liveServings ? `1 of ${liveServings}` : nutrition.serving_size || ''

  return (
    <section className="mb-8">
      <h2 className="font-display text-2xl text-cream font-light mb-4 flex items-center gap-2">
        <Flame size={20} className="text-amber" /> Nutrition
      </h2>
      <div className="bg-surface border border-border rounded-2xl p-5">
        {/* Per-serving header + trust badge */}
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <p className="text-faint text-xs font-body uppercase tracking-widest">
            Per serving{sizeLabel ? ` · ${sizeLabel}` : ''}
          </p>
          <span
            className="tag-amber inline-flex items-center gap-1.5"
            title={`Source: ${nutrition.source || 'unknown'} · Confidence: ${nutrition.confidence || 'unknown'}`}
          >
            <ShieldCheck size={11} /> {trustBadge(nutrition)}
          </span>
        </div>

        {/* Per-user servings control — writes THIS user's override, not the shared
            recipe. Only shown when a whole-recipe total exists to divide. */}
        {hasTotal && (
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-faint text-[11px] font-body uppercase tracking-wide">
                Your serving size
              </span>
              <div className="inline-flex items-center rounded-lg border border-border bg-card overflow-hidden">
                <button
                  type="button"
                  onClick={() => step(-1)}
                  disabled={(liveServings ?? 1) <= 1}
                  aria-label="Decrease servings"
                  className="px-2 py-1.5 text-faint hover:text-cream disabled:opacity-40 transition-colors"
                >
                  <Minus size={13} />
                </button>
                <input
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  value={servingsInput}
                  onChange={e => setServingsInput(e.target.value)}
                  onBlur={commitInput}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                  aria-label="Your serving size"
                  className="w-12 bg-transparent text-center text-cream font-body text-sm focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <button
                  type="button"
                  onClick={() => step(1)}
                  aria-label="Increase servings"
                  className="px-2 py-1.5 text-faint hover:text-cream transition-colors"
                >
                  <Plus size={13} />
                </button>
              </div>
            </div>
            {defaultServings != null && (
              <div className="flex items-center gap-2 text-[11px] font-body text-faint">
                {overrideActive ? (
                  <>
                    <span>recipe default: {defaultServings}</span>
                    <button
                      type="button"
                      onClick={resetToDefault}
                      className="inline-flex items-center gap-1 text-amber/80 hover:text-amber transition-colors"
                    >
                      <RotateCcw size={11} /> Reset
                    </button>
                  </>
                ) : (
                  <span>recipe default</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Macro grid — dimmed when this is a low-confidence estimate (Task B). */}
        <div className={`grid grid-cols-3 sm:grid-cols-6 gap-3 transition-opacity ${dimMacros ? 'opacity-50' : ''}`}>
          {NUTRIENTS.map(({ key, label, unit }) => (
            <div key={key} className="text-center">
              <p className="font-display text-2xl text-cream font-light leading-none">
                {formatNutrient(key, perServing[key])}
                {unit && <span className="text-sm text-faint ml-0.5">{unit}</span>}
              </p>
              <p className="text-faint text-[11px] font-body uppercase tracking-wide mt-1.5">
                {label}
              </p>
            </div>
          ))}
        </div>

        {/* One warning, section-level (confidence is per-recipe). Low-confidence
            dim takes precedence over the assumed-servings caveat. */}
        {dimMacros ? (
          <p
            className="text-amber/70 text-xs font-body mt-4 flex items-center gap-1.5"
            title="This recipe's nutrition is a low-confidence estimate — the underlying servings or ingredient matches couldn't be verified."
          >
            <AlertTriangle size={12} className="shrink-0" />
            Low-confidence estimate — may be inaccurate.{defaultServings != null ? ' Set your serving size above to refine the per-serving values.' : ''}
          </p>
        ) : assumed ? (
          <p className="text-amber/70 text-xs font-body mt-4 flex items-center gap-1.5">
            <AlertTriangle size={12} className="shrink-0" />
            Servings were assumed — set your serving size above to correct these values.
          </p>
        ) : null}
      </div>
    </section>
  )
}
