import { describe, expect, it } from 'vitest'
import { extractSourceRecipeFacts, normalizeRecipeImageUrl, publisherNutritionFromStructuredData } from '@/lib/sourceRecipeFacts'

const completeNutrition = {
  calories: '500 calories',
  proteinContent: '30 g',
  carbohydrateContent: '40 grams',
  fatContent: '22 g',
  fiberContent: '5 g',
  sugarContent: '8 g',
}

function recipeJson(recipe: Record<string, unknown>) {
  return `<script type="application/ld+json">${JSON.stringify(recipe)}</script>`
}

describe('source recipe facts', () => {
  it('captures a Recipe JSON-LD string image', () => {
    const facts = extractSourceRecipeFacts(recipeJson({ '@type': 'Recipe', image: 'https://cdn.example/recipe.jpg' }))
    expect(facts.imageURL).toBe('https://cdn.example/recipe.jpg')
  })

  it('uses the first usable image from a JSON-LD image array', () => {
    const facts = extractSourceRecipeFacts(recipeJson({
      '@type': 'Recipe', image: ['data:image/png;base64,nope', 'https://cdn.example/large.jpg'],
    }))
    expect(facts.imageURL).toBe('https://cdn.example/large.jpg')
  })

  it('captures an ImageObject URL and resolves a relative URL against the recipe page', () => {
    const facts = extractSourceRecipeFacts(recipeJson({
      '@type': 'Recipe', image: { '@type': 'ImageObject', url: '/images/recipe.jpg' },
    }), 'https://recipes.example/dinner/pasta')
    expect(facts.imageURL).toBe('https://recipes.example/images/recipe.jpg')
  })

  it('falls back to recipe microdata and then og:image when Recipe.image is absent', () => {
    const microdata = '<div itemtype="https://schema.org/Recipe"><img itemprop="image" src="/micro.jpg"></div>'
    expect(extractSourceRecipeFacts(microdata, 'https://recipes.example/a').imageURL).toBe('https://recipes.example/micro.jpg')
    const og = '<meta property="og:image" content="https://cdn.example/open-graph.jpg">'
    expect(extractSourceRecipeFacts(og).imageURL).toBe('https://cdn.example/open-graph.jpg')
  })

  it('ignores unusable image schemes and obvious structured logos', () => {
    expect(normalizeRecipeImageUrl('blob:https://recipes.example/id')).toBe('')
    expect(normalizeRecipeImageUrl('data:image/png;base64,abc')).toBe('')
    expect(normalizeRecipeImageUrl('https://cdn.example/assets/site-logo.png')).toBe('')
  })

  it('parses complete publisher nutrition into per-serving values and durable totals', () => {
    const nutrition = publisherNutritionFromStructuredData({ ...completeNutrition, recipeYield: '4 servings', servingSize: '1 bowl' })
    expect(nutrition).toEqual(expect.objectContaining({
      calories: 500, protein_g: 30, carbs_g: 40, fat_g: 22, fiber_g: 5, sugar_g: 8,
      servings: 4, serving_size: '1 bowl', source: 'source_site', confidence: 'high',
      total: { calories: 2000, protein_g: 120, carbs_g: 160, fat_g: 88, fiber_g: 20, sugar_g: 32 },
    }))
  })

  it('does not turn missing publisher macros into zero', () => {
    const { fiberContent: _missing, ...partial } = completeNutrition
    expect(publisherNutritionFromStructuredData({ ...partial, recipeYield: 4 })).toBeUndefined()
  })

  it('rejects ambiguous nutrition strings or a missing serving count', () => {
    expect(publisherNutritionFromStructuredData({ ...completeNutrition, calories: 'about 500 calories', recipeYield: 4 })).toBeUndefined()
    expect(publisherNutritionFromStructuredData(completeNutrition)).toBeUndefined()
  })

  it('handles multiple JSON-LD blocks and @graph while tolerating malformed metadata', () => {
    const html = [
      '<script type="application/ld+json">{invalid</script>',
      recipeJson({ '@graph': [{ '@type': 'WebSite' }, { '@type': ['Thing', 'Recipe'], image: { url: 'https://cdn.example/graph.jpg' }, nutrition: completeNutrition, recipeYield: '2 servings' }] }),
    ].join('')
    const facts = extractSourceRecipeFacts(html)
    expect(facts.imageURL).toBe('https://cdn.example/graph.jpg')
    expect(facts.nutrition).toEqual(expect.objectContaining({ servings: 2, total: expect.objectContaining({ calories: 1000 }) }))
  })
})
