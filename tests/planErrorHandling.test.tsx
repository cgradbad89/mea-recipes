// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

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
    sharedPlan: null as null | {
      uid: string
      displayName: string
      photoURL: string
      plannedRecipeIDs: string[]
    },
    publishSharedPlan: vi.fn().mockResolvedValue(undefined),
    unpublishSharedPlan: vi.fn().mockResolvedValue(undefined),
    rebuildGroceryFromPlan: vi.fn().mockResolvedValue(undefined),
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
  subscribeSharedPlanPublication: (_uid: string, _weekID: string, onData: (plan: unknown) => void) => {
    onData(mocks.sharedPlan)
    return vi.fn()
  },
  weekIDFromDate: () => '2026-08-17',
  getWeekPlan: vi.fn().mockResolvedValue(null),
  publishSharedPlan: mocks.publishSharedPlan,
  unpublishSharedPlan: mocks.unpublishSharedPlan,
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
  rebuildGroceryFromPlan: mocks.rebuildGroceryFromPlan,
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
  undoCookEvent: vi.fn(),
  getTodayCookEventForRecipe: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/nutrition', () => ({ perServingForViewer: vi.fn() }))
vi.mock('@/components/RecipeImage', () => ({ default: () => <div data-testid="recipe-image" /> }))

import PlanPage from '@/app/plan/page'

beforeEach(() => {
  mocks.sharedPlan = null
  mocks.publishSharedPlan.mockReset().mockResolvedValue(undefined)
  mocks.unpublishSharedPlan.mockReset().mockResolvedValue(undefined)
  mocks.rebuildGroceryFromPlan.mockReset().mockResolvedValue(undefined)
  mocks.setPlannedRecipeRole.mockReset()
})

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

  it('keeps private plan edits private until the user explicitly publishes', async () => {
    render(<PlanPage />)

    expect(await screen.findByText('Shared plan: Private')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Test Recipe — open actions' }))
    fireEvent.click(await screen.findByRole('button', { name: /side/i }))
    await waitFor(() => expect(mocks.setPlannedRecipeRole).toHaveBeenCalled())
    expect(mocks.publishSharedPlan).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Publish plan' }))
    await waitFor(() => expect(mocks.publishSharedPlan).toHaveBeenCalledWith(
      'user-1',
      'Meal Planner',
      '',
      '2026-08-17',
      mocks.plan.plannedRecipeIDs,
    ))
  })

  it('shows a persisted publication and unpublishes only the signed-in user', async () => {
    mocks.sharedPlan = {
      uid: 'user-1',
      displayName: 'Meal Planner',
      photoURL: '',
      plannedRecipeIDs: ['recipe-1'],
    }
    render(<PlanPage />)

    expect(await screen.findByText('Shared plan: Published')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Unpublish' }))
    await waitFor(() => expect(mocks.unpublishSharedPlan).toHaveBeenCalledWith('user-1', '2026-08-17'))
  })

  it('keeps sharing failures visible without changing the private plan', async () => {
    mocks.publishSharedPlan.mockRejectedValueOnce(new Error('permission denied'))
    render(<PlanPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Publish plan' }))
    expect((await screen.findByRole('alert')).textContent).toContain('publishing its shared snapshot failed')
    expect(screen.getByText('Test Recipe')).toBeTruthy()
  })

  it('reports an atomic grocery rebuild abort and clears the pending state', async () => {
    mocks.rebuildGroceryFromPlan.mockRejectedValueOnce(new Error(
      'Rebuild stopped because a planned recipe could not be loaded. Your grocery list was not changed.',
    ))
    render(<PlanPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Rebuild grocery list' }))
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild' }))

    expect((await screen.findByRole('alert')).textContent).toContain('grocery list was not changed')
    expect(screen.getByRole('button', { name: 'Rebuild grocery list' }).getAttribute('disabled')).toBeNull()
  })
})
