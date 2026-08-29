import 'server-only'

import { parseRecipeContent } from '@/lib/recipeContent'
import {
  COOKING_MAPPING_PARSER_VERSION,
  validateCookingStepIngredientMap,
} from '@/lib/cookingStepMapping'
import { computeMappingRecipeRevision } from '@/lib/cookingModeMappingIdentity'
import {
  computeApprovedMapHash,
  toApprovedMapHashInput,
} from '@/lib/cookingModeMappingPersistenceIdentity'
import {
  approvedMappingDocRef,
  mappingPointerDocRef,
  recipeDocRef,
  resolveMappingFirestore,
} from '@/lib/cookingModeMappingFirestore'
import type {
  MappingFirestoreDocSnapshot,
  MappingFirestoreLike,
  MappingFirestoreTransaction,
} from '@/lib/cookingModeMappingFirestore'
import type {
  CurrentApprovedMappingPointerV1,
  PersistedApprovedCookingStepMapV1,
} from '@/types/cookingModeMappingPersistence'
import type {
  CookingStepIngredientMap,
  CookingStepMapping,
} from '@/types/recipe'

export const SELECTIVE_PROMOTION_RUNTIME_ENGINE_VERSION = 'deterministic-v4'
export const SELECTIVE_PROMOTION_WRITE_TARGET = 'recipes/{recipeId}.cookingStepIngredientMap'

export interface PromoteApprovedMappingInput {
  recipeId: string
  expectedRecipeRevision: string
  approvedMapId: string
  approvedMapHash: string
  expectedExistingRuntimeMapHash: string
  expectedNewRuntimeMapHash: string
  /**
   * Exact frozen-manifest value. It is never trusted by itself: the service
   * independently materializes the authoritative approved map and requires
   * canonical equality before this value can be written.
   */
  frozenRuntimeMap: CookingStepIngredientMap
}

export type PromotionPreconditionFailure =
  | 'RECIPE_NOT_FOUND'
  | 'RECIPE_REVISION_MISMATCH'
  | 'APPROVED_MAP_NOT_FOUND'
  | 'APPROVED_MAP_ID_MISMATCH'
  | 'APPROVED_MAP_HASH_MISMATCH'
  | 'APPROVED_MAP_HASH_INVALID'
  | 'APPROVED_MAP_REVISION_MISMATCH'
  | 'POINTER_NOT_FOUND'
  | 'POINTER_STALE'
  | 'POINTER_MAP_MISMATCH'
  | 'EXISTING_RUNTIME_MAP_HASH_MISMATCH'
  | 'NEW_RUNTIME_MAP_HASH_MISMATCH'
  | 'FROZEN_RUNTIME_MAP_MISMATCH'
  | 'RUNTIME_MAP_INVALID'

export interface PromoteApprovedMappingResult {
  recipeId: string
  status: 'READY' | 'APPLIED' | 'PRECONDITION_FAILED'
  failure: PromotionPreconditionFailure | null
  recipeRevision: string | null
  approvedMapId: string
  approvedMapHash: string
  oldRuntimeMapHash: string | null
  newRuntimeMapHash: string | null
}

export interface SelectivePromotionManifestV1 {
  schemaVersion: 1
  manifestId: 'cooking-mode-selective-promotion-2026-08-29'
  recipes: SelectivePromotionManifestRecipeV1[]
}

export interface SelectivePromotionManifestRecipeV1 {
  recipeId: string
  recipeRevision: string
  approvedMapId: string
  approvedMapHash: string
  oldRuntimeMapExactValue: CookingStepIngredientMap
  oldRuntimeMapHash: string
  newRuntimeMapExactValue: CookingStepIngredientMap
  newRuntimeMapHash: string
  writeTarget: string
  preconditions: {
    recipeRevision: string
    approvedMapId: string
    approvedMapHash: string
    currentApprovedPointerStatus: 'CURRENT'
    existingRuntimeMapHash: string
  }
  rollbackValue: CookingStepIngredientMap
}

export interface RollbackPromotedMappingInput {
  recipeId: string
  expectedCurrentRuntimeMapHash: string
  rollbackRuntimeMap: CookingStepIngredientMap
  expectedRollbackRuntimeMapHash: string
}

export class CookingModeMappingPromotionRejectedError extends Error {
  readonly results: PromoteApprovedMappingResult[]

  constructor(results: PromoteApprovedMappingResult[]) {
    super('Cooking Mode mapping promotion preconditions failed; no runtime maps were written')
    this.name = 'CookingModeMappingPromotionRejectedError'
    this.results = results
  }
}

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b, 'en')
}

/** Recursively sorts object keys without changing array order. */
export function canonicalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJsonValue)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => compareStrings(a, b))
      .map(([key, nested]) => [key, canonicalizeJsonValue(nested)]),
  )
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalizeJsonValue(value))
}

export async function computeCanonicalJsonSha256(value: unknown): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto API is required to hash promotion data')
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(value)))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Pure approved-map → existing Cooking Mode runtime conversion.
 *
 * The established v4 reader contract is intentionally used. Unlike the v5
 * validator, v4 accepts an already-adjudicated, source-bound relationship
 * population without requiring those relationships to equal a deterministic
 * mapper run. The serialized shape remains the existing schema-v1 shape and
 * carries no review/routing metadata.
 */
export function materializeApprovedMapForLegacyRuntime(
  approvedMap: PersistedApprovedCookingStepMapV1,
  instructionCount: number,
): CookingStepIngredientMap {
  if (!Number.isInteger(instructionCount) || instructionCount < 0) {
    throw new Error('instructionCount must be a non-negative integer')
  }

  const acceptedByStep = new Map<number, Set<number>>()
  for (const relationship of approvedMap.relationships) {
    if (
      !Number.isInteger(relationship.stepIndex) ||
      relationship.stepIndex < 0 ||
      relationship.stepIndex >= instructionCount ||
      !Number.isInteger(relationship.ingredientRowIndex) ||
      relationship.ingredientRowIndex < 0
    ) {
      throw new Error(`Approved relationship ${relationship.candidateId} is outside the runtime source bounds`)
    }
    const indexes = acceptedByStep.get(relationship.stepIndex) ?? new Set<number>()
    indexes.add(relationship.ingredientRowIndex)
    acceptedByStep.set(relationship.stepIndex, indexes)
  }

  const steps: CookingStepMapping[] = Array.from({ length: instructionCount }, (_, instructionIndex) => ({
    instructionIndex,
    ingredients: [...(acceptedByStep.get(instructionIndex) ?? [])]
      .sort((a, b) => a - b)
      .map(ingredientIndex => ({
        ingredientIndex,
        confidence: 'high' as const,
        provenance: 'deterministic' as const,
      })),
  }))

  return {
    schemaVersion: 1,
    parserVersion: approvedMap.parserVersion,
    engineVersion: SELECTIVE_PROMOTION_RUNTIME_ENGINE_VERSION,
    sourceHash: approvedMap.mappingSourceHash,
    steps,
  }
}

interface ValidatedPromotion {
  input: PromoteApprovedMappingInput
  recipeRef: ReturnType<typeof recipeDocRef>
  result: PromoteApprovedMappingResult
}

function failedResult(
  input: PromoteApprovedMappingInput,
  failure: PromotionPreconditionFailure,
  partial: Partial<PromoteApprovedMappingResult> = {},
): PromoteApprovedMappingResult {
  return {
    recipeId: input.recipeId,
    status: 'PRECONDITION_FAILED',
    failure,
    recipeRevision: null,
    approvedMapId: input.approvedMapId,
    approvedMapHash: input.approvedMapHash,
    oldRuntimeMapHash: null,
    newRuntimeMapHash: null,
    ...partial,
  }
}

async function validateSnapshot(
  transaction: Pick<MappingFirestoreTransaction, 'get'>,
  db: MappingFirestoreLike,
  input: PromoteApprovedMappingInput,
): Promise<ValidatedPromotion | PromoteApprovedMappingResult> {
  const rootRef = recipeDocRef(db, input.recipeId)
  const rootSnap = await transaction.get(rootRef)
  if (!rootSnap.exists) return failedResult(input, 'RECIPE_NOT_FOUND')
  const rootData = rootSnap.data() ?? {}
  const content = typeof rootData.content === 'string' ? rootData.content : ''
  const { ingredients, instructions } = parseRecipeContent(content)
  const recipeRevision = await computeMappingRecipeRevision({
    recipeId: input.recipeId,
    parserVersion: COOKING_MAPPING_PARSER_VERSION,
    ingredients,
    instructions,
  })
  if (recipeRevision !== input.expectedRecipeRevision) {
    return failedResult(input, 'RECIPE_REVISION_MISMATCH', { recipeRevision })
  }

  const approvedSnap = await transaction.get(approvedMappingDocRef(db, input.recipeId, input.approvedMapId))
  if (!approvedSnap.exists) return failedResult(input, 'APPROVED_MAP_NOT_FOUND', { recipeRevision })
  const approved = approvedSnap.data() as unknown as PersistedApprovedCookingStepMapV1
  if (approved.mapId !== input.approvedMapId) {
    return failedResult(input, 'APPROVED_MAP_ID_MISMATCH', { recipeRevision })
  }
  if (approved.mapHash !== input.approvedMapHash) {
    return failedResult(input, 'APPROVED_MAP_HASH_MISMATCH', { recipeRevision })
  }
  const recomputedApprovedHash = await computeApprovedMapHash(toApprovedMapHashInput(approved))
  if (recomputedApprovedHash !== approved.mapHash) {
    return failedResult(input, 'APPROVED_MAP_HASH_INVALID', { recipeRevision })
  }
  if (
    approved.recipeId !== input.recipeId ||
    approved.recipeRevision !== recipeRevision ||
    approved.mappingSourceHash !== recipeRevision.split(':sha256:')[1]
  ) {
    return failedResult(input, 'APPROVED_MAP_REVISION_MISMATCH', { recipeRevision })
  }

  const pointerSnap = await transaction.get(mappingPointerDocRef(db, input.recipeId))
  if (!pointerSnap.exists) return failedResult(input, 'POINTER_NOT_FOUND', { recipeRevision })
  const pointer = pointerSnap.data() as unknown as CurrentApprovedMappingPointerV1
  if (pointer.recipeRevision !== recipeRevision) {
    return failedResult(input, 'POINTER_STALE', { recipeRevision })
  }
  if (pointer.mapId !== approved.mapId || pointer.mapHash !== approved.mapHash) {
    return failedResult(input, 'POINTER_MAP_MISMATCH', { recipeRevision })
  }

  const oldRuntimeMap = rootData.cookingStepIngredientMap ?? null
  const oldRuntimeMapHash = await computeCanonicalJsonSha256(oldRuntimeMap)
  if (oldRuntimeMapHash !== input.expectedExistingRuntimeMapHash) {
    return failedResult(input, 'EXISTING_RUNTIME_MAP_HASH_MISMATCH', { recipeRevision, oldRuntimeMapHash })
  }

  const authoritativeRuntimeMap = materializeApprovedMapForLegacyRuntime(approved, instructions.length)
  const newRuntimeMapHash = await computeCanonicalJsonSha256(authoritativeRuntimeMap)
  if (newRuntimeMapHash !== input.expectedNewRuntimeMapHash) {
    return failedResult(input, 'NEW_RUNTIME_MAP_HASH_MISMATCH', { recipeRevision, oldRuntimeMapHash, newRuntimeMapHash })
  }
  if (canonicalJson(authoritativeRuntimeMap) !== canonicalJson(input.frozenRuntimeMap)) {
    return failedResult(input, 'FROZEN_RUNTIME_MAP_MISMATCH', { recipeRevision, oldRuntimeMapHash, newRuntimeMapHash })
  }
  const deterministicForValidation: CookingStepIngredientMap = {
    ...authoritativeRuntimeMap,
    engineVersion: 'deterministic-v5',
  }
  const runtimeValidation = validateCookingStepIngredientMap(
    input.frozenRuntimeMap,
    ingredients,
    instructions,
    deterministicForValidation,
  )
  if (!runtimeValidation.valid) {
    return failedResult(input, 'RUNTIME_MAP_INVALID', { recipeRevision, oldRuntimeMapHash, newRuntimeMapHash })
  }

  return {
    input,
    recipeRef: rootRef,
    result: {
      recipeId: input.recipeId,
      status: 'READY',
      failure: null,
      recipeRevision,
      approvedMapId: approved.mapId,
      approvedMapHash: approved.mapHash,
      oldRuntimeMapHash,
      newRuntimeMapHash,
    },
  }
}

function assertUniqueRecipeInputs(inputs: readonly PromoteApprovedMappingInput[]): void {
  const ids = inputs.map(input => input.recipeId)
  if (new Set(ids).size !== ids.length) throw new Error('Promotion input contains a duplicate recipeId')
}

/** Read-only preflight; returns every row and never writes. */
export async function dryRunApprovedMappingPromotion(
  inputs: readonly PromoteApprovedMappingInput[],
  db?: MappingFirestoreLike,
): Promise<PromoteApprovedMappingResult[]> {
  assertUniqueRecipeInputs(inputs)
  const client = resolveMappingFirestore(db)
  const reader = { get: (ref: ReturnType<typeof recipeDocRef>) => ref.get() as Promise<MappingFirestoreDocSnapshot> }
  const validated = await Promise.all(inputs.map(input => validateSnapshot(reader, client, input)))
  return validated.map(item => 'result' in item ? item.result : item)
}

/**
 * All-or-nothing trusted/admin-side apply. Firestore re-reads every source,
 * approved artifact, pointer, and old runtime hash inside one transaction,
 * then merge-writes only `cookingStepIngredientMap` for every row.
 */
export async function promoteApprovedMappingsToRuntime(
  inputs: readonly PromoteApprovedMappingInput[],
  db?: MappingFirestoreLike,
): Promise<PromoteApprovedMappingResult[]> {
  assertUniqueRecipeInputs(inputs)
  const client = resolveMappingFirestore(db)
  return client.runTransaction(async transaction => {
    const checked = [] as Array<ValidatedPromotion | PromoteApprovedMappingResult>
    for (const input of inputs) checked.push(await validateSnapshot(transaction, client, input))
    const failures = checked.filter(item => !('result' in item)) as PromoteApprovedMappingResult[]
    if (failures.length > 0) {
      const results = checked.map(item => 'result' in item ? item.result : item)
      throw new CookingModeMappingPromotionRejectedError(results)
    }

    const valid = checked as ValidatedPromotion[]
    for (const item of valid) {
      transaction.set(item.recipeRef, { cookingStepIngredientMap: item.input.frozenRuntimeMap }, { merge: true })
    }
    return valid.map(item => ({ ...item.result, status: 'APPLIED' as const }))
  })
}

export async function promoteApprovedMappingToRuntime(
  input: PromoteApprovedMappingInput,
  db?: MappingFirestoreLike,
): Promise<PromoteApprovedMappingResult> {
  return (await promoteApprovedMappingsToRuntime([input], db))[0]
}

export function promotionInputsFromManifest(
  manifest: SelectivePromotionManifestV1,
): PromoteApprovedMappingInput[] {
  return manifest.recipes.map(row => ({
    recipeId: row.recipeId,
    expectedRecipeRevision: row.recipeRevision,
    approvedMapId: row.approvedMapId,
    approvedMapHash: row.approvedMapHash,
    expectedExistingRuntimeMapHash: row.oldRuntimeMapHash,
    expectedNewRuntimeMapHash: row.newRuntimeMapHash,
    frozenRuntimeMap: row.newRuntimeMapExactValue,
  }))
}

/**
 * All-or-nothing deterministic rollback. This is deliberately manifest-only:
 * it requires the live map to equal the promoted hash and restores the exact
 * recorded old value, writing no other recipe field.
 */
export async function rollbackPromotedMappings(
  inputs: readonly RollbackPromotedMappingInput[],
  db?: MappingFirestoreLike,
): Promise<Array<{ recipeId: string; restoredRuntimeMapHash: string }>> {
  assertUniqueRecipeInputs(inputs.map(input => ({ ...input,
    expectedRecipeRevision: '', approvedMapId: '', approvedMapHash: '',
    expectedExistingRuntimeMapHash: '', expectedNewRuntimeMapHash: '',
    frozenRuntimeMap: input.rollbackRuntimeMap,
  })))
  const client = resolveMappingFirestore(db)
  return client.runTransaction(async transaction => {
    const checked: Array<{
      input: RollbackPromotedMappingInput
      ref: ReturnType<typeof recipeDocRef>
      rollbackHash: string
    }> = []
    for (const input of inputs) {
      const ref = recipeDocRef(client, input.recipeId)
      const snap = await transaction.get(ref)
      if (!snap.exists) throw new Error(`Rollback recipe not found: ${input.recipeId}`)
      const currentHash = await computeCanonicalJsonSha256(snap.data()?.cookingStepIngredientMap ?? null)
      if (currentHash !== input.expectedCurrentRuntimeMapHash) {
        throw new Error(`Rollback current-map precondition failed: ${input.recipeId}`)
      }
      const rollbackHash = await computeCanonicalJsonSha256(input.rollbackRuntimeMap)
      if (rollbackHash !== input.expectedRollbackRuntimeMapHash) {
        throw new Error(`Rollback value hash failed: ${input.recipeId}`)
      }
      checked.push({ input, ref, rollbackHash })
    }
    for (const item of checked) {
      transaction.set(item.ref, { cookingStepIngredientMap: item.input.rollbackRuntimeMap }, { merge: true })
    }
    return checked.map(item => ({ recipeId: item.input.recipeId, restoredRuntimeMapHash: item.rollbackHash }))
  })
}

export async function verifySelectivePromotionManifestHash(
  manifest: SelectivePromotionManifestV1,
  expectedSha256: string,
): Promise<boolean> {
  return await computeCanonicalJsonSha256(manifest) === expectedSha256
}
