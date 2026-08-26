import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseRecipeContent } from '@/lib/recipeContent'

const ROOT = path.resolve(import.meta.dirname, '..')
const audit = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'docs/audits/excluded-recipe-source-parser-audit-2026-08-26.json'),
  'utf8',
))
const rows = new Map<string, any>(audit.recipes.map((row: any) => [row.recipeId, row]))

function contentFromAudit(recipeId: string, instructionLines?: string[]): string {
  const row = rows.get(recipeId)
  if (!row) throw new Error(`Missing audited recipe: ${recipeId}`)
  return [
    'INGREDIENTS',
    ...row.currentParse.ingredients,
    'INSTRUCTIONS',
    ...(instructionLines || row.currentParse.instructions),
  ].join('\n')
}

const urlIds: string[] = audit.parserRuleSimulations
  .find((rule: any) => rule.rule === 'STANDALONE_URL_FILTER')
  .excludedRecipeIdsImproved

const reviewIds: string[] = audit.parserRuleSimulations
  .find((rule: any) => rule.rule === 'REVIEW_COMMENT_TERMINATORS')
  .excludedRecipeIdsImproved

const footerIds: string[] = audit.parserRuleSimulations
  .find((rule: any) => rule.rule === 'EXPLICIT_FOOTER_METADATA')
  .excludedRecipeIdsImproved

const reviewBoundary = /^(?:Have you cooked this\?(?: Mark as Cooked)?|COOKING NOTES|Comments?|Reviews?|Reader notes|Ratings?|.{1,80}\d+\s+years? ago)$/i
const footerBoundary = /^(?:Storage(?: Suggestions?)?:\s*|(?:📊\s*)?Nutrition Estimate:|Nutrition(?:al Information)?:$)/i
const footerLine = /^(?:Note:\s*The nutritional information\b|Recipe Source:\s*https?:\/\/\S+)/i

describe('Wave 1A exact excluded-corpus regressions', () => {
  it.each(urlIds)('%s removes only the audited standalone URL instruction', recipeId => {
    const row = rows.get(recipeId)
    const parsed = parseRecipeContent(contentFromAudit(recipeId))
    const expected = row.currentParse.instructions.filter((line: string) =>
      !/^https?:\/\/\S+$/i.test(line) && !/^(?:Make the recipe with us|On Off)$/i.test(line),
    )

    expect(parsed.ingredients).toEqual(row.currentParse.ingredients)
    expect(parsed.instructions).toEqual(expected)
    expect(parsed.instructions.some((line: string) => /^https?:\/\/\S+$/i.test(line))).toBe(false)
  })

  it.each(reviewIds)('%s stops at its exact audited review/comment boundary', recipeId => {
    const row = rows.get(recipeId)
    const rawInstructions = [...row.currentParse.instructions]
    if (recipeId === 'curried-red-bean-soup-with-kale') {
      rawInstructions.splice(rawInstructions.length - 1, 0, 'Comment')
    }
    const boundaryIndex = rawInstructions.findIndex((line: string) => reviewBoundary.test(line))
    expect(boundaryIndex).toBeGreaterThan(-1)

    const parsed = parseRecipeContent(contentFromAudit(recipeId, rawInstructions))
    expect(parsed.ingredients).toEqual(row.currentParse.ingredients)
    expect(parsed.instructions).toEqual(rawInstructions.slice(0, boundaryIndex).filter((line: string) => line.length > 10))
  })

  it.each(footerIds)('%s applies only its exact audited footer metadata rule', recipeId => {
    const row = rows.get(recipeId)
    const expected: string[] = []
    for (const line of row.currentParse.instructions) {
      if (footerBoundary.test(line)) break
      if (!footerLine.test(line)) expected.push(line)
    }

    const parsed = parseRecipeContent(contentFromAudit(recipeId))
    expect(parsed.ingredients).toEqual(row.currentParse.ingredients)
    expect(parsed.instructions).toEqual(expected)
  })

  it('parses the complete audited Filipino Tocino PREP and ON THE STOVE method', () => {
    const ingredients = [
      '4 cloves garlic',
      '1 inch (about 1 tbsp) fine minced ginger',
      '3 green onions',
      '1 lb chicken thigh',
      '2 eggs',
      'furikake',
      'peanut oil',
      '4 tbsp low sodium soy sauce (or 2 tbsp full sodium soy sauce)',
      '1/2 tsp white pepper',
      '2 tbsp sweet chili sauce',
      '1 tbsp brown sugar',
      '1/2 cup pineapple juice',
      '2 tbsp ketchup',
    ]
    const instructions = [
      'CRUSH and mince the garlic, set aside',
      'FINE MINCE the ginger, set aside',
      'SLICE the whites of the green onions, set aside',
      'SLICE the greens of the green onions on a bias, set aside',
      'COMBINE all marinade ingredients with the chicken thighs, garlic, ginger, and whites of green onions in a ziplock bag, then toss and let marinate for a minimum of 30 minutes, or up to 4 hours',
      'HEAT a wok over medium low heat, add the chicken and marinade to the wok plus an additional 1 cup water, then let simmer for 1 hour adding additional water as needed',
      'REDUCE the marinade until a thickened sauce forms, then add 4 tbsp peanut oil and let the chicken thigh sear undisturbed for 2 minutes before tossing for wok hei',
      'REMOVE the chicken, then reheat the wok over high heat, add 4 tbsp peanut oil and long yao',
      'ADD the egg to the center of the wok, and spoon oil over top for a sunnyside up egg',
      'SERVE with rice and furikake, and finish with the greens of the green onions',
    ]
    const content = ['https://www.woocancook.com/chicken-tocino', 'INGREDIENTS', ...ingredients,
      'PREP', ...instructions.slice(0, 5), 'ON THE STOVE', ...instructions.slice(5)].join('\n')

    expect(parseRecipeContent(content)).toMatchObject({ ingredients, instructions })
  })

  it('parses all six audited Crunchy Queso Wrap steps and excludes its trailing Tip', () => {
    const baseline = rows.get('crunchy-queso-wrap').currentParse.ingredients
    const ingredients = [...baseline, 'Hot sauce, for serving']
    const instructions = [
      'Prepare your filling: In a large nonstick skillet, heat the oil over medium-high. Add the beef and onion, season aggressively with salt and pepper, and cook, breaking into tiny pieces, until the beef starts to brown, about 5 minutes. Stir in the tomato paste, then the cumin, paprika, ancho chile powder and garlic powder, and cook, stirring occasionally, until fragrant and any excess liquid evaporates, about 3 minutes. Transfer the mixture to a medium bowl. Using a paper towel, wipe out the skillet.',
      'Prepare the spicy sour cream: In a small bowl, mix together the sour cream and adobo sauce; season to taste with salt and pepper.',
      'Prepare the assembly line: On a large flat surface, set out the flour tortillas. (You’ll need your tortillas to be pliable without tearing, so if need be, you can warm them directly in the skillet over medium heat to soften just until soft and pliable.) Add ½ cup filling to the center of one tortilla, flattening the filling into an even, 4-inch circle just a bit smaller than the width of your tostadas. Spread with 3 tablespoons queso over the filling. Top the mixture with a tostada, pressing it slightly to make sure the meat mixture is evenly distributed. Evenly spread 2 scant tablespoons of the spicy sour cream on top of the tostada. Top evenly with a heaping ¼ cup shredded lettuce, then 3 tablespoons drained pico de gallo.',
      'Enclose the filling by folding over one flap of the tortilla “border” to cover the filling, repeating the pleat every inch or two. The tortilla should fully enclose your filling, but an opening smaller than 1 inch at the center is just fine. (You can also use slightly less filling, or add a piece of tortilla to cover the gap; see Tip.)',
      'Heat 1 tablespoon oil in the skillet over medium, then carefully add the wrap, setting it seam side down. Cook until golden and crisp, 2 to 3 minutes per side.',
      'Serve immediately, with hot sauce and the remaining spicy sour cream, for dipping or slathering as you eat, dousing the wrap bite by bite. Repeat with remaining wraps, adding oil as needed to the pan before searing.',
    ]
    const content = ['INGREDIENTS', ...ingredients, ...instructions.flatMap((line, index) => [`Step ${index + 1}`, line]),
      'Tip', 'If you can’t find 10-inch tortillas, use the largest available.'].join('\n')

    expect(parseRecipeContent(content)).toMatchObject({ ingredients, instructions })
  })
})

describe('Wave 1A conservative boundaries and negative cases', () => {
  it('filters standalone HTTP and HTTPS lines while preserving embedded URL prose and attribution', () => {
    const parsed = parseRecipeContent([
      'INGREDIENTS',
      '1 pound potatoes',
      'INSTRUCTIONS',
      'Roast the potatoes until they are crisp.',
      'https://example.com/source',
      'http://example.com/other',
      'Source: https://example.com/source',
      'See https://example.com/technique for technique, then roast 20 minutes.',
    ].join('\n'))

    expect(parsed.instructions).toEqual([
      'Roast the potatoes until they are crisp.',
      'Source: https://example.com/source',
      'See https://example.com/technique for technique, then roast 20 minutes.',
    ])
  })

  it('preserves legitimate first-person cooking prose', () => {
    const guidance = [
      'I like to toast the spices until fragrant before adding the tomatoes.',
      'I recommend serving immediately so the crust remains crisp.',
      "You'll want to rest the chicken before carving it.",
    ]
    const parsed = parseRecipeContent(['INGREDIENTS', '1 chicken', 'INSTRUCTIONS', ...guidance].join('\n'))
    expect(parsed.instructions).toEqual(guidance)
  })

  it('preserves actual mapped-corpus NOTES guidance', () => {
    const guidance = '1. Apart from chicken, you may also use pork, beef, shrimp or Char Siu. For vegetarian and vegan diets, egg and tofu are great alternatives.'
    const parsed = parseRecipeContent([
      'INGREDIENTS', '1 pound chicken', 'INSTRUCTIONS', 'Cook the chicken until browned.', 'NOTES', guidance,
    ].join('\n'))
    expect(parsed.instructions).toEqual(['Cook the chicken until browned.', guidance])
  })

  it('preserves actual mapped-corpus Tip guidance', () => {
    const guidance = 'To grill, heat a grill to medium-high. Oil the grates. Wipe off excess marinade from the chicken, then grill over direct heat until cooked through.'
    const parsed = parseRecipeContent([
      'INGREDIENTS', '1 pound chicken', 'INSTRUCTIONS', 'Marinate the chicken for 30 minutes.', 'Tip', guidance,
    ].join('\n'))
    expect(parsed.instructions).toEqual(['Marinate the chicken for 30 minutes.', guidance])
  })

  it('does not treat time metadata as a PREP method fallback', () => {
    const parsed = parseRecipeContent([
      'INGREDIENTS', '1 cup rice', 'Prep: 20 minutes', 'Rinse the rice thoroughly before cooking.',
      'ON THE STOVE', 'Simmer the rice until tender.',
    ].join('\n'))
    expect(parsed.instructions).toEqual([])
  })

  it('does not trigger the numbered fallback from an isolated Step 1', () => {
    const parsed = parseRecipeContent([
      'INGREDIENTS', '1 cup rice', 'Step 1', 'This is an isolated tutorial line, not a sequential method.',
    ].join('\n'))
    expect(parsed.instructions).toEqual([])
  })

  it('keeps ordinary instruction-heading precedence over later numbered structure', () => {
    const parsed = parseRecipeContent([
      'INGREDIENTS', '1 cup rice', 'INSTRUCTIONS', 'Start with this ordinary-heading instruction.',
      'Step 1', 'Continue with the first numbered action.', 'Step 2', 'Finish with the second numbered action.',
    ].join('\n'))
    expect(parsed.instructions).toEqual([
      'Start with this ordinary-heading instruction.',
      'Continue with the first numbered action.',
      'Finish with the second numbered action.',
    ])
  })
})
