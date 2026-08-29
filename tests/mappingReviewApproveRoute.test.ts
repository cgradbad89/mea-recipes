import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  verifyAdminToken: vi.fn(),
  loadMappingReviewRecipe: vi.fn(),
  buildApprovedMapping: vi.fn(),
  persistApprovedMapping: vi.fn(),
  updateCurrentApprovedMappingPointer: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/firebaseAdmin', () => ({ verifyAdminToken: mocks.verifyAdminToken }))
vi.mock('@/lib/cookingModeMappingReviewDetail', () => ({ loadMappingReviewRecipe: mocks.loadMappingReviewRecipe }))
vi.mock('@/lib/cookingModeMappingApprovedPersistence', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/cookingModeMappingApprovedPersistence')>()
  return {
    ...actual,
    buildApprovedMapping: mocks.buildApprovedMapping,
    persistApprovedMapping: mocks.persistApprovedMapping,
    updateCurrentApprovedMappingPointer: mocks.updateCurrentApprovedMappingPointer,
  }
})

import { POST } from '@/app/api/mapping-review/[recipeId]/approve/route'

function ctx(recipeId = 'recipe-1') {
  return { params: Promise.resolve({ recipeId }) }
}

function request(body: unknown) {
  return new NextRequest('http://localhost/api/mapping-review/recipe-1/approve', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const validBody = { proposalId: 'mp1:a', recipeRevision: 'v1:sha256:a' }

function baseData(overrides: Record<string, unknown> = {}) {
  return {
    recipeId: 'recipe-1',
    recipeTitle: 'R',
    liveRevision: 'v1:sha256:a',
    proposal: {
      proposalId: 'mp1:a', recipeId: 'recipe-1', recipeRevision: 'v1:sha256:a',
      parserVersion: 'v1', mappingSourceHash: 'hash', reviewerContractVersion: 'r1',
      evidenceContractVersion: 'e1', routingContractVersion: 'rt1', blockingReasons: [],
    },
    candidates: [],
    completion: { complete: true, totalCandidates: 1, resolvedCandidates: 1, unresolvedCandidateIds: [], requiresCompletenessAttestation: true },
    attestation: { valid: true, attestation: { attestationId: 'ma1:x', reviewStateHash: 'h' }, liveReviewStateHash: 'h' },
    pointer: { status: 'NOT_FOUND', pointer: null, currentRecipeRevision: 'v1:sha256:a' },
    approvedMap: null,
    ...overrides,
  }
}

describe('POST /api/mapping-review/[recipeId]/approve', () => {
  beforeEach(() => {
    mocks.verifyAdminToken.mockReset()
    mocks.loadMappingReviewRecipe.mockReset()
    mocks.buildApprovedMapping.mockReset()
    mocks.persistApprovedMapping.mockReset()
    mocks.updateCurrentApprovedMappingPointer.mockReset()
  })

  it('rejects an unauthenticated caller before any read', async () => {
    mocks.verifyAdminToken.mockResolvedValueOnce(null)
    const response = await POST(request(validBody), ctx())
    expect(response.status).toBe(401)
    expect(mocks.loadMappingReviewRecipe).not.toHaveBeenCalled()
  })

  it('rejects a stale proposalId/recipeRevision from the client (Phase 34 concurrency)', async () => {
    mocks.verifyAdminToken.mockResolvedValueOnce('admin-uid')
    mocks.loadMappingReviewRecipe.mockResolvedValueOnce(baseData({ liveRevision: 'v2:sha256:different' }))
    const response = await POST(request(validBody), ctx())
    expect(response.status).toBe(409)
    expect(mocks.buildApprovedMapping).not.toHaveBeenCalled()
  })

  it('blocks approval when candidates remain unresolved', async () => {
    mocks.verifyAdminToken.mockResolvedValueOnce('admin-uid')
    mocks.loadMappingReviewRecipe.mockResolvedValueOnce(baseData({
      completion: { complete: false, totalCandidates: 2, resolvedCandidates: 1, unresolvedCandidateIds: ['mc1:x'], requiresCompletenessAttestation: true },
    }))
    const response = await POST(request(validBody), ctx())
    expect(response.status).toBe(400)
    expect(mocks.buildApprovedMapping).not.toHaveBeenCalled()
  })

  it('blocks approval when completeness attestation is missing or stale', async () => {
    mocks.verifyAdminToken.mockResolvedValueOnce('admin-uid')
    mocks.loadMappingReviewRecipe.mockResolvedValueOnce(baseData({
      attestation: { valid: false, attestation: null, liveReviewStateHash: 'h' },
    }))
    const response = await POST(request(validBody), ctx())
    expect(response.status).toBe(409)
    expect(mocks.buildApprovedMapping).not.toHaveBeenCalled()
  })

  it('approves, persists, and updates the pointer on a fully valid request', async () => {
    mocks.verifyAdminToken.mockResolvedValueOnce('admin-uid')
    mocks.loadMappingReviewRecipe.mockResolvedValueOnce(baseData())
    mocks.buildApprovedMapping.mockResolvedValueOnce({
      ok: true, map: { mapId: 'am1:x', approvalMode: 'HUMAN_ASSISTED', relationships: [{ candidateId: 'mc1:a' }] },
    })
    mocks.persistApprovedMapping.mockResolvedValueOnce({ mapId: 'am1:x', outcome: 'CREATED' })
    mocks.updateCurrentApprovedMappingPointer.mockResolvedValueOnce({})

    const response = await POST(request(validBody), ctx())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.mapId).toBe('am1:x')
    expect(body.relationshipCount).toBe(1)
    expect(mocks.persistApprovedMapping).toHaveBeenCalled()
    expect(mocks.updateCurrentApprovedMappingPointer).toHaveBeenCalledWith('recipe-1', 'am1:x')
  })

  it('never re-runs AI or recomputes candidate discovery — approval only calls the build/persist/pointer services', async () => {
    mocks.verifyAdminToken.mockResolvedValueOnce('admin-uid')
    mocks.loadMappingReviewRecipe.mockResolvedValueOnce(baseData())
    mocks.buildApprovedMapping.mockResolvedValueOnce({
      ok: true, map: { mapId: 'am1:x', approvalMode: 'AUTO', relationships: [] },
    })
    mocks.persistApprovedMapping.mockResolvedValueOnce({ mapId: 'am1:x', outcome: 'CREATED' })
    mocks.updateCurrentApprovedMappingPointer.mockResolvedValueOnce({})

    await POST(request(validBody), ctx())
    expect(mocks.buildApprovedMapping).toHaveBeenCalledTimes(1)
    const [[input]] = mocks.buildApprovedMapping.mock.calls
    expect(input.approvedBy).toBe('admin-uid')
    expect(input.candidates).toEqual([])
  })

  it('sanitizes a build-approval failure', async () => {
    mocks.verifyAdminToken.mockResolvedValueOnce('admin-uid')
    mocks.loadMappingReviewRecipe.mockResolvedValueOnce(baseData())
    mocks.buildApprovedMapping.mockResolvedValueOnce({ ok: false, reason: 'STRUCTURAL_BLOCKER', unresolvedCandidateIds: [] })
    const response = await POST(request(validBody), ctx())
    expect(response.status).toBe(409)
    expect(mocks.persistApprovedMapping).not.toHaveBeenCalled()
  })
})
