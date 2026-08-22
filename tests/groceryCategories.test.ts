import { describe, expect, it } from 'vitest'
import {
  categorizeIngredient,
  GROCERY_CATEGORIES,
  MANUAL_CATEGORIES,
  type GroceryCategory,
} from '@/lib/groceryCategories'

const expectCategories = (cases: Record<string, GroceryCategory>) => {
  for (const [ingredient, category] of Object.entries(cases)) {
    expect(categorizeIngredient(ingredient), ingredient).toBe(category)
  }
}

describe('grocery category matching', () => {
  it('preserves the current nine values and auto-only Staples behavior', () => {
    expect(GROCERY_CATEGORIES).toEqual([
      'Produce',
      'Meat & Seafood',
      'Dairy & Eggs',
      'Bakery & Bread',
      'Canned / Jarred / Sauces',
      'Beverages',
      'Spices & Seasonings',
      'Staples',
      'Other',
    ])
    expect(MANUAL_CATEGORIES).not.toContain('Staples')
  })

  it('uses token boundaries instead of embedded alphabetic substrings', () => {
    expectCategories({
      'extra-virgin olive oil': 'Staples',
      teaspoon: 'Other',
      'rolled oats': 'Staples',
      peanut: 'Other',
      'peanut butter': 'Other',
      'pearl couscous': 'Staples',
      peppercorn: 'Spices & Seasonings',
    })
  })

  it('lets specific purchase identities outrank generic component words', () => {
    expectCategories({
      'garlic powder': 'Spices & Seasonings',
      'onion powder': 'Spices & Seasonings',
      'tomato paste': 'Canned / Jarred / Sauces',
      'coconut milk': 'Canned / Jarred / Sauces',
      'almond milk': 'Beverages',
      'oat milk': 'Beverages',
      'fish sauce': 'Canned / Jarred / Sauces',
      'oyster sauce': 'Canned / Jarred / Sauces',
      'chicken broth': 'Canned / Jarred / Sauces',
      'butter beans': 'Canned / Jarred / Sauces',
    })
  })

  it('covers the remaining required interim nine-category assignments', () => {
    expectCategories({
      'olive oil': 'Staples',
      'vegetable oil': 'Staples',
      'red wine vinegar': 'Staples',
      'dried rosemary': 'Spices & Seasonings',
      'poultry seasoning': 'Spices & Seasonings',
      'chicken stock': 'Canned / Jarred / Sauces',
      chickpeas: 'Canned / Jarred / Sauces',
      'soy milk': 'Beverages',
      cornstarch: 'Staples',
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
      rice: 'Staples',
      pasta: 'Staples',
      'soy sauce': 'Canned / Jarred / Sauces',
      sriracha: 'Canned / Jarred / Sauces',
      coffee: 'Beverages',
      wine: 'Beverages',
    })
  })
})
