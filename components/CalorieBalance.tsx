import { formatNutrient } from '@/lib/nutrition'

interface CalorieBalanceProps {
  consumed: number
  baselineCalories: number
  activeCalories: number
  hasActiveData: boolean
  activeDays?: number
  totalDays?: number
}

/** Shared calorie breakdown for Today and Insights. */
export default function CalorieBalance({
  consumed,
  baselineCalories,
  activeCalories,
  hasActiveData,
  activeDays,
  totalDays,
}: CalorieBalanceProps) {
  if (baselineCalories <= 0 && !hasActiveData) return null

  const burned = baselineCalories + activeCalories
  const coverage = typeof activeDays === 'number' && typeof totalDays === 'number'
    ? ` · active data ${activeDays}/${totalDays} days`
    : ''

  return (
    <div className="mt-5 pt-4 border-t border-border text-xs font-body text-muted">
      <div className="flex justify-center items-center gap-3 flex-wrap">
        <span>{Math.round(consumed)} consumed</span>
        <span>−</span>
        <span>{Math.round(burned)} burned</span>
        <span>=</span>
        <span className="text-cream font-medium">{Math.max(0, Math.round(consumed - burned))} net calories</span>
      </div>
      <p className="text-center text-faint mt-2">
        Baseline {formatNutrient('calories', baselineCalories)} · Active {hasActiveData ? formatNutrient('calories', activeCalories) : '—'}{coverage}
      </p>
      {!hasActiveData && (
        <p className="text-center text-amber/80 mt-1">Active calorie data is unavailable; net calories use the baseline only.</p>
      )}
    </div>
  )
}
