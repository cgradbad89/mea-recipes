import { describe, expect, it } from 'vitest'

import { RECIPE_CATEGORIES } from '@/lib/recipeCategories'
import {
  deriveRoleFromCategory,
  normalizePlannedEntry,
  resolveRecipeRole,
} from '@/lib/userdata'

describe('canonical recipe category role semantics', () => {
  it('derives every canonical category using the approved defaults', () => {
    for (const category of RECIPE_CATEGORIES) {
      const expected = category === 'Sides' || category === 'Sauces & Condiments'
        ? 'side'
        : 'main'
      expect(deriveRoleFromCategory(category)).toBe(expected)
    }
  })

  it('keeps Breakfast, Snacks, and Drinks as mains', () => {
    expect(deriveRoleFromCategory('Breakfast')).toBe('main')
    expect(deriveRoleFromCategory('Snacks')).toBe('main')
    expect(deriveRoleFromCategory('Drinks')).toBe('main')
  })

  it('normalizes direct and recipe-specific legacy categories before deriving', () => {
    expect(deriveRoleFromCategory('Chicken')).toBe('main')
    expect(deriveRoleFromCategory('Soup/Stew')).toBe('main')
    expect(deriveRoleFromCategory('Breakfast Snacks & Sides')).toBe('side')
    expect(deriveRoleFromCategory('Breakfast, Snacks & Sides', 'yogurt-dill-sauce')).toBe('side')
    expect(deriveRoleFromCategory('Breakfast, Snacks & Sides', 'huevos-rotos-broken-eggs')).toBe('main')
    expect(deriveRoleFromCategory('Some Random Category')).toBe('main')
  })

  it('preserves recipe defaultRole precedence over category derivation', () => {
    expect(resolveRecipeRole({ category: 'Sides', defaultRole: 'main' })).toBe('main')
    expect(resolveRecipeRole({ category: 'Breakfast', defaultRole: 'side' })).toBe('side')
    expect(resolveRecipeRole({ category: 'Sides' })).toBe('side')
  })

  it('keeps stored planned-entry roles while deriving only missing legacy roles', () => {
    expect(normalizePlannedEntry(
      { recipeID: 'stored-side', day: null, role: 'side' },
      () => 'Breakfast',
    ).role).toBe('side')
    expect(normalizePlannedEntry('yogurt-dill-sauce', () => 'Breakfast, Snacks & Sides').role)
      .toBe('side')
  })
})
