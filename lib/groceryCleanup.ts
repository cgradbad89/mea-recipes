import { categorizeIngredient, GROCERY_CATEGORIES, type GroceryCategory } from './groceryCategories'

export interface GroceryCleanupItem {
  name: string
  quantity?: string
  unit?: string
  manualSection?: GroceryCategory
}

export interface GroceryCleanupChange {
  originalIndex: number
  name: string
  quantity: string
  unit: string
  category: GroceryCategory
  action: 'merge' | 'normalize' | 'remove'
  mergedWith: number[]
}

const IGNORED_WORDS = new Set([
  'a', 'an', 'and', 'the', 'of', 'from', 'for', 'to',
  'best', 'quality', 'such', 'as',
  'fresh', 'freshly', 'packed', 'roughly', 'finely', 'thinly', 'coarsely',
  'chopped', 'minced', 'diced', 'sliced', 'crushed', 'peeled', 'halved', 'quartered',
  'ground', 'dried', 'frozen', 'cooked', 'raw', 'whole', 'large', 'medium', 'small', 'extra',
  'clove', 'cloves', 'leaf', 'leaves',
])

// Forms that materially change what a shopper buys. For example, whole limes
// and lime juice must not be merged merely because they share "lime".
const FORM_WORDS = new Set([
  'juice', 'sauce', 'paste', 'powder', 'oil', 'vinegar', 'milk', 'cream',
  'cheese', 'broth', 'stock', 'flour', 'seed', 'seeds',
])

function itemTokens(name: string): Set<string> {
  const beforeDirections = (name || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .split(',')[0]
    .replace(/[^a-z0-9\s]/g, ' ')

  return new Set(
    beforeDirections
      .split(/\s+/)
      .map(word => word.trim())
      .filter(word => word && !/^\d+$/.test(word) && !IGNORED_WORDS.has(word)),
  )
}

/** Conservative lexical guard used before an AI suggestion may delete a peer. */
export function areLikelySameGroceryItem(a: string, b: string): boolean {
  const left = itemTokens(a)
  const right = itemTokens(b)
  if (!left.size || !right.size) return false

  const leftForms = new Set([...left].filter(word => FORM_WORDS.has(word)))
  const rightForms = new Set([...right].filter(word => FORM_WORDS.has(word)))
  if (
    leftForms.size !== rightForms.size ||
    [...leftForms].some(word => !rightForms.has(word))
  ) return false

  const smaller = left.size <= right.size ? left : right
  const larger = smaller === left ? right : left
  return [...smaller].every(word => larger.has(word))
}

export function isClearlyNonGroceryLine(name: string): boolean {
  return /^\s*(?:for\s+the\b|on\s+the\b|instructions?\b|directions?\b|notes?\s*:)/i.test(name || '')
}

function normalizedChange(
  items: GroceryCleanupItem[],
  change: GroceryCleanupChange,
): GroceryCleanupChange {
  const item = items[change.originalIndex]
  const category = GROCERY_CATEGORIES.includes(change.category)
    ? change.category
    : categorizeIngredient(change.name || item.name)

  return {
    ...change,
    name: (change.name || item.name).trim(),
    quantity: typeof change.quantity === 'string' ? change.quantity : (item.quantity || ''),
    unit: typeof change.unit === 'string' ? change.unit : (item.unit || ''),
    category,
    mergedWith: [],
  }
}

function isActualNormalization(item: GroceryCleanupItem, change: GroceryCleanupChange): boolean {
  return change.name !== item.name ||
    change.quantity !== (item.quantity || '') ||
    change.unit !== (item.unit || '') ||
    change.category !== (item.manualSection || categorizeIngredient(item.name))
}

/**
 * Treat model output as a suggestion, never as deletion authority.
 *
 * - A merge target must be a different, valid, lexically equivalent item.
 * - Reciprocal/overlapping merge rows collapse to one survivor per group.
 * - Removal is limited to obvious recipe section/instruction headers.
 * - Only actionable changes are returned; unchanged items remain untouched.
 */
export function sanitizeGroceryCleanupChanges(
  items: GroceryCleanupItem[],
  rawChanges: GroceryCleanupChange[],
): GroceryCleanupChange[] {
  const validByIndex = new Map<number, GroceryCleanupChange>()

  for (const raw of rawChanges) {
    if (!Number.isInteger(raw.originalIndex) || !items[raw.originalIndex] || validByIndex.has(raw.originalIndex)) continue
    validByIndex.set(raw.originalIndex, raw)
  }

  const edges = new Map<number, Set<number>>()
  for (const raw of validByIndex.values()) {
    if (raw.action !== 'merge') continue
    const peers = new Set(
      raw.mergedWith.filter(index =>
        Number.isInteger(index) &&
        index !== raw.originalIndex &&
        !!items[index] &&
        areLikelySameGroceryItem(items[raw.originalIndex].name, items[index].name),
      ),
    )
    if (peers.size) edges.set(raw.originalIndex, peers)
  }

  // Build undirected components so reciprocal model output can never delete
  // both supposed survivors.
  const adjacency = new Map<number, Set<number>>()
  for (const [source, peers] of edges) {
    if (!adjacency.has(source)) adjacency.set(source, new Set())
    for (const peer of peers) {
      adjacency.get(source)!.add(peer)
      if (!adjacency.has(peer)) adjacency.set(peer, new Set())
      adjacency.get(peer)!.add(source)
    }
  }

  const result: GroceryCleanupChange[] = []
  const mergedMembers = new Set<number>()
  const visited = new Set<number>()
  for (const start of adjacency.keys()) {
    if (visited.has(start)) continue
    const component: number[] = []
    const queue = [start]
    visited.add(start)
    while (queue.length) {
      const current = queue.shift()!
      component.push(current)
      for (const peer of adjacency.get(current) || []) {
        if (!visited.has(peer)) {
          visited.add(peer)
          queue.push(peer)
        }
      }
    }

    const survivor = component
      .filter(index => edges.has(index))
      .sort((a, b) => (edges.get(b)!.size - edges.get(a)!.size) || a - b)[0]
    const raw = validByIndex.get(survivor)!
    const change = normalizedChange(items, raw)
    change.action = 'merge'
    change.mergedWith = component.filter(index => index !== survivor).sort((a, b) => a - b)
    result.push(change)
    component.forEach(index => mergedMembers.add(index))
  }

  for (const [index, raw] of validByIndex) {
    if (mergedMembers.has(index)) continue
    const item = items[index]

    if (raw.action === 'remove') {
      if (isClearlyNonGroceryLine(item.name)) result.push(normalizedChange(items, raw))
      continue
    }

    const change = normalizedChange(items, raw)
    change.action = 'normalize'
    if (isActualNormalization(item, change)) result.push(change)
  }

  return result.sort((a, b) => a.originalIndex - b.originalIndex)
}
