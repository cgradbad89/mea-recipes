'use client'

import { Flame, ShieldCheck, AlertTriangle } from 'lucide-react'
import type { RecipeNutrition } from '@/types/recipe'
import {
  NUTRIENTS,
  formatNutrient,
  perServingFromTotal,
  trustBadge,
  servingsAssumed,
} from '@/lib/nutrition'

interface Props {
  nutrition?: RecipeNutrition
}

export default function NutritionSection({ nutrition }: Props) {
  // Empty state — no nutrition object on the recipe yet.
  if (!nutrition) {
    return (
      <section className="mb-8">
        <h2 className="font-display text-2xl text-cream font-light mb-4 flex items-center gap-2">
          <Flame size={20} className="text-amber" /> Nutrition
        </h2>
        <div className="bg-surface border border-border rounded-2xl p-5">
          <p className="text-faint text-sm font-body">No nutrition data yet.</p>
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
