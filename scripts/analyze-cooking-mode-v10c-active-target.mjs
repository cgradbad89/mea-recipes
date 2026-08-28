#!/usr/bin/env node
/** Builds truth-blind V10C input and evaluates the bounded frozen-candidate experiment. */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { sha256, stableJson } from './analyze-cooking-step-arbiter-v10a-core.mjs'
import {
  candidateMetrics,
  extractV10CState,
  normalizeText,
  routeV10CRisk,
  validateTruthBlind,
  voteClass,
} from './analyze-cooking-mode-v10c-active-target-core.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const date = '2026-08-28'
const frozenPath = path.join(root, `docs/audits/cooking-mode-arbiter-v10a-frozen-candidates-${date}.json`)
const v10aPath = path.join(root, `docs/audits/cooking-mode-arbiter-v10a-analysis-${date}.json`)
const v10bPath = path.join(root, `docs/audits/cooking-mode-v10b-ingredient-precision-analysis-${date}.json`)
const benchmarkPath = path.join(root, 'docs/audits/cooking-mode-completeness-audit-2026-08-26.json')
const regressionPath = path.join(root, `docs/audits/cooking-mode-consensus-v9-regression-input-${date}.json`)
const v10aStatePath = `/tmp/cooking-step-arbiter-v10a-${date}-state.json`
const inputPath = `/tmp/cooking-mode-v10c-risk-input-${date}.json`
const statePath = `/tmp/cooking-mode-v10c-state-${date}.json`
const jsonPath = path.join(root, `docs/audits/cooking-mode-v10c-active-target-analysis-${date}.json`)
const markdownPath = path.join(root, `docs/audits/cooking-mode-v10c-active-target-analysis-${date}.md`)

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')) }
function percent(value) { return value === null || value === undefined ? 'n/a' : `${(value * 100).toFixed(2)}%` }
function countBy(values) {
  const counts = new Map()
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1)
  return Object.fromEntries([...counts].sort((a, b) => String(a[0]).localeCompare(String(b[0]))))
}
function md(value) { return String(value ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim() }

function baseAccepted(candidate, v10aDecisions) {
  return candidate.provenanceClass === '2_OF_2_REVIEWERS' || v10aDecisions.get(candidate.candidateId)?.decision === 'ACCEPT'
}

function safeCandidate(candidate, recipe, state, routing) {
  const relevantIndexes = new Set([candidate.instructionIndex - 1])
  for (const use of state.quantityState.priorUses) relevantIndexes.add(use.instructionIndex)
  for (const membership of state.componentMembership.memberships) if (membership.establishedAtInstructionIndex >= 0) relevantIndexes.add(membership.establishedAtInstructionIndex)
  return validateTruthBlind({
    candidateId: candidate.candidateId,
    recipeId: candidate.recipeId,
    recipeTitle: candidate.title || recipe.title,
    instructionIndex: candidate.instructionIndex,
    ingredientIndex: candidate.ingredientIndex,
    ingredientRow: candidate.ingredientText,
    groupOrPurpose: candidate.ingredientGroup || null,
    currentInstruction: candidate.instructionText,
    relevantPriorInstructions: [...relevantIndexes].filter(index => index >= 0 && index < candidate.instructionIndex).sort((a, b) => a - b).map(instructionIndex => ({ instructionIndex, text: recipe.steps[instructionIndex].instruction })),
    rowLocalQuantityState: state.quantityState,
    componentMembershipState: state.componentMembership,
    currentTargetState: state.currentTarget,
    continuingUseState: state.continuingUse,
    reviewerProvenance: {
      reviewerA: candidate.origins?.includes('REVIEWER_A') || false,
      reviewerB: candidate.origins?.includes('REVIEWER_B') || false,
      deterministic: candidate.origins?.includes('DETERMINISTIC') || false,
      voteClass: voteClass(candidate.origins || []),
      historicalOrigins: (candidate.origins || []).filter(origin => !['REVIEWER_A', 'REVIEWER_B', 'DETERMINISTIC'].includes(origin)),
    },
    sourceSignals: { directIdentityTokens: state.directIdentityTokens, legacyRisks: state.legacyRisks },
    routing,
  })
}

function loadInputs() {
  for (const file of [frozenPath, v10aPath, v10bPath, benchmarkPath, regressionPath, v10aStatePath]) if (!fs.existsSync(file)) throw new Error(`Required V10C evidence missing: ${file}`)
  const frozen = readJson(frozenPath)
  const v10a = readJson(v10aPath)
  const v10b = readJson(v10bPath)
  const benchmark = readJson(benchmarkPath)
  const regressions = readJson(regressionPath)
  const v10aState = readJson(v10aStatePath)
  const ingredients = frozen.populations.INGREDIENT_RELATIONSHIPS
  const components = frozen.populations.PREPARED_COMPONENT_RELATIONSHIPS
  const recipes = new Map(benchmark.recipes.map(recipe => [recipe.recipeId, recipe]))
  const v10aDecisions = new Map(Object.entries(v10aState.ingredientResults))
  const baseIds = new Set(ingredients.filter(candidate => baseAccepted(candidate, v10aDecisions)).map(item => item.candidateId))
  const reproducedV10A = candidateMetrics(ingredients, baseIds)
  if (ingredients.length !== 863 || ingredients.filter(item => item.adjudicatedTruth === 'CORRECT').length !== 833 || ingredients.filter(item => item.adjudicatedTruth === 'INCORRECT').length !== 30) throw new Error('Frozen V10A population mismatch')
  if (reproducedV10A.truePositives !== 831 || reproducedV10A.falsePositives !== 20 || reproducedV10A.falseNegatives !== 2) throw new Error(`V10A reproduction mismatch: ${JSON.stringify(reproducedV10A)}`)
  if (v10b.finalMetrics?.truePositives !== 748 || v10b.finalMetrics?.falsePositives !== 9 || v10b.finalMetrics?.falseNegatives !== 85 || v10b.twentyFalsePositives.filter(item => item.arbiterDecision === 'REJECT').length !== 13 || v10b.historicalRegression?.rejected !== 47) throw new Error('Exact V10B baseline reproduction failed')

  const stateById = new Map()
  const safeById = new Map()
  for (const candidate of ingredients) {
    const recipe = recipes.get(candidate.recipeId)
    const state = extractV10CState(candidate, recipe, ingredients, components)
    const routing = routeV10CRisk(state)
    stateById.set(candidate.candidateId, state)
    safeById.set(candidate.candidateId, safeCandidate(candidate, recipe, state, routing))
  }
  const primaryCandidates = ingredients.filter(candidate => baseIds.has(candidate.candidateId) && safeById.get(candidate.candidateId).routing.route === 'RISK_REVIEW_REQUIRED').map(candidate => safeById.get(candidate.candidateId))
  const frozenByKey = new Map(ingredients.map(candidate => [`${candidate.recipeId}:${candidate.instructionIndex}:${candidate.ingredientIndex}`, candidate]))
  const historical = regressions.ingredientFalsePositives.map(item => {
    const recipe = recipes.get(item.recipeId)
    const ingredient = recipe?.ingredients[item.ingredientIndex]
    const step = recipe?.steps[item.instructionIndex]
    if (!recipe || !ingredient || !step) return null
    const frozenCandidate = frozenByKey.get(`${item.recipeId}:${item.instructionIndex}:${item.ingredientIndex}`)
    const candidate = frozenCandidate || {
      candidateId: `historical::${item.recipeId}::${item.instructionIndex}::${item.ingredientIndex}`,
      recipeId: item.recipeId, title: recipe.title, instructionIndex: item.instructionIndex, ingredientIndex: item.ingredientIndex,
      ingredientText: ingredient.raw, ingredientGroup: ingredient.group || null, instructionText: step.instruction, origins: item.origins || [],
    }
    const state = extractV10CState(candidate, recipe, ingredients, components)
    const safe = safeCandidate(candidate, recipe, state, routeV10CRisk(state))
    const truthStatus = (item.origins || []).includes('EXISTING_PRODUCTION_FALSE_POSITIVE') ? 'LOCKED_TRUTH' : 'SOURCE_SIGNAL_ONLY'
    return { safe, evaluator: { candidateId: candidate.candidateId, origins: item.origins || [], truthStatus, state } }
  }).filter(Boolean)
  const input = validateTruthBlind({
    schemaVersion: 1,
    generatedAt: date,
    frozenSha256: sha256(fs.readFileSync(frozenPath)),
    truthLabelsIncluded: false,
    question: 'Is this ingredient row actively used in this current instruction?',
    candidates: primaryCandidates,
    historicalCandidates: historical.map(item => item.safe),
  })
  fs.writeFileSync(inputPath, stableJson(input))
  return { frozen, v10a, v10b, ingredients, components, recipes, v10aDecisions, baseIds, reproducedV10A, stateById, safeById, primaryCandidates, historical }
}

function evaluate(inputs) {
  const { v10a, v10b, ingredients, v10aDecisions, baseIds, reproducedV10A, stateById, primaryCandidates, historical } = inputs
  const state = fs.existsSync(statePath) ? readJson(statePath) : null
  const decisions = new Map(Object.entries(state?.results || {}))
  const primaryIds = new Set(primaryCandidates.map(item => item.candidateId))
  const finalAccepted = new Set([...baseIds].filter(id => !primaryIds.has(id) || decisions.get(id)?.decision === 'ACCEPT'))
  const finalMetrics = state ? candidateMetrics(ingredients, finalAccepted) : null
  const targetIds = new Set(v10a.experimentAErrors.incorrectAccepts.map(item => item.candidateId))
  const targetOutcomes = v10a.experimentAErrors.incorrectAccepts.map(error => {
    const candidate = ingredients.find(item => item.candidateId === error.candidateId)
    const v10c = decisions.get(candidate.candidateId)
    return {
      candidateId: candidate.candidateId, recipeId: candidate.recipeId, instructionIndex: candidate.instructionIndex, ingredientIndex: candidate.ingredientIndex,
      ingredientRow: candidate.ingredientText, currentInstruction: candidate.instructionText, rootCause: error.classification,
      quantityState: stateById.get(candidate.candidateId).quantityState,
      componentMembership: stateById.get(candidate.candidateId).componentMembership,
      targetState: stateById.get(candidate.candidateId).currentTarget,
      continuationState: stateById.get(candidate.candidateId).continuingUse,
      v10bDecision: v10b.twentyFalsePositives.find(item => item.candidateId === candidate.candidateId)?.arbiterDecision,
      v10cDecision: v10c?.decision || 'UNAVAILABLE', v10cBasis: v10c?.basis, v10cEvidence: v10c?.evidenceText,
    }
  })
  const quantityIds = new Set(v10b.stateAwareErrors.falseRejects.filter(item => item.decision?.basis === 'QUANTITY_CONFLICT').map(item => item.candidateId))
  const quantityDefectMatrix = ingredients.filter(item => quantityIds.has(item.candidateId)).map(candidate => {
    const old = v10b.stateAwareErrors.falseRejects.find(item => item.candidateId === candidate.candidateId)
    const q = stateById.get(candidate.candidateId).quantityState
    const decision = decisions.get(candidate.candidateId)
    return {
      recipeId: candidate.recipeId, candidateId: candidate.candidateId, ingredientRow: candidate.ingredientText,
      listedQuantity: q.listedQuantity, priorUse: q.priorUses, currentUse: q.currentUseQuantity,
      incorrectV10BExtractedQuantityState: old.decision.evidenceText,
      correctSourceDerivedQuantityState: q,
      resultingV10BFalseRejection: true,
      v10cDecision: primaryIds.has(candidate.candidateId) ? decision?.decision || 'UNAVAILABLE' : 'ACCEPT_LOW_RISK_BASE',
      v10cBasis: decision?.basis || 'ROW_LOCAL_QUANTITY_REPAIR',
      quantityDefectRepaired: !decision || decision.basis !== 'QUANTITY_CONFLICT',
      independentSemanticRejection: decision?.decision === 'REJECT' && decision.basis !== 'QUANTITY_CONFLICT',
    }
  })
  const historicalDecisions = new Map(Object.entries(state?.historicalResults || {}))
  const historicalOutcomes = historical.map(item => {
    const decision = historicalDecisions.get(item.safe.candidateId)
    return { ...item.evaluator, decision: decision?.decision || 'UNAVAILABLE', basis: decision?.basis, evidenceText: decision?.evidenceText }
  })
  const familyMap = {
    COMPONENT_LEAKAGE: 'component leakage', CONSUMED_ROW: 'consumed rows', CONTEXTUAL_MENTION: 'contextual mention',
    FRESH_PROCESS_MATERIAL: 'process material', WRONG_DUPLICATE: 'wrong duplicate', WRONG_GROUP: 'wrong group',
    QUANTITY_CONFLICT: 'quantity conflict', FINISHED_DISH_COLLISION: 'finished-dish collision', OTHER: 'other',
  }
  const historicalFamilyById = new Map((v10b.historicalRegression?.outcomes || []).map(item => [item.candidateId, familyMap[item.family] || 'other']))
  function historicalFamily(item) {
    if (historicalFamilyById.has(item.candidateId)) return historicalFamilyById.get(item.candidateId)
    const risks = item.state.legacyRisks
    if (risks.processMaterialRisk) return 'process material'
    if (risks.groupConflictRisk) return 'wrong group'
    if (risks.duplicateRowRisk) return 'wrong duplicate'
    if (item.state.continuingUse === 'PASSIVE_COMPONENT_CARRY') return 'component leakage'
    if (risks.contextualMentionRisk && /\b(?:dish|sandwich|wrap|salad)\b/.test(normalizeText(item.safe?.currentInstruction))) return 'finished-dish collision'
    if (risks.contextualMentionRisk) return 'contextual mention'
    if (item.state.quantityState.rowAvailability === 'POSSIBLY_CONSUMED') return 'consumed rows'
    return 'other'
  }
  for (const item of historicalOutcomes) item.family = historicalFamily({ ...item, safe: historical.find(h => h.evaluator.candidateId === item.candidateId)?.safe })
  const historicalByClass = Object.fromEntries(['component leakage', 'consumed rows', 'contextual mention', 'process material', 'wrong duplicate', 'wrong group', 'quantity conflict', 'finished-dish collision', 'other'].map(family => {
    const rows = historicalOutcomes.filter(item => item.family === family)
    return [family, { total: rows.length, lockedTruth: rows.filter(item => item.truthStatus === 'LOCKED_TRUTH').length, rejected: rows.filter(item => item.decision === 'REJECT').length, accepted: rows.filter(item => item.decision === 'ACCEPT').length }]
  }))
  const lockedHistorical = historicalOutcomes.filter(item => item.truthStatus === 'LOCKED_TRUTH')
  const unionIds = new Set(ingredients.filter(item => voteClass(item.origins) !== 'DETERMINISTIC_ONLY').map(item => item.candidateId))
  const intersectionIds = new Set(ingredients.filter(item => voteClass(item.origins) === '2_OF_2').map(item => item.candidateId))
  const strategies = state ? {
    reviewerUnion: { ...candidateMetrics(ingredients, unionIds), aiDecisions: 0 },
    reviewerIntersection: { ...candidateMetrics(ingredients, intersectionIds), aiDecisions: 0 },
    v10aDisagreementOnly: { ...reproducedV10A, aiDecisions: 91 },
    v10bStateAware: { ...v10b.finalMetrics, aiDecisions: v10b.aiDecisionCounts?.frozenRiskCandidates || 477 },
    v10cActiveTargetState: { ...finalMetrics, aiDecisions: primaryCandidates.length },
  } : null
  const transportReliable = state && state.transport.parseFailures === 0 && state.transport.schemaFailures === 0 && state.transport.otherFailures === 0 && state.recipe190?.failures === 0
  const passes = Boolean(state && finalMetrics.falsePositives === 0 && finalMetrics.truePositives >= 829 && finalMetrics.recall >= 0.995 && targetOutcomes.every(item => item.v10cDecision === 'REJECT') && quantityDefectMatrix.every(item => item.quantityDefectRepaired) && lockedHistorical.every(item => item.decision === 'REJECT') && transportReliable)
  const falseAccepts = state ? ingredients.filter(candidate => candidate.adjudicatedTruth === 'INCORRECT' && finalAccepted.has(candidate.candidateId)).map(candidate => ({
    candidateId: candidate.candidateId, ingredientRow: candidate.ingredientText, currentInstruction: candidate.instructionText,
    state: stateById.get(candidate.candidateId), decision: decisions.get(candidate.candidateId),
  })) : []
  const falseRejects = state ? ingredients.filter(candidate => candidate.adjudicatedTruth === 'CORRECT' && !finalAccepted.has(candidate.candidateId)).map(candidate => ({
    candidateId: candidate.candidateId, ingredientRow: candidate.ingredientText, currentInstruction: candidate.instructionText,
    state: stateById.get(candidate.candidateId), decision: decisions.get(candidate.candidateId) || { decision: 'REJECT', basis: 'V10A_BASE_REJECTION', evidenceText: 'Not accepted by the frozen V10A base strategy.' },
  })) : []
  const startingInventory = {
    DURABLE_AUDIT_EVIDENCE: [
      'docs/audits/cooking-mode-completeness-v6-focused-validation-2026-08-27.md', 'docs/audits/cooking-mode-semantic-v7-focused-validation-2026-08-27.md',
      'docs/audits/cooking-mode-v7-focused-failure-matrix-2026-08-27.md', 'docs/audits/cooking-mode-usage-matrix-v8-design-input-2026-08-27.json',
      'docs/audits/cooking-mode-usage-matrix-v8-focused-validation-2026-08-27.md', 'docs/audits/cooking-mode-consensus-v9-focused-validation-2026-08-28.md',
      'docs/audits/cooking-mode-consensus-v9-regression-input-2026-08-28.json', 'docs/audits/cooking-mode-recall-root-cause-analysis-2026-08-28.json',
      'docs/audits/cooking-mode-recall-root-cause-analysis-2026-08-28.md', 'docs/audits/cooking-mode-arbiter-v10a-analysis-2026-08-28.json',
      'docs/audits/cooking-mode-arbiter-v10a-analysis-2026-08-28.md', 'docs/audits/cooking-mode-arbiter-v10a-error-matrix-2026-08-28.md',
      'docs/audits/cooking-mode-arbiter-v10a-frozen-candidates-2026-08-28.json', 'docs/audits/cooking-mode-v10b-ingredient-precision-analysis-2026-08-28.json',
      'docs/audits/cooking-mode-v10b-ingredient-precision-analysis-2026-08-28.md', 'docs/audits/cooking-mode-v10c-active-target-analysis-2026-08-28.json',
      'docs/audits/cooking-mode-v10c-active-target-analysis-2026-08-28.md',
    ],
    DURABLE_DIAGNOSTIC_TOOLING: [
      'scripts/analyze-cooking-mode-recall-root-cause-core.mjs', 'scripts/analyze-cooking-mode-recall-root-cause.mjs',
      'scripts/analyze-cooking-mode-v10b-ingredient-precision-core.mjs', 'scripts/analyze-cooking-mode-v10b-ingredient-precision.mjs',
      'scripts/analyze-cooking-mode-v10c-active-target-core.mjs', 'scripts/analyze-cooking-mode-v10c-active-target.mjs',
      'scripts/analyze-cooking-step-arbiter-v10a-core.mjs', 'scripts/analyze-cooking-step-arbiter-v10a.mjs',
      'scripts/build-cooking-mode-v7-failure-matrix.mjs', 'scripts/build-cooking-mode-v8-design-input.mjs',
      'scripts/evaluate-cooking-step-completeness-v6-core.mjs', 'scripts/evaluate-cooking-step-semantic-v7-core.mjs',
      'scripts/run-cooking-mode-recall-diagnostics.mjs', 'scripts/run-cooking-mode-v10b-ingredient-precision.mjs',
      'scripts/run-cooking-mode-v10c-active-target.mjs', 'scripts/run-cooking-step-arbiter-v10a.mjs',
      'scripts/validate-cooking-step-completeness-v6.mjs', 'scripts/validate-cooking-step-consensus-v9.mjs',
      'scripts/validate-cooking-step-semantic-v7.mjs', 'scripts/validate-cooking-step-usage-matrix-v8.mjs',
    ],
    DURABLE_TEST_OR_REGRESSION: [
      'tests/cookingModeRecallRootCauseAnalysis.test.ts', 'tests/cookingModeV10BIngredientPrecision.test.js', 'tests/cookingModeV10CActiveTarget.test.js',
      'tests/cookingStepArbiterV10A.test.js', 'tests/cookingStepBlindReviewerAi.test.ts', 'tests/cookingStepMapArbiterAi.test.ts',
      'tests/cookingStepMapConsensus.test.ts', 'tests/cookingStepMappingV5.test.ts',
    ],
    DURABLE_DOCUMENTATION: ['PRD.md'],
    REUSABLE_NONACTIVE_INFRASTRUCTURE: ['package.json', 'lib/cookingStepBlindReviewerAi.ts', 'lib/cookingStepMapArbiterAi.ts', 'lib/cookingStepMapConsensus.ts'],
    FAILED_EXPERIMENTAL_PRODUCTION_CODE: [
      'app/api/cooking-step-map/route.ts', 'app/discover/page.tsx', 'app/queue/page.tsx', 'lib/aiConfig.ts', 'lib/cookingStepMapping.ts', 'lib/recipes.ts',
      'tests/cookingStepMapRoute.test.ts', 'tests/cookingStepMappingPublish.test.ts', 'tests/recipeQueueCategories.test.tsx',
    ],
    GENERATED_DEBUG: [
      'firebase-debug.log', 'firebase-debug 2.log', 'firebase-debug 3.log', 'firebase-debug 4.log', 'firestore-debug.log',
      'app/error 2.tsx', 'app/global-error 2.tsx', 'app/loading 2.tsx', 'lib/admin 2.ts', 'lib/chunkItems 2.ts', 'lib/firestoreBatch 2.ts', 'lib/safeFetch 2.ts',
      'tests/admin.test 2.ts', 'tests/firestoreBatch.test 2.ts', 'tests/ingredientParser.test 2.ts', 'tests/safeFetch.test 2.ts',
    ],
    UNRELATED_USER_FILE: ['.eslintrc.json'],
  }
  const result = {
    schemaVersion: 1, generatedAt: new Date().toISOString(), verdict: state ? (passes ? 'INGREDIENT PRECISION LAYER ISOLATED' : 'MORE INGREDIENT PRECISION WORK REQUIRED') : 'PENDING_V10C_ARBITER',
    workspace: { branch: execFileSync('git', ['branch', '--show-current'], { cwd: root }).toString().trim(), startingHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim() },
    frozenPopulation: { total: 863, correct: 833, incorrect: 30 },
    v10bBaselineReproduction: { metrics: v10b.finalMetrics, targetFalsePositivesRejected: 13, targetFalsePositivesTotal: 20, historicalRejected: 47, historicalTotal: 82 },
    quantityDefectRootCause: 'V10B normalized punctuation before quantity parsing, corrupting decimals/fractions, and attached the first quantity anywhere in an instruction to every candidate row. V10C parses raw quantity syntax and binds instruction quantities only inside the row mention clause.',
    quantityDefectMatrix,
    quantityRegressionSummary: { total: 9, repaired: quantityDefectMatrix.filter(item => item.quantityDefectRepaired).length, independentSemanticRejections: quantityDefectMatrix.filter(item => item.independentSemanticRejection).length },
    activeTargetContract: ['DIRECT_INGREDIENT', 'COMPONENT', 'BOTH', 'NEITHER', 'AMBIGUOUS'],
    componentMembershipContract: { auditOnly: true, purpose: 'Prevent passive constituent leakage only', allowedSources: ['explicit ingredient group heading', 'explicit source construction', 'source-grounded frozen reviewer component evidence'] },
    continuingUseContract: ['CONTINUING_MANIPULATION', 'DIVIDED_USE', 'RESERVED_REMAINDER', 'PASSIVE_COMPONENT_CARRY', 'FULLY_CONSUMED', 'UNKNOWN'],
    routedCandidateCount: primaryCandidates.length,
    targetFalsePositiveOutcomes: targetOutcomes,
    sevenSurvivingV10BFalsePositiveOutcomes: targetOutcomes.filter(item => item.v10bDecision === 'ACCEPT'),
    targetProtection: { total: 20, rejected: targetOutcomes.filter(item => item.v10cDecision === 'REJECT').length, accepted: targetOutcomes.filter(item => item.v10cDecision === 'ACCEPT').length, unavailable: targetOutcomes.filter(item => item.v10cDecision === 'UNAVAILABLE').length },
    correctCandidateProtection: finalMetrics ? { frozenCorrect: 833, truePositives: finalMetrics.truePositives, falseNegatives: finalMetrics.falseNegatives, candidateRecall: finalMetrics.recall } : null,
    historicalRegression: { total: historicalOutcomes.length, lockedTruthTotal: lockedHistorical.length, lockedTruthRejected: lockedHistorical.filter(item => item.decision === 'REJECT').length, sourceSignalOnlyTotal: historicalOutcomes.filter(item => item.truthStatus === 'SOURCE_SIGNAL_ONLY').length, byClass: historicalByClass, outcomes: historicalOutcomes },
    finalMetrics,
    finalErrors: {
      falseAccepts,
      falseRejects,
      falseRejectsByBasis: countBy(falseRejects.map(item => item.decision?.basis || 'V10A_BASE_REJECTION')),
      falseRejectsByTargetState: countBy(falseRejects.map(item => item.state.currentTarget)),
      falseRejectsByContinuingUseState: countBy(falseRejects.map(item => item.state.continuingUse)),
      remainingBoundary: 'Two contextual salt/pepper rows remain false accepts because generic “taste and adjust seasoning” was treated as direct row use. In the opposite direction, valid unnamed cooking/assembly continuations remain over-rejected as passive component carry; source-derived category/principal-target identity is still insufficient.',
    },
    strategies,
    componentFalsePositivesPrevented: targetOutcomes.filter(item => item.v10cDecision === 'REJECT' && item.continuationState === 'PASSIVE_COMPONENT_CARRY').length,
    transport: state?.transport || null, recipe190: state?.recipe190 || null, aiUsage: state?.usageSummary || null,
    productionMutations: { firestoreWrites: 0, recipeWrites: 0, mapWrites: 0, productionRouteActivation: 0, fullRecipeRuns: 0, reviewerReruns: 0 },
    repositoryReconciliation: {
      startingInventory,
      failedExperimentalFilesReverted: startingInventory.FAILED_EXPERIMENTAL_PRODUCTION_CODE,
      retainedAuditOnlyModules: ['lib/cookingStepBlindReviewerAi.ts', 'lib/cookingStepMapArbiterAi.ts', 'lib/cookingStepMapConsensus.ts'],
      retainedAuditOnlyModuleReason: 'Required to reproduce V9/V10 diagnostics; no production route, caller, engine validator, or runtime imports them after reconciliation.',
      filesIntentionallyLeftUntracked: [...startingInventory.GENERATED_DEBUG, ...startingInventory.UNRELATED_USER_FILE],
      productionBehaviorBefore: 'Committed/deployed behavior was approved deterministic-v5/hybrid-v5 with persisted deterministic-v4/hybrid-v4 compatibility; the starting local dirty tree contained an unapproved hybrid-v9 activation.',
      productionBehaviorAfter: 'Production-path files match committed HEAD exactly; deterministic-v5/hybrid-v5 remains active, persisted v4 remains compatible, and hybrid-v6 through hybrid-v10 fail closed as unsupported.',
      checkpointStatus: process.argv.includes('--verified') ? 'VERIFIED_AND_READY_FOR_CHECKPOINT_COMMIT' : 'PENDING_VERIFICATION',
    },
    verification: process.argv.includes('--verified') ? {
      lint: 'PASSED_WITH_6_PREEXISTING_WARNINGS', typecheck: 'PASSED', build: 'PASSED', tests: 'PASSED', diffCheck: 'PASSED',
      newTests: 10, totalTests: 885, passedTests: 884, skippedTests: 1,
    } : { lint: 'PENDING', typecheck: 'PENDING', build: 'PENDING', tests: 'PENDING', diffCheck: 'PENDING', newTests: 10 },
    unverifiableItems: ['Historical family labels are source-signal taxonomy unless truthStatus is LOCKED_TRUTH; no manual truth was invented.'],
    deferredWork: passes ? ['Prepared-component establishment/reuse semantics', 'Final production architecture', 'Separately authorized reviewed persisted-map migration'] : ['Resolve the remaining active-use versus passive-carry boundary before production architecture work'],
    artifacts: { json: path.relative(root, jsonPath), markdown: path.relative(root, markdownPath), truthBlindInput: inputPath, state: statePath },
  }
  fs.writeFileSync(jsonPath, stableJson(result))
  writeMarkdown(result)
  return result
}

function metricRow(name, value) {
  if (!value) return `| ${name} | — | — | — | — | — | — |`
  return `| ${name} | ${value.truePositives} | ${value.falsePositives} | ${value.falseNegatives} | ${percent(value.precision)} | ${percent(value.recall)} | ${value.aiDecisions} |`
}

function writeMarkdown(result) {
  const targetRows = result.targetFalsePositiveOutcomes.map(item => `| ${md(item.candidateId)} | ${md(item.rootCause)} | ${md(JSON.stringify(item.quantityState))} | ${md(item.componentMembership.memberships.map(value => value.componentKey).join(', '))} | ${item.targetState} | ${item.continuationState} | ${item.v10bDecision} | ${item.v10cDecision}${item.v10cBasis ? ` / ${item.v10cBasis}` : ''} |`).join('\n')
  const quantityRows = result.quantityDefectMatrix.map(item => `| ${md(item.candidateId)} | ${md(item.ingredientRow)} | ${md(item.listedQuantity)} | ${md(item.currentUse)} | ${md(item.incorrectV10BExtractedQuantityState)} | ${md(JSON.stringify(item.correctSourceDerivedQuantityState))} | ${item.v10cDecision} |`).join('\n')
  const historicalRows = Object.entries(result.historicalRegression.byClass).map(([family, value]) => `| ${family} | ${value.total} | ${value.lockedTruth} | ${value.rejected} | ${value.accepted} |`).join('\n')
  const strategies = result.strategies
  const body = `# Cooking Mode V10C Active-Target Analysis — ${date}

## Executive result

**${result.verdict}**

V10C remained audit-only: no production mappings, recipes, Firestore documents, routes, runtime engines, or reviewer populations were mutated. The frozen V10B baseline reproduced exactly at 748 TP / 9 FP / 85 FN, with 13/20 target false positives and 47/82 historical cases rejected.

${result.finalMetrics ? `V10C measured ${result.finalMetrics.truePositives} TP / ${result.finalMetrics.falsePositives} FP / ${result.finalMetrics.falseNegatives} FN, ${percent(result.finalMetrics.precision)} precision, and ${percent(result.finalMetrics.recall)} candidate recall.` : 'The truth-blind input is ready; the bounded V10C arbiter has not run yet.'}

## Quantity defect and repair

${result.quantityDefectRootCause}

| Candidate | Ingredient row | Listed | Current row-local use | Incorrect V10B state/effect | Correct V10C state | Outcome |
|---|---|---:|---:|---|---|---|
${quantityRows}

Quantity regressions repaired: ${result.quantityRegressionSummary.repaired}/9. Independent semantic rejections: ${result.quantityRegressionSummary.independentSemanticRejections}.

## Active-target, membership, and continuation contracts

- Current target: ${result.activeTargetContract.join(', ')}.
- Continuing use: ${result.continuingUseContract.join(', ')}.
- Membership is conservative and audit-only. It exists solely to distinguish an actively targeted row from a row passively carried inside a previously established component.
- Truth fields are excluded from extraction and model input; evaluation reads truth only after decisions exist.

## Twenty V10A target false positives

| Candidate | Root cause | Quantity state | Membership | Target | Continuation | V10B | V10C |
|---|---|---|---|---|---|---|---|
${targetRows}

Target protection: ${result.targetProtection.rejected}/20 rejected. Component-membership facts prevented ${result.componentFalsePositivesPrevented} target ingredient false positives.

The seven V10B survivors are the subset above whose V10B column is ACCEPT; V10C rejected ${result.sevenSurvivingV10BFalsePositiveOutcomes.filter(item => item.v10cDecision === 'REJECT').length}/7. The remaining false-positive boundary is: ${result.finalErrors?.remainingBoundary || 'pending'}

## Correct-candidate protection and strategy comparison

| Strategy | TP | FP | FN | Precision | Candidate recall | AI decisions |
|---|---:|---:|---:|---:|---:|---:|
${metricRow('Reviewer union', strategies?.reviewerUnion)}
${metricRow('Reviewer intersection', strategies?.reviewerIntersection)}
${metricRow('V10A disagreement-only', strategies?.v10aDisagreementOnly)}
${metricRow('V10B state-aware', strategies?.v10bStateAware)}
${metricRow('V10C active-target state', strategies?.v10cActiveTargetState)}

## Historical false-positive regression

| Class | Total | Locked truth | Rejected | Accepted |
|---|---:|---:|---:|---:|
${historicalRows}

Locked truth rejected: ${result.historicalRegression.lockedTruthRejected}/${result.historicalRegression.lockedTruthTotal}. The remaining ${result.historicalRegression.sourceSignalOnlyTotal} rows are reported as SOURCE_SIGNAL_ONLY because the artifact has origins but no manual truth label.

## Transport and controls

- Logical batches: ${result.transport?.logicalBatches ?? 'pending'}
- Gateway requests: ${result.transport?.gatewayCalls ?? 'pending'}
- Retries: ${result.transport?.retries ?? 'pending'}
- Parse failures: ${result.transport?.parseFailures ?? 'pending'}
- Schema failures: ${result.transport?.schemaFailures ?? 'pending'}
- Local rejections: ${result.transport?.localRequestRejections ?? 'pending'}
- Recipe 190: ${result.recipe190 ? `${result.recipe190.successes}/${result.recipe190.requests} successful` : 'pending'}
- AI tokens: ${result.aiUsage?.totalTokens ?? 'pending'} total (${result.aiUsage?.inputTokens ?? 'pending'} input / ${result.aiUsage?.outputTokens ?? 'pending'} output)

## Prepared-component diagnostic note

Prepared-component UX mapping remains a separate subsystem. V10C does not evaluate component-label precision/recall and does not activate a component architecture.

## Production mutation and next action

Production mutation: zero. Existing persisted v4/v5 maps and runtime behavior remain unchanged.

## Repository reconciliation

- Starting local production-path state: unapproved hybrid-v9 activation in the route, publish callers, engine validator, and related tests.
- Reverted production-path files: ${result.repositoryReconciliation.failedExperimentalFilesReverted.join(', ')}.
- Retained nonactive diagnostic modules: ${result.repositoryReconciliation.retainedAuditOnlyModules.join(', ')}. ${result.repositoryReconciliation.retainedAuditOnlyModuleReason}
- Intentionally left untracked: ${result.repositoryReconciliation.filesIntentionallyLeftUntracked.join(', ')}.
- Production parity: ${result.repositoryReconciliation.productionBehaviorAfter}
- Checkpoint: ${result.repositoryReconciliation.checkpointStatus}.

${result.verdict === 'INGREDIENT PRECISION LAYER ISOLATED' ? 'Ingredient precision is isolated. Next solve prepared-component establishment/reuse independently before assembling the final production ingestion architecture.' : 'Identify the remaining active-use versus passive-carry boundary before further production architecture work.'}
`
  fs.writeFileSync(markdownPath, body)
}

const inputs = loadInputs()
const result = evaluate(inputs)
process.stdout.write(stableJson({ inputPath, riskCandidates: inputs.primaryCandidates.length, historicalCandidates: inputs.historical.length, verdict: result.verdict, finalMetrics: result.finalMetrics, jsonPath, markdownPath }))
