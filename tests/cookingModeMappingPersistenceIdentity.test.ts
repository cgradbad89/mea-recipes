import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  MAPPING_APPROVED_MAP_ID_PREFIX,
  MAPPING_REVIEW_DECISION_ID_PREFIX,
} from '@/types/cookingModeMappingPersistence'
import type { ApprovedIngredientStepRelationshipV1 } from '@/types/cookingModeMappingPersistence'
import {
  canonicalizeApprovedMapRelationships,
  computeApprovedMapHash,
  computeApprovedMapId,
  computeApprovedMapVersion,
  computeMappingReviewDecisionId,
} from '@/lib/cookingModeMappingPersistenceIdentity'
import type { ApprovedMapHashInput } from '@/lib/cookingModeMappingPersistenceIdentity'

function relationship(overrides: Partial<ApprovedIngredientStepRelationshipV1> = {}): ApprovedIngredientStepRelationshipV1 {
  return {
    candidateId: 'mc1:aaa',
    ingredientRowIndex: 0,
    stepIndex: 0,
    decisionSource: 'AUTO',
    decisionId: null,
    ...overrides,
  }
}

function hashInput(overrides: Partial<ApprovedMapHashInput> = {}): ApprovedMapHashInput {
  return {
    schemaVersion: 1,
    recipeId: 'recipe-1',
    recipeRevision: 'v1:sha256:abc',
    parserVersion: 'v1',
    mappingSourceHash: 'abc',
    proposalId: 'mp1:xyz',
    reviewerContractVersion: 'cooking-mapping-reviewer-v1',
    evidenceContractVersion: 'cooking-routing-evidence-v1',
    routingContractVersion: 'cooking-review-routing-v1',
    status: 'APPROVED',
    approvalMode: 'AUTO',
    relationships: [relationship()],
    preparedComponents: [],
    approvedBy: 'admin-uid',
    completenessAttestedAt: '2026-08-28T00:00:00.000Z',
    ...overrides,
  }
}

describe('review-decision identity', () => {
  const base = {
    proposalId: 'mp1:xyz',
    candidateId: 'mc1:aaa',
    decision: 'ACCEPT' as const,
    reasonCode: 'SOURCE_EXPLICIT_USE' as const,
    decidedBy: 'admin-uid',
  }

  it('is deterministic for the exact same content', async () => {
    const first = await computeMappingReviewDecisionId(base)
    const second = await computeMappingReviewDecisionId(base)
    expect(first).toBe(second)
    expect(first.startsWith(MAPPING_REVIEW_DECISION_ID_PREFIX)).toBe(true)
  })

  it('changes when the decision changes', async () => {
    const accept = await computeMappingReviewDecisionId(base)
    const reject = await computeMappingReviewDecisionId({ ...base, decision: 'REJECT' })
    expect(accept).not.toBe(reject)
  })

  it('changes when the reason code changes', async () => {
    const a = await computeMappingReviewDecisionId(base)
    const b = await computeMappingReviewDecisionId({ ...base, reasonCode: 'LIFECYCLE_OR_REUSE' })
    expect(a).not.toBe(b)
  })

  it('changes when the note changes', async () => {
    const a = await computeMappingReviewDecisionId({ ...base, note: 'first' })
    const b = await computeMappingReviewDecisionId({ ...base, note: 'second' })
    expect(a).not.toBe(b)
  })

  it('changes when the actor changes', async () => {
    const a = await computeMappingReviewDecisionId(base)
    const b = await computeMappingReviewDecisionId({ ...base, decidedBy: 'someone-else' })
    expect(a).not.toBe(b)
  })

  it('changes when supersedesDecisionId changes (a correction is a distinct event)', async () => {
    const a = await computeMappingReviewDecisionId(base)
    const b = await computeMappingReviewDecisionId({ ...base, supersedesDecisionId: a })
    expect(a).not.toBe(b)
  })
})

describe('approved-map relationship canonicalization', () => {
  it('sorts by (stepIndex, ingredientRowIndex, candidateId)', () => {
    const input = [
      relationship({ candidateId: 'mc1:c', ingredientRowIndex: 2, stepIndex: 1 }),
      relationship({ candidateId: 'mc1:a', ingredientRowIndex: 0, stepIndex: 0 }),
      relationship({ candidateId: 'mc1:b', ingredientRowIndex: 1, stepIndex: 0 }),
    ]
    const sorted = canonicalizeApprovedMapRelationships(input)
    expect(sorted.map(r => r.candidateId)).toEqual(['mc1:a', 'mc1:b', 'mc1:c'])
  })

  it('deduplicates by candidateId, keeping the last occurrence', () => {
    const input = [
      relationship({ candidateId: 'mc1:a', decisionSource: 'AUTO' }),
      relationship({ candidateId: 'mc1:a', decisionSource: 'HUMAN', decisionId: 'mr1:xyz' }),
    ]
    const deduped = canonicalizeApprovedMapRelationships(input)
    expect(deduped).toHaveLength(1)
    expect(deduped[0].decisionSource).toBe('HUMAN')
  })

  it('produces the same order regardless of input order', () => {
    const a = relationship({ candidateId: 'mc1:a', ingredientRowIndex: 0, stepIndex: 0 })
    const b = relationship({ candidateId: 'mc1:b', ingredientRowIndex: 1, stepIndex: 1 })
    expect(canonicalizeApprovedMapRelationships([a, b])).toEqual(canonicalizeApprovedMapRelationships([b, a]))
  })
})

describe('approved-map content hash', () => {
  it('is deterministic for identical content', async () => {
    const first = await computeApprovedMapHash(hashInput())
    const second = await computeApprovedMapHash(hashInput())
    expect(first).toBe(second)
  })

  it('is unaffected by relationship array order', async () => {
    const a = relationship({ candidateId: 'mc1:a', ingredientRowIndex: 0, stepIndex: 0 })
    const b = relationship({ candidateId: 'mc1:b', ingredientRowIndex: 1, stepIndex: 1 })
    const first = await computeApprovedMapHash(hashInput({ relationships: [a, b] }))
    const second = await computeApprovedMapHash(hashInput({ relationships: [b, a] }))
    expect(first).toBe(second)
  })

  it('normalizes duplicate relationships deterministically rather than erroring', async () => {
    const dup = relationship({ candidateId: 'mc1:a' })
    const hash = await computeApprovedMapHash(hashInput({ relationships: [dup, dup, dup] }))
    const single = await computeApprovedMapHash(hashInput({ relationships: [dup] }))
    expect(hash).toBe(single)
  })

  it('changes when an accepted relationship changes', async () => {
    const original = await computeApprovedMapHash(hashInput())
    const changed = await computeApprovedMapHash(hashInput({ relationships: [relationship({ candidateId: 'mc1:different' })] }))
    expect(original).not.toBe(changed)
  })

  it('changes when the recipe revision changes', async () => {
    const original = await computeApprovedMapHash(hashInput())
    const changed = await computeApprovedMapHash(hashInput({ recipeRevision: 'v1:sha256:different' }))
    expect(original).not.toBe(changed)
  })

  it('changes when the proposal changes', async () => {
    const original = await computeApprovedMapHash(hashInput())
    const changed = await computeApprovedMapHash(hashInput({ proposalId: 'mp1:different' }))
    expect(original).not.toBe(changed)
  })

  it('is the same for two logically-identical maps built independently (same revision/proposal/relationships)', async () => {
    const first = await computeApprovedMapHash(hashInput())
    // Simulates two separate builder invocations for the exact same
    // approved semantic content (Implementation-3 Phase 7 requirement).
    const second = await computeApprovedMapHash(hashInput({
      relationships: [relationship({ candidateId: 'mc1:aaa' })],
    }))
    expect(first).toBe(second)
  })
})

describe('approved-map id and version', () => {
  it('mapId is the am1: prefix plus the content hash', async () => {
    const hash = await computeApprovedMapHash(hashInput())
    expect(computeApprovedMapId(hash)).toBe(`${MAPPING_APPROVED_MAP_ID_PREFIX}${hash}`)
  })

  it('mapVersion combines the routing contract version with the first 16 hash characters', async () => {
    const hash = await computeApprovedMapHash(hashInput())
    expect(computeApprovedMapVersion('cooking-review-routing-v1', hash)).toBe(`cooking-review-routing-v1:${hash.slice(0, 16)}`)
  })
})
