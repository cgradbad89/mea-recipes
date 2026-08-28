import { describe, expect, it } from 'vitest'

import type { BlindCookingReview } from '@/lib/cookingStepBlindReviewerAi'
import {
  buildCookingMapCandidatePool,
  mergeArbitratedCookingStepMap,
  type CookingMapArbitrationLike,
} from '@/lib/cookingStepMapConsensus'
import { buildHashedDeterministicCookingStepMap } from '@/lib/cookingStepMapping'

function review(steps: Array<{ indexes: number[]; components?: string[] }>): BlindCookingReview {
  return {
    steps: steps.map((step, instructionIndex) => ({
      instructionIndex,
      expectedIngredientIndexes: step.indexes,
      preparedComponents: (step.components || []).map(label => ({ label })),
      explicitActiveUseIndexes: step.indexes,
      ingredientAssessments: step.indexes.map(ingredientIndex => ({
        ingredientIndex,
        level: 'HIGH',
        kind: 'SUBSTANTIAL',
      })),
      confidence: 'high',
      reasoningCategory: step.indexes.length ? 'EXPLICIT_ACTIVE_USE' : 'OTHER',
    })),
  }
}

function acceptPool(pool: ReturnType<typeof buildCookingMapCandidatePool>): CookingMapArbitrationLike {
  return {
    ingredientRelations: pool.ingredientRelations.map(item => ({
      instructionIndex: item.instructionIndex,
      ingredientIndex: item.ingredientIndex,
      decision: 'ACCEPT',
      evidenceText: item.rawInstruction,
    })),
    components: pool.components.map(item => ({
      instructionIndex: item.instructionIndex,
      proposedLabel: item.proposedLabel,
      decision: 'ACCEPT',
      canonicalLabel: item.proposedLabel,
      evidenceText: item.proposedLabel,
    })),
  }
}

describe('cooking-map candidate union', () => {
  it('records deterministic, intersection, and singleton origins while deduplicating', async () => {
    const ingredients = ['salt', 'potatoes', 'pepper']
    const instructions = ['Cook the potatoes with salt and pepper.']
    const deterministic = await buildHashedDeterministicCookingStepMap(ingredients, instructions)
    deterministic.steps[0].ingredients = [
      { ingredientIndex: 0, confidence: 'high', provenance: 'deterministic' },
    ]
    const pool = buildCookingMapCandidatePool(
      deterministic,
      ingredients,
      instructions,
      review([{ indexes: [0, 1, 1] }]),
      review([{ indexes: [0, 2] }]),
    )
    expect(pool.ingredientRelations).toEqual([
      expect.objectContaining({ ingredientIndex: 0, origins: ['DETERMINISTIC', 'BOTH_REVIEWERS'] }),
      expect.objectContaining({ ingredientIndex: 1, origins: ['A_ONLY'] }),
      expect.objectContaining({ ingredientIndex: 2, origins: ['B_ONLY'] }),
    ])
  })

  it('groups a unique generic component alias under its source-grounded full label', async () => {
    const ingredients = ['For the green harissa dressing:', '1 tbsp olive oil']
    const instructions = ['Whisk the green harissa dressing.']
    const deterministic = await buildHashedDeterministicCookingStepMap(ingredients, instructions)
    const pool = buildCookingMapCandidatePool(
      deterministic,
      ingredients,
      instructions,
      review([{ indexes: [1], components: ['dressing'] }]),
      review([{ indexes: [1], components: ['green harissa dressing'] }]),
    )
    expect(pool.components).toEqual([{
      instructionIndex: 0,
      proposedLabel: 'green harissa dressing',
      origins: ['BOTH_REVIEWERS'],
    }])
  })
})

describe('arbiter merge and narrow hard safety', () => {
  it('allows the arbiter to reject a deterministic-v5 relationship', async () => {
    const ingredients = ['chili sauce']
    const instructions = ['Serve the chili hot.']
    const deterministic = await buildHashedDeterministicCookingStepMap(ingredients, instructions)
    deterministic.steps[0].ingredients = [{ ingredientIndex: 0, confidence: 'high', provenance: 'deterministic' }]
    const reviews = review([{ indexes: [] }])
    const pool = buildCookingMapCandidatePool(deterministic, ingredients, instructions, reviews, reviews)
    const arbitration = acceptPool(pool)
    arbitration.ingredientRelations[0].decision = 'REJECT'
    const result = await mergeArbitratedCookingStepMap(
      deterministic, ingredients, instructions, pool, arbitration,
    )
    expect(result.mapping.engineVersion).toBe('hybrid-v9')
    expect(result.mapping.steps[0].ingredients).toEqual([])
  })

  it('retains source-grounded missing potatoes and seasoning', async () => {
    const ingredients = ['2 potatoes', '1 tsp Italian herbs', '1 tsp black pepper']
    const instructions = ['Cook the potatoes with Italian herbs and black pepper.']
    const deterministic = await buildHashedDeterministicCookingStepMap(ingredients, instructions)
    deterministic.steps[0].ingredients = []
    const reviews = review([{ indexes: [0, 1, 2] }])
    const pool = buildCookingMapCandidatePool(deterministic, ingredients, instructions, reviews, reviews)
    const result = await mergeArbitratedCookingStepMap(
      deterministic, ingredients, instructions, pool, acceptPool(pool),
    )
    expect(result.mapping.steps[0].ingredients.map(item => item.ingredientIndex)).toEqual([0, 1, 2])
    expect(result.diagnostics.every(item => item.retained)).toBe(true)
  })

  it.each([
    {
      name: 'negative evidence',
      ingredients: ['1 tbsp oil'],
      instructions: ['Do not add the oil yet.'],
      expectedReason: 'negative-or-deferred-evidence',
    },
    {
      name: 'fresh process material',
      ingredients: ['1 cup water'],
      instructions: ['Bring a pot of additional hot water to a boil.'],
      expectedReason: 'fresh-process-material-hijack',
    },
    {
      name: 'quantity contradiction',
      ingredients: ['1 cup water'],
      instructions: ['Add 2 cups water to the pot.'],
      expectedReason: 'quantity-contradiction',
    },
    {
      name: 'finished dish collision',
      ingredients: ['2 tbsp chili sauce'],
      instructions: ['Cook the chili until hot.'],
      expectedReason: 'finished-dish-or-compound-name-collision',
    },
  ])('blocks the $name root cause after arbiter ACCEPT', async ({ ingredients, instructions, expectedReason }) => {
    const deterministic = await buildHashedDeterministicCookingStepMap(ingredients, instructions)
    deterministic.steps[0].ingredients = []
    const reviews = review([{ indexes: [0] }])
    const pool = buildCookingMapCandidatePool(deterministic, ingredients, instructions, reviews, reviews)
    const result = await mergeArbitratedCookingStepMap(
      deterministic, ingredients, instructions, pool, acceptPool(pool),
    )
    expect(result.mapping.steps[0].ingredients).toEqual([])
    expect(result.diagnostics[0]).toMatchObject({ retained: false, reason: expectedReason })
  })

  it('blocks reuse of a consumed prepared-component row without explicit reuse', async () => {
    const ingredients = ['For the vinaigrette:', '1 tsp salt']
    const instructions = ['Whisk the salt into the vinaigrette.', 'Season the salad with salt.']
    const deterministic = await buildHashedDeterministicCookingStepMap(ingredients, instructions)
    deterministic.steps.forEach(step => { step.ingredients = [] })
    const reviews = review([{ indexes: [1] }, { indexes: [1] }])
    const pool = buildCookingMapCandidatePool(deterministic, ingredients, instructions, reviews, reviews)
    const result = await mergeArbitratedCookingStepMap(
      deterministic, ingredients, instructions, pool, acceptPool(pool),
    )
    expect(result.mapping.steps[0].ingredients.map(item => item.ingredientIndex)).toEqual([1])
    expect(result.mapping.steps[1].ingredients).toEqual([])
    expect(result.diagnostics.at(-1)?.reason).toBe('consumed-row-reused-without-explicit-reuse')
  })

  it('blocks raw constituent leakage from a component-only action', async () => {
    const ingredients = ['For the dressing:', '1 tbsp olive oil']
    const instructions = ['Whisk the dressing with olive oil.', 'Pour the dressing over the salad.']
    const deterministic = await buildHashedDeterministicCookingStepMap(ingredients, instructions)
    deterministic.steps.forEach(step => { step.ingredients = [] })
    const reviews = review([
      { indexes: [1], components: ['dressing'] },
      { indexes: [1], components: ['dressing'] },
    ])
    const pool = buildCookingMapCandidatePool(deterministic, ingredients, instructions, reviews, reviews)
    const arbitration = acceptPool(pool)
    const result = await mergeArbitratedCookingStepMap(
      deterministic, ingredients, instructions, pool, arbitration,
    )
    expect(result.mapping.steps[1].ingredients).toEqual([])
    expect(result.diagnostics.find(item => item.kind === 'ingredient' && item.instructionIndex === 1)?.reason)
      .toBe('prepared-component-constituent-leakage')
  })
})
