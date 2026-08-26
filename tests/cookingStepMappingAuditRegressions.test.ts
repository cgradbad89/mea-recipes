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

describe('2026-08-26 deterministic-v4 row-lifecycle precision regressions', () => {
  function mapIndexes(ingredients: string[], instructions: string[]): number[][] {
    return buildDeterministicCookingStepMap(ingredients, instructions).steps
      .map(mappedStep => mappedStep.ingredients.map(reference => reference.ingredientIndex))
  }

  it('fixes Mexican Oaxacan Bowl unlisted sheet-pan oil without consuming slaw oil', () => {
    const ingredients = [
      'Spice Rub',
      '2 teaspoons cumin',
      '1 teaspoon ground chipotle ( or swap out a mix of smoked paprika and chili powder)',
      '½ teaspoon kosher salt',
      'Sheet Pan ingredients',
      '½ a red onion, cut in ½ inch wedges',
      '1 medium yam or sweet potato- diced into ¾ inch cubes ( leave skin on)',
      '8 baby bell peppers, cut in half (or 1 regular red or yellow bell pepper, cut into strips )',
      '½ cup pecans',
      '2 teaspoons maple syrup',
      '1 15-16 ounce can Seasoned Black Beans ( Cuban style or Mexican style) or use regular black beans ( see notes)',
      'Garnish: Avocado, cilantro, scallions, Cabbage Slaw, Mexican Secret Sauce or Vegan Avocado Sauce',
      'Quick Cabbage Slaw',
      '¼ of a a red cabbage, shredded',
      '1 tablespoon olive oil',
      '¼ cup chopped cilantro or scallions or both',
      '1 teaspoon coriander',
      '1/8 teaspoon kosher salt',
      '1 tablespoon lime juice',
    ]
    const instructions = [
      'Preheat oven to 400 F',
      'Mix cumin, chipotle and salt together in a small bowl.',
      'Place onion, sweet potato and peppers on a parchment lined sheet pan. Drizzle onion and potato with a little olive oil and sprinkle generously with spice mix, tossing to coat all sides well. Use about ½ or ⅔ of the spice.',
      'Place in the oven for 20-30 minutes, tossing halfway through.',
      'On another smaller parchment-lined pan, toss the pecans with 2 teaspoons maple syrup and 1 teaspoon of the spice mix. Place in the oven (on a lower rack) for 10-12 minutes, or until lightly browned. When you pull it out, give nuts a quick toss to loosen them up and “fluffen” them, so when they cool, they are easy to remove.',
      'Heat the seasoned beans in a small pot on the stove ( see notes) and make the slaw. Finely chop or shred the cabbage and place in a medium bowl with the rest of the ingredients, toss. Taste, adjust lime and salt.',
      'Slice the avocado.',
      'When the veggies are fork tender, assemble the bowls. Divide the beans among 2-3 bowls. Divide all the veggies, placing them over the beans, and top with slaw and add the avocado.',
      'Serve with the Chipotle Mayo ( vegan-adaptable) or Vegan Avocado sauce if you like, or sour cream and hot sauce– it’s fine without though too. 🙂',
    ]
    const mapped = mapIndexes(ingredients, instructions)
    expect(mapped[2]).not.toContain(14)
  })

  it('fixes Creamy Kale Pasta consumed sauce-salt reuse', () => {
    const ingredients = [
      'For the Sauce:', '1/4 cup pine nuts', '1/4 cup packed parsley', '1/4 cup packed basil',
      '2 tablespoons capers or pitted olives', '1 teaspoon salt', '1/2 teaspoon black pepper',
      'juice and zest of half a lemon', '2 tablespoons olive oil',
      'For the Pasta:', '8 ounces farfalle', '2 tablespoons butter or vegan butter',
      '2 cloves garlic, thinly sliced', '2 stalks kale, stems removed, leaves chopped into bite-sized pieces',
      '1/2 cup white wine, reserved cooking water, broth, or any combination',
      'lemon juice, red pepper flakes, and Parmesan to finish (omit Parmesan if vegan)',
    ]
    const instructions = [
      'Make the sauce: Pulse all sauce ingredients together until mostly smooth. (The sauce will be very salty. That’s okay, it’ll tone down once it mixes with everything.)',
      'Prep the pasta: Cook pasta according to package directions. Drain and set aside.',
      'Cook down the kale: While the pasta is cooking, melt the butter over medium heat in a large skillet. Add the garlic; sauté for 1-2 minutes. Add the kale; sauté for 1-2 minutes. Add the wine, water, or broth; let it sizzle out for a minute.',
      'Finish: Add drained, cooked pasta and sauce. Toss to combine. Season to taste with Parmesan, lemon, red pepper flakes, and salt and pepper. Fast, easy, yum.',
    ]
    const mapped = mapIndexes(ingredients, instructions)
    expect(mapped[0]).toContain(5)
    expect(mapped[3]).not.toContain(5)
  })

  it('fixes Schmancy Hot Smoked Salmon contextual salmon independently', () => {
    const mapped = mapIndexes(
      ['2 pounds salmon filet, skin on, pin bones removed', '1 quart cold water', '¼ cup kosher salt', '¼ cup brown sugar'],
      [
        'Make the brine: combine water, salt, and brown sugar in a container large enough to hold the salmon. Stir until dissolved.',
        'Place salmon skin-side up in the brine, cover, and refrigerate 4 to 8 hours.',
      ],
    )
    expect(mapped[0]).not.toContain(0)
    expect(mapped[1]).toContain(0)
  })

  it('fixes Schmancy Hot Smoked Salmon fresh rinse water independently', () => {
    const mapped = mapIndexes(
      ['2 pounds salmon filet, skin on, pin bones removed', '1 quart cold water', '¼ cup kosher salt', '¼ cup brown sugar'],
      [
        'Make the brine: combine water, salt, and brown sugar in a container large enough to hold the salmon. Stir until dissolved.',
        'Place salmon skin-side up in the brine, cover, and refrigerate 4 to 8 hours.',
        'Remove salmon from brine, rinse thoroughly under cold water, and pat dry with paper towels.',
      ],
    )
    expect(mapped[0]).toContain(1)
    expect(mapped[2]).not.toContain(1)
  })

  it('fixes Chili Lime Fish garnish leakage while selecting the sauce chile form', () => {
    const ingredients = [
      '330 g / 11 oz thin white fish fillets (~1 cm / 0.4" thick) , skinless, cut into 6 cm / 2.5" (or so) squares pieces (Note 1)',
      '1/4 tsp cooking/kosher salt', '1/4 cup rice flour or ordinary flour (Note 2)', '2 tbsp canola oil',
      'SAUCE:', '2 tsp sesame oil', '2 garlic cloves , finely minced with a knife (Note 3)',
      '2 tsp ginger , finely minced with a knife (Note 3)', '1 tsp chilli flakes / red pepper flakes (Note 4)',
      '2 tbsp sriracha (Note 4)', '2 tsp light soy sauce or fish sauce (Note 5)', '3 tbsp brown sugar',
      '1/2 cup water', '2 tbsp lime juice', 'GARNISHES (OPTIONAL):',
      '2 tbsp coriander/cilantro leaves', '1 tbsp large red chilli , finely sliced', 'Lime wedges',
    ]
    const mapped = mapIndexes(ingredients, [
      'Dust fish – Sprinkle with salt, dust with rice flour, shake off excess.',
      'Cook fish – In a non-stick skillet, heat oil over medium-high heat. Cook the fish until golden on each side then remove to a plate.',
      'Fish cooking times – Thin fillets 1 cm / 2/5" thick: 1 1/2 minutes each side; thicker fillets 1.5 – 1.75 cm / 0.6 – 0.75" thick 2 minutes each side) or until the internal temperature is 55°C / 130°F. Remove fish to a plate and set aside.',
      'Sauté aromatics – In the same pan, add sesame oil on medium heat. Cook garlic, chilli and ginger until golden – about 20 seconds.',
    ])
    expect(mapped[3]).toEqual([5, 6, 7, 8])
    expect(mapped[3]).not.toContain(16)
  })

  it('blocks a consumed bounded-group salt from a later unlisted use', () => {
    const mapped = mapIndexes(
      ['For the sauce:', '1 tsp salt', '1 cup tomatoes'],
      ['Combine all sauce ingredients.', 'Boil for five minutes.', 'Season pasta with salt.'],
    )
    expect(mapped[0]).toEqual([1, 2])
    expect(mapped[2]).not.toContain(1)
  })

  it('allows explicit remaining reuse of a divided row', () => {
    const mapped = mapIndexes(
      ['2 tbsp olive oil, divided'],
      ['Use 1 tbsp olive oil.', 'Add the remaining olive oil.'],
    )
    expect(mapped).toEqual([[0], [0]])
    expect(buildDeterministicCookingStepMap(
      ['2 tbsp olive oil, divided'],
      ['Use 1 tbsp olive oil.', 'Add the remaining olive oil.'],
    ).steps[1].ingredients[0].usage).toEqual({ kind: 'remaining' })
  })

  it('allows explicit remaining reuse after a bounded first use', () => {
    const mapped = mapIndexes(
      ['3 tbsp olive oil, divided'],
      ['Heat 2 tbsp olive oil.', 'Add remaining 1 tbsp olive oil.'],
    )
    expect(mapped).toEqual([[0], [0]])
  })

  it('does not reuse an ordinary fully used oil row from a later bare noun', () => {
    expect(mapIndexes(
      ['1 tbsp olive oil'],
      ['Heat the olive oil.', 'Add olive oil to finish.'],
    )).toEqual([[0], []])
  })

  it('does not map slaw-purpose oil to an unlisted sheet-pan use', () => {
    expect(indexes(['1 tbsp olive oil for slaw'], 'Oil a sheet pan.')).toEqual([])
  })

  it('does not map brine-purpose water to fresh rinse water', () => {
    expect(indexes(['4 cups water for brine'], 'Rinse with fresh water.')).toEqual([])
  })

  it('does not map a measured brine-water row to an unlisted process-water quantity', () => {
    expect(indexes(['4 cups cold water'], 'Fill a clean bowl with fresh water.')).toEqual([])
  })

  it('does not map contextual protein in brine preparation', () => {
    expect(indexes(['2 lb salmon'], 'Prepare the brine for the salmon.')).toEqual([])
  })

  it('maps active protein placement into brine', () => {
    expect(indexes(['2 lb salmon'], 'Place salmon in the brine.')).toEqual([0])
  })

  it('does not let a before-clause create a protein association', () => {
    expect(indexes(['2 lb salmon', '1 cup brine'], 'Before adding the salmon, chill the brine.')).not.toContain(0)
  })

  it('does not let a while-clause create a new protein association', () => {
    expect(indexes(['2 lb salmon', '1 tbsp honey'], 'While the salmon chills, whisk the honey.')).toEqual([1])
  })

  it('keeps optional garnish chile out of sauce aromatics', () => {
    expect(indexes(
      ['For the sauce:', '1 tsp chile flakes', 'For garnish:', '1 fresh chile, optional'],
      'For the sauce, cook the chile flakes.',
    )).toEqual([1])
  })

  it('allows an actionable garnish row in garnish context', () => {
    expect(indexes(
      ['For the sauce:', '1 tsp chile flakes', 'For garnish:', '1 fresh chile, optional'],
      'Garnish with the fresh chile.',
    )).toEqual([3])
  })

  it('keeps topping-purpose cheese out of a sauce instruction', () => {
    expect(indexes(
      ['For the sauce:', '1 cup cream', 'For topping:', '1/2 cup Parmesan cheese'],
      'Stir the cream into the sauce.',
    )).toEqual([1])
  })

  it('allows continuing manipulation of a previously introduced protein', () => {
    expect(mapIndexes(
      ['2 lb salmon'],
      ['Place salmon in the brine.', 'Place salmon skin-side down on the smoker.', 'Brush salmon with glaze.'],
    )).toEqual([[0], [0], [0]])
  })

  it('does not let exact quantity evidence override consumed-row state', () => {
    expect(mapIndexes(
      ['For the sauce:', '1 tsp salt'],
      ['Combine all sauce ingredients.', 'Season pasta with 1 tsp salt.'],
    )).toEqual([[1], []])
  })

  it('does not map chicken base from a bare chicken reference', () => {
    expect(indexes(
      ['1 pound chicken breasts', '1 tablespoon roasted chicken base', '3/4 cup heavy cream'],
      'Add bechamel, chicken, and heavy cream to the slow cooker.',
    )).toEqual([0, 2])
  })

  it('marks a spread onion used before a later destination mention', () => {
    expect(mapIndexes(
      ['1 onion, sliced', '1 beef chuck roast'],
      ['Spread onion slices in the bottom.', 'Place roast on onions in the slow cooker.'],
    )).toEqual([[0], []])
  })

  it('does not consume listed cooking water for a few unlisted tablespoons', () => {
    expect(mapIndexes(
      ['1½ cups water'],
      ['Add a few tablespoons of water if spices stick.', 'Add the water and stir.'],
    )).toEqual([[], [0]])
  })

  it('does not map a listed measured oil row from an extra splash', () => {
    expect(indexes(
      ['3 tablespoons neutral oil'],
      'Cook the garlic in the pan, adding an extra splash of neutral oil if necessary.',
    )).toEqual([])
  })

  it('does not remap raw butter from a prepared miso-butter reference', () => {
    const result = buildDeterministicCookingStepMap(
      ['4 tablespoons butter', '2 tablespoons white miso', '2 teaspoons vinegar'],
      [
        'Smash together the butter, miso, and vinegar until combined.',
        'Add the miso butter in spoonfuls.',
      ],
    )
    expect(result.steps[0].ingredients.map(reference => reference.ingredientIndex)).toEqual([0, 1, 2])
    expect(result.steps[1].ingredients).toEqual([])
  })

  it('keeps ungrouped main oil and salt separate from a named sauce group', () => {
    const mapped = indexes(
      [
        '1 lb chicken thighs', '3 bell peppers', '1 tsp salt and pepper', '1 tbsp olive oil',
        'Tinga Sauce:', '1 tbsp olive oil', '1/2 onion', '2 cloves garlic', '1/2 tsp salt',
      ],
      'Chicken and Peppers: Arrange chicken and peppers. Toss with olive oil and sprinkle with salt and pepper.',
    )
    expect(mapped).toEqual([0, 2])
    expect(mapped).not.toContain(5)
    expect(mapped).not.toContain(8)
  })
})
