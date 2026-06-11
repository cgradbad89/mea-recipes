'use client'

import { useState } from 'react'
import { Flame, ShieldCheck, AlertTriangle, Loader2 } from 'lucide-react'
import type { RecipeNutrition } from '@/types/recipe'
import { useAuth } from '@/lib/AuthContext'
import { computeAndStoreNutrition } from '@/lib/recipes'
import {
  NUTRIENTS,
  formatNutrient,
  perServingFromTotal,
  trustBadge,
  servingsAssumed,
} from '@/lib/nutrition'

interface Props {
  nutrition?: RecipeNutrition
  recipeId?: string
  // Called with the freshly-computed nutrition after a manual "Calculate nutrition".
  onCalculated?: (nutrition: RecipeNutrition) => void
}

export default function NutritionSection({ nutrition, recipeId, onCalculated }: Props) {
  const { user } = useAuth()
  const [calculating, setCalculating] = useState(false)
  const [calcError, setCalcError] = useState('')

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

  // Prefer freshly-derived per-serving values from the durable total; fall back to
  // the stored per-serving fields if total is unavailable.
  const derived = perServingFromTotal(nutrition.total, nutrition.servings)
  const perServing = derived || {
    calories: nutrition.calories,
    protein_g: nutrition.protein_g,
    carbs_g: nutrition.carbs_g,
    fat_g: nutrition.fat_g,
    fiber_g: nutrition.fiber_g,
    sugar_g: nutrition.sugar_g,
  }

  const assumed = servingsAssumed(nutrition)
  const sizeLabel = nutrition.serving_size ||
    (nutrition.servings ? `1 of ${nutrition.servings}` : '')

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

        {/* Macro grid */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
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

        {/* Assumed-servings caveat */}
        {assumed && (
          <p className="text-amber/70 text-xs font-body mt-4 flex items-center gap-1.5">
            <AlertTriangle size={12} className="shrink-0" />
            Servings were assumed — set the real count in edit mode to correct these values.
          </p>
        )}
      </div>
    </section>
  )
}
