import { describe, expect, it } from 'vitest'
import {
  isExplicitUrl,
  isIngredientSubheader,
  parseRecipeContent,
} from '@/lib/recipeContent'

describe('shared ingredient-subheader identity', () => {
  it('recognizes every unique audited label that the former UI predicate missed', () => {
    const auditedLabels = [
      'Additional Toppings (Optional)',
      'Aromatics',
      'Enchiladas',
      'Extras',
      'For the Chicken',
      'For the chicken (see note 1 for other protein options)',
      'For the Chickpeas',
      'For the Chili',
      'For the Croutons (optional)',
      'For the Green Harissa Dressing',
      'FOR THE GREEN SAUCE',
      'For the Mediterranean Bowls (build your own bowls based on what you like)',
      'For the Pickled Onions',
      'For The Ramen Egg**',
      'For the Roasted Tomatillo Chipotle Sauce',
      'For the Rosemary Oil',
      'For the Salad',
      'For the Soup',
      'For the stir fry',
      'For the Stir-fry',
      'For the Tacos',
      'Noodles',
      'Proteins',
      'Seasonings',
      'Sheet Pan ingredients',
      'The Extras',
      'Vegetables',
    ]

    for (const line of auditedLabels) {
      expect(isIngredientSubheader(line), line).toBe(true)
    }
  })

  it('preserves established colon, markdown-bold, and keyword semantics', () => {
    for (const line of ['Dressing:', '**For garnish**', 'For the sauce', 'To serve']) {
      expect(isIngredientSubheader(line), line).toBe(true)
    }
  })

  it('recognizes the audited component labels and the Blue Corn override variant', () => {
    const auditedLabels = [
      'Green Chile Sauce',
      'Green Chile Sauce!',
      'Pineapple Salsa',
      'Couscous Sweet Potato Black Bean Salad',
      'Lime Basil Vinaigrette',
      'Spice Rub',
      'Quick Cabbage Slaw',
      'Green Tahini',
      'Rosemary Lemon Garlic Oil ( for drizzling)',
    ]

    for (const line of auditedLabels) {
      expect(isIngredientSubheader(line), line).toBe(true)
    }
  })

  it('does not classify audited composite ingredients as subheaders', () => {
    const legitimate = [
      'chicken or vegetable broth',
      'pita or rice for serving',
      'sour cream or Greek yogurt',
      'Fresh cilantro, for garnish (optional)',
      'Garnish: Avocado, cilantro, scallions, Cabbage Slaw, Mexican Secret Sauce or Vegan Avocado Sauce',
      'Toppings (optional): toasted nuts or seeds, fresh herbs, grated or crumbled cheese, soft-boiled egg, avocado, hot sauce or other sauces and so on',
      '1 cup green chile sauce',
      'green chile sauce for serving',
      'For the sauce.',
      '• For the sauce',
      'For frying',
      'Canola or vegetable oil, for frying',
      '4–5 cups peanut oil for frying',
      '1 cup pineapple salsa',
      '2 tbsp spice rub',
      '2 tbsp green tahini',
      'Oil',
    ]

    for (const line of legitimate) {
      expect(isIngredientSubheader(line), line).toBe(false)
    }
  })
})

describe('conservative recipe-content contamination controls', () => {
  it('removes the audited rating-to-yield metadata/article preamble in the normal path', () => {
    const parsed = parseRecipeContent([
      'INGREDIENTS',
      '50 minutes',
      'Prep Time',
      '10 minutes',
      'Cook Time',
      "40 minutes (including 30 minutes' marinating)",
      'Rating',
      '5',
      '(794)',
      'Comments',
      'Read 221 comments',
      'How do restaurant stir-fries deliver silky and tender meat? This audited article copy is not an ingredient.',
      'Featured in: The Simple Trick to Silky, Juicy Chicken Breast',
      'Yield: 2 to 4 servings',
      'For the Chicken',
      '1 boneless, skinless chicken breast',
      'Black pepper',
      'INSTRUCTIONS',
      'Marinate the chicken until it appears glossy and velvety.',
    ].join('\n'))

    expect(parsed.ingredients).toEqual([
      'For the Chicken',
      '1 boneless, skinless chicken breast',
      'Black pepper',
    ])
    expect(parsed.instructions).toEqual(['Marinate the chicken until it appears glossy and velvety.'])
  })

  it('removes exact grocery/page controls without deleting nearby ingredients', () => {
    const parsed = parseRecipeContent([
      'INGREDIENTS',
      '2 cups cooked shredded chicken',
      'Add ingredients to Grocery List',
      'Shop ingredients on Instacart',
      'Email Grocery List',
      'Save Recipe',
      'Cook Mode Prevent your screen from going dark',
      '12 ounces sharp Cheddar, shredded',
      'INSTRUCTIONS',
      'Fold the chicken and cheese into the tortillas.',
    ].join('\n'))

    expect(parsed.ingredients).toEqual([
      '2 cups cooked shredded chicken',
      '12 ounces sharp Cheddar, shredded',
    ])
  })

  it('rejects only a complete explicit URL from an ingredient span', () => {
    const parsed = parseRecipeContent([
      'INGREDIENTS',
      'broccoli',
      'https://cooking.nytimes.com/recipes/1020740-meatless-meatballs-in-marinara-sauce',
      '1 cup marinara sauce',
      'INSTRUCTIONS',
      'Simmer the sauce until it thickens slightly.',
    ].join('\n'))

    expect(parsed.ingredients).toEqual(['broccoli', '1 cup marinara sauce'])
    expect(isExplicitUrl('https://example.com/recipe')).toBe(true)
    expect(isExplicitUrl('Source: https://example.com/recipe')).toBe(false)
  })

  it('treats standalone Notes as a terminal block while preserving the real instruction section', () => {
    const parsed = parseRecipeContent([
      'INGREDIENTS',
      '2 cups Pico de Gallo',
      '1/2 cup sour cream or mayo or a blend',
      'Notes:',
      'The traditional recipe calls for mild white-fleshed filets and may also be grilled.',
      'Metric conversion:',
      'These recipes were created in US Customary measurements and the conversion to metric is being done by calculations.',
      'INSTRUCTIONS',
      'Grill the fish until it flakes easily with a fork.',
    ].join('\n'))

    expect(parsed.ingredients).toEqual([
      '2 cups Pico de Gallo',
      '1/2 cup sour cream or mayo or a blend',
    ])
    expect(parsed.instructions).toEqual(['Grill the fish until it flakes easily with a fork.'])
  })

  it('applies metadata and control exclusions in the heading-only fallback path', () => {
    const parsed = parseRecipeContent([
      'INGREDIENTS',
      'UNITS USM',
      'SCALE',
      '1/2 x',
      '1 x',
      '2 x',
      '1 cup uncooked wild rice',
      'Save Recipe',
      'garlic',
    ].join('\n'))

    expect(parsed.ingredients).toEqual(['1 cup uncooked wild rice', 'garlic'])
    expect(parsed.instructions).toEqual([])
  })

  it('stops the heading-only fallback at the audited PREP boundary', () => {
    const parsed = parseRecipeContent([
      'INGREDIENTS',
      '4 tbsp low sodium soy sauce (or 2 tbsp full sodium soy sauce)',
      '2 cloves garlic',
      'PREP',
      'CRUSH and mince the garlic, set aside',
      'FINE MINCE the ginger, set aside',
      'ON THE STOVE',
      'HEAT a wok over medium low heat and add the chicken.',
    ].join('\n'))

    expect(parsed.ingredients).toEqual([
      '4 tbsp low sodium soy sauce (or 2 tbsp full sodium soy sauce)',
      '2 cloves garlic',
    ])
  })

  it('also stops the fallback at ON THE STOVE when PREP is absent', () => {
    const parsed = parseRecipeContent([
      'INGREDIENTS',
      '1 pound chicken thighs',
      '1 cup water',
      'ON THE STOVE',
      'HEAT the chicken and water until simmering.',
    ].join('\n'))

    expect(parsed.ingredients).toEqual(['1 pound chicken thighs', '1 cup water'])
  })

  it('removes anchored rating, byline, time, servings, and scale metadata', () => {
    const parsed = parseRecipeContent([
      'INGREDIENTS',
      '4.82 from 77 votes',
      'By: Alyssa Rivers',
      'PREP TIME:',
      '10 minutes minutes',
      'COOK TIME:',
      '5 minutes minutes',
      'TOTAL TIME:',
      '15 minutes minutes',
      'SERVINGS:',
      '6',
      '1 X',
      '2 X',
      '3 X',
      '1 tablespoon olive oil',
      '1 red bell pepper, sliced',
      'INSTRUCTIONS',
      'Stir-fry the vegetables until crisp-tender.',
    ].join('\n'))

    expect(parsed.ingredients).toEqual([
      '1 tablespoon olive oil',
      '1 red bell pepper, sliced',
    ])
  })

  it('keeps subheaders in the presentation-oriented ingredient array', () => {
    const parsed = parseRecipeContent([
      'INGREDIENTS',
      'For the Green Harissa Dressing',
      '4 to 5 green chiles, such as jalapeño or serrano',
      'For the Salad',
      '2 cups arugula or rocket',
      'INSTRUCTIONS',
      'Toss the salad with the dressing and serve.',
    ].join('\n'))

    expect(parsed.ingredients).toEqual([
      'For the Green Harissa Dressing',
      '4 to 5 green chiles, such as jalapeño or serrano',
      'For the Salad',
      '2 cups arugula or rocket',
    ])
  })

  it('preserves the Blue Corn effective override header structurally', () => {
    const parsed = parseRecipeContent([
      'INGREDIENTS',
      'Green Chile Sauce!',
      '2 tbsp olive oil',
      '1/2 onion',
      '1 cup green chile peeled, seeded, and chopped',
      '3 cloves garlic',
      '2 tbsp flour',
      '1.5 cups chicken broth',
      'salt and pepper to taste',
      'Enchiladas',
      '3-4 chicken breasts skinned and boneless',
      '12 blue corn tortillas',
      '1.5 cups shredded cheese',
      'INSTRUCTIONS',
      'Heat the sauce ingredients, fill the tortillas, and bake until browned.',
    ].join('\n'))

    expect(parsed.ingredients).toContain('Green Chile Sauce!')
    expect(isIngredientSubheader('Green Chile Sauce!')).toBe(true)
    expect(isIngredientSubheader('Enchiladas')).toBe(true)
  })

  it('preserves legitimate no-quantity ingredient lines', () => {
    const noQuantity = [
      'salt',
      'garlic',
      'fresh basil',
      'black pepper',
      'olive oil',
      'cilantro',
      'parsley',
      'ginger',
    ]
    const parsed = parseRecipeContent([
      'INGREDIENTS',
      ...noQuantity,
      'INSTRUCTIONS',
      'Combine all ingredients and season to taste.',
    ].join('\n'))

    expect(parsed.ingredients).toEqual(noQuantity)
  })

  it('preserves audited alternative, optional, and mixed-purchase ingredients', () => {
    const composite = [
      'chicken or vegetable broth',
      'pita or rice for serving',
      'sour cream or Greek yogurt',
      'Fresh cilantro, for garnish (optional)',
      'Any combination of kimchi, chile crisp, toasted nori sheets, and sliced cucumber, avocado or radish, for serving',
    ]
    const parsed = parseRecipeContent([
      'INGREDIENTS',
      ...composite,
      'INSTRUCTIONS',
      'Arrange the ingredients in bowls and serve.',
    ].join('\n'))

    expect(parsed.ingredients).toEqual(composite)
  })

  it('restores legitimate cooked ingredients hidden by the former broad Cook prefix filter', () => {
    const parsed = parseRecipeContent([
      'INGREDIENTS',
      '1 tablespoon soy sauce',
      'Cooked rice, for serving',
      'cooked quinoa',
      'INSTRUCTIONS',
      'Serve the finished dish over the cooked grain.',
    ].join('\n'))

    expect(parsed.ingredients).toEqual([
      '1 tablespoon soy sauce',
      'Cooked rice, for serving',
      'cooked quinoa',
    ])
  })
})
