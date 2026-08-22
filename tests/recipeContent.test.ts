import { describe, expect, it } from 'vitest'
import { parseRecipeContent } from '@/lib/recipeContent'

function parseWithIngredientHeading(heading: string) {
  return parseRecipeContent(`${heading}\n• 2 cups flour\nINSTRUCTIONS\nStep 1 Mix until smooth.`)
}

describe('parseRecipeContent section headings', () => {
  it('preserves standard plain ingredient headings with and without a colon', () => {
    expect(parseWithIngredientHeading('INGREDIENTS').ingredients).toEqual(['• 2 cups flour'])
    expect(parseWithIngredientHeading('INGREDIENTS:').ingredients).toEqual(['• 2 cups flour'])
  })

  it('preserves existing ingredient and instruction heading variants', () => {
    const parsed = parseRecipeContent('WHAT YOU NEED\n1 cup rice\nHOW TO MAKE:\nStep 1 Simmer until tender.')

    expect(parsed.ingredients).toEqual(['1 cup rice'])
    expect(parsed.instructions).toEqual(['Simmer until tender.'])
  })

  it('extracts ingredients and instructions beneath observed decorated headings', () => {
    const parsed = parseRecipeContent('🧾 Ingredients:\n• 1 cup oats\n• 2 tbsp honey\n🥣 Instructions:\nStep 1 Stir everything together.')

    expect(parsed.ingredients).toEqual(['• 1 cup oats', '• 2 tbsp honey'])
    expect(parsed.instructions).toEqual(['Stir everything together.'])
  })

  it('recognizes the observed swirl instruction decoration', () => {
    const parsed = parseRecipeContent('🧾 Ingredients:\n1 banana\n🌀 Instructions:\nBlend until completely smooth.')

    expect(parsed.ingredients).toEqual(['1 banana'])
    expect(parsed.instructions).toEqual(['Blend until completely smooth.'])
  })

  it('allows a bounded run of leading pictographic decoration', () => {
    const parsed = parseRecipeContent('🧾✨ Ingredients:\n1 cup milk\n🥣✨ Instructions:\nWhisk until evenly combined.')

    expect(parsed.ingredients).toEqual(['1 cup milk'])
    expect(parsed.instructions).toEqual(['Whisk until evenly combined.'])
  })

  it('rejects decoration beyond the four-pictograph bound', () => {
    const parsed = parseWithIngredientHeading('🧾✨🥣🌀🍽️ Ingredients:')

    expect(parsed.ingredients).toEqual([])
  })

  it('does not treat emoji-containing prose as section boundaries', () => {
    const parsed = parseRecipeContent([
      'INGREDIENTS',
      '1 cup rice',
      'Add 🧾 ingredients to the bowl.',
      'I like 🥣 instructions that are simple.',
      'INSTRUCTIONS',
      'Cook until the rice is tender.',
    ].join('\n'))

    expect(parsed.ingredients).toEqual([
      '1 cup rice',
      'Add 🧾 ingredients to the bowl.',
      'I like 🥣 instructions that are simple.',
    ])
    expect(parsed.instructions).toEqual(['Cook until the rice is tender.'])
  })

  it('rejects composite content with multiple top-level ingredient sections', () => {
    const parsed = parseRecipeContent([
      'First smoothie',
      '🧾 Ingredients:',
      '1 banana',
      'Second smoothie',
      '🧾 Ingredients:',
      '1 cup berries',
    ].join('\n'))

    expect(parsed.ingredients).toEqual([])
  })

  it('parses the Carbonara qualified ingredient heading', () => {
    const parsed = parseWithIngredientHeading('INGREDIENTS (partial — from Keep note)')

    expect(parsed.ingredients).toEqual(['• 2 cups flour'])
  })

  it('accepts a short mixed-case qualifier and optional trailing colon', () => {
    expect(parseWithIngredientHeading('Ingredients (from original recipe):').ingredients).toEqual(['• 2 cups flour'])
    expect(parseWithIngredientHeading('iNgReDiEnTs(for sauce)').ingredients).toEqual(['• 2 cups flour'])
    expect(parseWithIngredientHeading('Ingredients (for sauce) :').ingredients).toEqual(['• 2 cups flour'])
  })

  it('accepts a nonempty qualifier at the 80-character bound', () => {
    const parsed = parseWithIngredientHeading(`INGREDIENTS (${'a'.repeat(80)})`)

    expect(parsed.ingredients).toEqual(['• 2 cups flour'])
  })

  it('rejects a qualifier exceeding 80 characters', () => {
    const parsed = parseWithIngredientHeading(`INGREDIENTS (${'a'.repeat(81)})`)

    expect(parsed.ingredients).toEqual([])
  })

  it('rejects empty, nested, and unbalanced qualifiers', () => {
    for (const heading of [
      'INGREDIENTS ()',
      'INGREDIENTS (   )',
      'INGREDIENTS (for (sauce))',
      'INGREDIENTS (partial',
      'INGREDIENTS partial)',
    ]) {
      expect(parseWithIngredientHeading(heading).ingredients, heading).toEqual([])
    }
  })

  it('rejects qualified headings followed by arbitrary prose', () => {
    expect(parseWithIngredientHeading('INGREDIENTS (partial) extra text').ingredients).toEqual([])
  })

  it('does not recognize prose containing ingredients or parentheses as a heading', () => {
    for (const prose of [
      'These ingredients make a rich sauce.',
      'Combine all ingredients in a bowl.',
      'The ingredients (partial list shown here) were adapted.',
      'For the ingredients, use fresh herbs.',
      'Ingredients are listed below (partial)',
      'Ingredients for four people',
      'Optional ingredients:',
      'More ingredients for serving:',
      'These ingredients make four servings.',
      'My ingredients:',
    ]) {
      expect(parseWithIngredientHeading(prose).ingredients, prose).toEqual([])
    }
  })

  it('preserves yield filtering, ingredient subheaders, bullets, and Step prefixes', () => {
    const parsed = parseRecipeContent([
      'INGREDIENTS:',
      'Yield: 4 servings',
      'For the sauce:',
      '• 2 tbsp olive oil',
      'INSTRUCTIONS:',
      'Step 1 Whisk the sauce until smooth.',
    ].join('\n'))

    expect(parsed.ingredients).toEqual(['For the sauce:', '• 2 tbsp olive oil'])
    expect(parsed.instructions).toEqual(['Whisk the sauce until smooth.'])
  })
})
