import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { parseRecipeContent } from '@/lib/recipeContent'
import {
  COOKING_MAPPING_PARSER_VERSION,
  computeCookingMappingSourceHash,
} from '@/lib/cookingStepMapping'
import { computeMappingRecipeRevision } from '@/lib/cookingModeMappingIdentity'
import {
  computeApprovedMapHash,
  computeApprovedMapId,
  computeApprovedMapVersion,
} from '@/lib/cookingModeMappingPersistenceIdentity'
import {
  canonicalJson,
  computeCanonicalJsonSha256,
  dryRunApprovedMappingPromotion,
  materializeApprovedMapForLegacyRuntime,
  promoteApprovedMappingsToRuntime,
  rollbackPromotedMappings,
  verifySelectivePromotionManifestHash,
} from '@/lib/cookingModeMappingPromotion'
import { approvedMappingDocRef, mappingPointerDocRef, recipeDocRef } from '@/lib/cookingModeMappingFirestore'
import type {
  PersistedApprovedCookingStepMapV1,
} from '@/types/cookingModeMappingPersistence'
import type { CookingStepIngredientMap } from '@/types/recipe'
import { createFakeMappingFirestore } from './helpers/fakeMappingFirestore'

const RECIPE_ID = 'promotion-fixture'
const CONTENT = `INGREDIENTS
1 lb potatoes
1 lb steak
salt and pepper

INSTRUCTIONS
Step 1
Add the potatoes to the pan.
Step 2
Add the steak bites to the pan.
Step 3
Serve the cooked dish immediately.`

function oldRuntimeMap(sourceHash: string): CookingStepIngredientMap {
  return {
    schemaVersion: 1,
    parserVersion: COOKING_MAPPING_PARSER_VERSION,
    engineVersion: 'deterministic-v4',
    sourceHash,
    steps: [
      { instructionIndex: 0, ingredients: [] },
      { instructionIndex: 1, ingredients: [] },
      { instructionIndex: 2, ingredients: [] },
    ],
  }
}

async function approvedFixture(options: { duplicate?: boolean } = {}): Promise<PersistedApprovedCookingStepMapV1> {
  const parsed = parseRecipeContent(CONTENT)
  const mappingSourceHash = await computeCookingMappingSourceHash(parsed.ingredients, parsed.instructions)
  const recipeRevision = await computeMappingRecipeRevision({
    recipeId: RECIPE_ID,
    parserVersion: COOKING_MAPPING_PARSER_VERSION,
    ...parsed,
  })
  const relationships = [
    { candidateId: 'mc1:potatoes', ingredientRowIndex: 0, stepIndex: 0, decisionSource: 'AUTO' as const, decisionId: null, provenanceClass: 'AUTO_ACCEPT' as const },
    { candidateId: 'mc1:steak', ingredientRowIndex: 1, stepIndex: 1, decisionSource: 'HUMAN' as const, decisionId: 'mr1:steak', provenanceClass: 'HUMAN_REVIEW_ACCEPT' as const },
    ...(options.duplicate ? [{ candidateId: 'mc1:steak-duplicate', ingredientRowIndex: 1, stepIndex: 1, decisionSource: 'HUMAN' as const, decisionId: 'mr1:dup', provenanceClass: 'HUMAN_REVIEW_ACCEPT' as const }] : []),
  ].reverse()
  const hashInput = {
    schemaVersion: 1 as const,
    recipeId: RECIPE_ID,
    recipeRevision,
    parserVersion: COOKING_MAPPING_PARSER_VERSION,
    mappingSourceHash,
    proposalId: 'mp1:fixture',
    reviewerContractVersion: 'cooking-mapping-reviewer-v1',
    evidenceContractVersion: 'cooking-routing-evidence-v1',
    routingContractVersion: 'cooking-review-routing-v1',
    status: 'APPROVED' as const,
    approvalMode: 'HUMAN_ASSISTED' as const,
    relationships,
    preparedComponents: [] as never[],
    approvedBy: 'admin-uid',
  }
  const mapHash = await computeApprovedMapHash(hashInput)
  return {
    ...hashInput,
    mapHash,
    mapId: computeApprovedMapId(mapHash),
    mapVersion: computeApprovedMapVersion(hashInput.routingContractVersion, mapHash),
    completenessAttestedAt: 'T0',
    provenance: {
      reviewerARunId: 'a', reviewerBRunId: 'b',
      reviewerAOutputHash: 'ha', reviewerBOutputHash: 'hb',
      autoAcceptCandidateCount: 1, humanDecidedCandidateCount: 1,
    },
    createdAt: 'T0',
    approvedAt: 'T0',
  }
}

async function setup() {
  const db = createFakeMappingFirestore()
  const map = await approvedFixture()
  const oldMap = oldRuntimeMap(map.mappingSourceHash)
  await recipeDocRef(db, RECIPE_ID).set({
    title: 'Keep me',
    content: CONTENT,
    nutrition: { calories: 100 },
    cookingStepIngredientMap: oldMap,
  })
  await approvedMappingDocRef(db, RECIPE_ID, map.mapId).set(map as unknown as Record<string, unknown>)
  await mappingPointerDocRef(db, RECIPE_ID).set({
    schemaVersion: 1,
    recipeId: RECIPE_ID,
    recipeRevision: map.recipeRevision,
    mapId: map.mapId,
    mapHash: map.mapHash,
    updatedAt: 'T0',
  })
  const nextMap = materializeApprovedMapForLegacyRuntime(map, 3)
  const input = {
    recipeId: RECIPE_ID,
    expectedRecipeRevision: map.recipeRevision,
    approvedMapId: map.mapId,
    approvedMapHash: map.mapHash,
    expectedExistingRuntimeMapHash: await computeCanonicalJsonSha256(oldMap),
    expectedNewRuntimeMapHash: await computeCanonicalJsonSha256(nextMap),
    frozenRuntimeMap: nextMap,
  }
  return { db, map, oldMap, nextMap, input }
}

describe('materializeApprovedMapForLegacyRuntime', () => {
  it('uses the existing schema-v1 runtime shape with canonical step/ingredient ordering and no duplicates', async () => {
    const map = await approvedFixture({ duplicate: true })
    const runtime = materializeApprovedMapForLegacyRuntime(map, 3)
    expect(runtime.engineVersion).toBe('deterministic-v4')
    expect(runtime.steps.map(step => step.instructionIndex)).toEqual([0, 1, 2])
    expect(runtime.steps[0].ingredients.map(row => row.ingredientIndex)).toEqual([0])
    expect(runtime.steps[1].ingredients.map(row => row.ingredientIndex)).toEqual([1])
    expect(runtime.steps[2].ingredients).toEqual([])
    expect(canonicalJson(runtime)).not.toContain('candidateId')
    expect(canonicalJson(runtime)).not.toContain('decisionSource')
  })
})

describe('selective approved-map promotion', () => {
  it('reports an exact READY dry-run and performs no write', async () => {
    const { db, input, oldMap } = await setup()
    const result = await dryRunApprovedMappingPromotion([input], db)
    expect(result).toEqual([expect.objectContaining({ status: 'READY', failure: null })])
    expect((await recipeDocRef(db, RECIPE_ID).get()).data()?.cookingStepIngredientMap).toEqual(oldMap)
  })

  it.each([
    ['wrong recipe revision', { expectedRecipeRevision: 'wrong' }, 'RECIPE_REVISION_MISMATCH'],
    ['wrong map hash', { approvedMapHash: '0'.repeat(64) }, 'APPROVED_MAP_HASH_MISMATCH'],
    ['wrong old-runtime hash', { expectedExistingRuntimeMapHash: '0'.repeat(64) }, 'EXISTING_RUNTIME_MAP_HASH_MISMATCH'],
  ])('rejects %s without writing', async (_label, override, failure) => {
    const { db, input, oldMap } = await setup()
    const result = await dryRunApprovedMappingPromotion([{ ...input, ...override }], db)
    expect(result[0]).toEqual(expect.objectContaining({ status: 'PRECONDITION_FAILED', failure }))
    expect((await recipeDocRef(db, RECIPE_ID).get()).data()?.cookingStepIngredientMap).toEqual(oldMap)
  })

  it('rejects a stale pointer', async () => {
    const { db, input } = await setup()
    await mappingPointerDocRef(db, RECIPE_ID).set({ recipeRevision: 'stale', mapId: input.approvedMapId, mapHash: input.approvedMapHash })
    const result = await dryRunApprovedMappingPromotion([input], db)
    expect(result[0]).toEqual(expect.objectContaining({ failure: 'POINTER_STALE' }))
  })

  it('rejects a frozen value or new hash that does not equal authoritative materialization', async () => {
    const { db, input, oldMap } = await setup()
    const changed = structuredClone(input.frozenRuntimeMap)
    changed.steps[0].ingredients = []
    const changedHash = await computeCanonicalJsonSha256(changed)
    const result = await dryRunApprovedMappingPromotion([{ ...input, frozenRuntimeMap: changed, expectedNewRuntimeMapHash: changedHash }], db)
    expect(result[0]).toEqual(expect.objectContaining({ failure: 'NEW_RUNTIME_MAP_HASH_MISMATCH' }))
    expect((await recipeDocRef(db, RECIPE_ID).get()).data()?.cookingStepIngredientMap).toEqual(oldMap)
  })

  it('applies the exact frozen value and mutates no unrelated recipe field', async () => {
    const { db, input, nextMap } = await setup()
    const before = (await recipeDocRef(db, RECIPE_ID).get()).data()!
    const result = await promoteApprovedMappingsToRuntime([input], db)
    const after = (await recipeDocRef(db, RECIPE_ID).get()).data()!
    expect(result[0].status).toBe('APPLIED')
    expect(after.cookingStepIngredientMap).toEqual(nextMap)
    expect({ ...after, cookingStepIngredientMap: undefined }).toEqual({ ...before, cookingStepIngredientMap: undefined })
  })

  it('does not partially apply when any recipe precondition fails', async () => {
    const { db, input, oldMap } = await setup()
    await expect(promoteApprovedMappingsToRuntime([
      input,
      { ...input, recipeId: 'missing-second-recipe' },
    ], db)).rejects.toMatchObject({ name: 'CookingModeMappingPromotionRejectedError' })
    expect((await recipeDocRef(db, RECIPE_ID).get()).data()?.cookingStepIngredientMap).toEqual(oldMap)
  })

  it('restores the exact old value only when the current promoted hash matches', async () => {
    const { db, input, oldMap } = await setup()
    await promoteApprovedMappingsToRuntime([input], db)
    await rollbackPromotedMappings([{
      recipeId: RECIPE_ID,
      expectedCurrentRuntimeMapHash: input.expectedNewRuntimeMapHash,
      rollbackRuntimeMap: oldMap,
      expectedRollbackRuntimeMapHash: input.expectedExistingRuntimeMapHash,
    }], db)
    expect((await recipeDocRef(db, RECIPE_ID).get()).data()?.cookingStepIngredientMap).toEqual(oldMap)
  })

  it('fails rollback closed on a wrong current hash', async () => {
    const { db, input, oldMap } = await setup()
    await expect(rollbackPromotedMappings([{
      recipeId: RECIPE_ID,
      expectedCurrentRuntimeMapHash: input.expectedNewRuntimeMapHash,
      rollbackRuntimeMap: oldMap,
      expectedRollbackRuntimeMapHash: input.expectedExistingRuntimeMapHash,
    }], db)).rejects.toThrow('Rollback current-map precondition failed')
  })
})

describe('promotion manifest canonicalization', () => {
  it('is key-order independent and validates the locked SHA', async () => {
    const manifest = { schemaVersion: 1 as const, manifestId: 'cooking-mode-selective-promotion-2026-08-29' as const, recipes: [] }
    const hash = await computeCanonicalJsonSha256(manifest)
    expect(await verifySelectivePromotionManifestHash(manifest, hash)).toBe(true)
    expect(await computeCanonicalJsonSha256({ recipes: [], manifestId: manifest.manifestId, schemaVersion: 1 })).toBe(hash)
    expect(await verifySelectivePromotionManifestHash(manifest, '0'.repeat(64))).toBe(false)
  })
})
