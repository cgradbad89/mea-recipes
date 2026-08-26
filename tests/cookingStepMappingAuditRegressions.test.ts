import { describe, expect, it } from 'vitest'
import { buildDeterministicCookingStepMap } from '@/lib/cookingStepMapping'

function step(ingredients: string[], instruction: string) {
  return buildDeterministicCookingStepMap(ingredients, [instruction]).steps[0]
}

function indexes(ingredients: string[], instruction: string): number[] {
  return step(ingredients, instruction).ingredients.map(reference => reference.ingredientIndex)
}

describe('2026-08-25 deterministic audit regressions', () => {
  it('preserves the shared noun in coconut-or-olive-oil alternatives', () => {
    const ingredients = ['2–3 tablespoons coconut or olive oil', '1 can coconut milk']
    expect(indexes(ingredients, 'Add the coconut milk.')).toEqual([1])
    expect(indexes(ingredients, 'Spoon the coconut broth over the fish.')).toEqual([])
  })

  it('does not select chicken broth from a generic chicken mention', () => {
    expect(indexes(['1 pound chicken breasts', '6 cups chicken broth'], 'Shred the chicken.')).toEqual([0])
  })

  it('does not map an incidental egg-white observation', () => {
    expect(indexes(
      ['1 tablespoon egg white'],
      'Separate the chicken pieces (some egg white may float to the surface).',
    )).toEqual([])
  })

  it.each([
    ['do not add the oil yet', ['olive oil'], 'Do not add the olive oil yet.'],
    ['reserve cheese for later', ['Parmesan cheese'], 'Reserve the cheese for later.'],
    ['without sauce', ['tomato sauce'], 'Serve without the tomato sauce.'],
    ['remove bay leaves', ['bay leaves'], 'Remove the bay leaves.'],
    ['discard marinade', ['prepared marinade'], 'Discard the marinade.'],
    ['except salt and pepper', ['salt', 'black pepper'], 'Blend the ingredients except the salt and pepper.'],
  ])('omits clear negative or deferred use: %s', (_, ingredients, instruction) => {
    expect(indexes(ingredients, instruction)).toEqual([])
  })

  it('does not let unrelated nearby negation suppress a valid use', () => {
    expect(indexes(['olive oil'], 'Do not overheat the pan; add the olive oil.')).toEqual([0])
  })

  it('requires positive evidence to choose between duplicate groups', () => {
    const ingredients = [
      'For the marinade:', '1 tbsp olive oil',
      'For the sauce:', '2 tbsp olive oil',
    ]
    expect(step(ingredients, 'Add the olive oil.')).toMatchObject({
      ingredients: [],
      unresolvedReason: 'ambiguous',
    })
    expect(indexes(ingredients, 'For the sauce, add the olive oil.')).toEqual([3])
  })

  it('does not map serrano chiles from chile powder', () => {
    expect(indexes(
      ['1 to 3 serrano chiles', '½ teaspoon Indian red chile powder'],
      'Stir in the chile powder.',
    )).toEqual([1])
  })

  it('leaves a generic chiles reference ambiguous across distinct chile rows', () => {
    const result = step(
      ['4 guajillo chiles', '1 ancho chile', '2 chipotle chiles'],
      'Add the chiles.',
    )
    expect(result.ingredients).toEqual([])
    expect(result.unresolvedReason).toBe('ambiguous')
  })

  it('normalizes equivalent chile spelling and plural forms safely', () => {
    expect(indexes(['2 green chilies'], 'Add the green chiles.')).toEqual([0])
  })

  it('keeps unbounded collective references unresolved', () => {
    expect(step(['salt', 'olive oil'], 'Add all ingredients.')).toMatchObject({
      ingredients: [],
      unresolvedReason: 'implicit-reference',
    })
    expect(step(['salt', 'olive oil'], 'Add everything else.')).toMatchObject({
      ingredients: [],
      unresolvedReason: 'implicit-reference',
    })
  })

  it('resolves a collective reference only inside an explicit named group', () => {
    const ingredients = ['For the dressing:', 'olive oil', 'lemon juice', 'For the salad:', 'lettuce']
    expect(indexes(ingredients, 'Combine all dressing ingredients.')).toEqual([1, 2])
  })

  it('maps ingredient-specific remaining language but not collective remaining language', () => {
    expect(indexes(['olive oil'], 'Add the remaining olive oil.')).toEqual([0])
    expect(step(['olive oil', 'salt'], 'Add the remaining ingredients.')).toMatchObject({
      ingredients: [],
      unresolvedReason: 'implicit-reference',
    })
  })

  it('does not map chicken breast from a chicken-seasoning note', () => {
    expect(indexes(
      ['4 boneless skinless chicken breasts', '1 tablespoon seasoning mix'],
      'The seasoning mix can be any all purpose chicken seasoning you like.',
    )).toEqual([1])
  })

  it('marks obvious reader-review prose non-actionable', () => {
    const result = step(
      ['½ cup pasta', '5 ounces baby kale'],
      'I made this for friends last night. Everyone enjoyed it! I added the pasta and greens before serving.',
    )
    expect(result.ingredients).toEqual([])
    expect(result.unresolvedReason).toBe('non-actionable')
  })

  it.each([
    ['https://example.com/recipe'],
    ['Nutrition estimate: 450 calories per serving'],
    ['Storage: Refrigerate leftovers for four days.'],
    ['Unavailable because this recipe is behind a paywall'],
  ])('marks contaminated source text non-actionable: %s', instruction => {
    expect(step(['salt'], instruction)).toMatchObject({
      ingredients: [],
      unresolvedReason: 'non-actionable',
    })
  })

  it('does not treat a component heading as an ingredient use', () => {
    expect(indexes(['Green Chile Sauce', '1 cup green chile'], 'Green Chile Sauce')).toEqual([])
  })

  it('does not remap raw green chile from an established sauce reference', () => {
    expect(step(
      ['Green Chile Sauce', '1 cup green chile', '12 tortillas'],
      'Spoon green chile enchilada sauce over the tortillas.',
    )).toMatchObject({
      ingredients: [{ ingredientIndex: 2 }],
      unresolvedReason: 'prepared-component',
    })
  })

  it('does not attach an unlisted additional water quantity to the listed row', () => {
    expect(indexes(['1 1/2 cups water'], 'Add another 1/2 cup of water if needed.')).toEqual([])
  })

  it('retains the positive primary-protein shorthand control', () => {
    expect(indexes(['2 lb pork shoulder'], 'Brown the pork in batches.')).toEqual([0])
  })
})
