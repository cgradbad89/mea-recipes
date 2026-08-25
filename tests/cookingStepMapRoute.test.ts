import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  verifyAuthToken: vi.fn(),
  generateAIObject: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/firebaseAdmin', () => ({ verifyAuthToken: mocks.verifyAuthToken }))
vi.mock('@/lib/ai', () => ({ generateAIObject: mocks.generateAIObject }))

import {
  COOKING_STEP_MAP_MAX_BODY_BYTES,
  COOKING_STEP_MAP_MAX_LINE_LENGTH,
  POST,
} from '@/app/api/cooking-step-map/route'
import { computeCookingMappingSourceHash } from '@/lib/cookingStepMapping'
import { parseRecipeContent } from '@/lib/recipeContent'

const deterministicContent = `INGREDIENTS
1 tsp salt

INSTRUCTIONS
Step 1
Add the salt and stir well.`

const ambiguousContent = `INGREDIENTS
For the marinade:
1 tbsp olive oil
For the sauce:
2 tbsp olive oil

INSTRUCTIONS
Step 1
Add the olive oil and stir well.`

const preparedComponentContent = `INGREDIENTS
For the green sauce:
1 cup cilantro

INSTRUCTIONS
Step 1
Add the sauce over the cooked chicken.`

function request(body: BodyInit = JSON.stringify({ content: deterministicContent })) {
  return new NextRequest('http://localhost/api/cooking-step-map', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
    body,
  })
}

function jsonRequest(body: unknown) {
  return request(JSON.stringify(body))
}

describe('POST /api/cooking-step-map', () => {
  beforeEach(() => {
    mocks.verifyAuthToken.mockReset().mockResolvedValue('user-123')
    mocks.generateAIObject.mockReset()
  })

  it('rejects anonymous requests before parsing or AI work', async () => {
    mocks.verifyAuthToken.mockResolvedValueOnce(null)
    const response = await POST(request('{'))
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mocks.generateAIObject).not.toHaveBeenCalled()
  })

  it('rejects malformed and invalid request bodies', async () => {
    for (const body of ['{', JSON.stringify({}), JSON.stringify({ content: 42 })]) {
      const response = await POST(request(body))
      expect(response.status).toBe(400)
    }
    expect(mocks.generateAIObject).not.toHaveBeenCalled()
  })

  it('rejects an oversized raw body before AI work', async () => {
    const response = await POST(request(JSON.stringify({ padding: 'x'.repeat(COOKING_STEP_MAP_MAX_BODY_BYTES) })))
    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({ error: 'Request payload is too large.' })
    expect(mocks.generateAIObject).not.toHaveBeenCalled()
  })

  it('rejects impossible parsing and overlong parsed lines', async () => {
    const noSections = await POST(jsonRequest({ content: 'This is not structured recipe content.' }))
    expect(noSections.status).toBe(400)

    const longLine = `INGREDIENTS\n${'x'.repeat(COOKING_STEP_MAP_MAX_LINE_LENGTH + 1)}\nINSTRUCTIONS\nStep 1\nCook this ingredient until completely tender.`
    const overlong = await POST(jsonRequest({ content: longLine }))
    expect(overlong.status).toBe(400)
    expect(mocks.generateAIObject).not.toHaveBeenCalled()
  })

  it('does not invoke AI for a fully deterministic recipe', async () => {
    const response = await POST(jsonRequest({ content: deterministicContent }))
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.ai).toEqual({
      attempted: false,
      status: 'not_needed',
      resolvedIngredientReferences: 0,
      resolvedPreparedComponents: 0,
    })
    expect(data.mapping.steps[0].ingredients[0]).toMatchObject({
      ingredientIndex: 0,
      provenance: 'deterministic',
    })
    expect(mocks.generateAIObject).not.toHaveBeenCalled()
  })

  it('invokes AI at most once for eligible unresolved semantics', async () => {
    mocks.generateAIObject.mockResolvedValueOnce({ steps: [] })
    const response = await POST(jsonRequest({ content: ambiguousContent }))
    expect(response.status).toBe(200)
    expect((await response.json()).ai.status).toBe('completed')
    expect(mocks.generateAIObject).toHaveBeenCalledTimes(1)
  })

  it('merges a valid AI resolution and reports its count', async () => {
    mocks.generateAIObject.mockResolvedValueOnce({
      steps: [{
        instructionIndex: 0,
        ingredients: [{ ingredientIndex: 1, confidence: 'high' }],
        preparedComponents: [],
      }],
    })
    const response = await POST(jsonRequest({ content: ambiguousContent }))
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.mapping.engineVersion).toBe('hybrid-v1')
    expect(data.mapping.steps[0].ingredients).toEqual([
      { ingredientIndex: 1, confidence: 'high', provenance: 'ai' },
    ])
    expect(data.ai).toMatchObject({
      attempted: true,
      status: 'completed',
      resolvedIngredientReferences: 1,
      resolvedPreparedComponents: 0,
    })
  })

  it('persists and counts a grounded prepared-component resolution', async () => {
    mocks.generateAIObject.mockResolvedValueOnce({
      steps: [{
        instructionIndex: 0,
        ingredients: [],
        preparedComponents: [{ label: 'green sauce', confidence: 'high' }],
      }],
    })
    const response = await POST(jsonRequest({ content: preparedComponentContent }))
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.mapping.steps[0].preparedComponents).toEqual([
      { label: 'green sauce', confidence: 'high', provenance: 'ai' },
    ])
    expect(data.ai.resolvedPreparedComponents).toBe(1)
  })

  it('returns HTTP 200 with the deterministic map when optional AI fails', async () => {
    mocks.generateAIObject.mockRejectedValueOnce(new Error('AI_GATEWAY_API_KEY secret provider detail'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = await POST(jsonRequest({ content: ambiguousContent }))
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.ai).toEqual({
      attempted: true,
      status: 'failed',
      resolvedIngredientReferences: 0,
      resolvedPreparedComponents: 0,
    })
    expect(data.mapping.engineVersion).toBe('deterministic-v1')
    expect(JSON.stringify(data)).not.toContain('secret provider detail')
  })

  it('binds the returned source hash to the exact parsed content', async () => {
    const response = await POST(jsonRequest({ content: deterministicContent }))
    const data = await response.json()
    const parsed = parseRecipeContent(deterministicContent)
    await expect(computeCookingMappingSourceHash(parsed.ingredients, parsed.instructions))
      .resolves.toBe(data.mapping.sourceHash)
  })

  it('sanitizes unexpected auth/internal failures', async () => {
    mocks.verifyAuthToken.mockRejectedValueOnce(new Error('FIREBASE_PRIVATE_KEY secret-detail'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = await POST(request())
    const data = await response.json()
    expect(response.status).toBe(500)
    expect(data).toEqual({ error: 'Unable to prepare cooking-step mapping.' })
    expect(JSON.stringify(data)).not.toContain('secret-detail')
  })
})
