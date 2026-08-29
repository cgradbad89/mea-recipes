import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  verifyAdminToken: vi.fn(),
  loadMappingReviewRecipe: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/firebaseAdmin', () => ({ verifyAdminToken: mocks.verifyAdminToken }))
vi.mock('@/lib/cookingModeMappingReviewDetail', () => ({ loadMappingReviewRecipe: mocks.loadMappingReviewRecipe }))

import { GET } from '@/app/api/mapping-review/[recipeId]/route'

function ctx(recipeId = 'recipe-1') {
  return { params: Promise.resolve({ recipeId }) }
}

function request() {
  return new NextRequest('http://localhost/api/mapping-review/recipe-1', { headers: { Authorization: 'Bearer test-token' } })
}

describe('GET /api/mapping-review/[recipeId]', () => {
  beforeEach(() => {
    mocks.verifyAdminToken.mockReset()
    mocks.loadMappingReviewRecipe.mockReset()
  })

  it('rejects an unauthenticated request', async () => {
    mocks.verifyAdminToken.mockResolvedValueOnce(null)
    const response = await GET(request(), ctx())
    expect(response.status).toBe(401)
    expect(mocks.loadMappingReviewRecipe).not.toHaveBeenCalled()
  })

  it('returns 404 when the recipe does not exist', async () => {
    mocks.verifyAdminToken.mockResolvedValueOnce('admin-uid')
    mocks.loadMappingReviewRecipe.mockResolvedValueOnce(null)
    const response = await GET(request(), ctx())
    expect(response.status).toBe(404)
  })

  it('returns the joined recipe mapping-review state for a verified admin', async () => {
    mocks.verifyAdminToken.mockResolvedValueOnce('admin-uid')
    mocks.loadMappingReviewRecipe.mockResolvedValueOnce({ recipeId: 'recipe-1', recipeTitle: 'R', candidates: [] })
    const response = await GET(request(), ctx())
    expect(response.status).toBe(200)
    expect(mocks.loadMappingReviewRecipe).toHaveBeenCalledWith('recipe-1')
  })
})
