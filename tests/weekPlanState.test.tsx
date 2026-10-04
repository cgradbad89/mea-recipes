// @vitest-environment jsdom

import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Recipe } from '@/types/recipe'
import type { SharedPlanEntry, WeekPlan } from '@/lib/userdata'

type Subscription<T> = {
  uid: string
  weekID: string
  data: (value: T) => void
  error: (error: Error) => void
  stop: ReturnType<typeof vi.fn>
}
const mocks = vi.hoisted(() => ({
  user: {
    uid: 'owner-a', displayName: 'Owner A', email: 'owner@example.test', photoURL: '',
    getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} }),
  } as {
    uid: string; displayName: string; email: string; photoURL: string; getIdTokenResult: ReturnType<typeof vi.fn>
  } | null,
  plans: [] as Subscription<WeekPlan | null>[],
  publications: [] as Subscription<SharedPlanEntry | null>[],
  friends: [] as Subscription<SharedPlanEntry[]>[],
  getWeekPlan: vi.fn(),
  addRecipeToWeekPlan: vi.fn(),
  recipes: ['a', 'b'].map(id => ({
    id: `recipe-${id}`, recipeID: `recipe-${id}`, title: `Recipe ${id.toUpperCase()}`,
    content: 'INGREDIENTS\n1 onion\n\nINSTRUCTIONS\nCook.', category: 'Dinner',
    cuisine: 'test', imageURL: '', sourceURL: '', sourceFile: '', labels: '',
    hasImage: 'false', created: '', modified: '',
  })) as Recipe[],
}))

vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }))
vi.mock('@/components/AppDataProvider', () => ({ useAppData: () => ({
  recipes: mocks.recipes, recipesLoading: false, recipesError: null,
  metas: {}, metasError: null, favoritesError: null, cookingHistoryError: null,
  refetchRecipes: vi.fn(), refetchMetas: vi.fn(), refetchCookingHistory: vi.fn(), refetchFavorites: vi.fn(),
  isFavorite: () => false, toggleFavorite: vi.fn(), isWantToTry: () => false, toggleWantToTry: vi.fn(),
}) }))
vi.mock('@/lib/firebase', () => ({ db: {} }))
vi.mock('@/lib/userdata', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/userdata')>(),
  getWeekPlan: mocks.getWeekPlan,
  addRecipeToWeekPlan: mocks.addRecipeToWeekPlan,
  subscribeWeekPlan: (uid: string, weekID: string, data: Subscription<WeekPlan | null>['data'], error: Subscription<WeekPlan | null>['error']) => {
    const stop = vi.fn()
    mocks.plans.push({ uid, weekID, data, error, stop })
    return stop
  },
  subscribeSharedPlanPublication: (uid: string, weekID: string, data: Subscription<SharedPlanEntry | null>['data'], error: Subscription<SharedPlanEntry | null>['error']) => {
    const stop = vi.fn()
    mocks.publications.push({ uid, weekID, data, error, stop })
    data(null)
    return stop
  },
  subscribeSharedWeekPlans: (weekID: string, uid: string, data: Subscription<SharedPlanEntry[]>['data'], error: Subscription<SharedPlanEntry[]>['error']) => {
    const stop = vi.fn()
    mocks.friends.push({ uid, weekID, data, error, stop })
    data([])
    return stop
  },
}))
vi.mock('@/lib/recipes', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/recipes')>(),
  getRecipeById: vi.fn(async () => mocks.recipes[0]),
}))
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'recipe-a' }), useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}))
vi.mock('@/lib/googleCalendar', () => ({ runCalendarPush: vi.fn() }))
vi.mock('@/lib/consumptionLog', () => ({
  logCookEvent: vi.fn(), undoCookEvent: vi.fn(), getTodayCookEventForRecipe: vi.fn(),
}))
vi.mock('@/components/RecipeImage', () => ({ default: () => <div />, getCategoryIcon: () => null }))
vi.mock('@/components/NutritionSection', () => ({ default: () => null }))
vi.mock('@/components/CookingMode', () => ({ default: () => null }))
vi.mock('@/components/SignInOptions', () => ({ default: () => <div>Sign-in options</div> }))

import PlanPage from '@/app/plan/page'
import DetailPage from '@/app/recipes/[id]/page'
import RecipeCard from '@/components/RecipeCard'

const current = '2026-09-28'
const next = '2026-10-05'
const previous = '2026-09-21'
function plan(weekID: string, recipeID = 'recipe-a'): WeekPlan {
  return { weekID, weekStartISO: weekID, plannedRecipeIDs: [{ recipeID, day: null, role: 'main' }], cookedRecipeIDs: [] }
}
function subscription(weekID = current, uid = 'owner-a') {
  const found = mocks.plans.findLast(entry => entry.weekID === weekID && entry.uid === uid)
  if (!found) throw new Error(`Missing ${uid}/${weekID} subscription`)
  return found
}
function emit(weekID: string, value: WeekPlan | null, uid = 'owner-a') {
  act(() => subscription(weekID, uid).data(value))
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function pendingDefault() {
  const cur = deferred<WeekPlan | null>()
  const nxt = deferred<WeekPlan | null>()
  mocks.getWeekPlan.mockImplementation((_uid: string, week: string) => week === current ? cur.promise : nxt.promise)
  return { cur, nxt }
}
async function finishDefault(check: ReturnType<typeof pendingDefault>, cur: WeekPlan | null = null, nxt: WeekPlan | null = plan(next)) {
  await act(async () => { check.cur.resolve(cur); check.nxt.resolve(nxt) })
}
function expectWeek(weekID: string) {
  expect(sessionStorage.getItem('mea_plan_last_week')).toBe(weekID)
  const labels: Record<string, string> = {
    [current]: 'Sep 28 – Oct 4', [next]: 'Oct 5 – Oct 11',
    [previous]: 'Sep 21 – Sep 27', '2026-10-12': 'Oct 12 – Oct 18',
  }
  expect(screen.getByText(labels[weekID])).toBeTruthy()
}
function expectPending() {
  expect(screen.getByText('Loading meal plan…')).toBeTruthy()
  expect(screen.queryByText('No recipes planned this week')).toBeNull()
  expect(screen.queryByText('Recipe A')).toBeNull()
  expect(screen.queryByText('Recipe B')).toBeNull()
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 4, 20, 30))
  sessionStorage.clear()
  mocks.user = {
    uid: 'owner-a', displayName: 'Owner A', email: 'owner@example.test', photoURL: '',
    getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} }),
  }
  mocks.plans.length = mocks.publications.length = mocks.friends.length = 0
  mocks.getWeekPlan.mockReset().mockResolvedValue(null)
  mocks.addRecipeToWeekPlan.mockReset().mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('actual Plan owner/week subscription boundary', () => {
  it('shows loading until the first current snapshot, then accepts that snapshot', () => {
    render(<PlanPage />)
    expectWeek(current)
    expectPending()
    emit(current, plan(current))
    expect(screen.getByText('Recipe A')).toBeTruthy()
    expect(screen.queryByText('Loading meal plan…')).toBeNull()
  })

  it('hides Week A beneath the new Week B header while pending, then renders only B', () => {
    render(<PlanPage />)
    emit(current, plan(current))
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    expectWeek(next)
    expectPending()
    emit(next, plan(next, 'recipe-b'))
    expect(screen.getByText('Recipe B')).toBeTruthy()
    expect(screen.queryByText('Recipe A')).toBeNull()
  })

  it('renders a resolved empty Week B without any Week A recipes', () => {
    render(<PlanPage />)
    emit(current, plan(current))
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    expectPending()
    emit(next, null)
    expectWeek(next)
    expect(screen.getByText('No recipes planned this week')).toBeTruthy()
    expect(screen.queryByText('Recipe A')).toBeNull()
  })

  it('ignores stale data and errors both before and after the current callback', () => {
    render(<PlanPage />)
    const old = subscription()
    emit(current, plan(current))
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    expect(old.stop).toHaveBeenCalledTimes(1)
    act(() => { old.data(plan(current)); old.error(new Error('obsolete failure')) })
    expectPending()
    emit(next, plan(next, 'recipe-b'))
    act(() => { old.data(plan(current)); old.error(new Error('obsolete failure')) })
    expect(screen.getByText('Recipe B')).toBeTruthy()
    expect(screen.queryByText('Recipe A')).toBeNull()
    expect(screen.queryByText(/obsolete failure/)).toBeNull()
  })

  it('ignores a retired callback even after navigating back to its owner/week', () => {
    render(<PlanPage />)
    const old = subscription()
    emit(current, plan(current))
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }))
    act(() => old.data(plan(current)))
    expectPending()
    emit(current, plan(current, 'recipe-b'))
    expect(screen.getByText('Recipe B')).toBeTruthy()
  })

  it('hides the previous owner and ignores their callback after an owner change', () => {
    const page = render(<PlanPage />)
    const old = subscription()
    emit(current, plan(current))
    mocks.user = { ...mocks.user!, uid: 'owner-b' }
    page.rerender(<PlanPage />)
    expectPending()
    act(() => old.data(plan(current)))
    expectPending()
    emit(current, plan(current, 'recipe-b'), 'owner-b')
    expect(screen.getByText('Recipe B')).toBeTruthy()
    expect(screen.queryByText('Recipe A')).toBeNull()
  })

  it('clears private data on sign-out and rejects it after the same owner signs back in', () => {
    const page = render(<PlanPage />)
    const owner = mocks.user
    const old = subscription()
    emit(current, plan(current))
    mocks.user = null
    page.rerender(<PlanPage />)
    act(() => old.data(plan(current)))
    expect(screen.getByText('Sign-in options')).toBeTruthy()
    expect(screen.queryByText('Recipe A')).toBeNull()
    mocks.user = owner
    page.rerender(<PlanPage />)
    expectPending()
    act(() => old.data(plan(current)))
    expectPending()
    emit(current, null)
    expect(screen.getByText('No recipes planned this week')).toBeTruthy()
  })

  it('shows an initial subscription error, retries unresolved, and ignores the failed listener', () => {
    render(<PlanPage />)
    const old = subscription()
    act(() => old.error(new Error('controlled offline')))
    expect(screen.getByRole('alert').textContent).toContain('controlled offline')
    expect(screen.queryByText('No recipes planned this week')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expectPending()
    act(() => old.data(plan(current)))
    expectPending()
    emit(current, plan(current, 'recipe-b'))
    expect(screen.getByText('Recipe B')).toBeTruthy()
  })

  it('also binds published status and friends’ plans to the selected owner/week', () => {
    render(<PlanPage />)
    const publication = mocks.publications[0]
    const friends = mocks.friends[0]
    const shared = { uid: 'friend', displayName: 'Week A friend', photoURL: '', plannedRecipeIDs: ['recipe-a'] }
    emit(current, null)
    act(() => { publication.data(shared); friends.data([shared]) })
    expect(screen.getByText('Shared plan: Published — private changes not shared')).toBeTruthy()
    expect(screen.getByText('Week A friend')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    emit(next, null)
    act(() => { publication.data(shared); friends.data([shared]) })
    expect(screen.queryByText(/Shared plan: Published/)).toBeNull()
    expect(screen.queryByText('Week A friend')).toBeNull()
    expect(screen.queryByText('Recipe A')).toBeNull()
  })
})

describe('actual Plan remembered week and automatic selection', () => {
  it.each([
    ['2026-09-28', current], ['2026-09-29', current], ['2026-10-06', next],
  ])('restores %s as %s without reading the old Tuesday document or checking defaults', (remembered, expected) => {
    sessionStorage.setItem('mea_plan_last_week', remembered)
    render(<PlanPage />)
    expectWeek(expected)
    expect(mocks.getWeekPlan).not.toHaveBeenCalled()
    expect(mocks.plans.every(entry => entry.weekID === current || entry.weekID === expected)).toBe(true)
    expect(mocks.plans.some(entry => entry.weekID === expected)).toBe(true)
  })

  it.each(['malformed', '2026-02-30', '2026-13-01'])('ignores invalid memory %s and uses the normal default rule', async remembered => {
    sessionStorage.setItem('mea_plan_last_week', remembered)
    const check = pendingDefault()
    render(<PlanPage />)
    expectWeek(current)
    expect(mocks.getWeekPlan).toHaveBeenCalledWith('owner-a', current)
    expect(mocks.getWeekPlan).toHaveBeenCalledWith('owner-a', next)
    expect(mocks.plans.some(entry => entry.weekID === remembered)).toBe(false)
    await finishDefault(check)
    expectWeek(next)
  })

  it('preserves remembered memory while authentication is pending, then normalizes it on sign-in', () => {
    const owner = mocks.user
    mocks.user = null
    sessionStorage.setItem('mea_plan_last_week', '2026-10-06')
    const page = render(<PlanPage />)
    expect(sessionStorage.getItem('mea_plan_last_week')).toBe('2026-10-06')
    mocks.user = owner
    page.rerender(<PlanPage />)
    expectWeek(next)
    expect(mocks.getWeekPlan).not.toHaveBeenCalled()
    expect(mocks.plans.some(entry => entry.weekID === '2026-10-06')).toBe(false)
  })

  it.each([
    ['Previous week', previous], ['Next week', '2026-10-12'],
  ])('does not let delayed default results override manual %s navigation', async (button, expected) => {
    const check = pendingDefault()
    render(<PlanPage />)
    fireEvent.click(screen.getByRole('button', { name: button }))
    if (button === 'Next week') fireEvent.click(screen.getByRole('button', { name: button }))
    expectWeek(expected)
    await finishDefault(check)
    expectWeek(expected)
  })

  it('still defaults to populated next week when current is empty and the user has not navigated', async () => {
    const check = pendingDefault()
    render(<PlanPage />)
    await finishDefault(check)
    expectWeek(next)
    expectPending()
    emit(next, plan(next, 'recipe-b'))
    expect(screen.getByText('Recipe B')).toBeTruthy()
  })

  it.each([
    ['both empty', null, null],
    ['current populated', plan(current), plan(next)],
    ['only current populated', plan(current), null],
  ])('keeps current week when %s', async (_name, cur, nxt) => {
    const check = pendingDefault()
    render(<PlanPage />)
    await finishDefault(check, cur, nxt)
    expectWeek(current)
  })

  it('preserves automatic selection through Strict Mode effect replay', async () => {
    const check = pendingDefault()
    render(<StrictMode><PlanPage /></StrictMode>)
    await finishDefault(check)
    expectWeek(next)
  })

  it('ignores an unfinished default check from the previous owner', async () => {
    const check = pendingDefault()
    const page = render(<PlanPage />)
    mocks.getWeekPlan.mockImplementation(() => new Promise(() => {}))
    mocks.user = { ...mocks.user!, uid: 'owner-b' }
    page.rerender(<PlanPage />)
    await finishDefault(check)
    expectWeek(current)
  })
})

describe('actual Add-to-Plan pickers keep canonical keys and next-week defaults', () => {
  it.each(['next-week default', 'explicit current week'])('RecipeCard: %s', async choice => {
    render(<RecipeCard recipe={mocks.recipes[0]} />)
    fireEvent.click(screen.getByTitle('Add to plan'))
    expect(screen.getByRole('button', { name: 'This week (Sep 28)' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Next week (Oct 5)' })).toBeTruthy()
    if (choice === 'explicit current week') fireEvent.click(screen.getByRole('button', { name: 'This week (Sep 28)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add to Plan' }))
    await act(async () => {})
    expect(mocks.addRecipeToWeekPlan).toHaveBeenCalledWith('owner-a', choice === 'explicit current week' ? current : next, 'recipe-a', 'main')
    expect(screen.getByText('Added!')).toBeTruthy()
  })

  it.each(['next-week default', 'explicit current week'])('Recipe Detail: %s', async choice => {
    await act(async () => { render(<DetailPage />) })
    fireEvent.click(screen.getByRole('button', { name: 'Add to Plan' }))
    expect(screen.getByRole('button', { name: 'Oct 5 – Oct 11' })).toBeTruthy()
    if (choice === 'explicit current week') fireEvent.click(screen.getByRole('button', { name: /Sep 28 – Oct 4.*this week/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await act(async () => {})
    expect(mocks.addRecipeToWeekPlan).toHaveBeenCalledWith('owner-a', choice === 'explicit current week' ? current : next, 'recipe-a', 'main')
  })
})
