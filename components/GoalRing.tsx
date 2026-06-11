'use client'

// Single hand-built SVG goal ring (Today view). No charting dependency — the
// app has no existing ring/gauge pattern, so this is a plain <circle> arc.
// Primary number = remaining (counts down toward the goal). Floor/ceiling
// colour logic per the nutrition spec (Surface 4):
//   - ceilings (calories, carbs, fat, sugar): over the goal → red.
//   - floors (protein, fiber): behind the day's pace → red; goal met → green.

import { formatNutrient } from '@/lib/nutrition'
import type { NutritionMacros } from '@/types/recipe'

export type RingKind = 'floor' | 'ceiling'

const COLORS = { amber: '#E8A838', red: '#EF4444', green: '#10B981', track: '#2E2820' }

interface Props {
  nutrientKey: keyof NutritionMacros
  label: string
  unit: string
  consumed: number
  goal: number              // 0 / non-finite → no target set for this nutrient
  kind: RingKind
  elapsedFraction: number   // 0–1 of the day elapsed, for floor pacing
}

export default function GoalRing({
  nutrientKey, label, unit, consumed, goal, kind, elapsedFraction,
}: Props) {
  const hasGoal = goal > 0 && Number.isFinite(goal)
  const remaining = hasGoal ? goal - consumed : 0

  let color = COLORS.amber
  let status = ''
  if (hasGoal) {
    if (kind === 'ceiling') {
      if (consumed > goal) { color = COLORS.red; status = 'over' }
      else { color = COLORS.amber; status = 'left' }
    } else {
      if (consumed >= goal) { color = COLORS.green; status = 'goal met' }
      else if (consumed < goal * elapsedFraction) { color = COLORS.red; status = 'left' }
      else { color = COLORS.amber; status = 'left' }
    }
  }

  const size = 92
  const stroke = 8
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const frac = hasGoal ? Math.min(consumed / goal, 1) : 0
  const offset = circ * (1 - frac)
  const primary = hasGoal ? formatNutrient(nutrientKey, Math.abs(remaining)) : '—'

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={COLORS.track} strokeWidth={stroke} />
          {hasGoal && (
            <circle
              cx={size / 2} cy={size / 2} r={r} fill="none"
              stroke={color} strokeWidth={stroke} strokeLinecap="round"
              strokeDasharray={circ} strokeDashoffset={offset}
              style={{ transition: 'stroke-dashoffset 0.5s ease, stroke 0.3s ease' }}
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-2xl text-cream font-light leading-none">{primary}</span>
          {hasGoal && unit && <span className="text-faint text-[9px] font-body leading-none mt-0.5">{unit}</span>}
        </div>
      </div>
      <p className="text-cream text-xs font-body font-medium mt-2">{label}</p>
      {hasGoal ? (
        <>
          <p className="text-[10px] font-body leading-none mt-1" style={{ color }}>{status}</p>
          <p className="text-faint text-[10px] font-body mt-0.5">
            {formatNutrient(nutrientKey, consumed)} / {formatNutrient(nutrientKey, goal)}{unit}
          </p>
        </>
      ) : (
        <p className="text-faint text-[10px] font-body mt-1">no goal</p>
      )}
    </div>
  )
}
