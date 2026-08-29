import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  verifyAdminToken: vi.fn(),
  loadMappingReviewQueue: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/firebaseAdmin', () => ({ verifyAdminToken: mocks.verifyAdminToken }))
vi.mock('@/lib/cookingModeMappingReviewQueue', () => ({ loadMappingReviewQueue: mocks.loadMappingReviewQueue }))

import { GET } from '@/app/api/mapping-review/queue/route'

function request() {
  return new NextRequest('http://localhost/api/mapping-review/queue', {
    headers: { Authorization: 'Bearer test-token' },
  })
}

describe('GET /api/mapping-review/queue', () => {
  beforeEach(() => {
    mocks.verifyAdminToken.mockReset()
    mocks.loadMappingReviewQueue.mockReset()
  })

  it('rejects a request with no verified admin identity', async () => {
    mocks.verifyAdminToken.mockResolvedValueOnce(null)
    const response = await GET(request())
    expect(response.status).toBe(401)
    expect(mocks.loadMappingReviewQueue).not.toHaveBeenCalled()
  })

  it('returns the queue for a verified admin', async () => {
    mocks.verifyAdminToken.mockResolvedValueOnce('admin-uid')
    mocks.loadMappingReviewQueue.mockResolvedValueOnce([{ recipeId: 'r1', recipeTitle: 'R1', status: 'NEEDS_REVIEW' }])
    const response = await GET(request())
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ entries: [{ recipeId: 'r1', recipeTitle: 'R1', status: 'NEEDS_REVIEW' }] })
  })

  it('sanitizes a service failure instead of leaking internals', async () => {
    mocks.verifyAdminToken.mockResolvedValueOnce('admin-uid')
    mocks.loadMappingReviewQueue.mockRejectedValueOnce(new Error('Firestore boom: recipes/xyz'))
    const response = await GET(request())
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error).not.toContain('Firestore')
    expect(body.error).not.toContain('recipes/xyz')
  })
})
