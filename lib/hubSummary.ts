import type { HubSummary, RecipesData } from './hub-contract'
import { addCivilDays, hubPeriodLabel, newYorkWeek } from './hubDates'
import { recipeUrl, SITE_URL } from './recipeUrl'
import { normalizePlanned, type PlannedElement } from './weekPlanNormalize'

export interface HubWeekPlan {
  plannedRecipeIDs?: PlannedElement[]
  cookedRecipeIDs?: string[]
}

export interface HubRecipe {
  title?: string
  category?: string | null
}

export interface OmissionCounts {
  outsideWeek: number
  missingRecipe: number
  missingTitle: number
}

/** Counts are per omitted entry; outside-week entries are counted first. No I/O. */
export function buildRecipesSummary({ weekPlan, recipesById, now }: {
  weekPlan: HubWeekPlan | null
  recipesById: ReadonlyMap<string, HubRecipe>
  now: Date
}): [HubSummary<RecipesData>, OmissionCounts] {
  const { monday } = newYorkWeek(now)
  const data: RecipesData = {
    days: Array.from({ length: 7 }, (_, i) => ({ date: addCivilDays(monday, i), meals: [] })),
    unscheduled: [],
  }
  const counts: OmissionCounts = { outsideWeek: 0, missingRecipe: 0, missingTitle: 0 }
  const cooked = new Set(weekPlan?.cookedRecipeIDs || [])
  const entries = normalizePlanned(weekPlan?.plannedRecipeIDs, id => recipesById.get(id)?.category)
  // Array.sort is stable; entries retain their original order within each role.
  entries.sort((a, b) => Number(a.role === 'side') - Number(b.role === 'side'))
  for (const entry of entries) {
    const day = data.days.find(day => day.date === entry.day)
    if (entry.day !== null && !day) {
      counts.outsideWeek++
      continue
    }
    const recipe = recipesById.get(entry.recipeID)
    if (!recipe) {
      counts.missingRecipe++
      continue
    }
    if (typeof recipe.title !== 'string' || !recipe.title.trim()) {
      counts.missingTitle++
      continue
    }
    const meal = { name: recipe.title, url: recipeUrl(entry.recipeID), role: entry.role }
    if (day) day.meals.push({ ...meal, cooked: cooked.has(entry.recipeID) })
    else data.unscheduled.push(meal)
  }
  return [{
    status: 'ok', app: 'recipes', generatedAt: now.toISOString(),
    periodLabel: hubPeriodLabel(monday), appUrl: `${SITE_URL}/plan`, data,
  }, counts]
}
