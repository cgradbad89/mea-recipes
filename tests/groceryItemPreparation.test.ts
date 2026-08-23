import { describe, expect, it } from 'vitest'
import { prepareGroceryItem } from '@/lib/groceryItemPreparation'

// ─── Phase 16 — shared helper unit tests ─────────────────────────────────────
describe('prepareGroceryItem — standard parsing', () => {
  it('parses quantity/unit/name and computes normalizedName + category', () => {
    const prepared = prepareGroceryItem({ raw: '2 cups rice' })
    expect(prepared).toEqual({
      quantity: '2',
      unit: 'cups',
      name: 'rice',
      normalizedName: 'rice',
      category: 'Pantry & Dry Goods',
      confidence: 'high',
    })
  })
})

describe('prepareGroceryItem — no-quantity item', () => {
  it('accepts a plain noun phrase with no quantity', () => {
    const prepared = prepareGroceryItem({ raw: 'garlic' })
    expect(prepared?.quantity).toBe('')
    expect(prepared?.unit).toBe('')
    expect(prepared?.name).toBe('garlic')
  })
})

describe('prepareGroceryItem — automatic category', () => {
  it('categorizes black pepper as Spices & Seasonings with no override', () => {
    const prepared = prepareGroceryItem({ raw: 'black pepper' })
    expect(prepared?.category).toBe('Spices & Seasonings')
  })
})

describe('prepareGroceryItem — category override', () => {
  it('an explicit override always wins over automatic categorization', () => {
    const prepared = prepareGroceryItem({ raw: 'oat milk', categoryOverride: 'Dairy & Eggs' })
    expect(prepared?.category).toBe('Dairy & Eggs')
    // Sanity: automatic classification really would differ, proving the override fired.
    const auto = prepareGroceryItem({ raw: 'oat milk' })
    expect(auto?.category).toBe('Beverages')
  })
})

describe('prepareGroceryItem — subheader rejection', () => {
  it('rejects a known shared ingredient subheader when rejectContentArtifacts is set', () => {
    expect(prepareGroceryItem({ raw: 'For the sauce:', rejectContentArtifacts: true })).toBeNull()
  })

  it('does NOT reject a subheader when rejectContentArtifacts is unset (manual-add behavior)', () => {
    expect(prepareGroceryItem({ raw: 'For the sauce:' })).not.toBeNull()
  })
})

describe('prepareGroceryItem — URL rejection', () => {
  it('rejects a complete explicit URL when rejectContentArtifacts is set', () => {
    expect(prepareGroceryItem({ raw: 'https://example.com', rejectContentArtifacts: true })).toBeNull()
  })

  it('does NOT reject a URL when rejectContentArtifacts is unset', () => {
    expect(prepareGroceryItem({ raw: 'https://example.com' })).not.toBeNull()
  })
})

describe('prepareGroceryItem — empty input/name', () => {
  it('rejects an empty raw string', () => {
    expect(prepareGroceryItem({ raw: '' })).toBeNull()
  })

  it('rejects a whitespace-only raw string', () => {
    expect(prepareGroceryItem({ raw: '   ' })).toBeNull()
  })
})

describe('prepareGroceryItem — Other category', () => {
  it('accepts a legitimate unmatched grocery noun as Other, not invalid', () => {
    const prepared = prepareGroceryItem({ raw: 'birthday candles' })
    expect(prepared).not.toBeNull()
    expect(prepared?.category).toBe('Other')
  })
})

// ─── Phase 19/20 — before/after equivalence against captured golden fixtures ─
// These expected values were captured by literally re-running the PRE-REFACTOR
// addRecipeIngredientsToGrocery (lib/userdata.ts) and handleAddItem
// (app/grocery/page.tsx) logic against the same inputs, NOT derived from this
// helper. See docs/audits/shared-grocery-preparation-pipeline-2026-08-23.md.
describe('prepareGroceryItem — recipe-path equivalence (before/after)', () => {
  const cases: [string, { rejected: true } | {
    rejected: false; quantity: string; unit: string; name: string; normalizedName: string; category: string
  }][] = [
    ['2 cups chicken broth', { rejected: false, quantity: '2', unit: 'cups', name: 'chicken broth', normalizedName: 'chicken broth', category: 'Pantry & Dry Goods' }],
    ['8 tbsp chicken broth', { rejected: false, quantity: '8', unit: 'tbsp', name: 'chicken broth', normalizedName: 'chicken broth', category: 'Pantry & Dry Goods' }],
    ['garlic', { rejected: false, quantity: '', unit: '', name: 'garlic', normalizedName: 'garlic', category: 'Produce' }],
    ['black pepper', { rejected: false, quantity: '', unit: '', name: 'black pepper', normalizedName: 'black pepper', category: 'Spices & Seasonings' }],
    ['1 can chickpeas', { rejected: false, quantity: '1', unit: 'can', name: 'chickpeas', normalizedName: 'chickpea', category: 'Pantry & Dry Goods' }],
    ['1 cup flour', { rejected: false, quantity: '1', unit: 'cup', name: 'flour', normalizedName: 'flour', category: 'Pantry & Dry Goods' }],
    ['2 tbsp olive oil', { rejected: false, quantity: '2', unit: 'tbsp', name: 'olive oil', normalizedName: 'olive oil', category: 'Sauces & Condiments' }],
    ['For the sauce:', { rejected: true }],
    ['https://example.com', { rejected: true }],
    ['- 2 cups flour', { rejected: false, quantity: '2', unit: 'cups', name: 'flour', normalizedName: 'flour', category: 'Pantry & Dry Goods' }],
    ['6 4 ears shucked corn', { rejected: false, quantity: '', unit: '', name: '6 4 ears shucked corn', normalizedName: '6 4 ear shucked corn', category: 'Produce' }],
    ['2 cups', { rejected: false, quantity: '', unit: '', name: '2 cups', normalizedName: '2 cup', category: 'Other' }],
    ['', { rejected: true }],
    ['   ', { rejected: true }],
  ]

  it.each(cases)('matches captured pre-refactor output for %j', (raw, expected) => {
    const prepared = prepareGroceryItem({ raw, rejectContentArtifacts: true })
    if (expected.rejected) {
      expect(prepared).toBeNull()
    } else {
      expect(prepared).not.toBeNull()
      expect(prepared?.quantity).toBe(expected.quantity)
      expect(prepared?.unit).toBe(expected.unit)
      expect(prepared?.name).toBe(expected.name)
      expect(prepared?.normalizedName).toBe(expected.normalizedName)
      expect(prepared?.category).toBe(expected.category)
    }
  })
})

describe('prepareGroceryItem — manual-path equivalence (before/after)', () => {
  it('plain noun, no quantity', () => {
    const prepared = prepareGroceryItem({
      raw: 'rice',
      parsedOverride: { quantity: '', unit: '', name: 'rice' },
      quantityOverride: '',
      unitOverride: '',
      categoryOverride: 'Other',
    })
    expect(prepared).toEqual({ quantity: '', unit: '', name: 'rice', normalizedName: 'rice', category: 'Other', confidence: 'high' })
  })

  it('inline quantity/unit parsed from the typed name', () => {
    const prepared = prepareGroceryItem({
      raw: '1 lb ground beef',
      parsedOverride: { quantity: '1', unit: 'lb', name: 'ground beef' },
      quantityOverride: '',
      unitOverride: '',
      categoryOverride: 'Other',
    })
    expect(prepared).toEqual({ quantity: '1', unit: 'lb', name: 'ground beef', normalizedName: 'ground beef', category: 'Other', confidence: 'high' })
  })

  it('explicit quantity/unit fields on a plain name', () => {
    const prepared = prepareGroceryItem({
      raw: 'ground beef',
      parsedOverride: { quantity: '', unit: '', name: 'ground beef' },
      quantityOverride: '8',
      unitOverride: 'oz',
      categoryOverride: 'Other',
    })
    expect(prepared).toEqual({ quantity: '8', unit: 'oz', name: 'ground beef', normalizedName: 'ground beef', category: 'Other', confidence: 'high' })
  })

  it('category override (oat milk → Dairy & Eggs, not auto Beverages)', () => {
    const prepared = prepareGroceryItem({
      raw: 'oat milk',
      parsedOverride: { quantity: '', unit: '', name: 'oat milk' },
      quantityOverride: '',
      unitOverride: '',
      categoryOverride: 'Dairy & Eggs',
    })
    expect(prepared?.category).toBe('Dairy & Eggs')
  })

  it('AI-resolved ambiguous line (doubled quantity) is used directly, never re-parsed', () => {
    const prepared = prepareGroceryItem({
      raw: '6 4 ears shucked corn',
      parsedOverride: { quantity: '6', unit: 'ears', name: 'shucked corn' },
      quantityOverride: '',
      unitOverride: '',
      categoryOverride: 'Other',
    })
    expect(prepared).toEqual({ quantity: '6', unit: 'ears', name: 'shucked corn', normalizedName: 'shucked corn', category: 'Other', confidence: 'high' })
  })

  it('ambiguous line with BOTH explicit fields already given (AI never fires) falls back to the full typed text as name', () => {
    const prepared = prepareGroceryItem({
      raw: '6 4 ears shucked corn',
      parsedOverride: { quantity: '', unit: '', name: '6 4 ears shucked corn' }, // low-confidence parse, AI skipped by caller
      quantityOverride: '1',
      unitOverride: 'ears',
      categoryOverride: 'Other',
    })
    expect(prepared).toEqual({
      quantity: '1', unit: 'ears', name: '6 4 ears shucked corn', normalizedName: '6 4 ear shucked corn', category: 'Other', confidence: 'high',
    })
  })

  it('explicit fields win over an inline quantity/unit in the typed name', () => {
    const prepared = prepareGroceryItem({
      raw: '2 cups sugar',
      parsedOverride: { quantity: '2', unit: 'cups', name: 'sugar' },
      quantityOverride: '5',
      unitOverride: 'tbsp',
      categoryOverride: 'Pantry & Dry Goods',
    })
    expect(prepared).toEqual({ quantity: '5', unit: 'tbsp', name: 'sugar', normalizedName: 'sugar', category: 'Pantry & Dry Goods', confidence: 'high' })
  })
})

// ─── Manual-add never rejects on subheader/URL/empty-parsed-name grounds ─────
describe('prepareGroceryItem — manual/recipe safeguard asymmetry', () => {
  it('a manual "line" that looks like a subheader or URL is never rejected', () => {
    expect(prepareGroceryItem({ raw: 'Notes:' })).not.toBeNull()
    expect(prepareGroceryItem({ raw: 'https://example.com' })).not.toBeNull()
  })
})
