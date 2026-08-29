import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  verifyAdminToken: vi.fn(),
  getRecipeById: vi.fn(),
  generateAndPersistCookingModeMappingProposal: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/firebaseAdmin', () => ({ verifyAdminToken: mocks.verifyAdminToken }))
vi.mock('@/lib/recipes', () => ({ getRecipeById: mocks.getRecipeById }))
vi.mock('@/lib/cookingModeMappingIngestion', () => ({
  generateAndPersistCookingModeMappingProposal: mocks.generateAndPersistCookingModeMappingProposal,
}))

import { POST } from '@/app/api/mapping/generate/route'

function request(body: unknown) {
  return new NextRequest('http://localhost/api/mapping/generate', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const recipe = {
  id: 'recipe-1', recipeID: 'recipe-1', title: 'Fixture', content: 'INGREDIENTS\n1 egg\n\nINSTRUCTIONS\nStep 1\nCook it.',
  category: 'Breakfast', cuisine: 'american', imageURL: '', sourceURL: '', sourceFile: '',
  labels: '', hasImage: 'false', created: '', modified: '',
}

const successResult = {
  outcome: 'GENERATED', recipeId: 'recipe-1', recipeRevision: 'recipe-content-v1:sha256:abc',
  proposalId: 'mp1:abc', candidateCount: 1, autoAcceptCount: 1, reviewRequiredCount: 0,
  approvalBlocked: false, blockingReasons: [],
}

describe('POST /api/mapping/generate', () => {
  beforeEach(() => {
    mocks.verifyAdminToken.mockReset()
    mocks.getRecipeById.mockReset().mockResolvedValue(recipe)
    mocks.generateAndPersistCookingModeMappingProposal.mockReset().mockResolvedValue(successResult)
  })

  it('denies an unauthenticated caller', async () => {
    mocks.verifyAdminToken.mockResolvedValueOnce(null)
    const res = await POST(request({ recipeId: 'recipe-1' }))
    expect(res.status).toBe(401)
    expect(mocks.generateAndPersistCookingModeMappingProposal).not.toHaveBeenCalled()
  })

  it('denies an authenticated non-admin caller', async () => {
    // verifyAdminToken itself returns null for a non-admin authenticated
    // user (it enforces the admin-claim/email policy internally) — the
    // route has no separate non-admin branch to test beyond that contract.
    mocks.verifyAdminToken.mockResolvedValueOnce(null)
    const res = await POST(request({ recipeId: 'recipe-1' }))
    expect(res.status).toBe(401)
  })

  it('allows an admin caller and returns the ingestion outcome', async () => {
    mocks.verifyAdminToken.mockResolvedValueOnce('admin-uid')
    const res = await POST(request({ recipeId: 'recipe-1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ outcome: 'GENERATED', proposalId: 'mp1:abc' })
    expect(mocks.generateAndPersistCookingModeMappingProposal).toHaveBeenCalledWith(
      expect.objectContaining({ recipeId: 'recipe-1', recipe, userId: 'admin-uid' }),
    )
  })

  it('returns 404 for an unknown recipe', async () => {
    mocks.verifyAdminToken.mockResolvedValueOnce('admin-uid')
    mocks.getRecipeById.mockResolvedValueOnce(null)
    const res = await POST(request({ recipeId: 'missing' }))
    expect(res.status).toBe(404)
    expect(mocks.generateAndPersistCookingModeMappingProposal).not.toHaveBeenCalled()
  })

  it('returns 409 when the caller-supplied expectedRecipeRevision no longer matches', async () => {
    mocks.verifyAdminToken.mockResolvedValueOnce('admin-uid')
    const res = await POST(request({ recipeId: 'recipe-1', expectedRecipeRevision: 'recipe-content-v1:sha256:stale' }))
    expect(res.status).toBe(409)
    expect(mocks.generateAndPersistCookingModeMappingProposal).not.toHaveBeenCalled()
  })

  it('proceeds when the caller-supplied expectedRecipeRevision matches the live revision', async () => {
    mocks.verifyAdminToken.mockResolvedValueOnce('admin-uid')
    const { parseRecipeContent } = await import('@/lib/recipeContent')
    const { COOKING_MAPPING_PARSER_VERSION } = await import('@/lib/cookingStepMapping')
    const { computeMappingRecipeRevision } = await import('@/lib/cookingModeMappingIdentity')
    const { ingredients, instructions } = parseRecipeContent(recipe.content)
    const liveRevision = await computeMappingRecipeRevision({
      recipeId: recipe.id, parserVersion: COOKING_MAPPING_PARSER_VERSION, ingredients, instructions,
    })
    const res = await POST(request({ recipeId: 'recipe-1', expectedRecipeRevision: liveRevision }))
    expect(res.status).toBe(200)
    expect(mocks.generateAndPersistCookingModeMappingProposal).toHaveBeenCalledOnce()
  })

  it.each([
    ['missing recipeId', {}],
    ['non-string recipeId', { recipeId: 42 }],
    ['unknown field', { recipeId: 'recipe-1', extra: true }],
    ['empty recipeId', { recipeId: '' }],
  ])('returns 400 for malformed input: %s', async (_label, body) => {
    mocks.verifyAdminToken.mockResolvedValueOnce('admin-uid')
    const res = await POST(request(body))
    expect(res.status).toBe(400)
    expect(mocks.generateAndPersistCookingModeMappingProposal).not.toHaveBeenCalled()
  })

  it('returns a sanitized 200 outcome (never a raw provider error) when generation fails', async () => {
    mocks.verifyAdminToken.mockResolvedValueOnce('admin-uid')
    mocks.generateAndPersistCookingModeMappingProposal.mockResolvedValueOnce({
      outcome: 'FAILED', recipeId: 'recipe-1', recipeRevision: null, proposalId: null,
      candidateCount: null, autoAcceptCount: null, reviewRequiredCount: null, approvalBlocked: null,
      blockingReasons: [], error: 'Mapping proposal generation failed.',
    })
    const res = await POST(request({ recipeId: 'recipe-1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.outcome).toBe('FAILED')
    expect(body.error).toBe('Mapping proposal generation failed.')
    expect(JSON.stringify(body)).not.toMatch(/api[_-]?key|gateway|provider|openai|stack/i)
  })

  it('returns a sanitized 500 without provider/internal detail on an unexpected exception', async () => {
    mocks.verifyAdminToken.mockResolvedValueOnce('admin-uid')
    mocks.getRecipeById.mockRejectedValueOnce(new Error('ECONNREFUSED provider-internal-host:443 api-key=secret'))
    const res = await POST(request({ recipeId: 'recipe-1' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|api-key|secret|provider-internal-host/i)
  })
})
