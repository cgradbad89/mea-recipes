import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ generateAIObject: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/ai', () => ({ generateAIObject: mocks.generateAIObject }))

import {
  buildCookingStepMappingPrompt,
  mergeValidatedAiCookingMappings,
  resolveCookingStepMappingsWithAi,
} from '@/lib/cookingStepMappingAi'
import type { CookingStepIngredientMap } from '@/types/recipe'

const HASH = 'a'.repeat(64)

function deterministicMap(
  unresolvedReason: 'ambiguous' | 'implicit-reference' | 'prepared-component' | 'no-ingredient-use' | undefined = 'ambiguous',
  ingredientIndexes: number[] = [],
  instructionCount = 1,
): CookingStepIngredientMap {
  return {
    schemaVersion: 1,
    parserVersion: 'recipe-content-v1',
    engineVersion: 'deterministic-v3',
    sourceHash: HASH,
    steps: Array.from({ length: instructionCount }, (_, instructionIndex) => ({
      instructionIndex,
      ingredients: instructionIndex === 0
        ? ingredientIndexes.map(ingredientIndex => ({
          ingredientIndex,
          confidence: 'high' as const,
          provenance: 'deterministic' as const,
        }))
        : [],
      ...(instructionIndex === 0 && unresolvedReason ? { unresolvedReason } : {}),
    })),
  }
}

function output(
  instructionIndex: number,
  ingredients: Array<Record<string, unknown>> = [],
  preparedComponents: Array<Record<string, unknown>> = [],
) {
  return { steps: [{ instructionIndex, ingredients, preparedComponents }] }
}

describe('validated AI cooking-step mapping merge', () => {
  it('accepts a valid high-confidence ingredient for an unresolved step', () => {
    const merged = mergeValidatedAiCookingMappings(
      deterministicMap(),
      ['olive oil'],
      ['Add the oil to the marinade.'],
      output(0, [{ ingredientIndex: 0, confidence: 'high' }]),
    )
    expect(merged.engineVersion).toBe('hybrid-v3')
    expect(merged.steps[0]).toEqual({
      instructionIndex: 0,
      ingredients: [{ ingredientIndex: 0, confidence: 'high', provenance: 'ai' }],
    })
  })

  it('preserves deterministic mappings while adding a distinct AI reference', () => {
    const merged = mergeValidatedAiCookingMappings(
      deterministicMap('ambiguous', [0]),
      ['garlic', 'olive oil'],
      ['Add the garlic and oil.'],
      output(0, [{ ingredientIndex: 1, confidence: 'high' }]),
    )
    expect(merged.steps[0].ingredients).toEqual([
      { ingredientIndex: 0, confidence: 'high', provenance: 'deterministic' },
      { ingredientIndex: 1, confidence: 'high', provenance: 'ai' },
    ])
  })

  it('does not let AI replace or restate a deterministic reference', () => {
    const merged = mergeValidatedAiCookingMappings(
      deterministicMap('ambiguous', [0]),
      ['olive oil'],
      ['Add remaining oil.'],
      output(0, [{
        ingredientIndex: 0,
        confidence: 'high',
        usage: { kind: 'remaining' },
      }]),
    )
    expect(merged.engineVersion).toBe('deterministic-v3')
    expect(merged.steps[0].ingredients).toEqual([
      { ingredientIndex: 0, confidence: 'high', provenance: 'deterministic' },
    ])
  })

  it('rejects an out-of-range ingredient index', () => {
    const merged = mergeValidatedAiCookingMappings(
      deterministicMap(), ['salt'], ['Season.'],
      output(0, [{ ingredientIndex: 9, confidence: 'high' }]),
    )
    expect(merged.steps[0].ingredients).toEqual([])
  })

  it('rejects an ingredient-header index', () => {
    const merged = mergeValidatedAiCookingMappings(
      deterministicMap(), ['For the sauce:', 'salt'], ['Make the sauce.'],
      output(0, [{ ingredientIndex: 0, confidence: 'high' }]),
    )
    expect(merged.steps[0].ingredients).toEqual([])
  })

  it('rejects an invalid instruction index', () => {
    const merged = mergeValidatedAiCookingMappings(
      deterministicMap(), ['salt'], ['Season.'],
      output(3, [{ ingredientIndex: 0, confidence: 'high' }]),
    )
    expect(merged.steps[0].ingredients).toEqual([])
  })

  it('rejects proposals for an already resolved step', () => {
    const resolvedMap = deterministicMap()
    delete resolvedMap.steps[0].unresolvedReason
    const merged = mergeValidatedAiCookingMappings(
      resolvedMap, ['salt'], ['Season.'],
      output(0, [{ ingredientIndex: 0, confidence: 'high' }]),
    )
    expect(merged.steps[0].ingredients).toEqual([])
  })

  it('never treats no-ingredient-use as AI eligible', () => {
    const merged = mergeValidatedAiCookingMappings(
      deterministicMap('no-ingredient-use'), ['salt'], ['Preheat oven.'],
      output(0, [{ ingredientIndex: 0, confidence: 'high' }]),
    )
    expect(merged.steps[0]).toMatchObject({ ingredients: [], unresolvedReason: 'no-ingredient-use' })
  })

  it('rejects uncertain ingredient proposals', () => {
    const merged = mergeValidatedAiCookingMappings(
      deterministicMap(), ['salt'], ['Season.'],
      output(0, [{ ingredientIndex: 0, confidence: 'uncertain' }]),
    )
    expect(merged.steps[0].ingredients).toEqual([])
  })

  it('deduplicates repeated AI ingredient indexes', () => {
    const merged = mergeValidatedAiCookingMappings(
      deterministicMap(), ['salt'], ['Season with salt.'],
      output(0, [
        { ingredientIndex: 0, confidence: 'high' },
        { ingredientIndex: 0, confidence: 'high' },
      ]),
    )
    expect(merged.steps[0].ingredients).toHaveLength(1)
  })

  it('rejects competing duplicate ingredient rows returned together', () => {
    const merged = mergeValidatedAiCookingMappings(
      deterministicMap(),
      ['For the marinade:', '1 tbsp olive oil', 'For the sauce:', '2 tbsp olive oil'],
      ['Add the olive oil.'],
      output(0, [
        { ingredientIndex: 1, confidence: 'high' },
        { ingredientIndex: 3, confidence: 'high' },
      ]),
    )
    expect(merged.steps[0].ingredients).toEqual([])
  })

  it('rejects one arbitrarily selected duplicate group row without positive group evidence', () => {
    const merged = mergeValidatedAiCookingMappings(
      deterministicMap(),
      ['For the marinade:', '1 tbsp olive oil', 'For the sauce:', '2 tbsp olive oil'],
      ['Add the olive oil.'],
      output(0, [{ ingredientIndex: 1, confidence: 'high' }]),
    )
    expect(merged.steps[0].ingredients).toEqual([])
  })

  it('accepts a duplicate row when the instruction explicitly names its group', () => {
    const merged = mergeValidatedAiCookingMappings(
      deterministicMap(),
      ['For the marinade:', '1 tbsp olive oil', 'For the sauce:', '2 tbsp olive oil'],
      ['For the sauce, add the olive oil.'],
      output(0, [{ ingredientIndex: 3, confidence: 'high' }]),
    )
    expect(merged.steps[0].ingredients).toEqual([
      { ingredientIndex: 3, confidence: 'high', provenance: 'ai' },
    ])
  })

  it('accepts remaining usage only when grounded in the instruction', () => {
    const merged = mergeValidatedAiCookingMappings(
      deterministicMap(), ['olive oil'], ['Add the remaining oil.'],
      output(0, [{ ingredientIndex: 0, confidence: 'high', usage: { kind: 'remaining' } }]),
    )
    expect(merged.steps[0].ingredients[0].usage).toEqual({ kind: 'remaining' })
  })

  it('drops invented quantity text while retaining an explicit association', () => {
    const merged = mergeValidatedAiCookingMappings(
      deterministicMap(), ['butter'], ['Add half the butter.'],
      output(0, [{
        ingredientIndex: 0,
        confidence: 'high',
        usage: { kind: 'partial', quantityText: '1 cup' },
      }]),
    )
    expect(merged.steps[0].ingredients).toEqual([
      { ingredientIndex: 0, confidence: 'high', provenance: 'ai' },
    ])
  })

  it('drops locally invalid usage while retaining an independently grounded association', () => {
    const merged = mergeValidatedAiCookingMappings(
      deterministicMap(), ['salt'], ['Add salt, then toss to coat all pieces.'],
      output(0, [{ ingredientIndex: 0, confidence: 'high', usage: { kind: 'all' } }]),
    )
    expect(merged.steps[0].ingredients).toEqual([
      { ingredientIndex: 0, confidence: 'high', provenance: 'ai' },
    ])
  })

  it('drops an association that depends on invalid ungrounded usage', () => {
    const merged = mergeValidatedAiCookingMappings(
      deterministicMap(), ['butter'], ['Add half to the pan.'],
      output(0, [{
        ingredientIndex: 0,
        confidence: 'high',
        usage: { kind: 'partial', quantityText: 'half' },
      }]),
    )
    expect(merged.steps[0].ingredients).toEqual([])
  })

  it('does not attach quantity text from a different local ingredient phrase', () => {
    const merged = mergeValidatedAiCookingMappings(
      deterministicMap(), ['water', 'butter'], ['Add 1 cup water, then stir in the butter.'],
      output(0, [{
        ingredientIndex: 1,
        confidence: 'high',
        usage: { kind: 'partial', quantityText: '1 cup' },
      }]),
    )
    expect(merged.steps[0].ingredients).toEqual([
      { ingredientIndex: 1, confidence: 'high', provenance: 'ai' },
    ])
  })

  it('rejects generic remaining-ingredients expansion', () => {
    const merged = mergeValidatedAiCookingMappings(
      deterministicMap('implicit-reference'), ['canola oil', 'pork shoulder'], ['Add remaining ingredients.'],
      output(0, [{ ingredientIndex: 0, confidence: 'high', usage: { kind: 'remaining' } }]),
    )
    expect(merged.steps[0].ingredients).toEqual([])
  })

  it('rejects generic everything expansion', () => {
    const merged = mergeValidatedAiCookingMappings(
      deterministicMap('implicit-reference'), ['salt', 'olive oil'], ['Add everything to the pot.'],
      output(0, [
        { ingredientIndex: 0, confidence: 'high', usage: { kind: 'all' } },
        { ingredientIndex: 1, confidence: 'high', usage: { kind: 'all' } },
      ]),
    )
    expect(merged.steps[0].ingredients).toEqual([])
  })

  it('accepts collective all only for a valid named group', () => {
    const merged = mergeValidatedAiCookingMappings(
      deterministicMap('implicit-reference'),
      ['For the dressing:', 'olive oil', 'lemon juice', 'For the salad:', 'lettuce'],
      ['Combine all dressing ingredients.'],
      output(0, [
        { ingredientIndex: 1, confidence: 'high', usage: { kind: 'all' } },
        { ingredientIndex: 2, confidence: 'high', usage: { kind: 'all' } },
      ]),
    )
    expect(merged.steps[0].ingredients.map(reference => reference.ingredientIndex)).toEqual([1, 2])
    expect(merged.steps[0].ingredients.every(reference => reference.usage?.kind === 'all')).toBe(true)
  })

  it('rejects a negative-context ingredient proposal', () => {
    const merged = mergeValidatedAiCookingMappings(
      deterministicMap(), ['olive oil'], ['Do not add the olive oil yet.'],
      output(0, [{ ingredientIndex: 0, confidence: 'high' }]),
    )
    expect(merged.steps[0].ingredients).toEqual([])
  })

  it('rejects a mapping against reader-review prose', () => {
    const merged = mergeValidatedAiCookingMappings(
      deterministicMap(), ['pasta'], ['I made this for friends last night and added the pasta. Delicious!'],
      output(0, [{ ingredientIndex: 0, confidence: 'high' }]),
    )
    expect(merged.steps[0].ingredients).toEqual([])
  })

  it('accepts explicit quantity text grounded verbatim in the instruction', () => {
    const merged = mergeValidatedAiCookingMappings(
      deterministicMap(), ['Parmesan cheese'], ['Reserve ¼ cup of the cheese.'],
      output(0, [{
        ingredientIndex: 0,
        confidence: 'high',
        usage: { kind: 'partial', quantityText: '¼ cup' },
      }]),
    )
    expect(merged.steps[0].ingredients[0].usage).toEqual({ kind: 'partial', quantityText: '¼ cup' })
  })

  it('accepts a high-confidence prepared component grounded by a group header', () => {
    const merged = mergeValidatedAiCookingMappings(
      deterministicMap('prepared-component'),
      ['For the green sauce:', 'cilantro'],
      ['Spoon the sauce over the chicken.'],
      output(0, [], [{ label: 'green sauce', confidence: 'high' }]),
    )
    expect(merged.steps[0].preparedComponents).toEqual([
      { label: 'green sauce', confidence: 'high', provenance: 'ai' },
    ])
  })

  it('rejects an invented prepared-component label', () => {
    const merged = mergeValidatedAiCookingMappings(
      deterministicMap('prepared-component'),
      ['cilantro'],
      ['Spoon the sauce over the chicken.'],
      output(0, [], [{ label: 'magic sauce', confidence: 'high' }]),
    )
    expect(merged.steps[0].preparedComponents).toBeUndefined()
  })

  it('rejects unspecified toppings as an invented component', () => {
    const merged = mergeValidatedAiCookingMappings(
      deterministicMap('prepared-component'),
      ['black beans', 'salsa verde'],
      ['Serve immediately with desired toppings.'],
      output(0, [], [{ label: 'desired toppings', confidence: 'high' }]),
    )
    expect(merged.steps[0].preparedComponents).toBeUndefined()
  })

  it('canonicalizes a generic current reference to its established group component', () => {
    const merged = mergeValidatedAiCookingMappings(
      deterministicMap('prepared-component'),
      ['For the green sauce:', 'cilantro', 'jalapeño'],
      ['Spoon the sauce over the chicken.'],
      output(0, [], [{ label: 'sauce', confidence: 'high' }]),
    )
    expect(merged.steps[0].preparedComponents).toEqual([
      { label: 'green sauce', confidence: 'high', provenance: 'ai' },
    ])
  })

  it('canonicalizes a later generic reference to an earlier created component', () => {
    const map = deterministicMap('prepared-component', [], 2)
    map.steps[1].unresolvedReason = 'prepared-component'
    const merged = mergeValidatedAiCookingMappings(
      map,
      ['cilantro', 'jalapeño', 'yogurt'],
      ['Blend cilantro, jalapeño and yogurt into a green sauce.', 'Serve with the sauce.'],
      output(1, [], [{ label: 'sauce', confidence: 'high' }]),
    )
    expect(merged.steps[1].preparedComponents).toEqual([
      { label: 'green sauce', confidence: 'high', provenance: 'ai' },
    ])
  })

  it('rejects an AI-renamed component when only a different canonical component exists', () => {
    const merged = mergeValidatedAiCookingMappings(
      deterministicMap('prepared-component'),
      ['For the green sauce:', 'cilantro'],
      ['Spoon the sauce over the chicken.'],
      output(0, [], [{ label: 'emerald topping', confidence: 'high' }]),
    )
    expect(merged.steps[0].preparedComponents).toBeUndefined()
  })

  it.each([
    ['salt soy sauce', 'Combine salt and soy sauce, then set aside.'],
    ['serving prepare tadka', 'Just before serving, prepare the tadka.'],
    ['to make dressing', 'Whisk the oil and vinegar to make the dressing.'],
    ['cup of marinade', 'Stir the liquids together. Reserve 1/2 cup of the marinade.'],
    ['worcestershire hot sauce', 'Stir Worcestershire and hot sauce together.'],
  ])('rejects expanded noncanonical component label %s', (label, antecedent) => {
    const map = deterministicMap('prepared-component', [], 2)
    map.steps[1].unresolvedReason = 'prepared-component'
    const merged = mergeValidatedAiCookingMappings(
      map,
      ['Worcestershire sauce', 'hot sauce'],
      [antecedent, 'Serve with the sauce.'],
      output(1, [], [{ label, confidence: 'high' }]),
    )
    expect(merged.steps[1].preparedComponents).toBeUndefined()
  })

  it('accepts the canonical component established by an explicit prepare antecedent', () => {
    const map = deterministicMap('prepared-component', [], 2)
    map.steps[1].unresolvedReason = 'prepared-component'
    const merged = mergeValidatedAiCookingMappings(
      map,
      ['mustard seeds', 'cumin seeds'],
      ['Just before serving, prepare the tadka.', 'Pour the tadka over the curry.'],
      output(1, [], [{ label: 'tadka', confidence: 'high' }]),
    )
    expect(merged.steps[1].preparedComponents).toEqual([
      { label: 'tadka', confidence: 'high', provenance: 'ai' },
    ])
  })

  it('keeps a valid sibling when another association is invalid', () => {
    const merged = mergeValidatedAiCookingMappings(
      deterministicMap(), ['salt'], ['Season with salt.'],
      output(0, [
        { ingredientIndex: 0, confidence: 'high' },
        { ingredientIndex: 99, confidence: 'high' },
      ]),
    )
    expect(merged.steps[0].ingredients).toEqual([
      { ingredientIndex: 0, confidence: 'high', provenance: 'ai' },
    ])
  })
})

describe('AI request construction', () => {
  beforeEach(() => mocks.generateAIObject.mockReset())

  it('includes complete indexed context, headers, locked mappings, and unresolved reasons', () => {
    const prompt = buildCookingStepMappingPrompt(
      deterministicMap('ambiguous', [1]),
      ['For the sauce:', 'olive oil'],
      ['Add the oil.'],
    )
    expect(prompt).toContain('[0] GROUP HEADER: For the sauce:')
    expect(prompt).toContain('[1] INGREDIENT (group: sauce): olive oil')
    expect(prompt).toContain('locked deterministic ingredient indexes: 1')
    expect(prompt).toContain('0:ambiguous')
    expect(prompt).toContain('prompt version: v2')
  })

  it('uses the centralized structured AI helper exactly once', async () => {
    const response = { steps: [] }
    mocks.generateAIObject.mockResolvedValueOnce(response)
    await expect(resolveCookingStepMappingsWithAi(
      deterministicMap(), ['salt'], ['Season.'], 'user-123',
    )).resolves.toEqual(response)
    expect(mocks.generateAIObject).toHaveBeenCalledTimes(1)
    expect(mocks.generateAIObject).toHaveBeenCalledWith(expect.objectContaining({
      feature: 'cooking-step-map',
      userId: 'user-123',
      promptVersion: 'v2',
      temperature: 0,
      schema: expect.anything(),
    }))
  })
})
