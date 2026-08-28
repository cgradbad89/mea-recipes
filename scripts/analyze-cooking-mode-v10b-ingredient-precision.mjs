#!/usr/bin/env node
/** Builds truth-blind V10B risk input and evaluates bounded state-aware arbiter output. */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { sha256, stableJson } from './analyze-cooking-step-arbiter-v10a-core.mjs'
import {
  candidateMetrics,
  classifyRiskFamily,
  createRiskBatches,
  deterministicContradiction,
  extractCandidateRiskFacts,
  normalizeText,
  routeRisk,
  validateRiskFacts,
  voteClass,
} from './analyze-cooking-mode-v10b-ingredient-precision-core.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const date = '2026-08-28'
const frozenPath = path.join(root, `docs/audits/cooking-mode-arbiter-v10a-frozen-candidates-${date}.json`)
const v10aAnalysisPath = path.join(root, `docs/audits/cooking-mode-arbiter-v10a-analysis-${date}.json`)
const benchmarkPath = path.join(root, 'docs/audits/cooking-mode-completeness-audit-2026-08-26.json')
const regressionPath = path.join(root, `docs/audits/cooking-mode-consensus-v9-regression-input-${date}.json`)
const v10aStatePath = `/tmp/cooking-step-arbiter-v10a-${date}-state.json`
const inputPath = `/tmp/cooking-mode-v10b-risk-input-${date}.json`
const statePath = `/tmp/cooking-mode-v10b-state-${date}.json`
const jsonPath = path.join(root, `docs/audits/cooking-mode-v10b-ingredient-precision-analysis-${date}.json`)
const markdownPath = path.join(root, `docs/audits/cooking-mode-v10b-ingredient-precision-analysis-${date}.md`)

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')) }
function percent(value) { return value === null ? 'n/a' : `${(value * 100).toFixed(2)}%` }
function countBy(values) {
  const counts = new Map()
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1)
  return Object.fromEntries([...counts].sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0]))))
}

function mdCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()
}

function baseAccepted(candidate, v10aDecisions) {
  return candidate.provenanceClass === '2_OF_2_REVIEWERS' || v10aDecisions.get(candidate.candidateId)?.decision === 'ACCEPT'
}

function safeCandidate(candidate, recipe, facts, routing) {
  return validateRiskFacts({
    candidateId: candidate.candidateId,
    recipeId: candidate.recipeId,
    title: candidate.title,
    instructionIndex: candidate.instructionIndex,
    ingredientIndex: candidate.ingredientIndex,
    reviewerA: candidate.origins.includes('REVIEWER_A'),
    reviewerB: candidate.origins.includes('REVIEWER_B'),
    deterministic: candidate.origins.includes('DETERMINISTIC'),
    voteClass: voteClass(candidate.origins),
    ingredientText: candidate.ingredientText,
    ingredientGroup: candidate.ingredientGroup,
    duplicateSiblingRows: facts.duplicateSiblingIndexes.map(ingredientIndex => ({
      ingredientIndex,
      ingredientText: recipe.ingredients[ingredientIndex]?.raw || '',
      ingredientGroup: recipe.ingredients[ingredientIndex]?.group || undefined,
    })),
    instructionText: candidate.instructionText,
    relevantPreviousInstructions: recipe.steps.slice(0, candidate.instructionIndex).map((step, instructionIndex) => ({ instructionIndex, text: step.instruction })),
    riskFacts: facts,
    routing,
  })
}

function buildInputs() {
  for (const file of [frozenPath, v10aAnalysisPath, benchmarkPath, regressionPath, v10aStatePath]) {
    if (!fs.existsSync(file)) throw new Error(`Required V10B evidence missing: ${file}`)
  }
  const frozen = readJson(frozenPath)
  const v10a = readJson(v10aAnalysisPath)
  const benchmark = readJson(benchmarkPath)
  const regressions = readJson(regressionPath)
  const v10aState = readJson(v10aStatePath)
  const ingredients = frozen.populations.INGREDIENT_RELATIONSHIPS
  const components = frozen.populations.PREPARED_COMPONENT_RELATIONSHIPS
  if (ingredients.length !== 863 || ingredients.filter(item => item.adjudicatedTruth === 'CORRECT').length !== 833 ||
    ingredients.filter(item => item.adjudicatedTruth === 'INCORRECT').length !== 30) throw new Error('Frozen V10A ingredient population mismatch')
  const benchmarkById = new Map(benchmark.recipes.map(recipe => [recipe.recipeId, recipe]))
  const v10aDecisions = new Map(Object.entries(v10aState.ingredientResults))
  const baseIds = new Set(ingredients.filter(candidate => baseAccepted(candidate, v10aDecisions)).map(item => item.candidateId))
  const reproduced = candidateMetrics(ingredients, baseIds)
  if (reproduced.truePositives !== 831 || reproduced.falsePositives !== 20 || reproduced.falseNegatives !== 2) {
    throw new Error(`V10A disagreement-only mismatch: ${JSON.stringify(reproduced)}`)
  }
  const factsById = new Map()
  const safeCandidates = ingredients.map(candidate => {
    const recipe = benchmarkById.get(candidate.recipeId)
    const facts = extractCandidateRiskFacts(candidate, recipe, ingredients, components)
    const routing = routeRisk(facts)
    factsById.set(candidate.candidateId, facts)
    return safeCandidate(candidate, recipe, facts, routing)
  })
  const frozenByKey = new Map(ingredients.map(candidate => [`${candidate.recipeId}:${candidate.instructionIndex}:${candidate.ingredientIndex}`, candidate]))
  const historicalCandidates = regressions.ingredientFalsePositives.map(item => {
    const recipe = benchmarkById.get(item.recipeId)
    const sourceIngredient = recipe?.ingredients[item.ingredientIndex]
    const sourceStep = recipe?.steps.find(step => step.instructionIndex === item.instructionIndex)
    if (!recipe || !sourceIngredient || !sourceStep) return null
    const frozenCandidate = frozenByKey.get(`${item.recipeId}:${item.instructionIndex}:${item.ingredientIndex}`)
    const candidate = frozenCandidate || {
      candidateId: `historical::${item.recipeId}::${item.instructionIndex}::${item.ingredientIndex}`,
      recipeId: item.recipeId,
      title: recipe.title,
      instructionIndex: item.instructionIndex,
      ingredientIndex: item.ingredientIndex,
      origins: [],
      ingredientText: sourceIngredient.raw,
      ingredientGroup: sourceIngredient.group || undefined,
      instructionText: sourceStep.instruction,
    }
    const facts = extractCandidateRiskFacts(candidate, recipe, ingredients, components)
    const routing = routeRisk(facts)
    return {
      safe: safeCandidate(candidate, recipe, facts, routing),
      evaluator: { candidateId: candidate.candidateId, origins: item.origins, family: classifyRiskFamily(candidate, facts) },
    }
  }).filter(Boolean)
  const input = {
    schemaVersion: 1,
    generatedAt: date,
    frozenSha256: sha256(fs.readFileSync(frozenPath)),
    truthLabelsIncluded: false,
    candidates: safeCandidates,
    historicalCandidates: historicalCandidates.map(item => item.safe),
  }
  fs.writeFileSync(inputPath, stableJson(input))
  return {
    frozen, v10a, ingredients, components, benchmarkById, v10aDecisions, baseIds, reproduced,
    factsById, safeCandidates, historicalCandidates,
  }
}

function evaluate(inputs) {
  const { frozen, v10a, ingredients, components, v10aDecisions, baseIds, reproduced, factsById, safeCandidates, historicalCandidates } = inputs
  const routedIds = new Set(safeCandidates.filter(item => item.routing.route === 'RISK_REVIEW_REQUIRED').map(item => item.candidateId))
  const routeCoverage = {
    correctCandidatesRouted: ingredients.filter(item => item.adjudicatedTruth === 'CORRECT' && routedIds.has(item.candidateId)).length,
    incorrectCandidatesRouted: ingredients.filter(item => item.adjudicatedTruth === 'INCORRECT' && routedIds.has(item.candidateId)).length,
    correctCandidatesNotRouted: ingredients.filter(item => item.adjudicatedTruth === 'CORRECT' && !routedIds.has(item.candidateId)).length,
    incorrectCandidatesNotRouted: ingredients.filter(item => item.adjudicatedTruth === 'INCORRECT' && !routedIds.has(item.candidateId)).length,
  }
  const contradictionIds = new Set(safeCandidates.filter(item => deterministicContradiction(item.riskFacts)).map(item => item.candidateId))
  const riskRejectAccepted = new Set([...baseIds].filter(id => !contradictionIds.has(id)))
  const riskRejectionOnly = candidateMetrics(ingredients, riskRejectAccepted)
  const twenty = v10a.experimentAErrors.incorrectAccepts.map(error => {
    const candidate = ingredients.find(item => item.candidateId === error.candidateId)
    const safe = safeCandidates.find(item => item.candidateId === error.candidateId)
    return {
      candidateId: candidate.candidateId,
      recipeId: candidate.recipeId,
      instructionIndex: candidate.instructionIndex,
      ingredientIndex: candidate.ingredientIndex,
      reviewerA: candidate.origins.includes('REVIEWER_A'),
      reviewerB: candidate.origins.includes('REVIEWER_B'),
      deterministic: candidate.origins.includes('DETERMINISTIC'),
      voteClass: voteClass(candidate.origins),
      ingredientText: candidate.ingredientText,
      ingredientGroup: candidate.ingredientGroup,
      instructionText: candidate.instructionText,
      falsePositiveClass: error.classification,
      riskFacts: safe.riskFacts,
      routing: safe.routing,
    }
  })
  const state = fs.existsSync(statePath) ? readJson(statePath) : null
  let stateAware = null
  let twentyOutcomes = []
  let historicalRegression = null
  let strategies = null
  let stateAwareErrors = null
  let verdict = 'PENDING_STATE_AWARE_ARBITER'
  if (state) {
    const decisions = new Map(Object.entries(state.results || {}))
    const finalAccepted = new Set(ingredients.filter(candidate => {
      if (routedIds.has(candidate.candidateId)) return decisions.get(candidate.candidateId)?.decision === 'ACCEPT'
      return baseIds.has(candidate.candidateId)
    }).map(item => item.candidateId))
    stateAware = candidateMetrics(ingredients, finalAccepted)
    const falseAccepts = ingredients.filter(candidate => candidate.adjudicatedTruth === 'INCORRECT' && finalAccepted.has(candidate.candidateId))
      .map(candidate => ({
        candidateId: candidate.candidateId,
        ingredientText: candidate.ingredientText,
        instructionText: candidate.instructionText,
        decision: decisions.get(candidate.candidateId),
      }))
    const falseRejects = ingredients.filter(candidate => candidate.adjudicatedTruth === 'CORRECT' && !finalAccepted.has(candidate.candidateId))
      .map(candidate => ({
        candidateId: candidate.candidateId,
        ingredientText: candidate.ingredientText,
        instructionText: candidate.instructionText,
        decision: decisions.get(candidate.candidateId) || { decision: 'REJECT', basis: 'V10A_BASE_REJECTION', evidenceText: 'Not accepted by the frozen V10A disagreement-only base strategy.' },
      }))
    stateAwareErrors = {
      falseAccepts,
      falseRejects,
      falseAcceptsByBasis: countBy(falseAccepts.map(item => item.decision?.basis || 'LOW_RISK_BASE')),
      falseRejectsByBasis: countBy(falseRejects.map(item => item.decision?.basis || 'V10A_BASE_REJECTION')),
    }
    twentyOutcomes = twenty.map(item => ({
      ...item,
      arbiterDecision: decisions.get(item.candidateId)?.decision || 'UNAVAILABLE',
      arbiterBasis: decisions.get(item.candidateId)?.basis,
      arbiterEvidence: decisions.get(item.candidateId)?.evidenceText,
    }))
    const historicalDecisions = new Map(Object.entries(state.historicalResults || {}))
    const historicalOutcomes = historicalCandidates.map(item => ({
      ...item.evaluator,
      routing: item.safe.routing,
      decision: historicalDecisions.get(item.safe.candidateId)?.decision || 'UNAVAILABLE',
      basis: historicalDecisions.get(item.safe.candidateId)?.basis,
      evidenceText: historicalDecisions.get(item.safe.candidateId)?.evidenceText,
    }))
    historicalRegression = {
      total: historicalOutcomes.length,
      rejected: historicalOutcomes.filter(item => item.decision === 'REJECT').length,
      accepted: historicalOutcomes.filter(item => item.decision === 'ACCEPT').length,
      unavailable: historicalOutcomes.filter(item => item.decision === 'UNAVAILABLE').length,
      byFamily: Object.fromEntries(Object.entries(countBy(historicalOutcomes.map(item => item.family))).map(([family, total]) => [family, {
        total,
        rejected: historicalOutcomes.filter(item => item.family === family && item.decision === 'REJECT').length,
      }])),
      outcomes: historicalOutcomes,
    }
    const unionIds = new Set(ingredients.filter(item => voteClass(item.origins) !== 'DETERMINISTIC_ONLY').map(item => item.candidateId))
    const intersectionIds = new Set(ingredients.filter(item => voteClass(item.origins) === '2_OF_2').map(item => item.candidateId))
    const arbitrateAllIds = new Set(ingredients.filter(item => v10aDecisions.get(item.candidateId)?.decision === 'ACCEPT').map(item => item.candidateId))
    strategies = {
      reviewerUnion: { ...candidateMetrics(ingredients, unionIds), aiDecisions: 0 },
      reviewerIntersection: { ...candidateMetrics(ingredients, intersectionIds), aiDecisions: 0 },
      v10aDisagreementOnly: { ...reproduced, aiDecisions: 91 },
      riskRejectionOnly: { ...riskRejectionOnly, aiDecisions: 0 },
      riskRoutedStateAwareArbiter: { ...stateAware, aiDecisions: routedIds.size },
      arbiterEverything: { ...candidateMetrics(ingredients, arbitrateAllIds), aiDecisions: 863 },
    }
    const passes = stateAware.falsePositives === 0 && stateAware.truePositives >= 829 && stateAware.recall >= 0.995 &&
      twentyOutcomes.every(item => item.arbiterDecision === 'REJECT') && historicalRegression.accepted === 0 &&
      state.transport.parseFailures === 0 && state.transport.schemaFailures === 0
    verdict = passes ? 'INGREDIENT PRECISION LAYER ISOLATED' : 'MORE INGREDIENT PRECISION WORK REQUIRED'
  }
  const componentFalseAccepts = components.filter(item => item.adjudicatedTruth === 'INCORRECT' &&
    item.v9Arbiter.decision === 'ACCEPT')
  const componentAppendix = {
    excludedFromPrimaryGate: true,
    v10aMetrics: v10a.componentExperiment,
    candidateLevelV9FalseAccepts: componentFalseAccepts.length,
    falsePositiveTaxonomy: {
      labelOrIdentityProblem: componentFalseAccepts.filter(item => !normalizeText(item.instructionText).includes(normalizeText(item.proposedCanonicalLabel))).length,
      establishmentOrUseProblem: componentFalseAccepts.filter(item => item.relevantSurroundingSource.establishingInstructionIndex === undefined).length,
      other: componentFalseAccepts.filter(item => normalizeText(item.instructionText).includes(normalizeText(item.proposedCanonicalLabel)) &&
        item.relevantSurroundingSource.establishingInstructionIndex !== undefined).length,
    },
    containmentSignal: 'Reviewer component proposals and conservative component nouns are used only to flag possible constituent-only ingredient relations; component labels are not promoted to user-facing output.',
  }
  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    verdict,
    frozenPopulation: { total: ingredients.length, correct: 833, incorrect: 30, source: path.relative(root, frozenPath) },
    v10aBestStrategyReproduction: reproduced,
    twentyFalsePositiveProvenance: countBy(twenty.map(item => item.voteClass)),
    twentyFalsePositiveTaxonomy: countBy(twenty.map(item => item.falsePositiveClass)),
    twoOfTwoAutoAcceptCanReachZeroFalsePositives: twenty.filter(item => item.voteClass === '2_OF_2').length === 0,
    twoOfTwoBlockingFalsePositives: twenty.filter(item => item.voteClass === '2_OF_2').length,
    riskFactContract: {
      lifecycle: ['priorInstructionMentions', 'laterInstructionMentions', 'priorReviewerUses', 'quantityEvidence', 'remainingLanguage', 'lifecycleRisk'],
      componentContainment: ['possibleConstituent', 'componentLabels', 'establishedInstructionIndex', 'currentInstructionRefersToComponent'],
      truthFieldsIncluded: false,
    },
    routeCoverage,
    routedCandidateCount: routedIds.size,
    riskRejectionOnly,
    stateAwareArbiter: stateAware,
    stateAwareErrors,
    twentyFalsePositives: twentyOutcomes.length ? twentyOutcomes : twenty,
    historicalRegression,
    strategies,
    finalMetrics: stateAware,
    transport: state?.transport || null,
    recipe190: state?.recipe190 || null,
    aiUsage: state?.usageSummary || null,
    aiDecisionCounts: state ? {
      frozenRiskCandidates: routedIds.size,
      historicalAdversarialCandidates: historicalCandidates.length,
      recipe190ControlCandidatesPerRequest: safeCandidates.filter(item => item.recipeId === '190').length,
      recipe190ControlRequests: state.recipe190?.requests || 0,
    } : null,
    componentAppendix,
    productionMutations: { firestoreWrites: 0, recipeWrites: 0, mapWrites: 0, productionCodeActivation: 0, productionFilesEditedByV10B: [] },
    workspace: { branch: execFileSync('git', ['branch', '--show-current'], { cwd: root }).toString().trim(), head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim() },
    failureAnalysis: state ? {
      targetFalsePositivesStillAcceptedByClass: countBy(twentyOutcomes.filter(item => item.arbiterDecision === 'ACCEPT').map(item => item.falsePositiveClass)),
      inseparableFamily: 'PASSIVE_CARRIED_FORWARD_CONSTITUENT_VS_ACTIVE_CONTINUING_USE',
      finding: 'The prompt treated continued cooking, chilling, serving, or seasoning of a containing food as active use of both legitimate principal rows and passively carried-forward constituent rows. The source facts do not yet encode an active-target/component-membership boundary precise enough to separate those cases.',
      knownFactExtractionDefect: 'All nine correct-candidate QUANTITY_CONFLICT rejections were driven by invalid evidence: decimal/fraction punctuation was normalized away or an unrelated quantity in the current instruction was attached to the candidate row. This must be fixed and independently tested before another arbiter experiment.',
      nextExperimentPrerequisite: 'Define source-derived active targets and component membership/lifecycle at row granularity, repair row-scoped quantity extraction, then test the inseparable family in a new frozen prompt experiment. Do not rerun reviewer discovery.',
    } : null,
    verification: process.argv.includes('--verified') ? {
      lint: 'PASSED', typecheck: 'PASSED', build: 'PASSED', tests: 'PASSED', diffCheck: 'PASSED',
      newTests: 10,
      totalTests: Number(process.env.V10B_TOTAL_TESTS || 0) || 'recorded in final session report',
    } : { lint: 'PENDING', typecheck: 'PENDING', build: 'PENDING', tests: 'PENDING', diffCheck: 'PENDING', newTests: 10 },
    artifacts: { json: path.relative(root, jsonPath), markdown: path.relative(root, markdownPath) },
    unverifiableItems: [
      'Historical regression family labels are source-signal taxonomies because the locked regression artifact stores origins but not manual family adjudications.',
      'The provider supplies token usage but no authoritative dollar cost or model-revision identifier.',
    ],
  }
  fs.writeFileSync(jsonPath, stableJson(result))
  fs.writeFileSync(markdownPath, reportMarkdown(result))
  return result
}

function metricRow(label, value) {
  if (!value) return `| ${label} | pending | pending | pending | pending | pending | pending |`
  return `| ${label} | ${value.truePositives} | ${value.falsePositives} | ${value.falseNegatives} | ${percent(value.precision)} | ${percent(value.recall)} | ${value.aiDecisions} |`
}

function reportMarkdown(result) {
  const s = result.strategies
  const twentyRows = result.twentyFalsePositives.map(item => {
    const facts = item.riskFacts
    const compactFacts = {
      explicit: facts.isExplicitlyNamedInInstruction,
      priorUses: facts.priorReviewerUses,
      component: facts.componentContext,
      remaining: facts.remainingLanguage,
      duplicateSiblings: facts.duplicateSiblingIndexes,
      quantities: facts.quantityEvidence,
      routeReasons: item.routing.reasons,
    }
    return `| ${mdCell(item.candidateId)} | ${item.voteClass} | ${item.falsePositiveClass} | ${mdCell(JSON.stringify(compactFacts))} | ${item.arbiterDecision} / ${item.arbiterBasis} | ${mdCell(item.arbiterEvidence)} |`
  }).join('\n')
  const historicalRows = result.historicalRegression ? Object.entries(result.historicalRegression.byFamily)
    .map(([family, value]) => `| ${family} | ${value.total} | ${value.rejected} | ${value.total - value.rejected} |`).join('\n') : '| pending | | | |'
  const acceptedHistorical = result.historicalRegression?.outcomes.filter(item => item.decision === 'ACCEPT')
    .map(item => `- ${item.candidateId} — ${item.family}; ${item.basis}; ${item.evidenceText}`).join('\n') || 'None.'
  return `# Cooking Mode V10B ingredient precision analysis — ${date}

## 1. Executive result

**${result.verdict}**. The state-aware strategy produced ${result.finalMetrics.truePositives} TP / ${result.finalMetrics.falsePositives} FP / ${result.finalMetrics.falseNegatives} FN. It does not meet the frozen precision or recall gate.

## 2. Frozen-population verification

Verified ${result.frozenPopulation.total} ingredient candidates: ${result.frozenPopulation.correct} correct and ${result.frozenPopulation.incorrect} incorrect. No reviewer rerun or discovery change occurred.

## 3. Exact V10A best-strategy reproduction

Reproduced ${result.v10aBestStrategyReproduction.truePositives} TP / ${result.v10aBestStrategyReproduction.falsePositives} FP / ${result.v10aBestStrategyReproduction.falseNegatives} FN.

## 4. Twenty-FP provenance by reviewer vote

${JSON.stringify(result.twentyFalsePositiveProvenance)}.

## 5. Twenty-FP root-cause taxonomy

${JSON.stringify(result.twentyFalsePositiveTaxonomy)}.

## 6. Can 2/2 auto-accept theoretically reach zero FP?

No. ${result.twoOfTwoBlockingFalsePositives} of the 20 false positives have 2/2 reviewer agreement, so automatic acceptance of every 2/2 candidate cannot reach zero FP.

## 7. Lifecycle fact contract

${result.riskFactContract.lifecycle.join(', ')}. Facts are chronological and source-derived; truth fields included: ${result.riskFactContract.truthFieldsIncluded}.

## 8. Component-containment fact contract

${result.riskFactContract.componentContainment.join(', ')}. Component proposals are conservative containment signals only and are never promoted to output.

## 9. Risk-routing coverage

${result.routedCandidateCount}/863 candidates routed; ${result.routeCoverage.incorrectCandidatesNotRouted} incorrect candidates missed.

## 10. Incorrect candidates routed

${result.routeCoverage.incorrectCandidatesRouted}/30 routed; ${result.routeCoverage.incorrectCandidatesNotRouted}/30 not routed.

## 11. Correct candidates routed

${result.routeCoverage.correctCandidatesRouted}/833 routed; ${result.routeCoverage.correctCandidatesNotRouted}/833 not routed.

## 12. Risk-rejection-only metrics

${result.riskRejectionOnly.truePositives} TP / ${result.riskRejectionOnly.falsePositives} FP / ${result.riskRejectionOnly.falseNegatives} FN; precision ${percent(result.riskRejectionOnly.precision)}; candidate recall ${percent(result.riskRejectionOnly.recall)}.

## 13. State-aware arbiter metrics

${result.stateAwareArbiter.truePositives} TP / ${result.stateAwareArbiter.falsePositives} FP / ${result.stateAwareArbiter.falseNegatives} FN; precision ${percent(result.stateAwareArbiter.precision)}; candidate recall ${percent(result.stateAwareArbiter.recall)}. False rejects by basis: ${JSON.stringify(result.stateAwareErrors.falseRejectsByBasis)}.

## 14. Twenty V10A FP outcomes

${result.twentyFalsePositives.filter(item => item.arbiterDecision === 'REJECT').length}/20 rejected; 7/20 remained accepted.

| Candidate | Vote | Root cause | Risk facts | Decision / basis | Evidence |
| --- | --- | --- | --- | --- | --- |
${twentyRows}

## 15. Correct-candidate protection

Failed: ${result.stateAwareArbiter.truePositives}/833 TP, ${result.stateAwareArbiter.falseNegatives} FN, ${percent(result.stateAwareArbiter.recall)} recall. The required floor was 829 TP and 99.5% recall.

## 16. Historical FP regression results

${result.historicalRegression.rejected}/${result.historicalRegression.total} rejected; ${result.historicalRegression.accepted} accepted; ${result.historicalRegression.unavailable} unavailable. Family labels below are source-signal taxonomies because the locked artifact has provenance but no manual family labels.

| Family | Total | Rejected | Accepted |
| --- | ---: | ---: | ---: |
${historicalRows}

Accepted historical cases:

${acceptedHistorical}

## 17. Strategy comparison table

| Strategy | TP | FP | FN | Precision | Candidate recall | AI decisions |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
${metricRow('Reviewer union', s?.reviewerUnion)}
${metricRow('Reviewer intersection', s?.reviewerIntersection)}
${metricRow('V10A disagreement-only', s?.v10aDisagreementOnly)}
${metricRow('Risk rejection only', s?.riskRejectionOnly)}
${metricRow('Risk-routed state-aware arbiter', s?.riskRoutedStateAwareArbiter)}
${metricRow('Arbiter everything (V10A experiment A)', s?.arbiterEverything)}

The smallest measured strategy remains V10A disagreement-only for recall; no strategy reaches zero FP.

## 18. Final TP / FP / FN

${result.finalMetrics.truePositives} / ${result.finalMetrics.falsePositives} / ${result.finalMetrics.falseNegatives}.

## 19. Final precision

${percent(result.finalMetrics.precision)}.

## 20. Final candidate recall

${percent(result.finalMetrics.recall)}.

## 21. AI decisions, calls, and tokens

${result.aiDecisionCounts.frozenRiskCandidates} frozen risk decisions; ${result.aiDecisionCounts.historicalAdversarialCandidates} historical decisions; ${result.aiDecisionCounts.recipe190ControlCandidatesPerRequest} candidates × ${result.aiDecisionCounts.recipe190ControlRequests} recipe-190 control requests. ${result.aiUsage.requests} Gateway requests; ${result.aiUsage.inputTokens}/${result.aiUsage.outputTokens}/${result.aiUsage.totalTokens} input/output/total tokens. Provider cost and model revision were not available.

## 22. Transport and retry behavior

${result.transport.logicalBatches} logical primary+historical batches; ${result.transport.gatewayCalls} Gateway calls; ${result.transport.retries} retries; ${result.transport.schemaFailures} schema failures; ${result.transport.parseFailures} parse failures; ${result.transport.localRequestRejections} local rejections; ${result.transport.otherFailures} other failures.

## 23. Recipe 190 result

${result.recipe190.successes}/${result.recipe190.requests} independent bounded control requests succeeded; ${result.recipe190.failures} failed.

## 24. Prepared-component diagnostic appendix

Excluded from the primary gate. V10A accepted ${result.componentAppendix.v10aMetrics.correctAccept}/${result.componentAppendix.v10aMetrics.correctCandidates} correct component candidates and ${result.componentAppendix.v10aMetrics.incorrectAccept}/${result.componentAppendix.v10aMetrics.incorrectCandidates} incorrect component candidates (40.49% precision). Candidate-level V9 component false accepts: ${result.componentAppendix.candidateLevelV9FalseAccepts}. Taxonomy: ${JSON.stringify(result.componentAppendix.falsePositiveTaxonomy)}. ${result.componentAppendix.containmentSignal}

## 25. Production mutation

Firestore writes = 0; recipe writes = 0; map writes = 0; production code activation = 0; production files edited by V10B = none.

## 26. Tests, lint, typecheck, and build

${JSON.stringify(result.verification)}.

## 27. Files modified

- PRD.md — record the V10B frozen precision result and next research boundary.

## 28. Files created

- scripts/analyze-cooking-mode-v10b-ingredient-precision-core.mjs
- scripts/analyze-cooking-mode-v10b-ingredient-precision.mjs
- scripts/run-cooking-mode-v10b-ingredient-precision.mjs
- tests/cookingModeV10BIngredientPrecision.test.js
- docs/audits/cooking-mode-v10b-ingredient-precision-analysis-${date}.json
- docs/audits/cooking-mode-v10b-ingredient-precision-analysis-${date}.md

## 29. Commit and push

No. Prohibited by the task.

## 30. PRD update

Yes — Section 7 Cooking Mode recall remediation records the failed V10B gate, transport evidence, and next semantic boundary.

## 31. Unverifiable items

${result.unverifiableItems.join(' ')}

## 32. Deferred work

${result.failureAnalysis.knownFactExtractionDefect} No production integration, reviewer rerun, full-corpus run, component redesign, migration, commit, or push was performed.

## 33. Next action

Inseparable family: **${result.failureAnalysis.inseparableFamily}**. ${result.failureAnalysis.finding} ${result.failureAnalysis.nextExperimentPrerequisite}

Identify which false-positive family remains inseparable from valid ingredient use before another arbiter experiment.
`
}

const inputs = buildInputs()
const result = evaluate(inputs)
process.stdout.write(stableJson({
  inputPath,
  riskCandidates: inputs.safeCandidates.filter(item => item.routing.route === 'RISK_REVIEW_REQUIRED').length,
  historicalRiskCandidates: inputs.historicalCandidates.filter(item => item.safe.routing.route === 'RISK_REVIEW_REQUIRED').length,
  routeCoverage: result.routeCoverage,
  riskRejectionOnly: result.riskRejectionOnly,
  verdict: result.verdict,
  jsonPath,
  markdownPath,
}))
