import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const firestore = vi.hoisted(() => ({ getDoc: vi.fn() }))
vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>()
  return {
    ...actual,
    doc: vi.fn(() => ({ path: 'recipes/test-recipe' })),
    getDoc: firestore.getDoc,
  }
})
vi.mock('@/lib/firebase', () => ({ db: {} }))

import {
  getRecipeById,
  prepareCookingStepIngredientMap,
} from '@/lib/recipes'
import { buildRecipeContent, type QueuedRecipe } from '@/lib/queue'
import { parseRecipeContent } from '@/lib/recipeContent'
import { computeCookingMappingSourceHash } from '@/lib/cookingStepMapping'
import type { CookingStepIngredientMap } from '@/types/recipe'

const deterministicContent = `INGREDIENTS
1 tsp salt

INSTRUCTIONS
Step 1
Add the salt and stir well.`

const ambiguousContent = `INGREDIENTS
For the sauce:
1 tbsp olive oil

INSTRUCTIONS
Step 1
Add the oil to the marinade.`

function apiResponse(mapping: CookingStepIngredientMap): Response {
  return new Response(JSON.stringify({
    mapping,
    ai: {
      attempted: true,
      status: 'completed',
      resolvedIngredientReferences: 1,
      resolvedPreparedComponents: 0,
    },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

async function hybridApiMap(content: string): Promise<CookingStepIngredientMap> {
  const parsed = parseRecipeContent(content)
  return {
    schemaVersion: 1,
    parserVersion: 'recipe-content-v1',
    engineVersion: 'hybrid-v4',
    sourceHash: await computeCookingMappingSourceHash(parsed.ingredients, parsed.instructions),
    steps: [{
      instructionIndex: 0,
      ingredients: [{ ingredientIndex: 1, confidence: 'high', provenance: 'ai' }],
    }],
  }
}

describe('publish-time cooking-step map helper', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    firestore.getDoc.mockReset()
  })

  afterEach(() => vi.unstubAllGlobals())

  it('skips the API when deterministic mapping fully resolves the recipe', async () => {
    const mapping = await prepareCookingStepIngredientMap(deterministicContent, 'token')
    expect(mapping.engineVersion).toBe('deterministic-v4')
    expect(mapping.steps[0].ingredients[0].ingredientIndex).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('uses a structurally valid API map with the matching source hash', async () => {
    const remote = await hybridApiMap(ambiguousContent)
    vi.mocked(fetch).mockResolvedValueOnce(apiResponse(remote))
    await expect(prepareCookingStepIngredientMap(ambiguousContent, 'token')).resolves.toEqual(remote)
    expect(fetch).toHaveBeenCalledWith('/api/cooking-step-map', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer token' }),
      body: JSON.stringify({ content: ambiguousContent }),
    }))
  })

  it('rejects a valid-looking API map whose source hash does not match', async () => {
    const remote = { ...await hybridApiMap(ambiguousContent), sourceHash: 'b'.repeat(64) }
    vi.mocked(fetch).mockResolvedValueOnce(apiResponse(remote))
    const mapping = await prepareCookingStepIngredientMap(ambiguousContent, 'token')
    expect(mapping.engineVersion).toBe('deterministic-v4')
    expect(mapping.sourceHash).not.toBe(remote.sourceHash)
  })

  it('rejects structurally invalid API references and falls back deterministically', async () => {
    const remote = await hybridApiMap(ambiguousContent)
    remote.steps[0].ingredients[0].ingredientIndex = 0 // header index
    vi.mocked(fetch).mockResolvedValueOnce(apiResponse(remote))
    const mapping = await prepareCookingStepIngredientMap(ambiguousContent, 'token')
    expect(mapping.engineVersion).toBe('deterministic-v4')
    expect(mapping.steps[0].unresolvedReason).toBe('prepared-component')
  })

  it('falls back deterministically on network failure', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'))
    const mapping = await prepareCookingStepIngredientMap(ambiguousContent, 'token')
    expect(mapping.engineVersion).toBe('deterministic-v4')
    expect(mapping.steps[0].ingredients).toEqual([])
  })

  it('falls back deterministically when the optional request times out', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new DOMException('Timed out', 'AbortError'))
    const mapping = await prepareCookingStepIngredientMap(ambiguousContent, 'token', 1)
    expect(mapping.engineVersion).toBe('deterministic-v4')
    expect(mapping.steps[0].unresolvedReason).toBe('prepared-component')
  })

  it('falls back deterministically when the API returns a failure response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
    const mapping = await prepareCookingStepIngredientMap(ambiguousContent, 'token', 1)
    expect(mapping.engineVersion).toBe('deterministic-v4')
  })
})

function queued(overrides: Partial<QueuedRecipe> = {}): QueuedRecipe {
  return {
    title: 'Round Trip',
    cuisine: 'test',
    category: 'Other',
    ingredients: ['1 cup flour', '1 tsp salt'],
    instructions: ['Whisk the flour and salt together.', 'Bake until golden and cooked through.'],
    imageURL: '',
    sourceURL: 'https://recipes.example/round-trip',
    description: 'A representative recipe used for mapping round trips.',
    servings: '4',
    prepTime: '10 min',
    cookTime: '20 min',
    status: 'pending',
    ...overrides,
  }
}

describe('publish content mapping-source round trip', () => {
  it('round-trips normal reviewed ingredients and instructions', () => {
    const recipe = queued()
    const parsed = parseRecipeContent(buildRecipeContent(recipe))
    expect(parsed.ingredients).toEqual(recipe.ingredients)
    expect(parsed.instructions).toEqual(recipe.instructions)
  })

  it('round-trips ingredient subheaders and parenthetical notes', () => {
    const recipe = queued({
      ingredients: ['For the sauce:', '1 cup yogurt (plain)', 'For the salad:', '2 cucumbers'],
    })
    const parsed = parseRecipeContent(buildRecipeContent(recipe))
    expect(parsed.ingredients).toEqual(recipe.ingredients)
  })

  it('round-trips multiple explicit Step N serialized instructions', () => {
    const recipe = queued({
      instructions: [
        'Combine the ingredients until completely smooth.',
        'Cook over medium heat for ten minutes.',
        'Rest the finished dish for five minutes.',
      ],
    })
    const content = buildRecipeContent(recipe)
    expect(content).toContain('Step 1\n')
    expect(content).toContain('Step 3\n')
    expect(parseRecipeContent(content).instructions).toEqual(recipe.instructions)
  })

  it('round-trips repeated ingredient rows and produces the same source hash', async () => {
    const recipe = queued({
      ingredients: ['For the marinade:', '1 tbsp olive oil', 'For the sauce:', '1 tbsp olive oil'],
    })
    const parsed = parseRecipeContent(buildRecipeContent(recipe))
    expect(parsed.ingredients).toEqual(recipe.ingredients)
    const first = await computeCookingMappingSourceHash(recipe.ingredients, recipe.instructions)
    const second = await computeCookingMappingSourceHash(parsed.ingredients, parsed.instructions)
    expect(second).toBe(first)
  })
})

describe('recipe read whitelist', () => {
  it('preserves the persisted cooking-step map through docToRecipe', async () => {
    const mapping = await hybridApiMap(ambiguousContent)
    firestore.getDoc.mockResolvedValueOnce({
      exists: () => true,
      id: 'test-recipe',
      data: () => ({
        recipeID: 'test-recipe',
        title: 'Test Recipe',
        content: ambiguousContent,
        cookingStepIngredientMap: mapping,
      }),
    })
    await expect(getRecipeById('test-recipe')).resolves.toMatchObject({
      cookingStepIngredientMap: mapping,
    })
  })
})
