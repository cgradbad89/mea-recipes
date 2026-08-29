import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  FROZEN_V10B_SOURCE_EXTRACTOR_SHA256,
  deriveMappingV1Evidence,
} from '@/lib/cookingModeMappingEvidence'
import {
  canonicalizeMappingCandidateIdentity,
  canonicalizeMappingRecipeRevisionSource,
  computeMappingCandidateId,
  computeMappingRecipeRevision,
  validateMappingCandidateStructure,
} from '@/lib/cookingModeMappingIdentity'
import {
  routeMappingCandidate,
  serializeMappingCandidateV1,
} from '@/lib/cookingModeMappingRouter'
import { computeCookingMappingSourceHash } from '@/lib/cookingStepMapping'
import type {
  MappingCandidateStructuralInput,
  MappingCandidateV1,
  MappingEvidenceInput,
  MappingFrozenV10BRiskFacts,
  MappingReviewerVoteV1,
  MappingRiskEvidence,
  MappingRoutingInput,
  MappingRevisionSource,
} from '@/types/cookingModeMapping'

const source: MappingRevisionSource = {
  recipeId: 'recipe-1',
  parserVersion: 'recipe-content-v1',
  ingredients: ['For the sauce:', '1 tbsp olive oil', '1 tsp salt'],
  instructions: ['Heat the oil.', 'Season with salt.'],
}

function reviewer(slot: 'A' | 'B', vote: MappingReviewerVoteV1['vote'] = 'ACCEPT'): MappingReviewerVoteV1 {
  const complete = vote === 'ACCEPT' || vote === 'REJECT'
  return {
    reviewerSlot: slot,
    vote,
    reviewerContractVersion: 'reviewer-v1',
    promptVersion: 'prompt-v1',
    modelId: 'provider/model',
    runId: `run-${slot}`,
    attemptId: `attempt-${slot}`,
    completedAt: complete ? '2026-08-28T12:00:00Z' : null,
    parseStatus: vote === 'UNPARSEABLE' ? 'INVALID' : complete ? 'VALID' : 'NO_RESULT',
    normalizedOutputHash: complete ? `hash-${slot}` : null,
    confidence: complete ? 'HIGH' : null,
    sourceEvidence: complete ? 'bounded source evidence' : null,
  }
}

function frozenFacts(overrides: Partial<MappingFrozenV10BRiskFacts> = {}): MappingFrozenV10BRiskFacts {
  return {
    isExplicitlyNamedInInstruction: true,
    ingredientGroup: 'For the sauce',
    duplicateSiblingIndexes: [],
    priorInstructionMentions: [],
    laterInstructionMentions: [],
    priorReviewerUses: [],
    quantityEvidence: {},
    componentContext: {
      possibleConstituent: false,
      componentLabels: [],
      currentInstructionRefersToComponent: false,
    },
    remainingLanguage: false,
    processMaterialRisk: false,
    contextualMentionRisk: false,
    duplicateRowRisk: false,
    groupConflictRisk: false,
    quantityConflictRisk: false,
    lifecycleRisk: false,
    collectiveReferenceRisk: false,
    partialIdentityMatchRisk: false,
    ...overrides,
  }
}

function evidenceInput(overrides: Partial<MappingEvidenceInput> = {}): MappingEvidenceInput {
  return {
    status: 'COMPLETE',
    extractorFingerprint: FROZEN_V10B_SOURCE_EXTRACTOR_SHA256,
    frozenRiskFacts: frozenFacts(),
    ...overrides,
  }
}

function routingInput(overrides: Partial<MappingRoutingInput> = {}): MappingRoutingInput {
  return {
    candidateType: 'INGREDIENT_STEP_RELATIONSHIP',
    reviewerA: reviewer('A'),
    reviewerB: reviewer('B'),
    deterministicEvidence: deriveMappingV1Evidence(evidenceInput()),
    structuralValidation: { valid: true, reasons: [] },
    ...overrides,
  }
}

const riskCases: Array<[MappingRiskEvidence, Partial<MappingFrozenV10BRiskFacts>]> = [
  ['COMPONENT_CONTAINMENT_RISK', { componentContext: { possibleConstituent: true, componentLabels: ['sauce'], currentInstructionRefersToComponent: true } }],
  ['LIFECYCLE_RISK', { lifecycleRisk: true }],
  ['CONTEXT_ONLY_RISK', { contextualMentionRisk: true }],
  ['PROCESS_MATERIAL_RISK', { processMaterialRisk: true }],
  ['DUPLICATE_ROW_RISK', { duplicateRowRisk: true }],
  ['GROUP_CONFLICT_RISK', { groupConflictRisk: true }],
  ['QUANTITY_CONFLICT_RISK', { quantityConflictRisk: true }],
  ['COLLECTIVE_REFERENCE_RISK', { collectiveReferenceRisk: true }],
  ['PARTIAL_IDENTITY_MATCH_RISK', { partialIdentityMatchRisk: true }],
]

async function structuralCandidate(
  overrides: Partial<MappingCandidateStructuralInput> = {},
): Promise<MappingCandidateStructuralInput> {
  const mappingSourceHash = await computeCookingMappingSourceHash(source.ingredients, source.instructions)
  const recipeRevision = await computeMappingRecipeRevision(source)
  const identity = {
    recipeId: source.recipeId,
    recipeRevision,
    ingredientRowIndex: 1,
    stepIndex: 0,
  }
  return {
    ...identity,
    candidateId: await computeMappingCandidateId(identity),
    parserVersion: source.parserVersion,
    mappingSourceHash,
    ingredientText: source.ingredients[1],
    stepText: source.instructions[0],
    ...overrides,
  }
}

describe('mapping recipe revision identity', () => {
  it('is stable for the same exact mapping source', async () => {
    await expect(computeMappingRecipeRevision(source)).resolves.toBe(await computeMappingRecipeRevision({ ...source }))
  })

  it.each([
    ['ingredient text', { ingredients: ['For the sauce:', '2 tbsp olive oil', '1 tsp salt'] }],
    ['ingredient order', { ingredients: ['For the sauce:', '1 tsp salt', '1 tbsp olive oil'] }],
    ['instruction text', { instructions: ['Warm the oil.', 'Season with salt.'] }],
    ['instruction order', { instructions: ['Season with salt.', 'Heat the oil.'] }],
    ['parser version', { parserVersion: 'recipe-content-v2' }],
  ])('changes for a mapping-relevant %s change', async (_label, change) => {
    await expect(computeMappingRecipeRevision({ ...source, ...change })).resolves.not.toBe(
      await computeMappingRecipeRevision(source),
    )
  })

  it('ignores mapping-irrelevant metadata and recipe ID', async () => {
    const withMetadata = { ...source, recipeId: 'different-recipe', imageURL: 'changed', rating: 1 }
    await expect(computeMappingRecipeRevision(withMetadata)).resolves.toBe(await computeMappingRecipeRevision(source))
  })

  it('uses the repository fixed-key-order canonical source JSON', () => {
    expect(canonicalizeMappingRecipeRevisionSource(source)).toBe(
      '{"ingredients":["For the sauce:","1 tbsp olive oil","1 tsp salt"],"instructions":["Heat the oil.","Season with salt."]}',
    )
  })
})

describe('mapping candidate identity', () => {
  const identity = {
    recipeId: 'recipe-1',
    recipeRevision: 'recipe-content-v1:sha256:abc',
    ingredientRowIndex: 2,
    stepIndex: 3,
  }

  it('matches the exact mc1 identity tuple and SHA-256 contract', async () => {
    expect(canonicalizeMappingCandidateIdentity(identity)).toBe(
      '["mapping-candidate",1,"recipe-1","recipe-content-v1:sha256:abc",2,3]',
    )
    await expect(computeMappingCandidateId(identity)).resolves.toBe(
      'mc1:692fe623bd39f5eb9a3cbf85c85901417e9868ddb951fd0dd0810644c9ce79fa',
    )
  })

  it('is stable for the same logical candidate and ignores incidental properties', async () => {
    const withIncidentalProperties = { ...identity, reviewer: 'changed', risks: ['changed'], timestamp: 'changed' }
    await expect(computeMappingCandidateId(withIncidentalProperties)).resolves.toBe(await computeMappingCandidateId(identity))
  })

  it.each([
    ['recipeId', 'recipe-2'],
    ['recipeRevision', 'recipe-content-v1:sha256:def'],
    ['ingredientRowIndex', 3],
    ['stepIndex', 4],
  ] as const)('changes when %s changes', async (field, value) => {
    await expect(computeMappingCandidateId({ ...identity, [field]: value })).resolves.not.toBe(
      await computeMappingCandidateId(identity),
    )
  })
})

describe('mapping candidate structural validation', () => {
  it('accepts a source-bound, non-header candidate', async () => {
    await expect(validateMappingCandidateStructure(await structuralCandidate(), source)).resolves.toEqual({
      valid: true,
      reasons: [],
    })
  })

  it.each([
    ['ingredient index', { ingredientRowIndex: 99 }, 'INVALID_INGREDIENT_INDEX'],
    ['step index', { stepIndex: 99 }, 'INVALID_STEP_INDEX'],
    ['recipe ID', { recipeId: 'other' }, 'INVALID_RECIPE_REVISION'],
    ['recipe revision', { recipeRevision: 'stale' }, 'INVALID_RECIPE_REVISION'],
    ['ingredient snapshot', { ingredientText: 'changed' }, 'SOURCE_SNAPSHOT_MISMATCH'],
    ['step snapshot', { stepText: 'changed' }, 'SOURCE_SNAPSHOT_MISMATCH'],
    ['candidate ID', { candidateId: 'mc1:not-the-digest' }, 'CANDIDATE_ID_COLLISION'],
  ] as const)('rejects an invalid %s', async (_label, change, reason) => {
    const result = await validateMappingCandidateStructure(await structuralCandidate(change), source)
    expect(result.valid).toBe(false)
    expect(result.reasons).toContain(reason)
  })

  it('rejects an ingredient header row', async () => {
    const candidate = await structuralCandidate({ ingredientRowIndex: 0, ingredientText: source.ingredients[0] })
    candidate.candidateId = await computeMappingCandidateId(candidate)
    await expect(validateMappingCandidateStructure(candidate, source)).resolves.toMatchObject({
      valid: false,
      reasons: ['INGREDIENT_HEADER_INDEX'],
    })
  })

  it('distinguishes duplicate identity from a verified ID collision', async () => {
    const candidate = await structuralCandidate()
    const duplicate = await validateMappingCandidateStructure(candidate, source, [candidate])
    const collision = await validateMappingCandidateStructure(candidate, source, [{
      ...candidate,
      recipeId: 'other-recipe',
    }])
    expect(duplicate.reasons).toEqual(['DUPLICATE_CANDIDATE_IDENTITY'])
    expect(collision.reasons).toEqual(['CANDIDATE_ID_COLLISION'])
  })
})

describe('frozen V1 evidence adapter', () => {
  it.each(riskCases)('maps frozen facts to %s without semantic interpretation', (risk, change) => {
    const result = deriveMappingV1Evidence(evidenceInput({ frozenRiskFacts: frozenFacts(change) }))
    expect(result.risks).toEqual([risk])
  })

  it('canonicalizes and deduplicates finite arrays and observations', () => {
    const result = deriveMappingV1Evidence(evidenceInput({
      positive: ['V10G_ACTIVE_OBJECT_RESCUE_SUPPORT', 'DIRECT_EXPLICIT_USE', 'DIRECT_EXPLICIT_USE'],
      tags: ['V10G_FRONTIER_REJECT', 'GENERIC_SEASONING', 'GENERIC_SEASONING'],
      frozenRiskFacts: frozenFacts({
        duplicateSiblingIndexes: [4, 2, 4],
        priorInstructionMentions: [3, 1, 3],
        componentContext: {
          possibleConstituent: false,
          componentLabels: ['sauce', 'dressing', 'sauce'],
          currentInstructionRefersToComponent: true,
        },
      }),
    }))
    expect(result.positive).toEqual(['DIRECT_EXPLICIT_USE', 'V10G_ACTIVE_OBJECT_RESCUE_SUPPORT'])
    expect(result.tags).toEqual(['GENERIC_SEASONING', 'V10G_FRONTIER_REJECT'])
    expect(result.observations.duplicateSiblingIndexes).toEqual([2, 4])
    expect(result.observations.priorMentionStepIndexes).toEqual([1, 3])
    expect(result.observations.componentLabels).toEqual(['dressing', 'sauce'])
  })

  it('fails closed when complete evidence has an unsupported fingerprint or no facts', () => {
    expect(deriveMappingV1Evidence(evidenceInput({ extractorFingerprint: 'changed' })).status).toBe('INVALID')
    expect(deriveMappingV1Evidence(evidenceInput({ frozenRiskFacts: null })).status).toBe('INVALID')
  })

  it('represents unavailable evidence without inventing observations or risk absence', () => {
    const result = deriveMappingV1Evidence(evidenceInput({ status: 'UNAVAILABLE', frozenRiskFacts: null }))
    expect(result).toMatchObject({ status: 'UNAVAILABLE', risks: [], observations: { explicitlyNamed: false } })
  })
})

describe('pure V1 mapping router', () => {
  it('auto-accepts only two complete ACCEPT votes with complete no-risk evidence', () => {
    expect(routeMappingCandidate(routingInput())).toEqual({
      routingDecision: 'AUTO_ACCEPT',
      routingReasons: ['AUTO_ACCEPT_BOTH_REVIEWERS_NO_V1_RISK'],
      reviewStatus: 'NOT_REQUIRED',
      finalDecision: 'ACCEPT',
      decisionSource: 'AUTO',
    })
  })

  it.each([
    'COMPONENT_CONTAINMENT_RISK',
    'LIFECYCLE_RISK',
    'CONTEXT_ONLY_RISK',
    'PROCESS_MATERIAL_RISK',
    'DUPLICATE_ROW_RISK',
    'GROUP_CONFLICT_RISK',
    'QUANTITY_CONFLICT_RISK',
    'COLLECTIVE_REFERENCE_RISK',
    'PARTIAL_IDENTITY_MATCH_RISK',
  ] as const)('routes both accepts plus %s to review, never rejection', risk => {
    const deterministicEvidence = deriveMappingV1Evidence(evidenceInput({
      frozenRiskFacts: frozenFacts(riskCases.find(([value]) => value === risk)?.[1]),
    }))
    expect(routeMappingCandidate(routingInput({ deterministicEvidence }))).toMatchObject({
      routingDecision: 'REVIEW_REQUIRED',
      routingReasons: ['DETERMINISTIC_RISK_PRESENT'],
    })
  })

  it.each([
    ['A accepts/B rejects', reviewer('A', 'ACCEPT'), reviewer('B', 'REJECT')],
    ['A rejects/B accepts', reviewer('A', 'REJECT'), reviewer('B', 'ACCEPT')],
  ])('routes %s to review', (_label, reviewerA, reviewerB) => {
    expect(routeMappingCandidate(routingInput({ reviewerA, reviewerB }))).toMatchObject({
      routingDecision: 'REVIEW_REQUIRED',
      routingReasons: ['REVIEWER_DISAGREEMENT'],
    })
  })

  it('routes two rejects plus positive evidence to review', () => {
    const deterministicEvidence = deriveMappingV1Evidence(evidenceInput({ positive: ['DIRECT_EXPLICIT_USE'] }))
    expect(routeMappingCandidate(routingInput({
      reviewerA: reviewer('A', 'REJECT'),
      reviewerB: reviewer('B', 'REJECT'),
      deterministicEvidence,
    }))).toMatchObject({
      routingDecision: 'REVIEW_REQUIRED',
      routingReasons: ['BOTH_REJECT_WITH_POSITIVE_EVIDENCE'],
    })
  })

  it('defaults a materialized two-reject/no-positive candidate to review', () => {
    expect(routeMappingCandidate(routingInput({
      reviewerA: reviewer('A', 'REJECT'),
      reviewerB: reviewer('B', 'REJECT'),
    }))).toMatchObject({
      routingDecision: 'REVIEW_REQUIRED',
      finalDecision: null,
      decisionSource: null,
    })
  })

  it('emits one deterministic risk reason for multiple finite risks', () => {
    const deterministicEvidence = deriveMappingV1Evidence(evidenceInput({
      frozenRiskFacts: frozenFacts({ lifecycleRisk: true, quantityConflictRisk: true }),
    }))
    expect(routeMappingCandidate(routingInput({ deterministicEvidence }))).toMatchObject({
      routingDecision: 'REVIEW_REQUIRED',
      routingReasons: ['DETERMINISTIC_RISK_PRESENT'],
    })
  })

  it.each(['UNPARSEABLE', 'MISSING'] as const)('blocks review for an %s reviewer result', vote => {
    for (const input of [
      routingInput({ reviewerA: reviewer('A', vote) }),
      routingInput({ reviewerB: reviewer('B', vote) }),
    ]) {
      expect(routeMappingCandidate(input)).toMatchObject({
        routingDecision: 'REVIEW_REQUIRED',
        routingReasons: ['REVIEWER_RESULT_INCOMPLETE'],
        reviewStatus: 'BLOCKED',
      })
    }
  })

  it('blocks mismatched reviewer contract or prompt versions', () => {
    expect(routeMappingCandidate(routingInput({
      reviewerB: { ...reviewer('B'), reviewerContractVersion: 'reviewer-v2' },
    }))).toMatchObject({ routingDecision: 'REVIEW_REQUIRED', reviewStatus: 'BLOCKED' })
    expect(routeMappingCandidate(routingInput({
      reviewerB: { ...reviewer('B'), promptVersion: 'prompt-v2' },
    }))).toMatchObject({ routingDecision: 'REVIEW_REQUIRED', reviewStatus: 'BLOCKED' })
  })

  it('blocks review when evidence is unavailable, invalid, or from the wrong extractor', () => {
    const unavailable = deriveMappingV1Evidence(evidenceInput({ status: 'UNAVAILABLE', frozenRiskFacts: null }))
    const wrongFingerprint = { ...deriveMappingV1Evidence(evidenceInput()), extractorFingerprint: 'changed' }
    expect(routeMappingCandidate(routingInput({ deterministicEvidence: unavailable })).routingDecision).toBe('REVIEW_REQUIRED')
    expect(routeMappingCandidate(routingInput({ deterministicEvidence: wrongFingerprint }))).toMatchObject({
      routingDecision: 'REVIEW_REQUIRED',
      reviewStatus: 'BLOCKED',
    })
  })

  it('routes unsupported relationship classes to review', () => {
    expect(routeMappingCandidate(routingInput({ candidateType: 'PREPARED_COMPONENT_RELATIONSHIP' }))).toMatchObject({
      routingDecision: 'REVIEW_REQUIRED',
      routingReasons: ['UNSUPPORTED_RELATIONSHIP_CLASS'],
    })
  })

  it('gives structural invalidity precedence over votes, evidence failures, and semantic risks', () => {
    const result = routeMappingCandidate(routingInput({
      reviewerA: reviewer('A', 'MISSING'),
      deterministicEvidence: deriveMappingV1Evidence(evidenceInput({ status: 'UNAVAILABLE', frozenRiskFacts: null })),
      structuralValidation: { valid: false, reasons: ['INVALID_STEP_INDEX'] },
    }))
    expect(result).toEqual({
      routingDecision: 'AUTO_REJECT',
      routingReasons: ['INVALID_STEP_INDEX'],
      reviewStatus: 'NOT_REQUIRED',
      finalDecision: 'REJECT',
      decisionSource: 'AUTO',
    })
  })

  it('keeps V10G support and frontier tags non-authoritative', () => {
    const base = routeMappingCandidate(routingInput())
    const tagged = routeMappingCandidate(routingInput({
      deterministicEvidence: deriveMappingV1Evidence(evidenceInput({
        positive: ['V10G_ACTIVE_OBJECT_RESCUE_SUPPORT'],
        tags: ['V10G_FRONTIER_REJECT'],
      })),
    }))
    expect(tagged).toEqual(base)
  })
})

describe('candidate serialization and architecture boundaries', () => {
  async function candidate(): Promise<MappingCandidateV1> {
    const identityCandidate = await structuralCandidate()
    return {
      schemaVersion: 1,
      candidateType: 'INGREDIENT_STEP_RELATIONSHIP',
      candidateId: identityCandidate.candidateId,
      proposalId: 'proposal-1',
      recipeId: identityCandidate.recipeId,
      recipeRevision: identityCandidate.recipeRevision,
      parserVersion: identityCandidate.parserVersion,
      mappingSourceHash: identityCandidate.mappingSourceHash,
      ingredientRowIndex: identityCandidate.ingredientRowIndex,
      ingredientText: identityCandidate.ingredientText,
      ingredientGroup: 'For the sauce',
      stepIndex: identityCandidate.stepIndex,
      stepText: identityCandidate.stepText,
      reviewerA: reviewer('A'),
      reviewerB: reviewer('B'),
      deterministicEvidence: deriveMappingV1Evidence(evidenceInput()),
      routingDecision: 'AUTO_ACCEPT',
      routingReasons: ['AUTO_ACCEPT_BOTH_REVIEWERS_NO_V1_RISK'],
      reviewStatus: 'NOT_REQUIRED',
      finalDecision: 'ACCEPT',
      decisionSource: 'AUTO',
      provenance: {
        routingContractVersion: 'cooking-review-routing-v1',
        evidenceContractVersion: 'cooking-routing-evidence-v1',
        reviewerContractVersion: 'reviewer-v1',
        candidateOrigin: 'REVIEWER_UNION',
        acceptedByReviewerSlots: ['A', 'B'],
      },
      createdAt: '2026-08-28T12:00:00Z',
    }
  }

  it('round-trips every canonical candidate value through JSON', async () => {
    const value = await candidate()
    expect(JSON.parse(serializeMappingCandidateV1(value))).toEqual(value)
  })

  it('serializes finite arrays in canonical order with duplicates removed', async () => {
    const value = await candidate()
    value.deterministicEvidence.risks = ['QUANTITY_CONFLICT_RISK', 'LIFECYCLE_RISK', 'QUANTITY_CONFLICT_RISK']
    value.routingReasons = ['DETERMINISTIC_RISK_PRESENT', 'REVIEWER_DISAGREEMENT', 'DETERMINISTIC_RISK_PRESENT']
    const parsed = JSON.parse(serializeMappingCandidateV1(value)) as MappingCandidateV1
    expect(parsed.deterministicEvidence.risks).toEqual(['LIFECYCLE_RISK', 'QUANTITY_CONFLICT_RISK'])
    expect(parsed.routingReasons).toEqual(['REVIEWER_DISAGREEMENT', 'DETERMINISTIC_RISK_PRESENT'])
  })

  it('produces byte-equivalent serialization for equivalent array-set values', async () => {
    const first = await candidate()
    const second = await candidate()
    first.deterministicEvidence.tags = ['V10G_FRONTIER_REJECT', 'GENERIC_SEASONING']
    second.deterministicEvidence.tags = ['GENERIC_SEASONING', 'V10G_FRONTIER_REJECT', 'GENERIC_SEASONING']
    expect(serializeMappingCandidateV1(first)).toBe(serializeMappingCandidateV1(second))
  })

  it('does not depend on incidental nested object property order', async () => {
    const first = await candidate()
    const second = await candidate()
    second.reviewerA = Object.fromEntries(Object.entries(second.reviewerA!).reverse()) as unknown as MappingReviewerVoteV1
    second.deterministicEvidence.observations = Object.fromEntries(
      Object.entries(second.deterministicEvidence.observations).reverse(),
    ) as unknown as MappingCandidateV1['deterministicEvidence']['observations']
    expect(serializeMappingCandidateV1(first)).toBe(serializeMappingCandidateV1(second))
  })

  it('keeps the production core free of AI, Firestore, persistence, and runtime imports', () => {
    const root = process.cwd()
    const sourceText = [
      'lib/cookingModeMappingIdentity.ts',
      'lib/cookingModeMappingEvidence.ts',
      'lib/cookingModeMappingRouter.ts',
      'types/cookingModeMapping.ts',
    ].map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n')
    expect(sourceText).not.toMatch(/firebase|firestore|@ai-sdk|from ['"]ai['"]|generateText|generateObject|CookingMode|setDoc|updateDoc|addDoc/)
  })
})
