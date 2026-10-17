import {
  categorizeIngredient,
  isGroceryCategory,
  normalizePersistedGroceryCategory,
  type GroceryCategory,
} from './groceryCategories'
import { mergeQuantities, normalizeNoun, parseIngredient } from './ingredientParser'
import { FIRESTORE_SAFE_BATCH_SIZE } from './chunkItems'
import type { GroceryItem } from './userdata'

export const MAX_GROCERY_CLEANUP_ITEMS = 100
export const MAX_GROCERY_CLEANUP_QUANTITY_LENGTH = 100
const INVALID_CLEANUP_MESSAGE = 'Cleanup could not be completed safely. Please try again.'

export interface GroceryCleanupItem {
  name: string
  quantity?: string
  unit?: string
  manualSection?: string
  isManual?: boolean
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

/** Indices belong only to this captured unchecked list, never the live UI list. */
export interface GroceryCleanupPlan {
  items: GroceryItem[]
  changes: GroceryCleanupChange[]
}

/** One indivisible mutation: update the first item and delete its merge peers. */
export interface GroceryCleanupGroup {
  items: GroceryItem[]
  change: GroceryCleanupChange
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
  // Ratios such as 80/20 are purchase qualifiers, even inside parentheses.
  const ratios = (name || '').match(/\b\d{2,3}\s*\/\s*\d{1,3}\b/g) || []
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
  ratios.forEach(ratio => sensitive.add(`ratio:${ratio.replace(/\s/g, '')}`))
  return { tokens, sensitive }
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every(word => right.has(word))
}

/** Conservative lexical guard used before an AI suggestion may delete a peer. */
export function areLikelySameGroceryItem(a: string, b: string): boolean {
  return sameIdentity(itemIdentity(a), itemIdentity(b))
}

function sameIdentity(left: GroceryIdentity, right: GroceryIdentity): boolean {
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

function annotations(name: string): string {
  const parts = [
    ...[...name.matchAll(/\(([^)]*)\)/g)].map(match => match[1]),
    ...name.split(',').slice(1),
  ]
  return JSON.stringify(parts.map(part => normalizeNoun(part).trim()).filter(part =>
    part && !part.split(/\s+/).every(word => IGNORED_PREP_WORDS.has(word))))
}

function cleanupSource(item: GroceryCleanupItem) {
  const parsed = parseIngredient(item.name)
  const safe = parsed.confidence === 'high' &&
    !(!parsed.quantity && /^\s*[-*•·]?\s*[\d¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/.test(item.name))
  return {
    safe,
    name: safe && parsed.quantity ? parsed.name : item.name,
    quantity: item.quantity || (safe ? parsed.quantity : '') || '',
    unit: item.unit || (safe ? parsed.unit : '') || '',
  }
}

function cleanupName(item: GroceryCleanupItem, proposed?: string): string {
  const source = cleanupSource(item)
  if (!source.safe) return item.name
  const candidate = (proposed || source.name).trim()
  if (annotations(candidate) !== annotations(item.name)) return source.name
  const parsed = parseIngredient(candidate)
  // Proposed measurements have no authority; use only its noun after a safe split.
  if (parsed.confidence !== 'high') return source.name
  const name = parsed.quantity ? parsed.name : candidate
  if (!setsEqual(itemIdentity(source.name).sensitive, itemIdentity(name).sensitive)) return source.name
  return name
}

function normalizedChange(
  items: GroceryCleanupItem[],
  change: GroceryCleanupChange,
): GroceryCleanupChange {
  const item = items[change.originalIndex]
  const source = cleanupSource(item)
  const category = isGroceryCategory(change.category)
    ? change.category
    : categorizeIngredient(change.name || item.name)

  return {
    ...change,
    name: cleanupName(item, change.name),
    // A model may clean presentation, but cannot invent or discard measurements.
    quantity: source.quantity,
    unit: source.unit,
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
        items[raw.originalIndex].isManual === items[index].isManual &&
        cleanupSource(items[raw.originalIndex]).safe && cleanupSource(items[index]).safe &&
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

    const safeGroups: number[][] = []
    for (const index of component.sort((a, b) => a - b)) {
      const group = safeGroups.find(members => members.every(peer =>
        items[index].isManual === items[peer].isManual &&
        areLikelySameGroceryItem(items[index].name, items[peer].name)))
      if (group) group.push(index)
      else safeGroups.push([index])
    }
    for (const members of safeGroups) {
      if (members.length < 2) continue
      const survivor = members
        .filter(index => edges.has(index))
        .sort((a, b) => (edges.get(b)!.size - edges.get(a)!.size) || a - b)[0] ?? members[0]
      const raw = validByIndex.get(survivor) || {
        originalIndex: survivor, name: items[survivor].name,
        quantity: items[survivor].quantity || '', unit: items[survivor].unit || '',
        category: categorizeIngredient(items[survivor].name), action: 'merge', mergedWith: [],
      }
      const change = normalizedChange(items, raw)
      change.action = 'merge'
      change.mergedWith = members.filter(index => index !== survivor).sort((a, b) => a - b)
      const source = cleanupSource(items[survivor])
      Object.assign(change, change.mergedWith.reduce((quantity, index) =>
        mergeQuantities(quantity, cleanupSource(items[index])), { quantity: source.quantity, unit: source.unit }))
      result.push(change)
      members.forEach(index => mergedMembers.add(index))
    }
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

function invalidCleanup(): never {
  throw new Error(INVALID_CLEANUP_MESSAGE)
}

function checkedChanges(items: GroceryCleanupItem[], raw: unknown): GroceryCleanupChange[] {
  if (!Array.isArray(raw) || raw.length > items.length) return invalidCleanup()
  const seen = new Set<number>()
  return raw.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return invalidCleanup()
    const row = value as Record<string, unknown>
    const index = row.originalIndex
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= items.length || seen.has(index)) return invalidCleanup()
    seen.add(index)
    if (typeof row.name !== 'string' || row.name.length > 500 ||
      // Deterministic incompatible-unit merges can exceed the model's 100-char
      // quantity bound; their complete measurements must survive validation.
      typeof row.quantity !== 'string' ||
      typeof row.unit !== 'string' || row.unit.length > 100 ||
      typeof row.category !== 'string' || row.category.length > 100 ||
      !['merge', 'normalize', 'remove'].includes(String(row.action)) ||
      !Array.isArray(row.mergedWith) || row.mergedWith.length > items.length) return invalidCleanup()
    const peers = new Set<number>()
    for (const peer of row.mergedWith) {
      if (typeof peer !== 'number' || !Number.isInteger(peer) || peer < 0 || peer >= items.length || peer === index || peers.has(peer)) return invalidCleanup()
      peers.add(peer)
    }
    if (row.action !== 'merge' && peers.size > 0) return invalidCleanup()
    return { ...row, mergedWith: [...peers] } as unknown as GroceryCleanupChange
  })
}

/** Validate the complete response before permitting any cleanup proposal. Throws a safe error. */
export function validateGroceryCleanupResponse(
  items: GroceryCleanupItem[],
  raw: unknown,
): GroceryCleanupChange[] {
  return sanitizeGroceryCleanupChanges(items, checkedChanges(items, raw))
}

const MERGE_METADATA_FIELDS = new Set([
  'id', 'name', 'quantity', 'unit', 'sourceRecipeIDs', 'createdAt', 'updatedAt',
  'isChecked', 'isManual', 'manualSection', 'needThisTrip',
])

function metadataSignature(item: GroceryItem): string | null {
  // Unknown metadata has no defined merge rule. Preserve separate documents
  // whenever it differs rather than silently dropping a peer's information.
  try {
    const entries = Object.entries(item)
      .filter(([key]) => !MERGE_METADATA_FIELDS.has(key))
      .sort(([a], [b]) => a.localeCompare(b))
    const seen = new Set<object>()
    const representable = (value: unknown): boolean => {
      if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
      if (typeof value === 'number') return Number.isFinite(value)
      if (typeof value !== 'object' || seen.has(value)) return false
      seen.add(value)
      if (Array.isArray(value)) return value.every(representable)
      const prototype = Object.getPrototypeOf(value)
      return (prototype === Object.prototype || prototype === null) && Object.values(value).every(representable)
    }
    if (!entries.every(([, value]) => representable(value))) return null
    return JSON.stringify(Object.fromEntries(entries))
  } catch {
    // SDK reference values or other non-serializable metadata have no safe
    // generic merge rule, even when the apparent references match.
    return null
  }
}

interface CleanupFacts {
  identity: GroceryIdentity
  source: ReturnType<typeof cleanupSource>
  annotations: string
  category: GroceryCategory
  metadata: string | null
}

function cleanupFacts(items: readonly GroceryItem[]): Map<GroceryItem, CleanupFacts> {
  // The cache belongs to one captured request or application check. Nothing is
  // retained across calls, so later item edits cannot reuse stale facts.
  return new Map(items.map(item => [item, {
    identity: itemIdentity(item.name),
    source: cleanupSource(item),
    annotations: annotations(item.name),
    category: normalizePersistedGroceryCategory(item.manualSection, item.name),
    metadata: metadataSignature(item),
  }]))
}

function compatibleItems(
  left: GroceryItem,
  right: GroceryItem,
  facts: ReadonlyMap<GroceryItem, CleanupFacts>,
): boolean {
  const leftFacts = facts.get(left)!
  const rightFacts = facts.get(right)!
  return left.isManual === right.isManual &&
    leftFacts.source.safe && rightFacts.source.safe &&
    sameIdentity(leftFacts.identity, rightFacts.identity) &&
    leftFacts.annotations === rightFacts.annotations &&
    leftFacts.category === rightFacts.category &&
    leftFacts.metadata !== null && rightFacts.metadata !== null && leftFacts.metadata === rightFacts.metadata
}

function identityBucket(item: GroceryItem, identity: GroceryIdentity): string {
  return JSON.stringify([
    item.isManual,
    [...identity.tokens].filter(token => !OPTIONAL_UNIT_WORDS.has(token)).sort(),
    [...identity.sensitive].sort(),
  ])
}

function mergedChange(
  items: GroceryItem[],
  indices: number[],
  facts: ReadonlyMap<GroceryItem, CleanupFacts>,
  proposal?: GroceryCleanupChange,
): GroceryCleanupChange {
  const survivor = indices[0]
  const original = items[survivor]
  const source = facts.get(original)!.source
  const quantity = indices.slice(1).reduce((combined, index) =>
    mergeQuantities(combined, facts.get(items[index])!.source), { quantity: source.quantity, unit: source.unit })
  return {
    originalIndex: survivor,
    name: cleanupName(original, proposal?.name),
    quantity: quantity.quantity,
    unit: quantity.unit,
    category: proposal?.category || facts.get(original)!.category,
    action: 'merge',
    mergedWith: indices.slice(1),
  }
}

function validateSnapshot(items: GroceryItem[]): void {
  const ids = new Set<string>()
  for (const item of items) {
    if (!item || item.isChecked !== false || typeof item.id !== 'string' || !item.id || item.id.includes('/') ||
      ids.has(item.id) || typeof item.name !== 'string' || typeof item.quantity !== 'string' ||
      typeof item.unit !== 'string' || typeof item.isManual !== 'boolean' ||
      (item.sourceRecipeIDs !== undefined && (!Array.isArray(item.sourceRecipeIDs) ||
        item.sourceRecipeIDs.some(source => typeof source !== 'string')))) invalidCleanup()
    ids.add(item.id)
  }
}

/**
 * Review one captured unchecked list using sequential requests of at most 100
 * items. No mutations occur here. A failed request or malformed response rejects
 * the entire operation. Original identities reconcile all batches locally.
 */
export async function requestGroceryCleanup(
  items: readonly GroceryItem[],
  requestBatch: (items: GroceryCleanupItem[]) => Promise<unknown>,
): Promise<GroceryCleanupPlan> {
  const snapshot = items.filter(item => item.isChecked === false)
    .map(item => ({ ...item, ...(Array.isArray(item.sourceRecipeIDs)
      ? { sourceRecipeIDs: [...item.sourceRecipeIDs] } : {}) }))
  validateSnapshot(snapshot)
  const proposals = new Map<number, GroceryCleanupChange>()
  for (let offset = 0; offset < snapshot.length; offset += MAX_GROCERY_CLEANUP_ITEMS) {
    const batch = snapshot.slice(offset, offset + MAX_GROCERY_CLEANUP_ITEMS).map(item => ({
      name: item.name, quantity: item.quantity, unit: item.unit,
      ...(item.manualSection ? { manualSection: item.manualSection } : {}),
      isManual: item.isManual,
    }))
    const response = validateGroceryCleanupResponse(batch, await requestBatch(batch))
    for (const change of response) {
      const mapped = { ...change, originalIndex: offset + change.originalIndex,
        mergedWith: change.mergedWith.map(index => offset + index) }
      proposals.set(mapped.originalIndex, mapped)
    }
  }

  const facts = cleanupFacts(snapshot)
  const buckets = new Map<string, Array<{
    members: number[]
    quantity: { quantity: string; unit: string }
  }>>()
  const changes: GroceryCleanupChange[] = []
  snapshot.forEach((item, index) => {
    const proposal = proposals.get(index)
    if (proposal?.action === 'remove') {
      changes.push(proposal)
      return
    }
    const source = facts.get(item)!.source
    const key = identityBucket(item, facts.get(item)!.identity)
    const groups = buckets.get(key) || []
    let joined = false
    for (const group of groups) {
      if (group.members.length >= FIRESTORE_SAFE_BATCH_SIZE ||
        !group.members.every(peer => compatibleItems(item, snapshot[peer], facts))) continue
      // This is the same ordered left fold used to construct the final change,
      // cached at its current prefix instead of recomputing every earlier term.
      const quantity = mergeQuantities(group.quantity, source)
      if (quantity.quantity.length > MAX_GROCERY_CLEANUP_QUANTITY_LENGTH) continue
      group.members.push(index)
      group.quantity = quantity
      joined = true
      break
    }
    if (!joined) groups.push({ members: [index], quantity: { quantity: source.quantity, unit: source.unit } })
    buckets.set(key, groups)
  })
  for (const groups of buckets.values()) {
    for (const { members } of groups) {
      // A stable original order also keeps directional unit conversion and the
      // quantity-length bound identical during grouping, preview and application.
      const survivor = members[0]
      const proposal = proposals.get(survivor)
      if (members.length > 1) {
        changes.push(mergedChange(snapshot, members, facts, proposal))
      } else if (proposal) {
        const normalized = normalizedChange(snapshot, proposal)
        normalized.action = 'normalize'
        if (isActualNormalization(snapshot[survivor], normalized)) changes.push(normalized)
      }
    }
  }
  const plan = { items: snapshot, changes: changes.sort((a, b) => a.originalIndex - b.originalIndex) }
  buildGroceryCleanupGroups(plan)
  return plan
}

/**
 * Resolve a validated preview to disjoint document groups. Rejection applies to
 * the displayed group as a whole; remaining items are never regrouped afterward.
 * Throws the same safe error for stale/malformed identities or unsafe groups.
 */
export function buildGroceryCleanupGroups(
  plan: GroceryCleanupPlan,
  rejectedIndices: ReadonlySet<number> = new Set(),
): GroceryCleanupGroup[] {
  validateSnapshot(plan.items)
  const facts = cleanupFacts(plan.items)
  const changes = checkedChanges(plan.items, plan.changes)
  const touched = new Set<string>()
  const groups: GroceryCleanupGroup[] = []
  for (const rejected of rejectedIndices) {
    if (!Number.isInteger(rejected) || rejected < 0 || rejected >= changes.length) invalidCleanup()
  }
  changes.forEach((change, index) => {
    const members = [change.originalIndex, ...change.mergedWith].map(itemIndex => plan.items[itemIndex])
    if (!isGroceryCategory(change.category) || members.length > FIRESTORE_SAFE_BATCH_SIZE ||
      (change.action === 'merge' && change.quantity.length > MAX_GROCERY_CLEANUP_QUANTITY_LENGTH) ||
      (change.action === 'merge' && members.length < 2) ||
      (change.action === 'remove' && !isClearlyNonGroceryLine(members[0].name))) invalidCleanup()
    members.forEach((item, memberIndex) => {
      if (touched.has(item.id) || members.slice(0, memberIndex).some(peer => !compatibleItems(item, peer, facts))) invalidCleanup()
      touched.add(item.id)
    })
    if (change.action !== 'remove') {
      const expected = change.action === 'merge'
        ? mergedChange(plan.items, [change.originalIndex, ...change.mergedWith], facts, change)
        : normalizedChange(plan.items, change)
      if (change.quantity !== expected.quantity || change.unit !== expected.unit) invalidCleanup()
    }
    if (!rejectedIndices.has(index)) groups.push({ items: members, change })
  })
  return groups
}
