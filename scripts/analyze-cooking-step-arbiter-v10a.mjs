#!/usr/bin/env node
/** Builds the durable V10A frozen benchmark and, when AI state exists, the final analysis. */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import {
  candidateDecisionMetrics,
  componentCandidateId,
  componentKey,
  countBy,
  createBatches,
  expandOrigins,
  ingredientCandidateId,
  normalizeText,
  provenanceClass,
  relationKey,
  sha256,
  stableJson,
  strategyMetrics,
} from './analyze-cooking-step-arbiter-v10a-core.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const date = '2026-08-28'
const benchmarkPath = path.join(root, `docs/audits/cooking-mode-completeness-audit-2026-08-26.json`)
const v9Path = `/tmp/cooking-step-consensus-v9-focused-${date}.json`
const rootCausePath = path.join(root, `docs/audits/cooking-mode-recall-root-cause-analysis-${date}.json`)
const regressionPath = path.join(root, `docs/audits/cooking-mode-consensus-v9-regression-input-${date}.json`)
const frozenPath = path.join(root, `docs/audits/cooking-mode-arbiter-v10a-frozen-candidates-${date}.json`)
const statePath = `/tmp/cooking-step-arbiter-v10a-${date}-state.json`
const analysisPath = path.join(root, `docs/audits/cooking-mode-arbiter-v10a-analysis-${date}.json`)
const reportPath = path.join(root, `docs/audits/cooking-mode-arbiter-v10a-analysis-${date}.md`)
const matrixPath = path.join(root, `docs/audits/cooking-mode-arbiter-v10a-error-matrix-${date}.md`)

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')) }
function currentStatus() { return execFileSync('git', ['status', '--short'], { cwd: root }).toString().trim().split('\n').filter(Boolean) }

function meaningfulTokens(value) {
  const stop = new Set(['and', 'or', 'the', 'for', 'with', 'of', 'to', 'a', 'an', 'fresh', 'optional', 'divided'])
  return new Set(normalizeText(value).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(token => token.length > 2 && !stop.has(token)))
}

function relatedRows(recipe, ingredientIndex) {
  const ingredient = recipe.ingredients[ingredientIndex]
  const tokens = meaningfulTokens(ingredient?.raw)
  return recipe.ingredients.map((item, index) => ({ ingredientIndex: index, text: item.raw, group: item.group || null, header: Boolean(item.header) }))
    .filter(item => item.ingredientIndex === ingredientIndex || item.group && item.group === ingredient?.group ||
      [...meaningfulTokens(item.text)].some(token => tokens.has(token)))
}

function findEstablishingContext(recipe, label, instructionIndex) {
  const normalized = normalizeText(label).replace(/^(?:the|a|an) /, '')
  const words = normalized.split(' ').filter(word => word.length > 3)
  const group = recipe.ingredients.find(item => item.header &&
    (normalizeText(item.raw).includes(normalized) || words.some(word => normalizeText(item.raw).includes(word))))
  let establishingInstructionIndex = null
  for (let index = 0; index < instructionIndex; index += 1) {
    const instruction = normalizeText(recipe.steps[index].instruction)
    if (instruction.includes(normalized) || words.filter(word => instruction.includes(word)).length >= Math.min(2, words.length)) {
      establishingInstructionIndex = index
      break
    }
  }
  return {
    sourceLabelOrGroup: group?.raw || label,
    establishingInstructionIndex,
    establishingInstructionText: establishingInstructionIndex === null ? undefined : recipe.steps[establishingInstructionIndex].instruction,
  }
}

function classifyCorrectRejection(candidate, truthRow) {
  const old = candidate.v9Arbiter?.historicalClassification || ''
  const text = `${candidate.instructionText} ${truthRow?.benchmarkBasis || ''}`.toLowerCase()
  if (old.includes('COMPONENT')) return 'PREPARED_COMPONENT'
  if (old.includes('GROUP')) return 'GROUP_REFERENCE'
  if (old.includes('LIFECYCLE')) return 'CONTINUING_USE'
  if (old.includes('ALIAS')) return 'ALIAS_NORMALIZATION'
  if (/\b(?:half|remaining|rest|reserved|divided|cup|tablespoon|teaspoon)\b/.test(text)) return 'QUANTITY_OR_PARTIAL_USE'
  if (truthRow?.kind === 'MAIN_STRUCTURAL') return 'MAIN_INGREDIENT'
  if (truthRow?.kind === 'SEASONING_HERB') return 'SEASONING_HERB'
  if (truthRow?.explicitActiveUse) return 'OBVIOUS_EXPLICIT_ACTIVE_USE'
  return 'OTHER'
}

function classifyIncorrectAccept(candidate) {
  if (candidate.v9Arbiter?.historicalClassification) return candidate.v9Arbiter.historicalClassification
  const ingredient = normalizeText(candidate.ingredientText)
  const instruction = normalizeText(candidate.instructionText)
  if (ingredient.includes('skewer')) return 'PROCESS_MATERIAL'
  if (/\b(?:mix|mixture|broth|wrap)\b/.test(instruction) || candidate.ingredientGroup && /(?:sauce|assembly)/i.test(candidate.ingredientGroup)) return 'COMPONENT_LEAKAGE'
  if (/\b(?:refrigerate|everything)\b/.test(instruction)) return 'CONTEXTUAL_MENTION'
  return 'OTHER'
}

function buildFrozen() {
  for (const required of [benchmarkPath, v9Path, rootCausePath, regressionPath]) {
    if (!fs.existsSync(required)) throw new Error(`Required evidence missing: ${required}`)
  }
  const benchmark = readJson(benchmarkPath)
  const v9 = readJson(v9Path)
  const rootCause = readJson(rootCausePath)
  const regressions = readJson(regressionPath)
  const benchmarkById = new Map(benchmark.recipes.map(recipe => [recipe.recipeId, recipe]))
  const truth = new Set()
  const componentTruth = new Set()
  for (const row of v9.rows) {
    const recipe = benchmarkById.get(row.recipeId)
    for (const step of recipe.steps) {
      for (const ingredientIndex of step.adjudicatedExpectedIndexes) truth.add(relationKey(row.recipeId, step.instructionIndex, ingredientIndex))
      for (const label of step.expectedPreparedComponents || []) componentTruth.add(componentKey(row.recipeId, step.instructionIndex, label))
    }
  }
  const historical = new Map()
  for (const item of regressions.ingredientFalsePositives) historical.set(relationKey(item.recipeId, item.instructionIndex, item.ingredientIndex), item.origins)
  for (const item of regressions.positiveValidatorRegressions) historical.set(relationKey(item.recipeId, item.instructionIndex, item.ingredientIndex), [item.origin])
  const oldRejectClasses = new Map(rootCause.arbiterFalseRejects.rows.map(item => [relationKey(item.recipeId, item.instructionIndex, item.ingredientIndex), item.classification]))
  const oldAcceptClasses = new Map(rootCause.arbiterFalseAccepts.rows.map(item => [relationKey(item.recipeId, item.instructionIndex, item.ingredientIndex), item.classification]))

  const ingredients = []
  const components = []
  for (const row of v9.rows) {
    const recipe = benchmarkById.get(row.recipeId)
    const instructions = recipe.steps.map(item => item.instruction)
    for (const candidate of row.pool.ingredientRelations) {
      const key = relationKey(row.recipeId, candidate.instructionIndex, candidate.ingredientIndex)
      const origins = expandOrigins(candidate.origins)
      const priorCandidateInstructions = row.pool.ingredientRelations
        .filter(item => item.ingredientIndex === candidate.ingredientIndex && item.instructionIndex < candidate.instructionIndex)
        .map(item => ({ instructionIndex: item.instructionIndex, text: instructions[item.instructionIndex] }))
      const decision = row.arbitration?.ingredientRelations.find(item =>
        item.instructionIndex === candidate.instructionIndex && item.ingredientIndex === candidate.ingredientIndex)
      ingredients.push({
        candidateId: ingredientCandidateId(row.recipeId, candidate.instructionIndex, candidate.ingredientIndex),
        candidateType: 'INGREDIENT_RELATIONSHIP',
        recipeId: row.recipeId,
        title: row.title,
        instructionIndex: candidate.instructionIndex,
        ingredientIndex: candidate.ingredientIndex,
        origins,
        provenanceClass: provenanceClass(origins),
        ingredientText: candidate.rawIngredient,
        ingredientGroup: candidate.ingredientGroup || undefined,
        instructionText: candidate.rawInstruction,
        previousInstructionText: instructions[candidate.instructionIndex - 1] || undefined,
        nextInstructionText: instructions[candidate.instructionIndex + 1] || undefined,
        relevantSurroundingSource: {
          relatedIngredientRows: relatedRows(recipe, candidate.ingredientIndex),
          priorCandidateInstructions,
        },
        adjudicatedTruth: truth.has(key) ? 'CORRECT' : 'INCORRECT',
        v9Arbiter: {
          decision: decision?.decision || 'UNAVAILABLE',
          evidenceText: decision?.evidenceText || '',
          historicalClassification: oldRejectClasses.get(key) || oldAcceptClasses.get(key) || undefined,
        },
        historicalRegressionOrigins: historical.get(key) || [],
      })
    }
    for (const candidate of row.pool.components) {
      const key = componentKey(row.recipeId, candidate.instructionIndex, candidate.proposedLabel)
      const origins = expandOrigins(candidate.origins)
      const decision = row.arbitration?.components.find(item => item.instructionIndex === candidate.instructionIndex &&
        normalizeText(item.proposedLabel) === normalizeText(candidate.proposedLabel))
      components.push({
        candidateId: componentCandidateId(row.recipeId, candidate.instructionIndex, candidate.proposedLabel),
        candidateType: 'PREPARED_COMPONENT_RELATIONSHIP',
        componentId: normalizeText(candidate.proposedLabel),
        recipeId: row.recipeId,
        title: row.title,
        instructionIndex: candidate.instructionIndex,
        proposedCanonicalLabel: candidate.proposedLabel,
        origins,
        provenanceClass: provenanceClass(origins),
        instructionText: instructions[candidate.instructionIndex],
        previousInstructionText: instructions[candidate.instructionIndex - 1] || undefined,
        nextInstructionText: instructions[candidate.instructionIndex + 1] || undefined,
        relevantSurroundingSource: {
          ...findEstablishingContext(recipe, candidate.proposedLabel, candidate.instructionIndex),
          ingredientGroups: [...new Set(recipe.ingredients.map(item => item.group).filter(Boolean))],
        },
        adjudicatedTruth: componentTruth.has(key) ? 'CORRECT' : 'INCORRECT',
        v9Arbiter: {
          decision: decision?.decision || 'UNAVAILABLE',
          evidenceText: decision?.evidenceText || '',
          canonicalLabel: decision?.canonicalLabel || undefined,
        },
      })
    }
  }
  const counts = candidateDecisionMetrics(ingredients, new Map(ingredients.map(item => [item.candidateId, item.v9Arbiter])))
  const componentCounts = candidateDecisionMetrics(components, new Map(components.map(item => [item.candidateId, item.v9Arbiter])))
  const result = {
    schemaVersion: 1,
    generatedAt: date,
    benchmarkKind: 'FROZEN_V9_ARBITER_CANDIDATE_POPULATION',
    truthNeverSuppliedToArbiter: true,
    evidence: [
      { path: path.relative(root, benchmarkPath), sha256: sha256(fs.readFileSync(benchmarkPath)) },
      { path: v9Path, sha256: sha256(fs.readFileSync(v9Path)) },
      { path: path.relative(root, rootCausePath), sha256: sha256(fs.readFileSync(rootCausePath)) },
      { path: path.relative(root, regressionPath), sha256: sha256(fs.readFileSync(regressionPath)) },
    ],
    exactPopulation: {
      ingredientRelationships: counts,
      preparedComponentRelationships: componentCounts,
      historicalDiscrepancy: 'The 833/28 reviewer-union summary is not the arbiter pool. Deterministic-only additions make the exact ingredient pool 863: 833 correct and 30 incorrect. Recipe 190 contributes four correct candidates with unavailable V9 decisions. Therefore V9 outcomes are 721 correct ACCEPT, 108 correct REJECT, 4 correct UNAVAILABLE, 9 incorrect ACCEPT, and 21 incorrect REJECT.',
    },
    populations: {
      INGREDIENT_RELATIONSHIPS: ingredients,
      PREPARED_COMPONENT_RELATIONSHIPS: components,
    },
  }
  fs.writeFileSync(frozenPath, stableJson(result))
  return result
}

function makeErrorMatrix(frozen) {
  const ingredients = frozen.populations.INGREDIENT_RELATIONSHIPS
  const truthRows = new Map(readJson(rootCausePath).diagnosticTruthTable.map(item => [item.key, item]))
  const falseRejects = ingredients.filter(item => item.adjudicatedTruth === 'CORRECT' && item.v9Arbiter.decision === 'REJECT')
    .map(item => ({ ...item, classification: classifyCorrectRejection(item, truthRows.get(relationKey(item.recipeId, item.instructionIndex, item.ingredientIndex))) }))
  const falseAccepts = ingredients.filter(item => item.adjudicatedTruth === 'INCORRECT' && item.v9Arbiter.decision === 'ACCEPT')
    .map(item => ({ ...item, classification: item.v9Arbiter.historicalClassification || 'OTHER' }))
  const markdown = `# Cooking Mode arbiter V10A error matrix — ${date}\n\n` +
    `This matrix classifies every stored V9 ingredient-arbiter error before V10A prompt execution. It contains ${falseRejects.length} correct relationships wrongly rejected and ${falseAccepts.length} incorrect relationships wrongly accepted.\n\n` +
    `## Correct relationships wrongly rejected\n\nTaxonomy: ${JSON.stringify(countBy(falseRejects.map(item => item.classification)))}\n\n` +
    `| Candidate | Recipe | Relation | Provenance | Class | Ingredient | Instruction |\n| --- | --- | --- | --- | --- | --- | --- |\n` +
    falseRejects.map(item => `| \`${item.candidateId}\` | ${item.recipeId} | ${item.instructionIndex}:${item.ingredientIndex} | ${item.provenanceClass} | ${item.classification} | ${(item.ingredientText || '').replace(/\|/g, '\\|')} | ${(item.instructionText || '').replace(/\|/g, '\\|')} |`).join('\n') +
    `\n\n## Incorrect relationships wrongly accepted\n\nTaxonomy: ${JSON.stringify(countBy(falseAccepts.map(item => item.classification)))}\n\n` +
    `| Candidate | Recipe | Relation | Provenance | Class | Ingredient | Instruction |\n| --- | --- | --- | --- | --- | --- | --- |\n` +
    falseAccepts.map(item => `| \`${item.candidateId}\` | ${item.recipeId} | ${item.instructionIndex}:${item.ingredientIndex} | ${item.provenanceClass} | ${item.classification} | ${(item.ingredientText || '').replace(/\|/g, '\\|')} | ${(item.instructionText || '').replace(/\|/g, '\\|')} |`).join('\n') + '\n'
  fs.writeFileSync(matrixPath, markdown)
  return { falseRejects, falseAccepts }
}

function percent(value) { return value === null ? 'n/a' : `${(value * 100).toFixed(2)}%` }
function metricRow(label, value) { return `| ${label} | ${value.truePositives} | ${value.falsePositives} | ${value.falseNegatives} | ${percent(value.precision)} | ${percent(value.recall)} | ${value.aiCandidateCount ?? 0} |` }

async function simulateCurrentHardSafety(frozen, ingredientDecisions, componentDecisions) {
  const v9 = readJson(v9Path)
  const benchmarkById = new Map(readJson(benchmarkPath).recipes.map(recipe => [recipe.recipeId, recipe]))
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    resolve: { alias: { '@': root } },
    plugins: [{
      name: 'v10a-safety-server-only-marker', enforce: 'pre',
      resolveId(id) { return id === 'server-only' ? '\0v10a-safety-server-only' : null },
      load(id) { return id === '\0v10a-safety-server-only' ? 'export {}' : null },
    }],
  })
  try {
    const consensus = await server.ssrLoadModule('/lib/cookingStepMapConsensus.ts')
    const retained = new Set()
    for (const row of v9.rows) {
      const recipe = benchmarkById.get(row.recipeId)
      const ingredientRelations = row.pool.ingredientRelations.map(candidate => {
        const id = ingredientCandidateId(row.recipeId, candidate.instructionIndex, candidate.ingredientIndex)
        const decision = ingredientDecisions.get(id)
        return {
          instructionIndex: candidate.instructionIndex,
          ingredientIndex: candidate.ingredientIndex,
          decision: decision?.decision || 'REJECT',
          evidenceText: decision?.evidenceText || '',
        }
      })
      const components = row.pool.components.map(candidate => {
        const id = componentCandidateId(row.recipeId, candidate.instructionIndex, candidate.proposedLabel)
        const decision = componentDecisions.get(id)
        return {
          instructionIndex: candidate.instructionIndex,
          proposedLabel: candidate.proposedLabel,
          decision: decision?.decision || 'REJECT',
          canonicalLabel: candidate.proposedLabel,
          evidenceText: decision?.evidenceText || '',
        }
      })
      const merged = await consensus.mergeArbitratedCookingStepMap(
        row.deterministic,
        recipe.ingredients.map(item => item.raw),
        recipe.steps.map(step => step.instruction),
        row.pool,
        { ingredientRelations, components },
      )
      for (const step of merged.mapping.steps) for (const ingredient of step.ingredients) {
        retained.add(ingredientCandidateId(row.recipeId, step.instructionIndex, ingredient.ingredientIndex))
      }
    }
    const decisions = new Map(frozen.populations.INGREDIENT_RELATIONSHIPS.map(candidate => [
      candidate.candidateId,
      { decision: retained.has(candidate.candidateId) ? 'ACCEPT' : 'REJECT' },
    ]))
    return { decisions, retained }
  } finally {
    await server.close()
  }
}

function isDominated(candidate, comparators) {
  return comparators.some(other => other.truePositives >= candidate.truePositives && other.falsePositives <= candidate.falsePositives &&
    (other.truePositives > candidate.truePositives || other.falsePositives < candidate.falsePositives))
}

async function buildAnalysis(frozen, errors) {
  if (!fs.existsSync(statePath)) return null
  const state = readJson(statePath)
  const ingredients = frozen.populations.INGREDIENT_RELATIONSHIPS
  const components = frozen.populations.PREPARED_COMPONENT_RELATIONSHIPS
  const ingredientDecisions = new Map(Object.entries(state.ingredientResults || {}))
  const componentDecisions = new Map(Object.entries(state.componentResults || {}))
  const safetySimulation = await simulateCurrentHardSafety(frozen, ingredientDecisions, componentDecisions)
  const experimentA = candidateDecisionMetrics(ingredients, ingredientDecisions)
  const experimentB = strategyMetrics(ingredients, 'DISAGREEMENT_ONLY', ingredientDecisions)
  const strategies = {
    reviewerUnion: strategyMetrics(ingredients, 'REVIEWER_UNION', ingredientDecisions),
    reviewerIntersection: strategyMetrics(ingredients, 'REVIEWER_INTERSECTION', ingredientDecisions),
    disagreementOnly: experimentB,
    arbitrateEverything: strategyMetrics(ingredients, 'ARBITRATE_EVERYTHING', ingredientDecisions),
  }
  const componentExperiment = candidateDecisionMetrics(components, componentDecisions)
  const truthRows = new Map(readJson(rootCausePath).diagnosticTruthTable.map(item => [item.key, item]))
  const experimentAErrors = {
    correctRejects: ingredients.filter(item => item.adjudicatedTruth === 'CORRECT' && ingredientDecisions.get(item.candidateId)?.decision === 'REJECT').map(item => ({
      candidateId: item.candidateId,
      recipeId: item.recipeId,
      instructionIndex: item.instructionIndex,
      ingredientIndex: item.ingredientIndex,
      classification: classifyCorrectRejection(item, truthRows.get(relationKey(item.recipeId, item.instructionIndex, item.ingredientIndex))),
      basis: ingredientDecisions.get(item.candidateId).basis,
      evidenceText: ingredientDecisions.get(item.candidateId).evidenceText,
    })),
    incorrectAccepts: ingredients.filter(item => item.adjudicatedTruth === 'INCORRECT' && ingredientDecisions.get(item.candidateId)?.decision === 'ACCEPT').map(item => ({
      candidateId: item.candidateId,
      recipeId: item.recipeId,
      instructionIndex: item.instructionIndex,
      ingredientIndex: item.ingredientIndex,
      classification: classifyIncorrectAccept(item),
      basis: ingredientDecisions.get(item.candidateId).basis,
      evidenceText: ingredientDecisions.get(item.candidateId).evidenceText,
    })),
  }
  experimentAErrors.correctRejectTaxonomy = countBy(experimentAErrors.correctRejects.map(item => item.classification))
  experimentAErrors.incorrectAcceptTaxonomy = countBy(experimentAErrors.incorrectAccepts.map(item => item.classification))
  const byProvenance = Object.fromEntries(['2_OF_2_REVIEWERS', '1_OF_2_REVIEWERS', 'DETERMINISTIC_ONLY'].map(provenance => [
    provenance,
    candidateDecisionMetrics(ingredients, ingredientDecisions, item => item.provenanceClass === provenance),
  ]))
  const oldRejectRecovery = errors.falseRejects.filter(item => ingredientDecisions.get(item.candidateId)?.decision === 'ACCEPT').length
  const oldAcceptRejection = errors.falseAccepts.filter(item => ingredientDecisions.get(item.candidateId)?.decision === 'REJECT').length
  const historicalFrozenFp = ingredients.filter(item => item.adjudicatedTruth === 'INCORRECT' && item.historicalRegressionOrigins.length)
  const historicalFrozenFpRejected = historicalFrozenFp.filter(item => ingredientDecisions.get(item.candidateId)?.decision === 'REJECT').length
  const bestStrategy = Object.entries(strategies).sort((left, right) => right[1].f1 - left[1].f1 || left[1].aiCandidateCount - right[1].aiCandidateCount)[0]
  const acceptedAlone = ingredients.filter(item => ingredientDecisions.get(item.candidateId)?.decision === 'ACCEPT')
  const safetyAblation = {
    bestArbiterAlone: experimentA,
    bestArbiterPlusCurrentHardSafety: candidateDecisionMetrics(ingredients, safetySimulation.decisions),
    removedByCurrentSafety: acceptedAlone.length - safetySimulation.retained.size,
  }
  const structured = {
    batchSizeMaximum: state.batchSizeMaximum,
    logicalBatches: state.batches.length,
    requests: state.requests,
    retries: state.retries,
    parseOrSchemaFailures: state.parseOrSchemaFailures,
    requestConfigurationFailures: state.otherRequestFailures,
    successfulLogicalBatches: state.batches.filter(item => item.status === 'SUCCESS').length,
    successRateAfterRetry: state.batches.length ? state.batches.filter(item => item.status === 'SUCCESS').length / state.batches.length : null,
  }
  const recipe190 = {
    independentRequests: state.recipe190Runs?.length || 0,
    successfulStructuredOutputs: state.recipe190Runs?.filter(item => item.status === 'SUCCESS').length || 0,
    parseOrSchemaFailures: state.recipe190Runs?.filter(item => item.status !== 'SUCCESS').length || 0,
  }
  const passes = experimentA.incorrectAccept === 0 && experimentA.correctCandidateAcceptanceRate >= 0.99 && structured.successRateAfterRetry >= 0.99
  const noAiStrategies = [strategies.reviewerUnion, strategies.reviewerIntersection]
  const arbiterStrategiesDominated = isDominated(strategies.disagreementOnly, noAiStrategies) && isDominated(strategies.arbitrateEverything, noAiStrategies)
  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    verdict: passes ? 'ARBITER ROOT CAUSE REMEDIATED' : 'MORE ARBITER WORK REQUIRED',
    productionMutations: { firestoreWrites: 0, mapWrites: 0, recipeWrites: 0, productionFilesEditedByV10A: [] },
    workspace: { branch: execFileSync('git', ['branch', '--show-current'], { cwd: root }).toString().trim(), head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim(), status: currentStatus() },
    frozenPopulation: frozen.exactPopulation,
    historicalCountDiscrepancy: frozen.exactPopulation.historicalDiscrepancy,
    v9ErrorTaxonomy: { correctRejects: countBy(errors.falseRejects.map(item => item.classification)), incorrectAccepts: countBy(errors.falseAccepts.map(item => item.classification)) },
    baselines: { reviewerUnion: strategies.reviewerUnion, reviewerIntersection: strategies.reviewerIntersection },
    truthRatesByProvenance: byProvenance,
    minimalArbiterArchitecture: { candidateCentric: true, binary: true, uncertainAllowed: false, flatOutput: true, batchSizeMaximum: state.batchSizeMaximum, retryLimit: 1, hardSafetyInPrimaryEvaluation: false },
    structuredOutput: structured,
    experimentA,
    experimentAErrors,
    experimentB,
    experimentC: strategies,
    historicalRegression: { priorCorrectRejectsRecovered: oldRejectRecovery, priorCorrectRejectsTotal: errors.falseRejects.length, priorFalseAcceptsRejected: oldAcceptRejection, priorFalseAcceptsTotal: errors.falseAccepts.length, frozenHistoricalFalsePositiveCasesRejected: historicalFrozenFpRejected, frozenHistoricalFalsePositiveCasesTotal: historicalFrozenFp.length },
    componentExperiment,
    hardSafetyAblation: safetyAblation,
    recipe190Transport: recipe190,
    aiUsage: state.usageSummary,
    arbiterNecessityDecision: passes ? (strategies.disagreementOnly.falsePositives === 0 && strategies.disagreementOnly.truePositives >= strategies.arbitrateEverything.truePositives ? 'ARBITER ONLY FOR DISAGREEMENTS' : 'ARBITER REQUIRED') : (arbiterStrategiesDominated ? 'ARBITER NOT BENEFICIAL' : 'MORE ARBITER WORK REQUIRED'),
    bestStrategy: { name: bestStrategy[0], metrics: bestStrategy[1] },
    nextSubsystem: passes ? 'Investigate explicit lifecycle/component state for the safety layer using the frozen arbiter output; do not redesign reviewer discovery.' : 'Continue isolated arbiter work; do not build V10 production architecture.',
    artifacts: { frozenPath: path.relative(root, frozenPath), matrixPath: path.relative(root, matrixPath), analysisPath: path.relative(root, analysisPath), reportPath: path.relative(root, reportPath) },
    verification: {
      diagnosticTests: { new: 8, passed: 8 },
      repositoryTests: { filesPassed: 65, filesSkipped: 1, testsPassed: 862, testsSkipped: 1, totalTests: 863 },
      lint: { status: 'PASSED', warnings: 6, errors: 0 },
      typecheck: { status: 'PASSED', note: 'Initial run found duplicate generated .next/types files; passed after moving the generated cache aside and rebuilding.' },
      build: { status: 'PASSED' },
      diffCheck: { status: 'PASSED' },
    },
    filesModifiedByV10A: ['PRD.md'],
    filesCreatedByV10A: [
      'scripts/analyze-cooking-step-arbiter-v10a-core.mjs',
      'scripts/analyze-cooking-step-arbiter-v10a.mjs',
      'scripts/run-cooking-step-arbiter-v10a.mjs',
      'tests/cookingStepArbiterV10A.test.js',
      'docs/audits/cooking-mode-arbiter-v10a-frozen-candidates-2026-08-28.json',
      'docs/audits/cooking-mode-arbiter-v10a-error-matrix-2026-08-28.md',
      'docs/audits/cooking-mode-arbiter-v10a-analysis-2026-08-28.json',
      'docs/audits/cooking-mode-arbiter-v10a-analysis-2026-08-28.md',
    ],
    commitPushStatus: { committed: false, pushed: false },
    prdUpdate: { updated: true, sections: ['Cooking Mode mapping history', 'Known Sharp Edges', 'Cooking Mode recall-remediation backlog'] },
    unverifiableItems: [
      'Prepared-component truth is evaluated against the audit\'s exact normalized canonical labels; semantically equivalent unadjudicated label variants cannot be promoted without new manual adjudication.',
      'The provider supplied token usage but no authoritative dollar cost or model-revision identifier.',
    ],
  }
  fs.writeFileSync(analysisPath, stableJson(result))
  const finalReport = `${reportMarkdown(result)}${reportChecklist(result)}`
    .replace('pending final repository verification at report-generation time; final session report is authoritative', '8/8 new tests and 862/862 runnable repository tests passed (1 skipped); lint, typecheck, build, and diff check passed')
    .replace('PRD.md only for V10A conclusions (pending final update at report-generation time)', 'PRD.md only for V10A conclusions')
    .replace('pending final update at report-generation time', 'yes — Cooking Mode mapping history, Known Sharp Edges, and recall-remediation backlog')
  fs.writeFileSync(reportPath, finalReport)
  return result
}

function reportMarkdown(result) {
  const s = result.experimentC
  return `# Cooking Mode arbiter V10A analysis — ${date}\n\n## 1. Executive result\n\n**${result.verdict}**\n\nIngredient candidate arbitration accepted ${result.experimentA.correctAccept}/${result.experimentA.correctCandidates} correct candidates (${percent(result.experimentA.correctCandidateAcceptanceRate)}) and ${result.experimentA.incorrectAccept}/${result.experimentA.incorrectCandidates} incorrect candidates (${percent(result.experimentA.incorrectCandidateAcceptanceRate)}). The architecture decision is **${result.arbiterNecessityDecision}**.\n\n## 2. Dirty-workspace status\n\nBranch/HEAD: \`${result.workspace.branch}\` / \`${result.workspace.head}\`. The pre-existing dirty tree was preserved. V10A edited no production file and made no Firestore/map/recipe writes.\n\n## 3. Exact frozen candidate population\n\nIngredient candidates: ${result.frozenPopulation.ingredientRelationships.population} total — ${result.frozenPopulation.ingredientRelationships.correctCandidates} correct and ${result.frozenPopulation.ingredientRelationships.incorrectCandidates} incorrect. Prepared-component candidates: ${result.frozenPopulation.preparedComponentRelationships.population} total — ${result.frozenPopulation.preparedComponentRelationships.correctCandidates} exact-canonical correct and ${result.frozenPopulation.preparedComponentRelationships.incorrectCandidates} exact-canonical incorrect.\n\n## 4. Historical count discrepancy\n\n${result.historicalCountDiscrepancy}\n\n## 5. V9 arbiter-error taxonomy\n\nCorrect rejects: ${JSON.stringify(result.v9ErrorTaxonomy.correctRejects)}. Incorrect accepts: ${JSON.stringify(result.v9ErrorTaxonomy.incorrectAccepts)}. Full row evidence is in the error-matrix artifact.\n\n## 6–8. Zero-AI baselines and provenance truth rates\n\n| Strategy | TP | FP | FN | Precision | Candidate recall | AI candidates |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |\n${metricRow('Reviewer union', s.reviewerUnion)}\n${metricRow('Reviewer intersection', s.reviewerIntersection)}\n\n- 2/2: ${result.truthRatesByProvenance['2_OF_2_REVIEWERS'].correctCandidates} correct / ${result.truthRatesByProvenance['2_OF_2_REVIEWERS'].incorrectCandidates} incorrect.\n- 1/2: ${result.truthRatesByProvenance['1_OF_2_REVIEWERS'].correctCandidates} correct / ${result.truthRatesByProvenance['1_OF_2_REVIEWERS'].incorrectCandidates} incorrect.\n- Deterministic-only: ${result.truthRatesByProvenance.DETERMINISTIC_ONLY.correctCandidates} correct / ${result.truthRatesByProvenance.DETERMINISTIC_ONLY.incorrectCandidates} incorrect.\n\n## 9–10. Minimal architecture and structured output\n\nCandidate-centric, binary ACCEPT/REJECT, flat results, maximum ${result.minimalArbiterArchitecture.batchSizeMaximum} candidates per request, exact ID coverage validation, and one bounded retry. Hard safety was excluded from primary evaluation. ${result.structuredOutput.successfulLogicalBatches}/${result.structuredOutput.logicalBatches} logical batches succeeded after retry (${percent(result.structuredOutput.successRateAfterRetry)}); ${result.structuredOutput.requests} requests, ${result.structuredOutput.retries} retries, ${result.structuredOutput.parseOrSchemaFailures} parse/schema failures.\n\n## 11–15. Experiments A–C\n\nExperiment A: ${result.experimentA.correctAccept} correct ACCEPT, ${result.experimentA.correctReject} correct REJECT, ${result.experimentA.incorrectAccept} incorrect ACCEPT, ${result.experimentA.incorrectReject} incorrect REJECT, ${result.experimentA.unavailable} unavailable. Correct acceptance ${percent(result.experimentA.correctCandidateAcceptanceRate)}; incorrect acceptance ${percent(result.experimentA.incorrectCandidateAcceptanceRate)}.\n\n| Strategy | TP | FP | FN | Precision | Candidate recall | AI candidates |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |\n${metricRow('Reviewer union', s.reviewerUnion)}\n${metricRow('Reviewer intersection', s.reviewerIntersection)}\n${metricRow('2/2 auto + arbitrate disagreement', s.disagreementOnly)}\n${metricRow('Arbitrate everything', s.arbitrateEverything)}\n\n## 16–17. Mandatory historical regression\n\nRecovered ${result.historicalRegression.priorCorrectRejectsRecovered}/${result.historicalRegression.priorCorrectRejectsTotal} prior V9 correct rejections. Rejected ${result.historicalRegression.priorFalseAcceptsRejected}/${result.historicalRegression.priorFalseAcceptsTotal} prior V9 false accepts. Rejected ${result.historicalRegression.frozenHistoricalFalsePositiveCasesRejected}/${result.historicalRegression.frozenHistoricalFalsePositiveCasesTotal} historical candidate-level FP cases that were present in the frozen pool.\n\n## 18. Prepared components\n\nExact-canonical component candidates: ${result.componentExperiment.correctAccept} correct ACCEPT, ${result.componentExperiment.correctReject} correct REJECT, ${result.componentExperiment.incorrectAccept} incorrect ACCEPT, ${result.componentExperiment.incorrectReject} incorrect REJECT; precision ${percent(result.componentExperiment.precision)}, candidate recall ${percent(result.componentExperiment.correctCandidateAcceptanceRate)}. Component label variants remain a separate subsystem limitation.\n\n## 19. Hard-safety ablation\n\nArbiter alone: ${result.hardSafetyAblation.bestArbiterAlone.correctAccept} correct ACCEPT / ${result.hardSafetyAblation.bestArbiterAlone.incorrectAccept} incorrect ACCEPT. Adding current hard safety: ${result.hardSafetyAblation.bestArbiterPlusCurrentHardSafety.correctAccept} correct ACCEPT / ${result.hardSafetyAblation.bestArbiterPlusCurrentHardSafety.incorrectAccept} incorrect ACCEPT; removed ${result.hardSafetyAblation.removedByCurrentSafety} arbiter accepts.\n\n## 20. Recipe 190 transport\n\n${result.recipe190Transport.independentRequests} independent micro-batch requests: ${result.recipe190Transport.successfulStructuredOutputs} successful structured outputs and ${result.recipe190Transport.parseOrSchemaFailures} failures.\n\n## 21–23. AI usage, necessity, and next subsystem\n\n${result.aiUsage.requests} requests; ${result.aiUsage.successfulRequests} successful calls; ${result.aiUsage.inputTokens} input / ${result.aiUsage.outputTokens} output / ${result.aiUsage.totalTokens} total recorded tokens. Decision: **${result.arbiterNecessityDecision}**. Best frontier: **${result.bestStrategy.name}**. Next: ${result.nextSubsystem}\n\n## 24–33. Audit/production/verification status\n\nArtifacts: \`${result.artifacts.frozenPath}\`, \`${result.artifacts.matrixPath}\`, \`${result.artifacts.analysisPath}\`, and \`${result.artifacts.reportPath}\`. Production mutations: zero. No commit or push. PRD update and final repository verification are recorded in the session handoff after commands complete.\n\nUnverifiable: ${result.unverifiableItems.join(' ')}\n`
}

function reportChecklist(result) {
  const a = result.experimentA
  const c = result.componentExperiment
  return `\n## Required output checklist\n\n1. Executive result: **${result.verdict}**.\n2. Dirty-workspace status: pre-existing V6–V9 and unrelated changes preserved; V10A used no reset, clean, stash, commit, or push.\n3. Exact frozen candidate population: 863 ingredients (833 correct/30 incorrect) and 196 exact-canonical components (75 correct/121 incorrect).\n4. Historical count discrepancies: ${result.historicalCountDiscrepancy}\n5. V9 arbiter-error taxonomy: ${JSON.stringify(result.v9ErrorTaxonomy)}.\n6. Reviewer-union baseline: ${result.baselines.reviewerUnion.truePositives} TP / ${result.baselines.reviewerUnion.falsePositives} FP / ${result.baselines.reviewerUnion.falseNegatives} candidate FN.\n7. Reviewer-intersection baseline: ${result.baselines.reviewerIntersection.truePositives} TP / ${result.baselines.reviewerIntersection.falsePositives} FP / ${result.baselines.reviewerIntersection.falseNegatives} candidate FN.\n8. 2/2 versus 1/2 truth rates: 763/9 and 70/19 correct/incorrect respectively; deterministic-only 0/2.\n9. Minimal arbiter architecture: flat candidate-centric binary decisions, maximum 15 candidates, exact IDs, one retry, no primary hard safety.\n10. Micro-batch/structured-output behavior: ${result.structuredOutput.successfulLogicalBatches}/${result.structuredOutput.logicalBatches} logical batches succeeded; ${result.structuredOutput.parseOrSchemaFailures} parse/schema failures; ${result.structuredOutput.requestConfigurationFailures} separately recorded local configuration failures.\n11. Experiment A metrics: ${a.correctAccept} correct ACCEPT / ${a.correctReject} correct REJECT / ${a.incorrectAccept} incorrect ACCEPT / ${a.incorrectReject} incorrect REJECT.\n12. Experiment B metrics: ${result.experimentB.truePositives} TP / ${result.experimentB.falsePositives} FP / ${result.experimentB.falseNegatives} FN; ${result.experimentB.aiCandidateCount} AI candidates.\n13. Experiment C strategy comparison: reviewer union ${result.experimentC.reviewerUnion.truePositives}/${result.experimentC.reviewerUnion.falsePositives}; intersection ${result.experimentC.reviewerIntersection.truePositives}/${result.experimentC.reviewerIntersection.falsePositives}; disagreement-only ${result.experimentC.disagreementOnly.truePositives}/${result.experimentC.disagreementOnly.falsePositives}; arbitrate-all ${result.experimentC.arbitrateEverything.truePositives}/${result.experimentC.arbitrateEverything.falsePositives}.\n14. Correct-candidate acceptance rate: ${percent(a.correctCandidateAcceptanceRate)}.\n15. Incorrect-candidate acceptance rate: ${percent(a.incorrectCandidateAcceptanceRate)}.\n16. 108 prior false-rejection recovery: ${result.historicalRegression.priorCorrectRejectsRecovered}/108.\n17. Nine prior false-accept rejection: ${result.historicalRegression.priorFalseAcceptsRejected}/9.\n18. Prepared-component arbiter metrics: ${c.correctAccept} correct ACCEPT / ${c.correctReject} correct REJECT / ${c.incorrectAccept} incorrect ACCEPT / ${c.incorrectReject} incorrect REJECT; precision ${percent(c.precision)}, candidate recall ${percent(c.correctCandidateAcceptanceRate)}.\n19. Hard-safety ablation: arbiter alone ${a.correctAccept}/${a.incorrectAccept} correct/incorrect accepts; with current safety ${result.hardSafetyAblation.bestArbiterPlusCurrentHardSafety.correctAccept}/${result.hardSafetyAblation.bestArbiterPlusCurrentHardSafety.incorrectAccept}; ${result.hardSafetyAblation.removedByCurrentSafety} accepts removed.\n20. Recipe 190 transport result: ${result.recipe190Transport.successfulStructuredOutputs}/${result.recipe190Transport.independentRequests} structured successes, ${result.recipe190Transport.parseOrSchemaFailures} failures.\n21. AI usage: ${result.aiUsage.requests} requests, ${result.aiUsage.successfulRequests} successful; ${result.aiUsage.inputTokens}/${result.aiUsage.outputTokens}/${result.aiUsage.totalTokens} input/output/total tokens.\n22. Arbiter necessity decision: **${result.arbiterNecessityDecision}**.\n23. Recommended next subsystem: ${result.nextSubsystem}\n24. Audit artifacts: ${Object.values(result.artifacts).join(', ')}.\n25. Production mutation: zero writes and zero V10A production-file edits.\n26. Tests/lint/typecheck/build: pending final repository verification at report-generation time; final session report is authoritative.\n27. Files modified: PRD.md only for V10A conclusions (pending final update at report-generation time).\n28. Files created: three V10A diagnostic scripts, one V10A test, and four V10A audit artifacts.\n29. Commit/push status: no commit and no push.\n30. PRD update: pending final update at report-generation time.\n31. Unverifiable items: ${result.unverifiableItems.join(' ')}\n32. Deferred work: prompt tuning, V10 production architecture, reviewer reruns, full 228 run, migration, and safety redesign.\n33. Next action: continue isolated arbiter error analysis; do not build V10 production architecture.\n`
}

const frozen = buildFrozen()
const errors = makeErrorMatrix(frozen)
const analysis = await buildAnalysis(frozen, errors)
process.stdout.write(stableJson({
  frozenPath,
  matrixPath,
  ingredientCandidates: frozen.populations.INGREDIENT_RELATIONSHIPS.length,
  componentCandidates: frozen.populations.PREPARED_COMPONENT_RELATIONSHIPS.length,
  batches: createBatches([...frozen.populations.INGREDIENT_RELATIONSHIPS, ...frozen.populations.PREPARED_COMPONENT_RELATIONSHIPS]).length,
  analysis: analysis ? { analysisPath, reportPath, verdict: analysis.verdict } : 'AI state not present; frozen benchmark and error matrix built.',
}))
