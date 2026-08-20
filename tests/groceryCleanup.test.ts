import { describe, expect, it } from 'vitest'
import {
  areLikelySameGroceryItem,
  sanitizeGroceryCleanupChanges,
  type GroceryCleanupChange,
} from '@/lib/groceryCleanup'

const change = (
  originalIndex: number,
  action: GroceryCleanupChange['action'],
  mergedWith: number[] = [],
  name = '',
): GroceryCleanupChange => ({
  originalIndex,
  action,
  mergedWith,
  name,
  quantity: '',
  unit: '',
  category: 'Produce',
})

describe('grocery cleanup safety', () => {
  it('recognizes preparation variants but not merely related ingredients', () => {
    expect(areLikelySameGroceryItem('fresh lime juice, from one lime', 'lime juice, from 2 limes')).toBe(true)
    expect(areLikelySameGroceryItem('large garlic cloves, roughly chopped', 'garlic, roughly chopped')).toBe(true)
    expect(areLikelySameGroceryItem('packed fresh cilantro leaves', 'lime juice')).toBe(false)
    expect(areLikelySameGroceryItem('whole limes', 'lime juice')).toBe(false)
  })

  it('strips a self index and keeps one survivor for a merge', () => {
    const items = [
      { name: 'fresh lime juice, from one lime', quantity: '1', unit: 'tablespoon' },
      { name: 'lime juice, from 2 limes', quantity: '1/4', unit: 'cup' },
    ]
    const result = sanitizeGroceryCleanupChanges(items, [
      { ...change(0, 'merge', [0, 1], 'lime juice'), quantity: '1/4 cup + 1 tablespoon' },
    ])

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ originalIndex: 0, action: 'merge', mergedWith: [1] })
  })

  it('collapses reciprocal merge suggestions instead of deleting both items', () => {
    const items = [
      { name: '4 large garlic cloves, roughly chopped' },
      { name: '2 cloves garlic, roughly chopped' },
    ]
    const result = sanitizeGroceryCleanupChanges(items, [
      change(0, 'merge', [1], 'garlic'),
      change(1, 'merge', [0], 'garlic'),
    ])

    expect(result).toHaveLength(1)
    expect(result[0].mergedWith).toHaveLength(1)
    expect(result[0].mergedWith).not.toContain(result[0].originalIndex)
  })

  it('rejects unrelated merge targets and removal of real grocery items', () => {
    const items = [
      { name: 'packed fresh cilantro leaves' },
      { name: 'lime juice, from 2 limes' },
      { name: 'FOR THE CHICKEN' },
    ]
    const result = sanitizeGroceryCleanupChanges(items, [
      change(0, 'merge', [1], 'cilantro'),
      change(1, 'remove', [], 'lime juice'),
      change(2, 'remove', [], 'FOR THE CHICKEN'),
    ])

    expect(result).toEqual([
      expect.objectContaining({ originalIndex: 0, action: 'normalize', name: 'cilantro' }),
      expect.objectContaining({ originalIndex: 2, action: 'remove' }),
    ])
  })
})
