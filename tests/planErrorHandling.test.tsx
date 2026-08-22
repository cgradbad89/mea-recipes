// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const mocks = vi.hoisted(() => {
  const user = {
    uid: 'user-1',
    displayName: 'Meal Planner',
    email: 'planner@example.com',
    photoURL: '',
  }
  const recipe = {
    id: 'recipe-1',
    title: 'Test Recipe',
    content: '',
    category: 'Dinner',
    cuisine: 'Italian',
    imageURL: '',
  }
  const plan = {
    weekID: '2026-08-17',
    weekStartISO: '2026-08-17',
    plannedRecipeIDs: [{ recipeID: recipe.id, day: null, role: 'main' as const }],
    cookedRecipeIDs: [],
  }
  return {
    user,
    recipe,
    plan,
    setPlannedRecipeRole: vi.fn(),
    refetchRecipes: vi.fn().mockResolvedValue(undefined),
    refetchMetas: vi.fn().mockResolvedValue(undefined),
    refetchCookingHistory: vi.fn().mockResolvedValue(undefined),
  }
})

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ user: mocks.user }),
}))

vi.mock('@/components/AppDataProvider', () => ({
  useAppData: () => ({
    recipes: [mocks.recipe],
    recipesLoading: false,
    recipesError: null,
    metas: {},
    metasError: null,
    cookingHistoryError: null,
    refetchRecipes: mocks.refetchRecipes,
    refetchMetas: mocks.refetchMetas,
    refetchCookingHistory: mocks.refetchCookingHistory,
  }),
}))

vi.mock('@/lib/firebase', () => ({ db: {} }))

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({})),
  getDocs: vi.fn().mockResolvedValue({ docs: [] }),
}))

vi.mock('@/lib/userdata', () => ({
  subscribeWeekPlan: (_uid: string, _weekID: string, onData: (plan: unknown) => void) => {
    onData(mocks.plan)
    return vi.fn()
  },
  subscribeSharedWeekPlans: (_weekID: string, _uid: string, onData: (plans: unknown[]) => void) => {
    onData([])
    return vi.fn()
  },
  weekIDFromDate: () => '2026-08-17',
  getWeekPlan: vi.fn().mockResolvedValue(null),
  publishSharedPlan: vi.fn().mockResolvedValue(undefined),
  normalizePlanned: (entries?: unknown[]) => entries || [],
  plannedRecipeIDList: (entries?: Array<{ recipeID: string }>) => (entries || []).map(entry => entry.recipeID),
  resolveRecipeRole: () => 'main',
  setPlannedRecipeRole: mocks.setPlannedRecipeRole,
  removeRecipeFromWeekPlan: vi.fn(),
  markRecipeCooked: vi.fn(),
  addRecipeIngredientsToGrocery: vi.fn(),
  moveRecipeToWeek: vi.fn(),
  saveRecipeMeta: vi.fn(),
  getRecipeMeta: vi.fn(),
  rebuildGroceryFromPlan: vi.fn(),
  addRecipeToWeekPlan: vi.fn(),
  assignRecipeToDay: vi.fn(),
  saveCalendarEventIds: vi.fn(),
}))

vi.mock('@/lib/recipes', () => ({
  parseRecipeContent: vi.fn(() => ({ ingredients: [] })),
  getRecipeById: vi.fn(),
  recipeUrl: (id: string) => `/recipes/${id}`,
}))

vi.mock('@/lib/googleCalendar', () => ({ runCalendarPush: vi.fn() }))
vi.mock('@/lib/consumptionLog', () => ({
  logCookEvent: vi.fn(),
  getTodayCookEventForRecipe: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/nutrition', () => ({ perServingForViewer: vi.fn() }))
vi.mock('@/components/RecipeImage', () => ({ default: () => <div data-testid="recipe-image" /> }))

import PlanPage from '@/app/plan/page'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('plan write errors', () => {
  it('renders an inline message when changing a planned recipe role fails', async () => {
    mocks.setPlannedRecipeRole.mockRejectedValueOnce(new Error('offline'))
    render(<PlanPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Test Recipe — open actions' }))
    fireEvent.click(await screen.findByRole('button', { name: /side/i }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Couldn’t change that recipe’s role')
  })
})
