import { describe, expect, it } from 'vitest'
import {
  categorizeIngredient,
  GROCERY_CATEGORIES,
  LEGACY_GROCERY_CATEGORIES,
  MANUAL_CATEGORIES,
  normalizePersistedGroceryCategory,
  type GroceryCategory,
} from '@/lib/groceryCategories'

const expectCategories = (cases: Record<string, GroceryCategory>) => {
  for (const [ingredient, category] of Object.entries(cases)) {
    expect(categorizeIngredient(ingredient), ingredient).toBe(category)
  }
}

describe('grocery category matching', () => {
  it('defines the approved eleven categories and exposes all of them manually', () => {
    expect(GROCERY_CATEGORIES).toEqual([
      'Produce',
      'Meat & Seafood',
      'Dairy & Eggs',
      'Bakery & Bread',
      'Pantry & Dry Goods',
      'Canned & Jarred',
      'Sauces & Condiments',
      'Spices & Seasonings',
      'Nuts, Seeds & Nut Butters',
      'Beverages',
      'Other',
    ])
    expect(MANUAL_CATEGORIES).toEqual(GROCERY_CATEGORIES)
    expect(LEGACY_GROCERY_CATEGORIES).toEqual(['Staples', 'Canned / Jarred / Sauces'])
  })

  it('uses token boundaries instead of embedded alphabetic substrings', () => {
    expectCategories({
      'extra-virgin olive oil': 'Sauces & Condiments',
      teaspoon: 'Other',
      'rolled oats': 'Pantry & Dry Goods',
      peanut: 'Nuts, Seeds & Nut Butters',
      'peanut butter': 'Nuts, Seeds & Nut Butters',
      'pearl couscous': 'Pantry & Dry Goods',
      peppercorn: 'Spices & Seasonings',
    })
  })

  it('lets specific purchase identities outrank generic component words', () => {
    expectCategories({
      'garlic powder': 'Spices & Seasonings',
      'onion powder': 'Spices & Seasonings',
      'tomato paste': 'Canned & Jarred',
      'coconut milk': 'Canned & Jarred',
      'almond milk': 'Beverages',
      'oat milk': 'Beverages',
      'fish sauce': 'Sauces & Condiments',
      'oyster sauce': 'Sauces & Condiments',
      'chicken broth': 'Pantry & Dry Goods',
      'butter beans': 'Canned & Jarred',
      'sesame oil': 'Sauces & Condiments',
      'mustard powder': 'Spices & Seasonings',
      'almond flour': 'Pantry & Dry Goods',
      'canned tuna': 'Canned & Jarred',
    })
  })

  it('covers the required store-oriented assignments', () => {
    expectCategories({
      'olive oil': 'Sauces & Condiments',
      'vegetable oil': 'Sauces & Condiments',
      'red wine vinegar': 'Sauces & Condiments',
      'dried rosemary': 'Spices & Seasonings',
      'poultry seasoning': 'Spices & Seasonings',
      'chicken stock': 'Pantry & Dry Goods',
      chickpeas: 'Pantry & Dry Goods',
      'canned chickpeas': 'Canned & Jarred',
      'soy milk': 'Beverages',
      cornstarch: 'Pantry & Dry Goods',
      tahini: 'Nuts, Seeds & Nut Butters',
      'sesame seeds': 'Nuts, Seeds & Nut Butters',
    })
  })

  it('distinguishes seasoning peppers and dried herbs from fresh produce', () => {
    expectCategories({
      'black pepper': 'Spices & Seasonings',
      'freshly ground black pepper': 'Spices & Seasonings',
      'cayenne pepper': 'Spices & Seasonings',
      'bell pepper': 'Produce',
      'jalapeño': 'Produce',
      'dried oregano': 'Spices & Seasonings',
      'fresh oregano': 'Produce',
      'dried thyme': 'Spices & Seasonings',
      'fresh thyme': 'Produce',
      'fresh basil': 'Produce',
      'dried basil': 'Spices & Seasonings',
      'white pepper': 'Spices & Seasonings',
      'red pepper flakes': 'Spices & Seasonings',
      'serrano pepper': 'Produce',
      habanero: 'Produce',
      'sliced red chilli': 'Produce',
      strawberries: 'Produce',
      jalapeños: 'Produce',
    })
  })

  it('keeps fresh alliums and protein identities distinct from processed forms', () => {
    expectCategories({
      garlic: 'Produce',
      'garlic cloves': 'Produce',
      'minced fresh garlic': 'Produce',
      'red onion': 'Produce',
      shallot: 'Produce',
      'fish fillet': 'Meat & Seafood',
      oysters: 'Meat & Seafood',
      shrimp: 'Meat & Seafood',
    })
  })

  it('preserves representative known-good classifications', () => {
    expectCategories({
      'chicken breast': 'Meat & Seafood',
      'ground beef': 'Meat & Seafood',
      salmon: 'Meat & Seafood',
      milk: 'Dairy & Eggs',
      cheddar: 'Dairy & Eggs',
      egg: 'Dairy & Eggs',
      bread: 'Bakery & Bread',
      baguette: 'Bakery & Bread',
      tomato: 'Produce',
      onion: 'Produce',
      broccoli: 'Produce',
      rice: 'Pantry & Dry Goods',
      pasta: 'Pantry & Dry Goods',
      'soy sauce': 'Sauces & Condiments',
      sriracha: 'Sauces & Condiments',
      coffee: 'Beverages',
      wine: 'Beverages',
      'mystery ingredient': 'Other',
    })
  })

  it('normalizes legacy manualSection and saved defaultCategory values without changing current overrides', () => {
    expect(normalizePersistedGroceryCategory('Staples', 'olive oil')).toBe('Sauces & Condiments')
    expect(normalizePersistedGroceryCategory('Staples', 'rice')).toBe('Pantry & Dry Goods')
    expect(normalizePersistedGroceryCategory('Staples', 'black pepper')).toBe('Spices & Seasonings')
    expect(normalizePersistedGroceryCategory('Canned / Jarred / Sauces', 'tomato paste')).toBe('Canned & Jarred')
    expect(normalizePersistedGroceryCategory('Canned / Jarred / Sauces', 'soy sauce')).toBe('Sauces & Condiments')
    expect(normalizePersistedGroceryCategory('Dairy & Eggs', 'oat milk')).toBe('Dairy & Eggs')
    expect(normalizePersistedGroceryCategory('arbitrary stored value', 'rice')).toBe('Pantry & Dry Goods')
  })
})
