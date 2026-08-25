import { describe, expect, it } from 'vitest'
import {
  buildDeterministicCookingStepMap,
  canonicalizeCookingMappingSource,
  computeCookingMappingSourceHash,
} from '@/lib/cookingStepMapping'

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
      engineVersion: 'deterministic-v1',
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
