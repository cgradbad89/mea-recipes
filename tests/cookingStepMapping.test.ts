import { describe, expect, it } from 'vitest'
import {
  buildHashedDeterministicCookingStepMap,
  buildDeterministicCookingStepMap,
  canonicalizeCookingMappingSource,
  computeCookingMappingSourceHash,
  resolveCookingStepIngredientMap,
} from '@/lib/cookingStepMapping'
import type { CookingStepIngredientMap } from '@/types/recipe'

function indexes(ingredients: string[], instruction: string): number[] {
  return buildDeterministicCookingStepMap(ingredients, [instruction]).steps[0].ingredients
    .map(reference => reference.ingredientIndex)
}

describe('cooking mapping source fingerprint', () => {
  it('canonicalizes the same source stably', () => {
    const ingredients = ['1 cup rice', 'salt']
    const instructions = ['Cook the rice.', 'Season with salt.']
    expect(canonicalizeCookingMappingSource(ingredients, instructions))
      .toBe(canonicalizeCookingMappingSource([...ingredients], [...instructions]))
  })

  it('uses a lossless stable JSON shape', () => {
    expect(canonicalizeCookingMappingSource(['  salt'], ['Add salt.']))
      .toBe('{"ingredients":["  salt"],"instructions":["Add salt."]}')
  })

  it('produces a stable lowercase SHA-256 hash', async () => {
    const first = await computeCookingMappingSourceHash(['salt'], ['Add salt.'])
    const second = await computeCookingMappingSourceHash(['salt'], ['Add salt.'])
    expect(first).toBe(second)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes the hash when ingredient text changes', async () => {
    await expect(computeCookingMappingSourceHash(['salt'], ['Season.']))
      .resolves.not.toBe(await computeCookingMappingSourceHash(['sea salt'], ['Season.']))
  })

  it('changes the hash when ingredient order changes', async () => {
    await expect(computeCookingMappingSourceHash(['salt', 'oil'], ['Mix.']))
      .resolves.not.toBe(await computeCookingMappingSourceHash(['oil', 'salt'], ['Mix.']))
  })

  it('changes the hash when instruction text changes', async () => {
    await expect(computeCookingMappingSourceHash(['salt'], ['Add salt.']))
      .resolves.not.toBe(await computeCookingMappingSourceHash(['salt'], ['Sprinkle salt.']))
  })

  it('changes the hash when instruction order changes', async () => {
    await expect(computeCookingMappingSourceHash(['salt'], ['Mix.', 'Bake.']))
      .resolves.not.toBe(await computeCookingMappingSourceHash(['salt'], ['Bake.', 'Mix.']))
  })

  it('preserves ingredient headers in the fingerprint', async () => {
    await expect(computeCookingMappingSourceHash(['For the sauce:', 'salt'], ['Mix.']))
      .resolves.not.toBe(await computeCookingMappingSourceHash(['For the dressing:', 'salt'], ['Mix.']))
  })
})

describe('deterministic mapping contract', () => {
  it('returns version metadata and a result for every instruction', () => {
    const result = buildDeterministicCookingStepMap(['salt'], ['Add salt.', 'Rest.'])
    expect(result).toMatchObject({
      schemaVersion: 1,
      parserVersion: 'recipe-content-v1',
      engineVersion: 'deterministic-v3',
    })
    expect(result.steps.map(step => step.instructionIndex)).toEqual([0, 1])
  })

  it('places confidence and provenance on emitted ingredient references', () => {
    expect(buildDeterministicCookingStepMap(['salt'], ['Add salt.']).steps[0].ingredients[0])
      .toEqual({ ingredientIndex: 0, confidence: 'high', provenance: 'deterministic' })
  })

  it('never emits a subheader as an ingredient reference', () => {
    expect(indexes(['For the sauce:', '1 tsp salt'], 'For the sauce, add the salt.')).toEqual([1])
  })

  it('maps exact distinctive multiword identities', () => {
    expect(indexes(['1 tbsp olive oil', '1 tbsp sesame oil'], 'Drizzle with sesame oil.')).toEqual([1])
  })

  it('handles conservative singular and plural forms', () => {
    expect(indexes(['2 chicken breasts, cubed'], 'Brown the chicken breasts.')).toEqual([0])
  })

  it('removes bounded parenthetical notes without replacing the food identity', () => {
    expect(indexes(['1 cup dairy-free yogurt (we love plain Culina)'], 'Stir the yogurt.')).toEqual([0])
  })

  it('keeps distinct oils separate', () => {
    expect(indexes(['olive oil', 'sesame oil'], 'Heat the olive oil.')).toEqual([0])
  })

  it('does not map an unqualified generic oil reference to specific oils', () => {
    const step = buildDeterministicCookingStepMap(['olive oil', 'sesame oil'], ['Add the oil.']).steps[0]
    expect(step.ingredients).toEqual([])
  })

  it('keeps distinct sauces separate', () => {
    expect(indexes(['soy sauce', 'fish sauce', 'oyster sauce'], 'Whisk in the fish sauce.')).toEqual([1])
  })

  it('preserves a temperature word when it distinguishes hot sauce', () => {
    expect(indexes(['hot sauce', 'soy sauce'], 'Finish with hot sauce.')).toEqual([0])
  })

  it('keeps distinct peppers separate', () => {
    expect(indexes(['black pepper', 'bell pepper'], 'Season with black pepper.')).toEqual([0])
  })

  it('keeps distinct powders separate', () => {
    expect(indexes(['chili powder', 'garlic powder'], 'Add the garlic powder.')).toEqual([1])
  })

  it('keeps distinct leaf ingredients separate', () => {
    expect(indexes(['bay leaves', 'mint leaves'], 'Add the bay leaves.')).toEqual([0])
  })

  it('leaves duplicate ingredients unresolved instead of mapping both', () => {
    const step = buildDeterministicCookingStepMap(
      ['For the marinade:', '1 tbsp olive oil', 'For the sauce:', '2 tbsp olive oil'],
      ['Add the olive oil.'],
    ).steps[0]
    expect(step).toMatchObject({ ingredients: [], unresolvedReason: 'ambiguous' })
  })

  it('uses explicit group language to disambiguate duplicates', () => {
    expect(indexes(
      ['For the marinade:', '1 tbsp olive oil', 'For the sauce:', '2 tbsp olive oil'],
      'For the marinade, add the olive oil.',
    )).toEqual([1])
  })

  it('maps explicit repeated use as remaining in multiple steps', () => {
    const steps = buildDeterministicCookingStepMap(
      ['4 tbsp olive oil'],
      ['Heat half the oil.', 'Add the remaining oil.'],
    ).steps
    expect(steps[0].ingredients[0].usage).toEqual({ kind: 'partial', quantityText: 'half' })
    expect(steps[1].ingredients[0].usage).toEqual({ kind: 'remaining' })
  })

  it('preserves an explicit fractional partial quantity', () => {
    const reference = buildDeterministicCookingStepMap(
      ['1 cup grated Parmesan cheese'],
      ['Reserve ¼ cup of the cheese.'],
    ).steps[0].ingredients[0]
    expect(reference.usage).toEqual({ kind: 'partial', quantityText: '¼ cup' })
  })

  it('preserves an explicit tablespoon partial quantity', () => {
    const reference = buildDeterministicCookingStepMap(
      ['3 tbsp olive oil'],
      ['Add 1 tablespoon of the oil.'],
    ).steps[0].ingredients[0]
    expect(reference.usage).toEqual({ kind: 'partial', quantityText: '1 tablespoon' })
  })

  it.each([
    ['Worcestershire sauce', 'Add the prepared sauce.'],
    ['lime juice', 'Stir in the marinade.'],
    ['olive oil', 'Add the prepared dressing.'],
  ])('classifies prepared component references without broad raw matches: %s', (ingredient, instruction) => {
    const step = buildDeterministicCookingStepMap([ingredient], [instruction]).steps[0]
    expect(step).toMatchObject({ ingredients: [], unresolvedReason: 'prepared-component' })
  })

  it('does not treat cheese inside a cheese mixture as a raw use', () => {
    const step = buildDeterministicCookingStepMap(['cheddar cheese'], ['Fold in the cheese mixture.']).steps[0]
    expect(step).toMatchObject({ ingredients: [], unresolvedReason: 'prepared-component' })
  })

  it('leaves recipe-wide collective references unresolved', () => {
    const step = buildDeterministicCookingStepMap(['flour', 'salt'], ['Combine all ingredients.']).steps[0]
    expect(step).toMatchObject({ ingredients: [], unresolvedReason: 'implicit-reference' })
  })

  it('resolves collective references only with explicit group scope', () => {
    const ingredients = ['For the dressing:', 'olive oil', 'lemon juice', 'For the salad:', 'arugula']
    const step = buildDeterministicCookingStepMap(ingredients, ['For the dressing, combine all ingredients.']).steps[0]
    expect(step.ingredients.map(item => [item.ingredientIndex, item.usage?.kind])).toEqual([[1, 'all'], [2, 'all']])
  })

  it('classifies a confident no-ingredient-use step', () => {
    const steps = buildDeterministicCookingStepMap(['asparagus'], ['Preheat oven to 425°F.', 'Bake until browned.']).steps
    expect(steps[0]).toMatchObject({ ingredients: [], unresolvedReason: 'no-ingredient-use' })
    expect(steps[1]).toMatchObject({ ingredients: [], unresolvedReason: 'no-ingredient-use' })
  })
})

describe('investigation regressions', () => {
  it('Pork Posole maps pork shoulder from an explicit pork mention', () => {
    expect(indexes(['2 lb pork shoulder'], 'Brown the pork in batches.')).toEqual([0])
  })

  it("Charlie Bird's Farro Salad maps only bay leaves", () => {
    const ingredients = ['2 bay leaves', 'arugula leaves / greens', 'mint leaves', 'parsley or basil']
    expect(indexes(ingredients, 'Add the bay leaves and simmer.')).toEqual([0])
  })

  it('Butter-Soy Chicken limits a marinade step to its explicit group', () => {
    const ingredients = [
      'For the marinade:', 'oil', 'soy sauce', 'black pepper',
      'For the sauce:', 'sesame oil', 'soy sauce', 'white pepper',
    ]
    expect(indexes(ingredients, 'For the marinade, whisk the oil, soy sauce, and black pepper.')).toEqual([1, 2, 3])
  })

  it('Easy Spaghetti retains garlic and beef identities', () => {
    const ingredients = [
      '2 garlic cloves, minced',
      '½ pound ground beef (preferably 20 percent fat), pork or dark meat turkey',
    ]
    expect(indexes(ingredients, 'Add the garlic and beef and cook until browned.')).toEqual([0, 1])
  })

  it('Roasted Asparagus retains optional Parmesan identity', () => {
    expect(indexes(['¼ cup grated Parmesan cheese (optional)'], 'Sprinkle with Parmesan.')).toEqual([0])
  })

  it('Protein Bars retain food identity through bounded notes', () => {
    expect(indexes(
      ['½ cup natural peanut butter (unsweetened)', '¼ cup unsweetened almond milk (add more as needed)'],
      'Whisk the peanut butter with almond milk.',
    )).toEqual([0, 1])
  })

  it('Beef Brisket does not map Worcestershire sauce from a prepared BBQ sauce reference', () => {
    const step = buildDeterministicCookingStepMap(
      ['2 tbsp Worcestershire sauce'],
      ['Baste generously with BBQ sauce.'],
    ).steps[0]
    expect(step).toMatchObject({ ingredients: [], unresolvedReason: 'prepared-component' })
  })
})

describe('positive controls', () => {
  it('maps Pesto walnuts, garlic, oil, and cheese without collisions', () => {
    const ingredients = ['pine nuts or walnuts', '2 garlic cloves', 'olive oil', 'Parmesan cheese']
    expect(indexes(ingredients, 'Pulse the walnuts and garlic, then stream in olive oil and add Parmesan.'))
      .toEqual([0, 1, 2, 3])
  })

  it('maps roasted asparagus ingredients directly', () => {
    const ingredients = ['asparagus', 'olive oil', 'salt', 'black pepper']
    expect(indexes(ingredients, 'Toss asparagus with olive oil, salt, and black pepper.')).toEqual([0, 1, 2, 3])
  })

  it('maps Japanese teriyaki bowl ingredients directly', () => {
    const ingredients = ['rice', 'avocado', 'edamame', 'cucumber']
    expect(indexes(ingredients, 'Divide rice among bowls and top with avocado, edamame, and cucumber.'))
      .toEqual([0, 1, 2, 3])
  })

  it('maps Taco Soup ingredients directly', () => {
    const ingredients = ['green chiles', 'black beans', 'diced tomatoes', 'chicken broth']
    expect(indexes(ingredients, 'Stir in the chiles, beans, tomatoes, and chicken broth.')).toEqual([0, 1, 2, 3])
  })
})

async function validHybridMap(
  ingredients = ['For the sauce:', '1 tbsp olive oil'],
  instructions = ['Add the oil to the marinade.'],
): Promise<CookingStepIngredientMap> {
  return {
    schemaVersion: 1,
    parserVersion: 'recipe-content-v1',
    engineVersion: 'hybrid-v3',
    sourceHash: await computeCookingMappingSourceHash(ingredients, instructions),
    steps: [{
      instructionIndex: 0,
      ingredients: [{ ingredientIndex: 1, confidence: 'high', provenance: 'ai' }],
    }],
  }
}

async function validPreparedComponentMap(): Promise<{
  ingredients: string[]
  instructions: string[]
  mapping: CookingStepIngredientMap
}> {
  const ingredients = ['For the green sauce:', '1 cup parsley', '1 tbsp olive oil']
  const instructions = ['Toss with the prepared green sauce.']
  return {
    ingredients,
    instructions,
    mapping: {
      schemaVersion: 1,
      parserVersion: 'recipe-content-v1',
      engineVersion: 'hybrid-v3',
      sourceHash: await computeCookingMappingSourceHash(ingredients, instructions),
      steps: [{
        instructionIndex: 0,
        ingredients: [],
        preparedComponents: [{ label: 'Green sauce', confidence: 'high', provenance: 'ai' }],
      }],
    },
  }
}

describe('runtime cooking-step map resolver', () => {
  it('uses the deterministic fallback when no persisted map exists', async () => {
    const result = await resolveCookingStepIngredientMap(['2 garlic cloves'], ['Add the garlic.'])
    expect(result).toMatchObject({ source: 'deterministic-fallback', fallbackReason: 'missing' })
    expect(result.mapping.steps[0].ingredients.map(reference => reference.ingredientIndex)).toEqual([0])
  })

  it('accepts a valid deterministic-v3 persisted map', async () => {
    const ingredients = ['salt']
    const instructions = ['Add salt.']
    const persisted = await buildHashedDeterministicCookingStepMap(ingredients, instructions)
    const result = await resolveCookingStepIngredientMap(ingredients, instructions, persisted)
    expect(result).toEqual({ mapping: persisted, source: 'persisted' })
  })

  it('accepts a valid hybrid-v3 AI-only ingredient association', async () => {
    const persisted = await validHybridMap()
    const ingredients = ['For the sauce:', '1 tbsp olive oil']
    const result = await resolveCookingStepIngredientMap(ingredients, ['Add the oil to the marinade.'], persisted)
    expect(result.source).toBe('persisted')
    expect(result.mapping.steps[0].ingredients[0]).toMatchObject({ ingredientIndex: 1, provenance: 'ai' })
  })

  it('accepts a structurally valid prepared-component association', async () => {
    const fixture = await validPreparedComponentMap()
    const result = await resolveCookingStepIngredientMap(fixture.ingredients, fixture.instructions, fixture.mapping)
    expect(result.source).toBe('persisted')
    expect(result.mapping.steps[0].preparedComponents?.[0].label).toBe('Green sauce')
  })

  it.each([
    ['schemaVersion', 2, 'unsupported-schema'],
    ['parserVersion', 'recipe-content-v2', 'unsupported-parser'],
    ['engineVersion', 'hybrid-v1', 'unsupported-engine'],
  ] as const)('rejects unsupported %s', async (field, value, reason) => {
    const persisted = await validHybridMap()
    const invalid = { ...persisted, [field]: value }
    const result = await resolveCookingStepIngredientMap(
      ['For the sauce:', '1 tbsp olive oil'],
      ['Add the oil to the marinade.'],
      invalid,
    )
    expect(result).toMatchObject({ source: 'deterministic-fallback', fallbackReason: reason })
  })

  it('rejects a deterministic-v1 map after the semantic engine upgrade', async () => {
    const ingredients = ['salt']
    const instructions = ['Add salt.']
    const persisted = await buildHashedDeterministicCookingStepMap(ingredients, instructions)
    persisted.engineVersion = 'deterministic-v1'
    await expect(resolveCookingStepIngredientMap(ingredients, instructions, persisted)).resolves.toMatchObject({
      source: 'deterministic-fallback',
      fallbackReason: 'unsupported-engine',
    })
  })

  it.each(['deterministic-v2', 'hybrid-v2'])('rejects a persisted %s map after the v3 upgrade', async engineVersion => {
    const ingredients = ['salt']
    const instructions = ['Add salt.']
    const persisted = await buildHashedDeterministicCookingStepMap(ingredients, instructions)
    persisted.engineVersion = engineVersion
    await expect(resolveCookingStepIngredientMap(ingredients, instructions, persisted)).resolves.toMatchObject({
      source: 'deterministic-fallback',
      fallbackReason: 'unsupported-engine',
      mapping: { engineVersion: 'deterministic-v3' },
    })
  })

  it('rejects a source-hash mismatch and maps the current source', async () => {
    const persisted = await validHybridMap()
    const result = await resolveCookingStepIngredientMap(
      ['For the sauce:', '1 tbsp avocado oil', 'For the salad:', '1 tbsp avocado oil'],
      ['Add the avocado oil.'],
      persisted,
    )
    expect(result).toMatchObject({ source: 'deterministic-fallback', fallbackReason: 'source-hash-mismatch' })
    expect(result.mapping.sourceHash).not.toBe(persisted.sourceHash)
  })

  it.each([
    ['non-integer instruction index', (map: CookingStepIngredientMap) => { map.steps[0].instructionIndex = 0.5 }],
    ['out-of-range instruction index', (map: CookingStepIngredientMap) => { map.steps[0].instructionIndex = 2 }],
    ['non-integer ingredient index', (map: CookingStepIngredientMap) => { map.steps[0].ingredients[0].ingredientIndex = 1.5 }],
    ['out-of-range ingredient index', (map: CookingStepIngredientMap) => { map.steps[0].ingredients[0].ingredientIndex = 99 }],
    ['ingredient subheader reference', (map: CookingStepIngredientMap) => { map.steps[0].ingredients[0].ingredientIndex = 0 }],
    ['unsupported confidence', (map: CookingStepIngredientMap) => {
      ;(map.steps[0].ingredients[0] as unknown as { confidence: string }).confidence = 'uncertain'
    }],
    ['unsupported provenance', (map: CookingStepIngredientMap) => {
      ;(map.steps[0].ingredients[0] as unknown as { provenance: string }).provenance = 'legacy'
    }],
    ['duplicate ingredient reference', (map: CookingStepIngredientMap) => {
      map.steps[0].ingredients.push({ ...map.steps[0].ingredients[0] })
    }],
    ['invalid usage kind', (map: CookingStepIngredientMap) => {
      ;(map.steps[0].ingredients[0] as unknown as { usage: { kind: string } }).usage = { kind: 'calculated' }
    }],
    ['usage text absent from instruction', (map: CookingStepIngredientMap) => {
      map.steps[0].ingredients[0].usage = { kind: 'partial', quantityText: '¼ cup' }
    }],
  ])('rejects invalid structure: %s', async (_, mutate) => {
    const persisted = await validHybridMap()
    mutate(persisted)
    const result = await resolveCookingStepIngredientMap(
      ['For the sauce:', '1 tbsp olive oil'],
      ['Add the oil to the marinade.'],
      persisted,
    )
    expect(result).toMatchObject({ source: 'deterministic-fallback', fallbackReason: 'invalid-structure' })
  })

  it('rejects duplicate instruction records', async () => {
    const ingredients = ['salt']
    const instructions = ['Add salt.', 'Stir again.']
    const persisted = await buildHashedDeterministicCookingStepMap(ingredients, instructions)
    persisted.steps[1] = { ...persisted.steps[0] }
    const result = await resolveCookingStepIngredientMap(ingredients, instructions, persisted)
    expect(result.fallbackReason).toBe('invalid-structure')
  })

  it('rejects removal of a locked deterministic reference', async () => {
    const ingredients = ['salt']
    const instructions = ['Add salt.']
    const persisted = await buildHashedDeterministicCookingStepMap(ingredients, instructions)
    persisted.steps[0].ingredients = []
    const result = await resolveCookingStepIngredientMap(ingredients, instructions, persisted)
    expect(result.fallbackReason).toBe('invalid-structure')
  })

  it.each([
    ['empty label', (map: CookingStepIngredientMap) => { map.steps[0].preparedComponents![0].label = '   ' }],
    ['unsupported provenance', (map: CookingStepIngredientMap) => {
      ;(map.steps[0].preparedComponents![0] as unknown as { provenance: string }).provenance = 'deterministic'
    }],
    ['duplicate label', (map: CookingStepIngredientMap) => {
      map.steps[0].preparedComponents!.push({ label: ' green  sauce ', confidence: 'high', provenance: 'ai' })
    }],
  ])('rejects malformed prepared components: %s', async (_, mutate) => {
    const fixture = await validPreparedComponentMap()
    mutate(fixture.mapping)
    const result = await resolveCookingStepIngredientMap(fixture.ingredients, fixture.instructions, fixture.mapping)
    expect(result.fallbackReason).toBe('invalid-structure')
  })

  it('rejects AI associations mislabeled with the deterministic engine', async () => {
    const persisted = await validHybridMap()
    persisted.engineVersion = 'deterministic-v3'
    const result = await resolveCookingStepIngredientMap(
      ['For the sauce:', '1 tbsp olive oil'],
      ['Add the oil to the marinade.'],
      persisted,
    )
    expect(result.fallbackReason).toBe('invalid-structure')
  })

  it('rejects a hybrid engine map with no AI resolution', async () => {
    const ingredients = ['salt']
    const instructions = ['Add salt.']
    const persisted = await buildHashedDeterministicCookingStepMap(ingredients, instructions)
    persisted.engineVersion = 'hybrid-v3'
    const result = await resolveCookingStepIngredientMap(ingredients, instructions, persisted)
    expect(result.fallbackReason).toBe('invalid-structure')
  })

  it('does not mutate ingredients, instructions, or the persisted map', async () => {
    const ingredients = ['For the sauce:', '1 tbsp olive oil']
    const instructions = ['Add the oil to the marinade.']
    const persisted = await validHybridMap(ingredients, instructions)
    const before = JSON.stringify({ ingredients, instructions, persisted })
    await resolveCookingStepIngredientMap(ingredients, instructions, persisted)
    expect(JSON.stringify({ ingredients, instructions, persisted })).toBe(before)
  })
})

describe('effective-source and personal override resolution', () => {
  const sharedIngredients = ['salt', 'olive oil']
  const sharedInstructions = ['Add salt and olive oil.']

  it('uses a shared stored map when shared content is effective', async () => {
    const persisted = await buildHashedDeterministicCookingStepMap(sharedIngredients, sharedInstructions)
    await expect(resolveCookingStepIngredientMap(sharedIngredients, sharedInstructions, persisted))
      .resolves.toMatchObject({ source: 'persisted' })
  })

  it.each([
    ['changed ingredient', ['sea salt', 'olive oil'], sharedInstructions],
    ['changed instruction', sharedIngredients, ['Whisk salt and olive oil.']],
    ['reordered ingredients', ['olive oil', 'salt'], sharedInstructions],
  ] as const)('%s invalidates the shared stored map', async (_, ingredients, instructions) => {
    const persisted = await buildHashedDeterministicCookingStepMap(sharedIngredients, sharedInstructions)
    const result = await resolveCookingStepIngredientMap([...ingredients], [...instructions], persisted)
    expect(result).toMatchObject({ source: 'deterministic-fallback', fallbackReason: 'source-hash-mismatch' })
  })

  it('allows a source-equivalent override to retain the shared stored map', async () => {
    const persisted = await buildHashedDeterministicCookingStepMap(sharedIngredients, sharedInstructions)
    const result = await resolveCookingStepIngredientMap([...sharedIngredients], [...sharedInstructions], persisted)
    expect(result.source).toBe('persisted')
  })

  it('uses deterministic override mapping when no stored map exists', async () => {
    const result = await resolveCookingStepIngredientMap(['2 garlic cloves'], ['Add garlic.'])
    expect(result.source).toBe('deterministic-fallback')
    expect(result.mapping.steps[0].ingredients[0].ingredientIndex).toBe(0)
  })

  it('fails closed without throwing for malformed persisted input', async () => {
    await expect(resolveCookingStepIngredientMap(['salt'], ['Add salt.'], { steps: 'broken' }))
      .resolves.toMatchObject({ source: 'deterministic-fallback', fallbackReason: 'unsupported-schema' })
  })
})
