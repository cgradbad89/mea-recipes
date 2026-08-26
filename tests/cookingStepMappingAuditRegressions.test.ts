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
    )).not.toContain(0)
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

describe('2026-08-26 deterministic-v3 active-use regressions', () => {
  it('does not map a protein mentioned only as the target of a sauce', () => {
    expect(indexes(['1 lb chicken breast'], 'Prepare the sauce for the chicken.')).toEqual([])
  })

  it('still maps a protein that is actively added', () => {
    expect(indexes(['1 lb chicken breast'], 'Add the chicken to the pan.')).toEqual([0])
  })

  it('does not map shrimp from a dressing context phrase', () => {
    expect(indexes(['1 lb shrimp'], 'Make the dressing for the shrimp.')).toEqual([])
  })

  it('maps shrimp when it is actively tossed with dressing', () => {
    expect(indexes(['1 lb shrimp'], 'Toss the shrimp with the dressing.')).toEqual([0])
  })

  it('does not let an action in another clause activate a contextual protein', () => {
    expect(indexes(['1 lb chicken breast'], 'Make the sauce, then serve it over the chicken.')).toEqual([])
  })

  it('keeps negative and positive uses local across clauses', () => {
    expect(indexes(['olive oil', 'extra firm tofu'], 'Do not add oil yet; add tofu now.')).toEqual([1])
  })

  it('does not map a prepared-component constituent', () => {
    expect(step(['2 cloves garlic'], 'Add the garlic sauce.')).toMatchObject({
      ingredients: [],
      unresolvedReason: 'prepared-component',
    })
  })

  it('maps a separately acted-on raw constituent before a component reference', () => {
    expect(indexes(['2 cloves garlic'], 'Add the garlic and then stir in the sauce.')).toEqual([0])
  })

  it('treats a for-the-protein line as a heading rather than ingredient use', () => {
    expect(step(['1 lb chicken breast'], 'For the chicken:')).toMatchObject({
      ingredients: [],
      unresolvedReason: 'non-actionable',
    })
  })

  it('does not map contextual serving-side language', () => {
    expect(indexes(['1 lb chicken breast'], 'Prepare the sauce and serve with the chicken on the side.')).toEqual([])
  })

  it('does not map a noun embedded in a destination label', () => {
    expect(indexes(['2 eggs'], 'Transfer the shrimp to the egg plate.')).toEqual([])
  })

  it('does not map raw bacon from contextual bacon-fat or bacon-pan phrases', () => {
    expect(indexes(['12 slices bacon'], 'Drain excess bacon fat, then add bread to the bacon pan.')).toEqual([])
  })

  it('does not map an ingredient mentioned only in a temporal clause', () => {
    expect(indexes(['1 lb chicken breast', '1 tbsp butter'], 'While the chicken bakes, melt the butter.')).toEqual([1])
  })

  it('does not map an ingredient mentioned only in a completion condition', () => {
    expect(indexes(['1 lb chicken breast', '1 tbsp butter'], 'When the chicken is done cooking, melt the butter.')).toEqual([1])
  })

  it('leaves duplicate group salt unresolved without row-specific evidence', () => {
    expect(step([
      'For the chicken:', '1 tsp salt',
      'For the dressing:', '1/2 tsp salt',
    ], 'Season shrimp with salt.')).toMatchObject({ ingredients: [], unresolvedReason: 'ambiguous' })
  })

  it('uses an exact quantity to select only the matching duplicate oil row', () => {
    expect(indexes([
      'For the chicken:', '2 tbsp avocado oil',
      'For the dressing:', '1 tbsp avocado oil',
    ], 'Add 1 tbsp avocado oil.')).toEqual([3])
  })

  it('leaves quantity-disambiguated duplicates unresolved when neither row agrees', () => {
    expect(step([
      'For the chicken:', '2 tbsp avocado oil',
      'For the dressing:', '1 tbsp avocado oil',
    ], 'Add 3 tbsp avocado oil.')).toMatchObject({ ingredients: [], unresolvedReason: 'ambiguous' })
  })

  it('does not attach an explicit mismatched quantity to a unique listed row', () => {
    expect(indexes(['1 tbsp avocado oil'], 'Add 2 tbsp avocado oil.')).toEqual([])
  })

  it('uses another unambiguous component cue in the clause to select duplicate garlic', () => {
    expect(indexes([
      'For the marinade:', '4 cloves garlic', '1/2 onion',
      'For the tomatillo sauce:', '3 tomatillos', '2 small cloves of garlic', '1/4 onion',
    ], 'Roast the tomatillos, onion, and garlic.')).toEqual([4, 5, 6])
  })

  it('does not map a listed plain water row from an unlisted hot-water use', () => {
    expect(indexes(['1 tbsp water'], 'Pour in hot water enough to cover the noodles.')).toEqual([])
  })

  it('does not emit a bare Oil section-label row', () => {
    expect(indexes(['Oil', '2 tbsp neutral cooking oil'], 'Heat half of the cooking oil.')).toEqual([1])
  })

  it('does not map locally negated oil even when another ingredient is active', () => {
    expect(indexes(['Oil', '2 tbsp neutral cooking oil', '8 shrimp'], 'Sear the shrimp; no need to pour in more oil.'))
      .toEqual([2])
  })

  it('keeps an actionable optional garnish', () => {
    expect(indexes(['cilantro'], 'Optional: garnish with cilantro.')).toEqual([0])
  })

  it('marks the Chicken Chow Mein substitution note non-actionable', () => {
    expect(step(
      ['1 piece chicken breast'],
      '1. Apart from chicken, you may also use pork, beef, shrimp or Char Siu. For vegetarian and vegan diets, egg and tofu are great alternatives.',
    )).toMatchObject({ ingredients: [], unresolvedReason: 'non-actionable' })
  })

  it('does not map raw chile from an unlisted prepared chili oil', () => {
    expect(indexes(['1 fresh chilli'], 'Drizzle with homemade chili oil if you wish.')).toEqual([])
  })

  it('does not map raw chipotle from a prepared chipotle mayo reference', () => {
    expect(indexes(['1 tsp ground chipotle'], 'Serve with the Chipotle Mayo.')).toEqual([])
  })

  it('does not attach unscoped extra water to an earlier measured water row', () => {
    expect(indexes(['2 tbsp water'], 'Add extra water or broth to thin the sauce.')).toEqual([])
  })

  it('marks the Singapore Mei Fun fry line as a section heading', () => {
    expect(step(['2 eggs', '8 shrimp'], 'Fry the eggs & shrimp')).toMatchObject({
      ingredients: [],
      unresolvedReason: 'non-actionable',
    })
  })

  it('marks the Fried Chicken Sandwich size guidance as supplemental prose', () => {
    expect(step(
      ['4 chicken breasts'],
      'You can use small chicken pieces, large chicken breasts that have been pounded thin, or large chicken breasts cut in half.',
    )).toMatchObject({ ingredients: [], unresolvedReason: 'non-actionable' })
  })

  it('fixes Butter-Soy Chicken wrong-group salt while retaining active asparagus', () => {
    const ingredients = [
      'For the Chicken', '1 chicken breast', '1/4 teaspoon salt',
      'For the Stir-fry', '1/4 pound asparagus', 'Salt and black pepper',
    ]
    const result = step(ingredients, 'Start the stir-fry: Add the asparagus, then transfer chicken and add a pinch of salt and pepper.')
    expect(result.ingredients.map(reference => reference.ingredientIndex)).toEqual([1, 4])
  })

  it('fixes chicken wild rice contextual chicken without losing the roux ingredients', () => {
    expect(indexes(
      ['1 pound chicken breasts', '1/2 cup butter', '3/4 cup flour', '2 cups whole milk'],
      'When rice and chicken are done cooking, melt the butter. Add the flour. Slowly whisk in the whole milk.',
    )).toEqual([1, 2, 3])
  })

  it('fixes Sheet Pan Chicken Tinga temporal chicken without losing sauce garlic', () => {
    expect(indexes(
      ['1 lb chicken thighs', '2 cloves garlic'],
      'Sauce: While the chicken bakes, heat oil in a skillet. Add garlic and saute.',
    )).toEqual([1])
  })

  it('fixes Chopped Thai Shrimp Salad dressing-salt leakage', () => {
    expect(indexes(
      ['1/2 tsp salt', '1 lb shrimp'],
      'Shrimp: Add the shrimp and sprinkle with a little salt.',
    )).toEqual([1])
  })

  it('fixes Sesame Apricot Tofu garlic leakage from prepared-sauce prose', () => {
    const result = step(
      ['extra firm tofu', 'Apricot Sauce:', '2 cloves garlic'],
      'Finally, add the sauce to the tofu and remove from heat - it will smell really good from the garlic.',
    )
    expect(result.ingredients.map(reference => reference.ingredientIndex)).toEqual([0])
    expect(result.unresolvedReason).toBe('prepared-component')
  })

  it('fixes Chickpea Curry mismatched optional-component oil quantity', () => {
    expect(indexes(
      ['1 tablespoon avocado oil'],
      'For the pickled cucumber salad, toss cucumbers with 2 tablespoons avocado oil.',
    )).toEqual([])
  })
})
