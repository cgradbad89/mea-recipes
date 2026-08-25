import { describe, expect, it } from 'vitest'

import {
  RECIPE_CATEGORIES,
  isRecipeCategory,
  normalizeRecipeCategory,
} from '@/lib/recipeCategories'

describe('canonical recipe category contract', () => {
  it('keeps the exact approved 12-category order', () => {
    expect(RECIPE_CATEGORIES).toEqual([
      'Chicken & Poultry',
      'Beef & Pork',
      'Seafood',
      'Vegetarian Mains',
      'Pasta, Noodles & Rice',
      'Salads & Bowls',
      'Soups, Stews & Chili',
      'Breakfast',
      'Snacks',
      'Drinks',
      'Sauces & Condiments',
      'Sides',
    ])
  })

  it('contains no duplicates', () => {
    expect(new Set(RECIPE_CATEGORIES).size).toBe(RECIPE_CATEGORIES.length)
  })

  it('validates every canonical value and rejects arbitrary or legacy output', () => {
    RECIPE_CATEGORIES.forEach(category => expect(isRecipeCategory(category)).toBe(true))
    ;['Chicken', 'Breakfast, Snacks & Sides', 'Other', 'Some Random Category', 12, null]
      .forEach(value => expect(isRecipeCategory(value)).toBe(false))
  })

  it('normalizes all direct deterministic legacy aliases', () => {
    expect({
      Chicken: normalizeRecipeCategory('Chicken'),
      Beef: normalizeRecipeCategory('Beef'),
      Pork: normalizeRecipeCategory('Pork'),
      Vegetarian: normalizeRecipeCategory('Vegetarian'),
      Pasta: normalizeRecipeCategory('Pasta Noodles & Rice'),
      Soups: normalizeRecipeCategory('Soups Stews & Chili'),
      SoupStew: normalizeRecipeCategory('Soup/Stew'),
      Combined: normalizeRecipeCategory('Breakfast Snacks & Sides'),
    }).toEqual({
      Chicken: 'Chicken & Poultry',
      Beef: 'Beef & Pork',
      Pork: 'Beef & Pork',
      Vegetarian: 'Vegetarian Mains',
      Pasta: 'Pasta, Noodles & Rice',
      Soups: 'Soups, Stews & Chili',
      SoupStew: 'Soups, Stews & Chili',
      Combined: 'Sides',
    })
  })

  it('returns null for blank, null, undefined, and unknown inputs', () => {
    ;['', '   ', null, undefined, 'Some Random Category']
      .forEach(value => expect(normalizeRecipeCategory(value)).toBeNull())
  })

  it('does not globally resolve heterogeneous combined or Other values', () => {
    expect(normalizeRecipeCategory('Breakfast, Snacks & Sides')).toBeNull()
    expect(normalizeRecipeCategory('Other')).toBeNull()
    expect(normalizeRecipeCategory('Non-Recipe / Notes')).toBeNull()
  })

  it('resolves the approved combined-category recipe IDs', () => {
    const expected = {
      bread: 'Sides',
      'cauliflower-breakfast-muffins': 'Breakfast',
      'chinese-chili-oil': 'Sauces & Condiments',
      'hearthealthy-peanut-butter-protein-bars': 'Snacks',
      'peanut-butter-oat-protein-shake': 'Drinks',
      smoothies: 'Drinks',
      'yogurt-dill-sauce': 'Sauces & Condiments',
    }
    for (const [id, category] of Object.entries(expected)) {
      expect(normalizeRecipeCategory('Breakfast, Snacks & Sides', id)).toBe(category)
    }
  })

  it('applies the approved numeric Other classifications only to exact IDs', () => {
    expect(normalizeRecipeCategory('Other', '199')).toBe('Sides')
    expect(normalizeRecipeCategory('Other', '190')).toBe('Sides')
    expect(normalizeRecipeCategory('Other', '167')).toBe('Snacks')
    expect(normalizeRecipeCategory('Other', '168')).toBeNull()
  })

  it('covers the explicitly approved special classifications', () => {
    expect(normalizeRecipeCategory('Breakfast, Snacks & Sides', 'bread')).toBe('Sides')
    expect(normalizeRecipeCategory('Other', '167')).toBe('Snacks')
    expect(normalizeRecipeCategory('Vegetarian Mains', 'maple-roasted-candied-pecans')).toBe('Snacks')
    expect(normalizeRecipeCategory('Non-Recipe / Notes', 'rising-sun-mazcal')).toBe('Drinks')
  })

  it('never applies recipe-specific compatibility to the wrong raw value or ID', () => {
    expect(normalizeRecipeCategory('Other', 'bread')).toBeNull()
    expect(normalizeRecipeCategory('Vegetarian Mains', 'another-recipe')).toBe('Vegetarian Mains')
    expect(normalizeRecipeCategory('Breakfast, Snacks & Sides', 'future-recipe')).toBeNull()
  })
})
