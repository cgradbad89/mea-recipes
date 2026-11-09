import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ verifyAuthToken: vi.fn(), getAdminDb: vi.fn(), get: vi.fn(), getAll: vi.fn(), doc: vi.fn(), collection: vi.fn() }))
vi.mock('@/lib/firebaseAdmin', () => ({ verifyAuthToken: mocks.verifyAuthToken, getAdminDb: mocks.getAdminDb }))
import { GET } from '@/app/api/hub/summary/route'

function request(authorization?: string) {
  return new NextRequest('http://localhost/api/hub/summary?uid=someone-else', {
    headers: authorization === undefined ? {} : { Authorization: authorization },
  })
}
function expectHeaders(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect([...response.headers.keys()].some(key => key.startsWith('access-control-'))).toBe(false)
}

describe('GET /api/hub/summary', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-09T04:00:00Z')) // Sunday 11pm in New York
    mocks.verifyAuthToken.mockResolvedValue('caller-uid')
    const db = { collection: mocks.collection, doc: mocks.doc, get: mocks.get, getAll: mocks.getAll }
    mocks.collection.mockReturnValue(db)
    mocks.doc.mockReturnValue(db)
    mocks.getAdminDb.mockReturnValue(db)
    mocks.get.mockResolvedValue({ exists: false })
  })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it.each([undefined, '', 'Basic token', 'Bearer '])('returns 401 for missing/malformed authorization (%s)', async authorization => {
    const response = await GET(request(authorization))
    expect(response.status).toBe(401)
    expectHeaders(response)
    expect(mocks.verifyAuthToken).not.toHaveBeenCalled()
    expect(mocks.getAdminDb).not.toHaveBeenCalled()
  })
  it('returns 401 for an invalid token without reading Firestore', async () => {
    mocks.verifyAuthToken.mockResolvedValue(null)
    const response = await GET(request('Bearer invalid-token'))
    expect(response.status).toBe(401)
    expectHeaders(response)
    expect(mocks.getAdminDb).not.toHaveBeenCalled()
  })
  it('uses only verified uid and the NY Monday, with no recipe reads for an absent week', async () => {
    const req = request('Bearer valid-token')
    const response = await GET(req)
    expect(response.status).toBe(200)
    expectHeaders(response)
    expect(mocks.verifyAuthToken).toHaveBeenCalledWith(req)
    expect(mocks.collection.mock.calls).toEqual([['users'], ['pantry'], ['weekPlans']])
    expect(mocks.doc.mock.calls).toEqual([['caller-uid'], ['root'], ['2026-11-02']])
    expect(mocks.getAll).not.toHaveBeenCalled()
    const body = await response.json()
    expect(body.status).toBe('ok')
    expect(body.data.days).toHaveLength(7)
    expect(body.data.days.every((day: { meals: unknown[] }) => day.meals.length === 0)).toBe(true)
    expect(body.data.unscheduled).toEqual([])
  })
  it('batches distinct recipe document IDs and logs only omission counts', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.get.mockResolvedValue({ exists: true, data: () => ({ plannedRecipeIDs: [
      'real-id', { recipeID: 'real-id', day: '2026-11-02', role: 'main' }, 'missing',
    ], cookedRecipeIDs: ['real-id'] }) })
    mocks.getAll.mockResolvedValue([
      { id: 'real-id', exists: true, data: () => ({ title: 'Actual title', recipeID: 'wrong-id' }) },
      { id: 'missing', exists: false },
    ])
    const response = await GET(request('Bearer token'))
    expect(response.status).toBe(200)
    expectHeaders(response)
    expect(mocks.getAll).toHaveBeenCalledTimes(1)
    expect(mocks.getAll.mock.calls[0]).toHaveLength(2)
    expect(mocks.doc.mock.calls.slice(3)).toEqual([['real-id'], ['missing']])
    const body = await response.json()
    expect(body.data.days[0].meals[0]).toEqual({ name: 'Actual title', url: 'https://mea-recipes.vercel.app/recipes/real-id', role: 'main', cooked: true })
    expect(body).not.toHaveProperty('counts')
    expect(warn).toHaveBeenCalledExactlyOnceWith('Hub summary omitted entries', { outsideWeek: 0, missingRecipe: 1, missingTitle: 0 })
  })
  it.each(['week read', 'recipe read'])('sanitizes unexpected %s errors', async stage => {
    if (stage === 'week read') mocks.get.mockRejectedValue(new Error('private error details'))
    else {
      mocks.get.mockResolvedValue({ exists: true, data: () => ({ plannedRecipeIDs: ['id'] }) })
      mocks.getAll.mockRejectedValue(new Error('private error details'))
    }
    const response = await GET(request('Bearer token'))
    expect(response.status).toBe(500)
    expectHeaders(response)
    expect(await response.json()).toEqual({ error: 'Unable to load summary' })
  })
})
