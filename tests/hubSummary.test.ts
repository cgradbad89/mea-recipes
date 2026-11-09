import { describe, expect, it } from 'vitest'
import { addCivilDays, newYorkWeek } from '@/lib/hubDates'
import { buildRecipesSummary, type HubWeekPlan } from '@/lib/hubSummary'
import { normalizePlanned, normalizePlannedEntry, type PlannedElement } from '@/lib/weekPlanNormalize'

const now = new Date('2026-11-05T15:00:00Z')
const recipesById = new Map([
  ['main-a', { title: 'Main A', category: 'Chicken & Poultry' }],
  ['main-b', { title: 'Main B', category: 'Beef & Pork' }],
  ['side-a', { title: 'Side A', category: 'Sides' }],
  ['side-b', { title: 'Side B', category: 'Sauces & Condiments' }],
  ['untitled', { category: 'Sides' }],
  ['blank', { title: '  ' }],
])
function build(weekPlan: HubWeekPlan | null, at = now) {
  const [summary, counts] = buildRecipesSummary({ weekPlan, recipesById, now: at })
  if (summary.status !== 'ok') throw new Error('Expected an ok summary')
  return { ...summary, counts }
}

describe('New York hub dates', () => {
  it.each([
    ['Sunday 11pm EST', '2026-11-09T04:00:00Z', '2026-11-08', '2026-11-02'],
    ['Monday 12:30am EST', '2026-11-09T05:30:00Z', '2026-11-09', '2026-11-09'],
    ['Sunday 11pm EDT', '2026-07-06T03:00:00Z', '2026-07-05', '2026-06-29'],
    ['Monday 12:30am EDT', '2026-07-06T04:30:00Z', '2026-07-06', '2026-07-06'],
    ['year crossing', '2027-01-01T15:00:00Z', '2027-01-01', '2026-12-28'],
  ])('%s resolves the civil date and Monday', (_label, value, today, monday) => {
    expect(newYorkWeek(new Date(value))).toEqual({ today, monday })
  })
  it.each([
    ['2026-03-08T16:00:00Z', '2026-03-02'],
    ['2026-11-01T17:00:00Z', '2026-10-26'],
  ])('returns seven distinct dates across DST (%s)', (value, monday) => {
    const dates = build(null, new Date(value)).data.days.map(day => day.date)
    expect(dates).toEqual(Array.from({ length: 7 }, (_, i) => addCivilDays(monday, i)))
    expect(new Set(dates).size).toBe(7)
  })
})

describe('buildRecipesSummary', () => {
  it('returns seven empty Monday–Sunday days for an absent week', () => {
    const result = build(null)
    expect(result.data).toEqual({ days: [
      '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05',
      '2026-11-06', '2026-11-07', '2026-11-08',
    ].map(date => ({ date, meals: [] })), unscheduled: [] })
    expect(result.generatedAt).toBe(now.toISOString())
    expect(result.app).toBe('recipes')
    expect(result.appUrl).toBe('https://mea-recipes.vercel.app/plan')
    expect(result.periodLabel).toBe('Nov 2 to Nov 8')
    expect(result.counts).toEqual({ outsideWeek: 0, missingRecipe: 0, missingTitle: 0 })
  })
  it('places legacy strings and null days in unscheduled with no cooked property', () => {
    const result = build({ plannedRecipeIDs: ['side-a', { recipeID: 'main-a', day: null, role: 'main' }], cookedRecipeIDs: ['main-a'] })
    expect(result.data.unscheduled).toEqual([
      { name: 'Main A', url: 'https://mea-recipes.vercel.app/recipes/main-a', role: 'main' },
      { name: 'Side A', url: 'https://mea-recipes.vercel.app/recipes/side-a', role: 'side' },
    ])
    expect(result.data.days.every(day => day.meals.length === 0)).toBe(true)
  })
  it('sorts main before side stably and retains cooked meals', () => {
    const plannedRecipeIDs: PlannedElement[] = ['side-a', 'main-b', 'side-b', 'main-a'].map(recipeID => ({
      recipeID, day: '2026-11-03', role: recipeID.startsWith('side') ? 'side' : 'main',
    }))
    const result = build({ plannedRecipeIDs, cookedRecipeIDs: ['main-a', 'side-b'] })
    expect(result.data.days[1].meals.map(meal => [meal.name, meal.cooked])).toEqual([
      ['Main B', false], ['Main A', true], ['Side A', false], ['Side B', true],
    ])
  })
  it('honors stored roles and falls back to the recipe category for missing roles', () => {
    // Historical documents may lack role even though the current writer type requires it.
    const plannedRecipeIDs = [
      { recipeID: 'side-a', day: '2026-11-02', role: 'main' },
      { recipeID: 'side-b', day: '2026-11-02' },
    ] as PlannedElement[]
    expect(build({ plannedRecipeIDs }).data.days[0].meals.map(meal => meal.role)).toEqual(['main', 'side'])
  })
  it('omits missing recipes, absent/blank titles, and outside-week entries with separate counts', () => {
    const result = build({ plannedRecipeIDs: [
      'missing', 'untitled', 'blank',
      { recipeID: 'main-a', day: '2026-11-01', role: 'main' },
      { recipeID: 'side-a', day: '2026-11-09', role: 'side' },
      { recipeID: 'main-b', day: '2026-11-08', role: 'main' },
    ] })
    expect(result.counts).toEqual({ outsideWeek: 2, missingRecipe: 1, missingTitle: 2 })
    expect(result.data.unscheduled).toEqual([])
    expect(result.data.days.flatMap(day => day.meals).map(meal => meal.name)).toEqual(['Main B'])
  })
  it('does not mutate input arrays or entries', () => {
    const weekPlan: HubWeekPlan = { plannedRecipeIDs: ['side-a', 'main-a'], cookedRecipeIDs: ['side-a'] }
    const before = structuredClone(weekPlan)
    build(weekPlan)
    expect(weekPlan).toEqual(before)
  })
  it('preserves reserved slot values in the extracted normalizer', () => {
    expect(normalizePlannedEntry({ recipeID: 'main-a', day: null, role: 'main', slot: 'dinner' })).toEqual({
      recipeID: 'main-a', day: null, role: 'main', slot: 'dinner',
    })
    expect(normalizePlanned(undefined)).toEqual([])
  })
})
