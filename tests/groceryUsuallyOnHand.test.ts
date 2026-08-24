import { describe, expect, it } from 'vitest'
import { GROCERY_CATEGORIES } from '@/lib/groceryCategories'
import {
  USUALLY_ON_HAND_SECTION,
  buildSavedGroceryIdentityLookup,
  deriveGrocerySections,
  effectiveGroceryCategory,
  groceryIdentity,
  isUsuallyOnHand,
} from '@/lib/groceryUsuallyOnHand'
import type { SavedGroceryItem } from '@/lib/userdata'

function saved(
  name: string,
  usuallyOnHand?: boolean,
  defaultCategory: SavedGroceryItem['defaultCategory'] = 'Other',
): SavedGroceryItem {
  return {
    id: name.replaceAll(' ', '-'),
    name,
    defaultCategory,
    timesUsed: 1,
    lastUsed: null,
    usuallyOnHand,
  }
}

describe('Usually On Hand preference interpretation', () => {
  it('treats historical absence and explicit false as false, and only true as true', () => {
    const historical = saved('salt')
    const explicitFalse = saved('black pepper', false)
    const explicitTrue = saved('olive oil', true)
    const lookup = buildSavedGroceryIdentityLookup([historical, explicitFalse, explicitTrue])

    expect(isUsuallyOnHand({ name: 'salt' }, lookup)).toBe(false)
    expect(isUsuallyOnHand({ name: 'black pepper' }, lookup)).toBe(false)
    expect(isUsuallyOnHand({ name: 'olive oil' }, lookup)).toBe(true)
  })

  it('uses the exact normalizeNoun identity without fuzzy or substring matching', () => {
    const lookup = buildSavedGroceryIdentityLookup([
      saved('olive oil', true),
      saved('onion', true),
    ])

    expect(groceryIdentity('Olive oils')).toBe(groceryIdentity('olive oil'))
    expect(isUsuallyOnHand({ name: 'extra-virgin olive oil' }, lookup)).toBe(false)
    expect(isUsuallyOnHand({ name: 'red onion' }, lookup)).toBe(false)
    expect(groceryIdentity('ground chicken')).not.toBe(groceryIdentity('chicken breast'))
  })
})

describe('derived grocery sections', () => {
  it('moves preferred items to Usually On Hand while preserving their real categories', () => {
    const items = [
      { name: 'olive oil', isChecked: false },
      { name: 'black pepper', isChecked: false },
      { name: 'rice', isChecked: false },
    ]
    const sections = deriveGrocerySections(items, [
      saved('olive oil', true, 'Sauces & Condiments'),
      saved('black pepper', true, 'Spices & Seasonings'),
      saved('rice', true, 'Pantry & Dry Goods'),
    ], false)

    expect(sections.usuallyOnHand.map(item => item.name)).toEqual(['olive oil', 'black pepper', 'rice'])
    expect(effectiveGroceryCategory(items[0])).toBe('Sauces & Condiments')
    expect(effectiveGroceryCategory(items[1])).toBe('Spices & Seasonings')
    expect(effectiveGroceryCategory(items[2])).toBe('Pantry & Dry Goods')
    expect(GROCERY_CATEGORIES).not.toContain(USUALLY_ON_HAND_SECTION)
  })

  it('keeps absent/false preferences in normal shopping categories and omits an empty derived section', () => {
    const items = [
      { name: 'olive oil', isChecked: false },
      { name: 'rice', isChecked: false },
    ]
    const sections = deriveGrocerySections(items, [saved('olive oil', false)], false)

    expect(sections.usuallyOnHand).toEqual([])
    expect(sections.categories['Sauces & Condiments'].map(item => item.name)).toEqual(['olive oil'])
    expect(sections.categories['Pantry & Dry Goods'].map(item => item.name)).toEqual(['rice'])
  })

  it('preserves a manual category override through preference mark and unmark', () => {
    const oatMilk = { name: 'oat milk', manualSection: 'Dairy & Eggs' as const, isChecked: false }
    const marked = deriveGrocerySections([oatMilk], [saved('oat milk', true, 'Dairy & Eggs')], false)
    const unmarked = deriveGrocerySections([oatMilk], [saved('oat milk', false, 'Dairy & Eggs')], false)

    expect(marked.usuallyOnHand).toEqual([oatMilk])
    expect(effectiveGroceryCategory(oatMilk)).toBe('Dairy & Eggs')
    expect(unmarked.categories['Dairy & Eggs']).toEqual([oatMilk])
    expect(unmarked.categories.Beverages).toEqual([])
  })

  it('keeps checked state independent and follows the existing checked-item visibility', () => {
    const checked = { name: 'salt', isChecked: true, quantity: '1', unit: 'tsp' }

    expect(deriveGrocerySections([checked], [saved('salt', true)], false).usuallyOnHand).toEqual([])
    expect(deriveGrocerySections([checked], [saved('salt', true)], true).usuallyOnHand).toEqual([checked])
    expect(checked).toMatchObject({ isChecked: true, quantity: '1', unit: 'tsp' })
  })
})
