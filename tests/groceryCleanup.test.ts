import { describe, expect, it, vi } from 'vitest'
import {
  areLikelySameGroceryItem,
  sanitizeGroceryCleanupChanges,
  validateGroceryCleanupResponse,
  requestGroceryCleanup,
  buildGroceryCleanupGroups,
  type GroceryCleanupChange,
} from '@/lib/groceryCleanup'
import { GROCERY_CATEGORIES, type GroceryCategory } from '@/lib/groceryCategories'
import type { GroceryItem } from '@/lib/userdata'

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
    expect(areLikelySameGroceryItem('fresh lime juice, from one lime', 'fresh lime juice, from 2 limes')).toBe(true)
    expect(areLikelySameGroceryItem('fresh lime juice', 'lime juice')).toBe(false)
    expect(areLikelySameGroceryItem('large garlic cloves, roughly chopped', 'large garlic, roughly chopped')).toBe(true)
    expect(areLikelySameGroceryItem('packed fresh cilantro leaves', 'lime juice')).toBe(false)
    expect(areLikelySameGroceryItem('whole limes', 'lime juice')).toBe(false)
  })

  it('strips a self index and keeps one survivor for a merge', () => {
    const items = [
      { name: 'fresh lime juice, from one lime', quantity: '1', unit: 'tablespoon' },
      { name: 'fresh lime juice, from 2 limes', quantity: '1/4', unit: 'cup' },
    ]
    const result = sanitizeGroceryCleanupChanges(items, [
      { ...change(0, 'merge', [0, 1], 'lime juice'), quantity: '1/4 cup + 1 tablespoon' },
    ])

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ originalIndex: 0, action: 'merge', mergedWith: [1] })
  })

  it('enforces purchase identity across adversarial singular/plural and form cases', () => {
    expect(areLikelySameGroceryItem('ground beef', 'beef tenderloin')).toBe(false)
    expect(areLikelySameGroceryItem('fresh parsley', 'dried parsley')).toBe(false)
    expect(areLikelySameGroceryItem('whole tomatoes', 'tomato sauce')).toBe(false)
    expect(areLikelySameGroceryItem('tomato', 'tomatoes')).toBe(true)
    expect(areLikelySameGroceryItem('garlic clove', 'garlic cloves')).toBe(true)
    expect(areLikelySameGroceryItem('ground beef 80/20', 'ground beef 93/7')).toBe(false)
    expect(areLikelySameGroceryItem('ground beef (80/20)', 'ground beef (93/7)')).toBe(false)
  })

  it('collapses reciprocal merge suggestions instead of deleting both items', () => {
    const items = [
      { name: '4 large garlic cloves, roughly chopped' },
      { name: '2 large cloves garlic, roughly chopped' },
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
      expect.objectContaining({ originalIndex: 2, action: 'remove' }),
    ])
    expect(items[0].name).toBe('packed fresh cilantro leaves')
  })

  it('accepts every current category from the central contract', () => {
    const items = GROCERY_CATEGORIES.map((_, index) => ({ name: `Original ${index}` }))
    const changes = GROCERY_CATEGORIES.map((category, index) => ({
      ...change(index, 'normalize', [], `Normalized ${index}`),
      category,
    }))

    expect(sanitizeGroceryCleanupChanges(items, changes).map(item => item.category))
      .toEqual(GROCERY_CATEGORIES)
  })

  it('rejects legacy and arbitrary AI categories in favor of deterministic classification', () => {
    const items = [
      { name: 'olive oil' },
      { name: 'tomato paste' },
      { name: 'rice' },
    ]
    const result = sanitizeGroceryCleanupChanges(items, [
      { ...change(0, 'normalize', [], 'olive oil normalized'), category: 'Staples' as GroceryCategory },
      { ...change(1, 'normalize', [], 'tomato paste normalized'), category: 'Canned / Jarred / Sauces' as GroceryCategory },
      { ...change(2, 'normalize', [], 'rice normalized'), category: 'Not a category' as GroceryCategory },
    ])

    expect(result.map(item => item.category)).toEqual([
      'Sauces & Condiments',
      'Canned & Jarred',
      'Pantry & Dry Goods',
    ])
  })
})

const grocery = (index: number, overrides: Partial<GroceryItem> = {}): GroceryItem => ({
  id: `doc-${index}`, name: `ingredient${index}`, quantity: '1', unit: '',
  isChecked: false, isManual: false, sourceRecipeIDs: [`recipe-${index}`], ...overrides,
})

describe('bounded grocery cleanup plans', () => {
  it.each([0, 99, 100, 101, 150, 250])('processes %s unchecked items in bounded requests', async count => {
    const items = Array.from({ length: count }, (_, index) => grocery(index))
    const request = vi.fn(async () => [])
    const plan = await requestGroceryCleanup(items, request)
    expect(request).toHaveBeenCalledTimes(Math.ceil(count / 100))
    expect(request.mock.calls.every(call => (call as unknown as [unknown[]])[0].length <= 100)).toBe(true)
    expect(plan.items.map(item => item.id)).toEqual(items.map(item => item.id))
    expect(plan.changes).toEqual([])
  })

  it('excludes all 33 checked rows from the 103-item reproduction and captures independent sources', async () => {
    const items = Array.from({ length: 103 }, (_, index) => grocery(index, { isChecked: index % 3 === 0 && index < 99 }))
    const before = JSON.parse(JSON.stringify(items))
    const request = vi.fn(async () => [])
    const plan = await requestGroceryCleanup(items, request)
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0]).toEqual([items.filter(item => !item.isChecked).map(item => ({
      name: item.name, quantity: item.quantity, unit: item.unit, isManual: false,
    }))])
    expect(plan.items).toHaveLength(70)
    expect(items).toEqual(before)
    items[1].sourceRecipeIDs.push('later-source')
    expect(plan.items[0].sourceRecipeIDs).toEqual(['recipe-1'])
  })

  it('makes no request for an entirely checked list', async () => {
    const items = [grocery(0, { isChecked: true }), grocery(1, { isChecked: true })]
    const request = vi.fn(async () => [])
    await expect(requestGroceryCleanup(items, request)).resolves.toEqual({ items: [], changes: [] })
    expect(request).not.toHaveBeenCalled()
  })

  it('reconciles duplicates within and across three batches using original quantities and sources', async () => {
    const items = Array.from({ length: 250 }, (_, index) => grocery(index))
    for (const index of [0, 1, 100, 200]) items[index] = grocery(index, { name: index === 100 ? 'Milk' : 'milk', quantity: index === 0 ? '2' : '1', unit: 'cup' })
    const plan = await requestGroceryCleanup(items, async () => [])
    expect(plan.changes).toEqual([expect.objectContaining({
      originalIndex: 0, mergedWith: [1, 100, 200], quantity: '5', unit: 'cup', action: 'merge',
    })])
    const [group] = buildGroceryCleanupGroups(plan)
    expect(group.items.map(item => item.id)).toEqual(['doc-0', 'doc-1', 'doc-100', 'doc-200'])
    expect(group.items.flatMap(item => item.sourceRecipeIDs)).toEqual(['recipe-0', 'recipe-1', 'recipe-100', 'recipe-200'])
  })

  it('keeps unsafe purchase identities, manual sources, categories, and extra metadata separate', async () => {
    const names = ['red onion', 'yellow onion', 'chicken breast', 'chicken thighs', 'fresh basil', 'dried basil', 'ground beef 80/20', 'ground beef 93/7']
    const items = names.map((name, index) => grocery(index, { name }))
    items.push(grocery(8, { name: 'milk', isManual: true }), grocery(9, { name: 'milk' }))
    items.push(grocery(10, { name: 'oil', manualSection: 'Other' }), grocery(11, { name: 'oil', manualSection: 'Sauces & Condiments' }))
    items.push({ ...grocery(12, { name: 'rice' }), customNote: 'brand A' } as GroceryItem)
    items.push({ ...grocery(13, { name: 'rice' }), customNote: 'brand B' } as GroceryItem)
    for (const name of ['milk (oat)', 'milk (dairy)', 'flour (gluten-free)', 'flour (all-purpose)', 'ground beef (80% lean)', 'ground beef (93% lean)', 'onion, red', 'onion, yellow']) {
      items.push(grocery(items.length, { name }))
    }
    const circular: Record<string, unknown> = {}
    circular.reference = circular
    items.push({ ...grocery(22, { name: 'bread' }), reference: circular } as GroceryItem)
    items.push({ ...grocery(23, { name: 'bread' }), reference: circular } as GroceryItem)
    items.push({ ...grocery(24, { name: 'salt' }), customValue: NaN } as GroceryItem)
    items.push({ ...grocery(25, { name: 'salt' }), customValue: null } as GroceryItem)
    expect((await requestGroceryCleanup(items, async () => [])).changes).toEqual([])
    const protectedNames = ['fresh basil', 'dried basil', 'chicken breast', 'chicken thighs', 'ground beef 80/20', 'ground beef 93/7']
    const normalization = await requestGroceryCleanup(protectedNames.map((name, index) => grocery(index, { name })), async () => protectedNames.map((_, index) => ({
      ...change(index, 'normalize', [], index < 2 ? 'basil' : index < 4 ? 'chicken' : 'ground beef'),
    })))
    expect(normalization.changes.every(row => row.name === protectedNames[row.originalIndex])).toBe(true)
  })

  it('remaps batch-local proposals through checked filtering to stable original IDs', async () => {
    const items = [grocery(999, { isChecked: true }), ...Array.from({ length: 101 }, (_, index) => grocery(index))]
    let calls = 0
    const plan = await requestGroceryCleanup(items, async () => ++calls === 2
      ? [change(0, 'normalize', [], 'Ingredient100')]
      : [])
    items.reverse()
    expect(plan.changes).toEqual([expect.objectContaining({ originalIndex: 100, name: 'Ingredient100' })])
    expect(buildGroceryCleanupGroups(plan)[0].items[0].id).toBe('doc-100')
    expect(buildGroceryCleanupGroups(plan).flatMap(group => group.items).some(item => item.id === 'doc-999')).toBe(false)
  })

  it('rejects malformed responses and invalid references before producing a plan', async () => {
    const items = [grocery(0), grocery(1)]
    const invalid = [null, {}, [null], [change(2, 'normalize')], [change(0, 'normalize'), change(0, 'normalize')],
      [change(0, 'merge', [2])], [change(0, 'merge', [0])], [change(0, 'merge', [1, 1])],
      [change(0, 'normalize', [1])], [{ ...change(0, 'normalize'), quantity: 3 }]]
    for (const response of invalid) {
      expect(() => validateGroceryCleanupResponse(items, response)).toThrow('Cleanup could not be completed safely.')
      await expect(requestGroceryCleanup(items, async () => response)).rejects.toThrow('Cleanup could not be completed safely.')
    }
  })

  it('rejects the entire plan when a later batch fails or is invalid', async () => {
    const items = Array.from({ length: 101 }, (_, index) => grocery(index))
    for (const failure of ['request', 'response']) {
      let calls = 0
      await expect(requestGroceryCleanup(items, async () => {
        if (++calls === 1) return [change(0, 'normalize', [], 'Ingredient0')]
        if (failure === 'request') throw new Error('Service unavailable')
        return [change(99, 'remove')]
      })).rejects.toThrow(failure === 'request' ? 'Service unavailable' : 'Cleanup could not be completed safely.')
      expect(items[0].name).toBe('ingredient0')
    }
  })

  it('never trusts model measurements and preserves incompatible units verbatim', async () => {
    const items = [grocery(0, { name: 'milk', quantity: '2', unit: 'cups' }), grocery(1, { name: 'milk', quantity: '200', unit: 'g' })]
    const plan = await requestGroceryCleanup(items, async () => [{
      ...change(0, 'merge', [1], 'milk'), quantity: '999', unit: 'cans', category: 'Dairy & Eggs',
    }])
    expect(plan.changes[0]).toMatchObject({ quantity: '2 cups + 200 g', unit: '' })
    expect(validateGroceryCleanupResponse([items[0]], [{
      ...change(0, 'normalize', [], 'Milk'), quantity: '999', unit: 'cans',
    }])[0]).toMatchObject({ quantity: '2', unit: 'cups' })
  })

  it('extracts legacy embedded measurements safely and keeps uncertain amounts unchanged', async () => {
    const legacy = grocery(0, { name: '2 cups milk', quantity: '', unit: '' })
    const normal = await requestGroceryCleanup([legacy], async () => [{
      ...change(0, 'normalize', [], 'milk'), quantity: '999', unit: 'cans', category: 'Dairy & Eggs',
    }])
    expect(normal.changes[0]).toMatchObject({ name: 'milk', quantity: '2', unit: 'cups' })
    const merged = await requestGroceryCleanup([legacy, grocery(1, { name: '1 cup milk', quantity: '', unit: '' })], async () => [])
    expect(merged.changes[0]).toMatchObject({ name: 'milk', quantity: '3', unit: 'cups' })
    expect(buildGroceryCleanupGroups(merged)[0].items.map(item => item.name)).toEqual(['2 cups milk', '1 cup milk'])
    const explicit = await requestGroceryCleanup([{ ...legacy, quantity: '7', unit: 'tbsp' }], async () => [change(0, 'normalize', [], 'milk')])
    expect(explicit.changes[0]).toMatchObject({ quantity: '7', unit: 'tbsp' })
    const uncertain = grocery(2, { name: '6 4 ears corn', quantity: '', unit: '' })
    const preserved = await requestGroceryCleanup([uncertain], async () => [change(0, 'normalize', [], 'corn')])
    expect(preserved.changes.every(row => row.name === uncertain.name && row.quantity === '')).toBe(true)
    const absent = grocery(3)
    delete (absent as Partial<GroceryItem>).sourceRecipeIDs
    const captured = await requestGroceryCleanup([absent], async () => [])
    expect(captured.items[0].sourceRecipeIDs).toBeUndefined()
    expect(Object.hasOwn(captured.items[0], 'sourceRecipeIDs')).toBe(false)
  })

  it('splits long compound measurements so the saved list can be cleaned again', async () => {
    const items = Array.from({ length: 3 }, (_, index) => grocery(index, {
      name: 'milk', quantity: `a generous ${'large '.repeat(3)}handful`, unit: '',
    }))
    const sanitized = validateGroceryCleanupResponse(items, [change(0, 'merge', [1, 2], 'milk')])
    expect(sanitized[0].quantity.length).toBeGreaterThan(100)
    const plan = await requestGroceryCleanup(items, async () => sanitized)
    const groups = buildGroceryCleanupGroups(plan)
    expect(groups.some(group => group.items.length > 1)).toBe(true)
    expect(groups.every(group => group.change.quantity.length <= 100)).toBe(true)
    const removed = new Set(groups.flatMap(group => group.items.slice(1).map(item => item.id)))
    const saved = items.filter(item => !removed.has(item.id)).map(item => {
      const group = groups.find(candidate => candidate.items[0].id === item.id)
      return group ? { ...item, quantity: group.change.quantity, unit: group.change.unit } : item
    })
    await expect(requestGroceryCleanup(saved, async batch => {
      expect(batch.every(item => (item.quantity || '').length <= 100)).toBe(true)
      return []
    })).resolves.toMatchObject({ changes: [] })
    expect(saved.flatMap(item => item.quantity.split(' + '))).toEqual(items.map(item => item.quantity))
  })

  it('keeps merge groups indivisible at 450 writes without dropping excess duplicates', async () => {
    const items = Array.from({ length: 451 }, (_, index) => grocery(index, { name: 'tomato' }))
    const plan = await requestGroceryCleanup(items, async () => [])
    const groups = buildGroceryCleanupGroups(plan)
    expect(groups).toHaveLength(1)
    expect(groups[0].items).toHaveLength(450)
    expect(groups[0].change.quantity).toBe('450')
    expect(groups[0].items.some(item => item.id === 'doc-450')).toBe(false)
    expect(plan.items[450]).toEqual(items[450])
  })

  it('rejects a displayed merge as one unit and rejects overlapping or checked mutation plans', async () => {
    const items = [grocery(0, { name: 'tomato' }), grocery(1, { name: 'tomatoes' })]
    const plan = await requestGroceryCleanup(items, async () => [])
    expect(buildGroceryCleanupGroups(plan, new Set([0]))).toEqual([])
    expect(() => buildGroceryCleanupGroups({ ...plan, changes: [...plan.changes, {
      ...change(1, 'normalize', [], 'Tomatoes'), quantity: '1',
    }] })).toThrow('Cleanup could not be completed safely.')
    expect(() => buildGroceryCleanupGroups({ ...plan, items: [items[0], { ...items[1], isChecked: true }] })).toThrow('Cleanup could not be completed safely.')
  })
})
