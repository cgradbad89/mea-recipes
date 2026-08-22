import {
  categorizeIngredient,
  isGroceryCategory,
  normalizePersistedGroceryCategory,
  type GroceryCategory,
} from './groceryCategories'
import { normalizeNoun } from './ingredientParser'

export interface GroceryCleanupItem {
  name: string
  quantity?: string
  unit?: string
  manualSection?: string
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

const IGNORED_PREP_WORDS = new Set([
  'a', 'an', 'and', 'the', 'of', 'from', 'for', 'to',
  'best', 'quality', 'such', 'as',
  'freshly', 'packed', 'roughly', 'finely', 'thinly', 'coarsely',
  'chopped', 'minced', 'diced', 'sliced', 'crushed', 'peeled', 'halved', 'quartered',
  'grated', 'shredded', 'trimmed',
])

// Terms that materially change what a shopper buys. These sets must match on
// both sides before any narrow unit-token allowance is considered.
const PURCHASE_SENSITIVE_WORDS = new Set([
  'fresh', 'dried', 'frozen', 'cooked', 'raw', 'ground', 'whole',
  'lean', 'skinless', 'boneless',
  'tenderloin', 'sirloin', 'chuck', 'brisket', 'ribeye', 'rump', 'shoulder',
  'thigh', 'breast', 'wing', 'drumstick', 'loin', 'chop', 'roast', 'steak',
  'juice', 'sauce', 'paste', 'powder', 'oil', 'vinegar', 'milk', 'cream',
  'cheese', 'broth', 'stock', 'flour', 'seed',
])

// The only non-exact allowance: a count/container token may be present on one
// side of an otherwise identical item ("garlic" vs "garlic clove").
const OPTIONAL_UNIT_WORDS = new Set([
  'bag', 'bottle', 'box', 'bunch', 'can', 'clove', 'ear', 'head', 'jar',
  'leaf', 'loaf', 'package', 'piece', 'slice', 'sprig', 'stalk', 'stick',
])

interface GroceryIdentity {
  tokens: Set<string>
  sensitive: Set<string>
}

function itemIdentity(name: string): GroceryIdentity {
  const beforeDirections = (name || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .split(',')[0]
    .replace(/(\d+)\s*%/g, '$1percent')
    .replace(/[^a-z0-9\s]/g, ' ')

  const tokens = new Set(
    normalizeNoun(beforeDirections)
      .split(/\s+/)
      .map(word => word.trim())
      .filter(word => word && !/^\d+$/.test(word) && !IGNORED_PREP_WORDS.has(word)),
  )
  const sensitive = new Set(
    [...tokens].filter(word => PURCHASE_SENSITIVE_WORDS.has(word) || /^\d+percent$/.test(word)),
  )
  return { tokens, sensitive }
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every(word => right.has(word))
}

/** Conservative lexical guard used before an AI suggestion may delete a peer. */
export function areLikelySameGroceryItem(a: string, b: string): boolean {
  const left = itemIdentity(a)
  const right = itemIdentity(b)
  if (!left.tokens.size || !right.tokens.size) return false

  if (!setsEqual(left.sensitive, right.sensitive)) return false
  if (setsEqual(left.tokens, right.tokens)) return true

  const differing = new Set([
    ...[...left.tokens].filter(word => !right.tokens.has(word)),
    ...[...right.tokens].filter(word => !left.tokens.has(word)),
  ])
  if (![...differing].every(word => OPTIONAL_UNIT_WORDS.has(word))) return false

  const sharedCore = [...left.tokens].some(word =>
    right.tokens.has(word) && !OPTIONAL_UNIT_WORDS.has(word),
  )
  return sharedCore
}

export function isClearlyNonGroceryLine(name: string): boolean {
  return /^\s*(?:for\s+the\b|on\s+the\b|instructions?\b|directions?\b|notes?\s*:)/i.test(name || '')
}

function normalizedChange(
  items: GroceryCleanupItem[],
  change: GroceryCleanupChange,
): GroceryCleanupChange {
  const item = items[change.originalIndex]
  const category = isGroceryCategory(change.category)
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
    change.category !== (item.manualSection
      ? normalizePersistedGroceryCategory(item.manualSection, item.name)
      : categorizeIngredient(item.name))
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
