import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  verifyAdminToken: vi.fn(),
  getMappingReviewHistory: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/firebaseAdmin', () => ({ verifyAdminToken: mocks.verifyAdminToken }))
vi.mock('@/lib/cookingModeMappingReviewPersistence', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/cookingModeMappingReviewPersistence')>()
  return { ...actual, getMappingReviewHistory: mocks.getMappingReviewHistory }
})

import { GET } from '@/app/api/mapping-review/[recipeId]/candidates/[candidateId]/history/route'

function ctx() {
  return { params: Promise.resolve({ recipeId: 'recipe-1', candidateId: 'mc1:a' }) }
}

function request(query = '?proposalId=mp1:a') {
  return new NextRequest(`http://localhost/api/mapping-review/recipe-1/candidates/mc1:a/history${query}`, {
    headers: { Authorization: 'Bearer test-token' },
  })
}

describe('GET .../candidates/[candidateId]/history', () => {
  beforeEach(() => {
    mocks.verifyAdminToken.mockReset()
    mocks.getMappingReviewHistory.mockReset()
  })

  it('rejects an unauthenticated caller', async () => {
    mocks.verifyAdminToken.mockResolvedValueOnce(null)
    const response = await GET(request(), ctx())
    expect(response.status).toBe(401)
    expect(mocks.getMappingReviewHistory).not.toHaveBeenCalled()
  })

  it('rejects a missing proposalId query param', async () => {
    mocks.verifyAdminToken.mockResolvedValueOnce('admin-uid')
    const response = await GET(request(''), ctx())
    expect(response.status).toBe(400)
  })

  it('returns the ordered decision chain for a verified admin', async () => {
    mocks.verifyAdminToken.mockResolvedValueOnce('admin-uid')
    mocks.getMappingReviewHistory.mockResolvedValueOnce([{ decisionId: 'mr1:a', decision: 'ACCEPT' }])
    const response = await GET(request(), ctx())
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ history: [{ decisionId: 'mr1:a', decision: 'ACCEPT' }] })
  })
})
