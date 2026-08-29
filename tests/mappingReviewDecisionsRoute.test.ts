import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  verifyAdminToken: vi.fn(),
  appendMappingReviewDecision: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/firebaseAdmin', () => ({ verifyAdminToken: mocks.verifyAdminToken }))
vi.mock('@/lib/cookingModeMappingReviewPersistence', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/cookingModeMappingReviewPersistence')>()
  return { ...actual, appendMappingReviewDecision: mocks.appendMappingReviewDecision }
})

import { POST } from '@/app/api/mapping-review/[recipeId]/decisions/route'
import { MappingReviewDecisionRejectedError } from '@/lib/cookingModeMappingReviewPersistence'

function ctx(recipeId = 'recipe-1') {
  return { params: Promise.resolve({ recipeId }) }
}

function request(body: unknown) {
  return new NextRequest('http://localhost/api/mapping-review/recipe-1/decisions', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const validBody = {
  proposalId: 'mp1:abc', candidateId: 'mc1:abc', recipeRevision: 'v1:sha256:abc',
  decision: 'ACCEPT', reasonCode: 'SOURCE_EXPLICIT_USE',
}

describe('POST /api/mapping-review/[recipeId]/decisions', () => {
  beforeEach(() => {
    mocks.verifyAdminToken.mockReset()
    mocks.appendMappingReviewDecision.mockReset()
  })

  it('rejects an unauthenticated caller before touching persistence', async () => {
    mocks.verifyAdminToken.mockResolvedValueOnce(null)
    const response = await POST(request(validBody), ctx())
    expect(response.status).toBe(401)
    expect(mocks.appendMappingReviewDecision).not.toHaveBeenCalled()
  })

  it('rejects a malformed body', async () => {
    mocks.verifyAdminToken.mockResolvedValueOnce('admin-uid')
    const response = await POST(request({ decision: 'MAYBE' }), ctx())
    expect(response.status).toBe(400)
    expect(mocks.appendMappingReviewDecision).not.toHaveBeenCalled()
  })

  it('derives decidedBy from the verified token, never from the request body', async () => {
    mocks.verifyAdminToken.mockResolvedValueOnce('admin-uid')
    mocks.appendMappingReviewDecision.mockResolvedValueOnce({ decisionId: 'mr1:xyz', decidedBy: 'admin-uid' })
    const response = await POST(request({ ...validBody, decidedBy: 'someone-else' }), ctx())
    expect(response.status).toBe(200)
    expect(mocks.appendMappingReviewDecision).toHaveBeenCalledWith(
      expect.objectContaining({ recipeId: 'recipe-1', decidedBy: 'admin-uid' }),
    )
  })

  it('maps a rejected decision to a sanitized 409', async () => {
    mocks.verifyAdminToken.mockResolvedValueOnce('admin-uid')
    mocks.appendMappingReviewDecision.mockRejectedValueOnce(
      new MappingReviewDecisionRejectedError('REVISION_MISMATCH', 'internal detail'),
    )
    const response = await POST(request(validBody), ctx())
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.error).not.toContain('internal detail')
  })

  it('sanitizes an unexpected service failure', async () => {
    mocks.verifyAdminToken.mockResolvedValueOnce('admin-uid')
    mocks.appendMappingReviewDecision.mockRejectedValueOnce(new Error('Firestore path leaked: recipes/x/mappingProposals/y'))
    const response = await POST(request(validBody), ctx())
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error).not.toContain('Firestore')
  })
})
