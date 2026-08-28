import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  evaluateReviewRoutingContract,
  REVIEW_ROUTING_BENCHMARK_SIZE,
} from '../scripts/analyze-cooking-mode-review-routing-contract-core.mjs'
import { extractCandidateRiskFacts } from '../scripts/analyze-cooking-mode-v10b-ingredient-precision-core.mjs'
import {
  FROZEN_V10B_SOURCE_EXTRACTOR_SHA256,
  deriveMappingV1Evidence,
} from '../lib/cookingModeMappingEvidence.ts'
import { routeMappingCandidate } from '../lib/cookingModeMappingRouter.ts'

const root = path.resolve(process.cwd())
const readJson = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'))
const evidence = {
  frozen: readJson('docs/audits/cooking-mode-arbiter-v10a-frozen-candidates-2026-08-28.json'),
  benchmark: readJson('docs/audits/cooking-mode-completeness-audit-2026-08-26.json'),
  v10d: readJson('docs/audits/cooking-mode-v10d-principal-target-analysis-2026-08-28.json'),
  v10g: readJson('docs/audits/cooking-mode-v10g-active-object-full-frozen-validation-2026-08-28.json'),
}
const result = evaluateReviewRoutingContract(evidence)

describe('Cooking Mode review-routing benchmark reconciliation', () => {
  it('reconciles the exact 861-candidate reviewer union and 36-recipe population', () => {
    expect(REVIEW_ROUTING_BENCHMARK_SIZE).toBe(861)
    expect(result.benchmark).toMatchObject({
      recipes: 36,
      deterministicAugmentedCandidates: 863,
      deterministicOnlyCandidates: 2,
      reviewerUnionCandidates: 861,
      correctCandidates: 833,
      incorrectCandidates: 28,
      possibleIngredientStepCells: 3802,
      truthRelationships: 868,
    })
  })

  it('reconciles the four reviewer vote buckets', () => {
    expect(result.reviewerAgreement.bothAccept).toMatchObject({ correct: 763, incorrect: 9, total: 772 })
    expect(result.reviewerAgreement.aOnlyAccepts).toMatchObject({ correct: 17, incorrect: 11, total: 28 })
    expect(result.reviewerAgreement.bOnlyAccepts).toMatchObject({ correct: 53, incorrect: 8, total: 61 })
    expect(result.reviewerAgreement.bothReject).toMatchObject({
      correctRelationshipsMissed: 35,
      incorrectRelationshipsCorrectlyOmitted: 2906,
      total: 2941,
    })
  })
})

describe('Cooking Mode review-routing policy arithmetic', () => {
  it('shows why reviewer agreement alone is unsafe', () => {
    expect(result.policies.reviewerAgreementOnly.autoAccept).toEqual({
      count: 772,
      truePositives: 763,
      falsePositives: 9,
      precision: 763 / 772,
    })
  })

  it('locks the selected both-reviewers-plus-no-risk AUTO_ACCEPT frontier at 382 TP / 0 FP', () => {
    const selected = result.policies.reviewerAgreementAndNoV10bRisk
    expect(selected.autoAccept).toEqual({ count: 382, truePositives: 382, falsePositives: 0, precision: 1 })
    expect(selected.reviewRequired).toEqual({ count: 479, correctCandidates: 451, incorrectCandidates: 28 })
    expect(selected.autoReject.count).toBe(0)
    expect(selected.recipesRequiringReview).toBe(34)
  })

  it('shows that allowing single-reviewer low-risk candidates adds only four auto-accepts', () => {
    const maximum = result.policies.maximumSafeNoV10bRisk
    expect(maximum.autoAccept).toEqual({ count: 386, truePositives: 386, falsePositives: 0, precision: 1 })
    expect(maximum.reviewRequired.count).toBe(475)
  })

  it('reconciles the experimental V10G frontier without treating it as deployable routing', () => {
    const frontier = result.policies.v10gCombinedExperimentalFrontier
    expect(frontier.autoAccept).toEqual({ count: 773, truePositives: 773, falsePositives: 0, precision: 1 })
    expect(frontier.reviewRequired).toEqual({ count: 88, correctCandidates: 60, incorrectCandidates: 28 })
    expect(frontier.recipesRequiringReview).toBe(21)
  })

  it('reproduces the selected 382/479 policy through the production evidence adapter and router', () => {
    const reviewerUnion = evidence.frozen.populations.INGREDIENT_RELATIONSHIPS
      .filter(candidate => candidate.provenanceClass !== 'DETERMINISTIC_ONLY')
    const recipeById = new Map(evidence.benchmark.recipes.map(recipe => [recipe.recipeId, recipe]))
    const componentCandidates = evidence.frozen.populations.PREPARED_COMPONENT_RELATIONSHIPS
    const allIngredientCandidates = evidence.frozen.populations.INGREDIENT_RELATIONSHIPS
    const vote = (slot, accepted) => ({
      reviewerSlot: slot,
      vote: accepted ? 'ACCEPT' : 'REJECT',
      reviewerContractVersion: 'frozen-reviewer-v1',
      promptVersion: 'frozen-prompt-v1',
      modelId: 'frozen/model',
      runId: `frozen-run-${slot}`,
      attemptId: `frozen-attempt-${slot}`,
      completedAt: '2026-08-28T00:00:00Z',
      parseStatus: 'VALID',
      normalizedOutputHash: `frozen-hash-${slot}`,
      confidence: null,
      sourceEvidence: null,
    })

    const decisions = reviewerUnion.map(candidate => {
      const facts = extractCandidateRiskFacts(
        candidate,
        recipeById.get(candidate.recipeId),
        allIngredientCandidates,
        componentCandidates,
      )
      return routeMappingCandidate({
        candidateType: 'INGREDIENT_STEP_RELATIONSHIP',
        reviewerA: vote('A', candidate.origins.includes('REVIEWER_A')),
        reviewerB: vote('B', candidate.origins.includes('REVIEWER_B')),
        deterministicEvidence: deriveMappingV1Evidence({
          status: 'COMPLETE',
          extractorFingerprint: FROZEN_V10B_SOURCE_EXTRACTOR_SHA256,
          frozenRiskFacts: facts,
        }),
        structuralValidation: { valid: true, reasons: [] },
      }).routingDecision
    })

    expect(decisions.filter(decision => decision === 'AUTO_ACCEPT')).toHaveLength(382)
    expect(decisions.filter(decision => decision === 'REVIEW_REQUIRED')).toHaveLength(479)
    expect(decisions).not.toContain('AUTO_REJECT')
  })
})

describe('Cooking Mode V10G support-role combinations', () => {
  it('reconciles agreement/disagreement crossed with the V10G recorded frontier', () => {
    expect(result.v10gCombinations.reviewerDisagreementAndV10gAccept).toMatchObject({ count: 62, correct: 62, incorrect: 0 })
    expect(result.v10gCombinations.bothReviewersAcceptAndV10gAccept).toMatchObject({ count: 711, correct: 711, incorrect: 0 })
    expect(result.v10gCombinations.bothReviewersAcceptAndV10gReject).toMatchObject({ count: 61, correct: 52, incorrect: 9 })
    expect(result.v10gCombinations.reviewerDisagreementAndV10gReject).toMatchObject({ count: 27, correct: 8, incorrect: 19 })
    expect(result.v10gCombinations.deterministicRescueSignal).toMatchObject({ count: 131, correct: 131, incorrect: 0 })
  })
})

describe('review-routing analysis remains read-only', () => {
  it('the durable JSON artifact matches the independently recomputed selected policy', () => {
    const artifact = readJson('docs/audits/cooking-mode-review-routing-contract-analysis-2026-08-28.json')
    expect(artifact.benchmark).toMatchObject({
      deterministicAugmentedCandidates: 863,
      reviewerUnionCandidates: result.benchmark.reviewerUnionCandidates,
      correctCandidates: result.benchmark.correctCandidates,
      incorrectCandidates: result.benchmark.incorrectCandidates,
    })
    expect(artifact.policies.reviewerAgreementAndNoV10bRisk.autoAccept).toMatchObject({
      count: result.policies.reviewerAgreementAndNoV10bRisk.autoAccept.count,
      tp: result.policies.reviewerAgreementAndNoV10bRisk.autoAccept.truePositives,
      fp: result.policies.reviewerAgreementAndNoV10bRisk.autoAccept.falsePositives,
    })
    expect(artifact.productionMutations).toMatchObject({ aiCalls: 0, firestoreWrites: 0, recipeWrites: 0, mapWrites: 0 })
  })

  it('imports no Firestore, network, or AI execution path', () => {
    const source = fs.readFileSync(path.join(root, 'scripts/analyze-cooking-mode-review-routing-contract-core.mjs'), 'utf8')
    expect(source).not.toMatch(/firebase-admin|getFirestore|setDoc|updateDoc|\bfetch\(|generateObject|generateText/)
  })
})
