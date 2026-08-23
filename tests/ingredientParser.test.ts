import { describe, expect, it } from 'vitest'
import {
  normalizeNoun,
  singularizeFoodWord,
  convertQuantity,
  mergeQuantities,
  measurementDimension,
} from '@/lib/ingredientParser'

describe('food noun normalization', () => {
  it('normalizes common regular and irregular food plurals', () => {
    expect(normalizeNoun('tomatoes')).toBe('tomato')
    expect(normalizeNoun('fresh leaves')).toBe('fresh leaf')
    expect(normalizeNoun('red onions')).toBe('red onion')
    expect(normalizeNoun('mixed berries')).toBe('mixed berry')
  })

  it('preserves uncountable and special food nouns', () => {
    for (const noun of ['fish', 'rice', 'couscous', 'molasses', 'oats', 'asparagus']) {
      expect(singularizeFoodWord(noun)).toBe(noun)
    }
  })

  it('keeps identity-bearing modifiers', () => {
    expect(normalizeNoun('the red onions')).toBe('red onion')
    expect(normalizeNoun('yellow onion')).toBe('yellow onion')
    expect(normalizeNoun('red onions')).not.toBe(normalizeNoun('yellow onion'))
  })
})

// ─── Unit conversion: dimension/factor table ─────────────────────────────────
// Every supported measurement unit checked against its base-unit conversion
// factor, to catch accidental future regressions in the conversion constants.
describe('measurementDimension', () => {
  it('classifies volume units', () => {
    for (const u of ['teaspoon', 'tbsp', 'cup', 'ml', 'liter', 'pint', 'quart', 'gallon']) {
      expect(measurementDimension(u)).toBe('volume')
    }
  })

  it('classifies mass units', () => {
    for (const u of ['mg', 'gram', 'kg', 'oz', 'lb']) {
      expect(measurementDimension(u)).toBe('mass')
    }
  })

  it('returns null for countable units, unknown units, and empty strings', () => {
    expect(measurementDimension('can')).toBeNull()
    expect(measurementDimension('clove')).toBeNull()
    expect(measurementDimension('bogus')).toBeNull()
    expect(measurementDimension('')).toBeNull()
  })
})

describe('convertQuantity — conversion table', () => {
  const TOL = 1e-9

  it('converts every volume unit into milliliters at its exact factor', () => {
    expect(convertQuantity(1, 'teaspoon', 'ml')).toBeCloseTo(4.92892159375, 9)
    expect(convertQuantity(1, 'tablespoon', 'ml')).toBeCloseTo(14.78676478125, 9)
    expect(convertQuantity(1, 'cup', 'ml')).toBeCloseTo(236.5882365, 6)
    expect(convertQuantity(1, 'pint', 'ml')).toBeCloseTo(473.176473, 6)
    expect(convertQuantity(1, 'quart', 'ml')).toBeCloseTo(946.352946, 6)
    expect(convertQuantity(1, 'gallon', 'ml')).toBeCloseTo(3785.411784, 6)
    expect(convertQuantity(1, 'liter', 'ml')).toBeCloseTo(1000, TOL)
  })

  it('converts every mass unit into grams at its exact factor', () => {
    expect(convertQuantity(1, 'milligram', 'gram')).toBeCloseTo(0.001, 9)
    expect(convertQuantity(1, 'kilogram', 'gram')).toBeCloseTo(1000, TOL)
    expect(convertQuantity(1, 'ounce', 'gram')).toBeCloseTo(28.349523125, 9)
    expect(convertQuantity(1, 'pound', 'gram')).toBeCloseTo(453.59237, 6)
    expect(convertQuantity(1, 'pound', 'ounce')).toBeCloseTo(16, 9)
  })

  it('exact US cooking relationships', () => {
    expect(convertQuantity(1, 'tablespoon', 'teaspoon')).toBeCloseTo(3, 9)
    expect(convertQuantity(1, 'cup', 'tablespoon')).toBeCloseTo(16, 9)
    expect(convertQuantity(1, 'pint', 'cup')).toBeCloseTo(2, 9)
    expect(convertQuantity(1, 'quart', 'pint')).toBeCloseTo(2, 9)
    expect(convertQuantity(1, 'gallon', 'quart')).toBeCloseTo(4, 9)
  })

  it('same canonical unit → unchanged quantity', () => {
    expect(convertQuantity(2.5, 'cups', 'cup')).toBe(2.5)
    expect(convertQuantity(3, 'g', 'gram')).toBe(3)
    expect(convertQuantity(3, 'can', 'cans')).toBe(3)
  })

  it('cross-dimension pairs are always null', () => {
    expect(convertQuantity(1, 'cup', 'gram')).toBeNull()
    expect(convertQuantity(1, 'oz', 'ml')).toBeNull()
    expect(convertQuantity(1, 'lb', 'tbsp')).toBeNull()
  })

  it('countable units never convert, even to another countable unit', () => {
    expect(convertQuantity(1, 'can', 'jar')).toBeNull()
    expect(convertQuantity(1, 'clove', 'tbsp')).toBeNull()
  })

  it('unknown units and invalid quantities return null and never throw', () => {
    expect(convertQuantity(1, 'bogus', 'cup')).toBeNull()
    expect(convertQuantity(1, 'cup', 'bogus')).toBeNull()
    expect(convertQuantity(NaN, 'cup', 'tbsp')).toBeNull()
    expect(convertQuantity(Infinity, 'cup', 'tbsp')).toBeNull()
    expect(() => convertQuantity(1, '', '')).not.toThrow()
  })
})

// ─── mergeQuantities — compatible-unit conversion and summing ────────────────
describe('mergeQuantities — same canonical unit (Case B, unchanged)', () => {
  it('sums identical units', () => {
    expect(mergeQuantities({ quantity: '2', unit: 'cups' }, { quantity: '1', unit: 'cup' }))
      .toEqual({ quantity: '3', unit: 'cups' })
    expect(mergeQuantities({ quantity: '500', unit: 'grams' }, { quantity: '250', unit: 'g' }))
      .toEqual({ quantity: '750', unit: 'grams' })
    expect(mergeQuantities({ quantity: '1', unit: 'can' }, { quantity: '2', unit: 'cans' }))
      .toEqual({ quantity: '3', unit: 'can' })
  })
})

describe('mergeQuantities — compatible different units (Case C)', () => {
  it('volume: converts incoming into the existing unit', () => {
    expect(mergeQuantities({ quantity: '1', unit: 'cup' }, { quantity: '8', unit: 'tbsp' }))
      .toEqual({ quantity: '1.5', unit: 'cup' })
    expect(mergeQuantities({ quantity: '8', unit: 'tbsp' }, { quantity: '1', unit: 'cup' }))
      .toEqual({ quantity: '24', unit: 'tbsp' })
    expect(mergeQuantities({ quantity: '1', unit: 'tbsp' }, { quantity: '3', unit: 'tsp' }))
      .toEqual({ quantity: '2', unit: 'tbsp' })
    expect(mergeQuantities({ quantity: '3', unit: 'tsp' }, { quantity: '1', unit: 'tbsp' }))
      .toEqual({ quantity: '6', unit: 'tsp' })
    expect(mergeQuantities({ quantity: '1', unit: 'l' }, { quantity: '500', unit: 'ml' }))
      .toEqual({ quantity: '1.5', unit: 'l' })
    expect(mergeQuantities({ quantity: '500', unit: 'ml' }, { quantity: '1', unit: 'l' }))
      .toEqual({ quantity: '1500', unit: 'ml' })
    expect(mergeQuantities({ quantity: '1', unit: 'pint' }, { quantity: '1', unit: 'cup' }))
      .toEqual({ quantity: '1.5', unit: 'pint' })
    expect(mergeQuantities({ quantity: '1', unit: 'quart' }, { quantity: '1', unit: 'pint' }))
      .toEqual({ quantity: '1.5', unit: 'quart' })
    expect(mergeQuantities({ quantity: '1', unit: 'gallon' }, { quantity: '1', unit: 'quart' }))
      .toEqual({ quantity: '1.25', unit: 'gallon' })
  })

  it('volume cross-system (US customary ↔ metric)', () => {
    const merged = mergeQuantities({ quantity: '1', unit: 'cup' }, { quantity: '236.5882365', unit: 'ml' })
    expect(merged.unit).toBe('cup')
    expect(Number(merged.quantity)).toBeCloseTo(2, 6)

    const merged2 = mergeQuantities({ quantity: '500', unit: 'ml' }, { quantity: '1', unit: 'cup' })
    expect(merged2.unit).toBe('ml')
    expect(Number(merged2.quantity)).toBeCloseTo(736.59, 2)
  })

  it('mass: converts incoming into the existing unit', () => {
    expect(mergeQuantities({ quantity: '1', unit: 'kg' }, { quantity: '500', unit: 'g' }))
      .toEqual({ quantity: '1.5', unit: 'kg' })
    expect(mergeQuantities({ quantity: '500', unit: 'g' }, { quantity: '1', unit: 'kg' }))
      .toEqual({ quantity: '1500', unit: 'g' })
    expect(mergeQuantities({ quantity: '1', unit: 'lb' }, { quantity: '8', unit: 'oz' }))
      .toEqual({ quantity: '1.5', unit: 'lb' })
    expect(mergeQuantities({ quantity: '8', unit: 'oz' }, { quantity: '1', unit: 'lb' }))
      .toEqual({ quantity: '24', unit: 'oz' })

    const merged = mergeQuantities({ quantity: '1', unit: 'kg' }, { quantity: '1', unit: 'lb' })
    expect(merged.unit).toBe('kg')
    expect(Number(merged.quantity)).toBeCloseTo(1.45, 2)
  })

  it('no floating-point garbage in the formatted result', () => {
    const merged = mergeQuantities({ quantity: '1', unit: 'cup' }, { quantity: '8', unit: 'tbsp' })
    expect(merged.quantity).toBe('1.5')
    expect(merged.quantity).not.toMatch(/\d{3,}$/)
  })
})

describe('mergeQuantities — incompatible dimensions (Case D, side-by-side)', () => {
  it('never converts weight ↔ volume, volume ↔ count, or weight ↔ count', () => {
    expect(mergeQuantities({ quantity: '1', unit: 'cup' }, { quantity: '200', unit: 'g' }))
      .toEqual({ quantity: '1 cup + 200 g', unit: '' })
    expect(mergeQuantities({ quantity: '1', unit: 'can' }, { quantity: '8', unit: 'oz' }))
      .toEqual({ quantity: '1 can + 8 oz', unit: '' })
    expect(mergeQuantities({ quantity: '2', unit: 'tbsp' }, { quantity: '1', unit: 'package' }))
      .toEqual({ quantity: '2 tbsp + 1 package', unit: '' })
    expect(mergeQuantities({ quantity: '1', unit: 'clove' }, { quantity: '1', unit: 'tbsp' }))
      .toEqual({ quantity: '1 clove + 1 tbsp', unit: '' })
  })

  it('does not convert between different countable units', () => {
    expect(mergeQuantities({ quantity: '1', unit: 'can' }, { quantity: '2', unit: 'jar' }))
      .toEqual({ quantity: '1 can + 2 jar', unit: '' })
  })
})

describe('mergeQuantities — non-numeric / ranges (Case E, conservative)', () => {
  it('never converts or sums a range', () => {
    expect(mergeQuantities({ quantity: '1-2', unit: 'cups' }, { quantity: '1', unit: 'cup' }))
      .toEqual({ quantity: '1-2 cups + 1 cup', unit: '' })
  })

  it('never converts or sums a non-numeric quantity', () => {
    expect(mergeQuantities({ quantity: 'a handful', unit: '' }, { quantity: '200', unit: 'g' }))
      .toEqual({ quantity: 'a handful + 200 g', unit: '' })
  })
})

describe('mergeQuantities — multi-recipe accumulation (sequential merges)', () => {
  it('accumulates 1 cup + 8 tbsp + 4 tbsp → 1.75 cups without drift', () => {
    let acc = { quantity: '1', unit: 'cup' }
    acc = mergeQuantities(acc, { quantity: '8', unit: 'tbsp' })
    expect(acc).toEqual({ quantity: '1.5', unit: 'cup' })
    acc = mergeQuantities(acc, { quantity: '4', unit: 'tbsp' })
    expect(acc).toEqual({ quantity: '1.75', unit: 'cup' })
  })
})

describe('mergeQuantities — merge direction is intentionally asymmetric', () => {
  it('preserves whichever unit is the EXISTING (first) item, not a "prettier" unit', () => {
    expect(mergeQuantities({ quantity: '1', unit: 'cup' }, { quantity: '8', unit: 'tbsp' }).unit).toBe('cup')
    expect(mergeQuantities({ quantity: '8', unit: 'tbsp' }, { quantity: '1', unit: 'cup' }).unit).toBe('tbsp')
  })
})

describe('mergeQuantities — unit conversion never broadens grocery identity', () => {
  it('is purely a quantity operation; identity matching stays the caller\'s responsibility via normalizeNoun', () => {
    // "red onion" vs "onion" are different normalizeNoun() identities and would
    // never reach mergeQuantities together in the real add path — verified here
    // only to document that mergeQuantities itself has no noun awareness.
    expect(normalizeNoun('red onion')).not.toBe(normalizeNoun('onion'))
  })
})
