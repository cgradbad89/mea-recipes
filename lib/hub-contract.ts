export type HubSummary<T> = {
  status: 'ok'
  app: 'recipes'
  generatedAt: string
  periodLabel: string
  appUrl: string
  data: T
} | {
  status: 'unavailable'
  app: 'recipes'
  generatedAt: string
  reason: string
}

export type RecipesData = {
  days: {
    date: string
    meals: { name: string; url: string; role: 'main' | 'side'; cooked: boolean }[]
  }[] // always 7, Mon..Sun
  unscheduled: { name: string; url: string; role: 'main' | 'side' }[]
  /**
   * Additive (Hub Glance): the current grocery list's unchecked item count —
   * the Grocery page's "N items remaining". Not week-scoped. null when the
   * grocery list could not be read (the rest of the summary is still valid).
   */
  grocery: { toBuy: number } | null
}
