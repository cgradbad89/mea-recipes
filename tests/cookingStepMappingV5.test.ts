import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/ai', () => ({ generateAIObject: vi.fn() }))

import {
  buildDeterministicCookingStepMap,
  buildHashedDeterministicCookingStepMap,
  computeCookingMappingSourceHash,
  resolveCookingStepIngredientMap,
} from '@/lib/cookingStepMapping'
import { mergeValidatedAiCookingMappings } from '@/lib/cookingStepMappingAi'
import type { CookingStepIngredientMap } from '@/types/recipe'

function indexes(ingredients: string[], instruction: string): number[] {
  return buildDeterministicCookingStepMap(ingredients, [instruction]).steps[0].ingredients
    .map(reference => reference.ingredientIndex)
}

function mapIndexes(ingredients: string[], instructions: string[]): number[][] {
  return buildDeterministicCookingStepMap(ingredients, instructions).steps
    .map(step => step.ingredients.map(reference => reference.ingredientIndex))
}

function proposal(instructionIndex: number, ingredientIndex: number, usage?: Record<string, unknown>) {
  return {
    steps: [{
      instructionIndex,
      ingredients: [{ ingredientIndex, confidence: 'high', ...(usage ? { usage } : {}) }],
      preparedComponents: [],
    }],
  }
}

describe('deterministic-v5 recovered-recipe failures', () => {
  it('stamps deterministic-v5', () => {
    expect(buildDeterministicCookingStepMap(['salt'], ['Add salt.']).engineVersion).toBe('deterministic-v5')
  })

  it('consumes the Couscous Salad vinaigrette salt inside the dressing group', () => {
    const mapped = mapIndexes(
      ['Couscous Sweet Potato Black Bean Salad', '2 sweet potatoes', 'Lime Basil Vinaigrette', '1/2 teaspoon kosher salt'],
      ['Pulse all dressing ingredients until smooth.', 'Place sweet potatoes in a skillet with a sprinkle of salt.', 'Season salad with salt.'],
    )
    expect(mapped).toEqual([[3], [1], []])
  })

  it('maps a separate salad salt with positive group evidence', () => {
    expect(indexes(
      ['For the dressing:', '1 tsp salt', 'For the salad:', '1/2 tsp salt'],
      'For the salad, season with salt.',
    )).toEqual([3])
  })

  it('allows explicit remaining reuse of a divided salt row', () => {
    expect(mapIndexes(
      ['2 tsp salt, divided'],
      ['Add 1 tsp salt.', 'Add the remaining 1 tsp salt.'],
    )).toEqual([[0], [0]])
  })

  it('keeps a consumed group salt closed to a later bare use', () => {
    expect(mapIndexes(
      ['For the dressing:', '1 tsp salt'],
      ['Combine all dressing ingredients.', 'Season the salad with salt.'],
    )).toEqual([[1], []])
  })

  it('does not map Chili Sauce from the finished dish name', () => {
    expect(indexes(['Chili Sauce 1 TBSP'], 'Blend the vegetables for a smoother chili.')).toEqual([])
  })

  it('still maps a direct Chili Sauce use', () => {
    expect(indexes(['Chili Sauce 1 TBSP'], 'Add the chili sauce.')).toEqual([0])
  })

  it('does not map Chili Sauce when simmering the finished chili', () => {
    expect(indexes(['1 tablespoon chili sauce'], 'Simmer the chili for an hour.')).toEqual([])
  })

  it('does not spend listed soup water on egg-boiling process water', () => {
    expect(mapIndexes(
      ['1 cup water'],
      ['Bring a pot of water to boil and lower the eggs into the water.', 'Add 1 cup water to the soup.'],
    )).toEqual([[], [0]])
  })

  it('maps directly measured soup water', () => {
    expect(indexes(['1 cup water'], 'Add 1 cup water to the broth.')).toEqual([0])
  })

  it('does not map listed water into an ice bath', () => {
    expect(indexes(['1 cup water'], 'Fill a bowl with ice and water to make an ice bath.')).toEqual([])
  })

  it('allows separately scoped and measured egg water', () => {
    expect(indexes(['For the eggs:', '4 cups water'], 'For the eggs, bring 4 cups water to a boil.')).toEqual([1])
  })

  it('captures Pepper Steak mixed-number soy usage exactly', () => {
    const step = buildDeterministicCookingStepMap(
      ['3 ½ tablespoons soy sauce, plus more to taste'],
      ['Combine with 2 ½ tablespoons soy sauce.', 'Add the remaining 1 tablespoon soy sauce.'],
    ).steps
    expect(step[0].ingredients[0].usage).toEqual({ kind: 'partial', quantityText: '2 ½ tablespoons' })
    expect(step[1].ingredients[0].usage).toEqual({ kind: 'remaining' })
  })

  it('abstains when an explicit partial quantity exceeds the row', () => {
    expect(indexes(['1 tablespoon soy sauce'], 'Add 2 tablespoons soy sauce.')).toEqual([])
  })

  it('selects the Peruvian sauce chile and not the marinade chile', () => {
    expect(indexes(
      ['FOR THE CHICKEN:', '1 tablespoon aji amarillo paste', 'FOR THE SAUCE:', '½ tablespoon aji amarillo paste'],
      'While chicken roasts, make the sauce. For the sauce, blend aji amarillo paste until smooth.',
    )).toEqual([3])
  })

  it('keeps rosemary-oil garlic out of soup garlic', () => {
    expect(indexes(
      ['4–6 cloves garlic- rough chopped', '1 cup carrots', '1 cup fennel', 'Rosemary Lemon Garlic Oil (for drizzling)', '4 cloves garlic, sliced'],
      'Add the carrots, fennel and garlic to the soup.',
    )).toEqual([0, 1, 2])
  })

  it('selects pickling onion instead of chili onion', () => {
    expect(indexes(
      ['For the Pickled Onions', '1 red onion or shallot, thinly sliced', 'For the Chili', '1 large onion, chopped'],
      'Make the pickled onions: Add onion and salt.',
    )).toEqual([1])
  })

  it('selects the chili onion in explicit chili scope', () => {
    expect(indexes(
      ['For the Pickled Onions', '1 red onion or shallot, thinly sliced', 'For the Chili', '1 large onion, chopped'],
      'Prepare the chili: Add onion and sauté.',
    )).toEqual([3])
  })
})

describe('hybrid-v5 availability validation', () => {
  const couscousIngredients = [
    'Couscous Sweet Potato Black Bean Salad', '2 sweet potatoes',
    'Lime Basil Vinaigrette', '1/2 teaspoon kosher salt',
  ]
  const couscousInstructions = [
    'Pulse all dressing ingredients until smooth.',
    'Place sweet potatoes in a skillet with a sprinkle of salt.',
    'Toss with dressing and season the salad with salt.',
  ]

  it('rejects a primary-like consumed vinaigrette salt proposal', async () => {
    const deterministic = await buildHashedDeterministicCookingStepMap(couscousIngredients, couscousInstructions)
    const merged = mergeValidatedAiCookingMappings(deterministic, couscousIngredients, couscousInstructions, proposal(2, 3))
    expect(merged.steps[2].ingredients).toEqual([])
    expect(merged.engineVersion).toBe('deterministic-v5')
  })

  it('rejects the same stability-like consumed salt proposal again', async () => {
    const deterministic = await buildHashedDeterministicCookingStepMap(couscousIngredients, couscousInstructions)
    const repeat = mergeValidatedAiCookingMappings(deterministic, couscousIngredients, couscousInstructions, proposal(2, 3))
    expect(repeat.steps[2].ingredients.some(reference => reference.provenance === 'ai')).toBe(false)
  })

  it('accepts explicit remaining reuse when the source is divided', async () => {
    const ingredients = ['2 tsp salt, divided']
    const instructions = ['Add 1 tsp salt.', 'Add the remaining 1 tsp salt.']
    const deterministic = await buildHashedDeterministicCookingStepMap(ingredients, instructions)
    deterministic.steps[1] = { instructionIndex: 1, ingredients: [], unresolvedReason: 'ambiguous' }
    const merged = mergeValidatedAiCookingMappings(
      deterministic, ingredients, instructions, proposal(1, 0, { kind: 'remaining' }),
    )
    expect(merged.steps[1].ingredients).toEqual([
      { ingredientIndex: 0, confidence: 'high', provenance: 'ai', usage: { kind: 'remaining' } },
    ])
  })

  it('rejects a consumed row without explicit reuse', async () => {
    const ingredients = ['1 tsp salt']
    const instructions = ['Add salt.', 'Season again with salt.']
    const deterministic = await buildHashedDeterministicCookingStepMap(ingredients, instructions)
    deterministic.steps[1] = { instructionIndex: 1, ingredients: [], unresolvedReason: 'ambiguous' }
    expect(mergeValidatedAiCookingMappings(deterministic, ingredients, instructions, proposal(1, 0)).steps[1].ingredients).toEqual([])
  })

  it('rejects a wrong-group duplicate row', async () => {
    const ingredients = ['For the marinade:', '1 tsp salt', 'For the sauce:', '1 tsp salt']
    const instructions = ['For the marinade, add salt.', 'For the sauce, add salt.']
    const deterministic = await buildHashedDeterministicCookingStepMap(ingredients, instructions)
    deterministic.steps[1] = { instructionIndex: 1, ingredients: [], unresolvedReason: 'ambiguous' }
    expect(mergeValidatedAiCookingMappings(deterministic, ingredients, instructions, proposal(1, 1)).steps[1].ingredients).toEqual([])
  })

  it('rejects listed soup water for a fresh boiling-water proposal', async () => {
    const ingredients = ['1 cup water']
    const instructions = ['Bring a pot of water to boil for the eggs.']
    const deterministic = await buildHashedDeterministicCookingStepMap(ingredients, instructions)
    deterministic.steps[0].unresolvedReason = 'ambiguous'
    expect(mergeValidatedAiCookingMappings(deterministic, ingredients, instructions, proposal(0, 0)).steps[0].ingredients).toEqual([])
  })

  it('rejects an incompatible AI quantity', async () => {
    const ingredients = ['1 tablespoon soy sauce']
    const instructions = ['Add 2 tablespoons soy sauce.']
    const deterministic = await buildHashedDeterministicCookingStepMap(ingredients, instructions)
    expect(mergeValidatedAiCookingMappings(
      deterministic, ingredients, instructions, proposal(0, 0, { kind: 'partial', quantityText: '2 tablespoons' }),
    ).steps[0].ingredients).toEqual([])
  })

  it('accepts an exact compatible AI partial quantity', async () => {
    const ingredients = ['3 ½ tablespoons soy sauce']
    const instructions = ['Add 2 ½ tablespoons soy sauce.']
    const deterministic = await buildHashedDeterministicCookingStepMap(ingredients, instructions)
    deterministic.steps[0] = { instructionIndex: 0, ingredients: [], unresolvedReason: 'ambiguous' }
    const merged = mergeValidatedAiCookingMappings(
      deterministic, ingredients, instructions, proposal(0, 0, { kind: 'partial', quantityText: '2 ½ tablespoons' }),
    )
    expect(merged.steps[0].ingredients[0].usage).toEqual({ kind: 'partial', quantityText: '2 ½ tablespoons' })
    expect(merged.engineVersion).toBe('hybrid-v5')
  })

  it('uses an earlier accepted AI row as consumed lifecycle state', async () => {
    const ingredients = ['salt']
    const instructions = ['Add salt.', 'Season again with salt.']
    const deterministic = await buildHashedDeterministicCookingStepMap(ingredients, instructions)
    deterministic.steps = instructions.map((_, instructionIndex) => ({ instructionIndex, ingredients: [], unresolvedReason: 'ambiguous' }))
    const merged = mergeValidatedAiCookingMappings(deterministic, ingredients, instructions, {
      steps: [
        { instructionIndex: 0, ingredients: [{ ingredientIndex: 0, confidence: 'high' }], preparedComponents: [] },
        { instructionIndex: 1, ingredients: [{ ingredientIndex: 0, confidence: 'high' }], preparedComponents: [] },
      ],
    })
    expect(merged.steps[0].ingredients).toHaveLength(1)
    expect(merged.steps[1].ingredients).toEqual([])
  })
})

describe('persisted v4 compatibility under the v5 runtime', () => {
  it('accepts a source-bound deterministic-v4 map', async () => {
    const ingredients = ['salt']
    const instructions = ['Add salt.']
    const persisted = await buildHashedDeterministicCookingStepMap(ingredients, instructions)
    persisted.engineVersion = 'deterministic-v4'
    await expect(resolveCookingStepIngredientMap(ingredients, instructions, persisted)).resolves.toEqual({
      mapping: persisted,
      source: 'persisted',
    })
  })

  it('accepts a structurally valid source-bound hybrid-v4 map', async () => {
    const ingredients = ['For the sauce:', '1 tbsp olive oil']
    const instructions = ['Add the oil to the marinade.']
    const persisted: CookingStepIngredientMap = {
      schemaVersion: 1,
      parserVersion: 'recipe-content-v1',
      engineVersion: 'hybrid-v4',
      sourceHash: await computeCookingMappingSourceHash(ingredients, instructions),
      steps: [{ instructionIndex: 0, ingredients: [{ ingredientIndex: 1, confidence: 'high', provenance: 'ai' }] }],
    }
    await expect(resolveCookingStepIngredientMap(ingredients, instructions, persisted)).resolves.toMatchObject({ source: 'persisted' })
  })

  it('continues to reject persisted v1-v3 engine versions', async () => {
    for (const engineVersion of ['deterministic-v1', 'hybrid-v1', 'deterministic-v2', 'hybrid-v2', 'deterministic-v3', 'hybrid-v3']) {
      const ingredients = ['salt']
      const instructions = ['Add salt.']
      const persisted = await buildHashedDeterministicCookingStepMap(ingredients, instructions)
      persisted.engineVersion = engineVersion
      await expect(resolveCookingStepIngredientMap(ingredients, instructions, persisted)).resolves.toMatchObject({
        source: 'deterministic-fallback', fallbackReason: 'unsupported-engine',
      })
    }
  })

  it('still rejects a v4 source-hash mismatch', async () => {
    const persisted = await buildHashedDeterministicCookingStepMap(['salt'], ['Add salt.'])
    persisted.engineVersion = 'deterministic-v4'
    await expect(resolveCookingStepIngredientMap(['sea salt'], ['Add salt.'], persisted)).resolves.toMatchObject({
      source: 'deterministic-fallback', fallbackReason: 'source-hash-mismatch',
    })
  })

  it('still rejects malformed deterministic-v4 structure', async () => {
    const ingredients = ['salt']
    const instructions = ['Add salt.']
    const persisted = await buildHashedDeterministicCookingStepMap(ingredients, instructions)
    persisted.engineVersion = 'deterministic-v4'
    persisted.steps[0].ingredients[0].ingredientIndex = 99
    await expect(resolveCookingStepIngredientMap(ingredients, instructions, persisted)).resolves.toMatchObject({
      source: 'deterministic-fallback', fallbackReason: 'invalid-structure',
    })
  })

  it('does not accept AI provenance under deterministic-v4', async () => {
    const ingredients = ['salt']
    const instructions = ['Add salt.']
    const persisted = await buildHashedDeterministicCookingStepMap(ingredients, instructions)
    persisted.engineVersion = 'deterministic-v4'
    persisted.steps[0].ingredients[0].provenance = 'ai'
    await expect(resolveCookingStepIngredientMap(ingredients, instructions, persisted)).resolves.toMatchObject({
      source: 'deterministic-fallback', fallbackReason: 'invalid-structure',
    })
  })

  it('keeps both v5 validation scripts free of a Firestore write path', () => {
    for (const script of [
      'scripts/validate-recovered-recipe-mappings-v5.mjs',
      'scripts/validate-recovered-recipe-mappings-v5-ai.mjs',
    ]) {
      const source = readFileSync(script, 'utf8')
      expect(source).not.toMatch(/\b(?:setDoc|updateDoc|deleteDoc|writeBatch|runTransaction|bulkWriter)\s*\(|\.batch\s*\(|\.commit\s*\(/)
    }
  })
})
