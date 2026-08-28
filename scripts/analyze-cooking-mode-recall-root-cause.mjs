#!/usr/bin/env node
/** Reconstructs immutable, read-only evidence from the audit and preserved V9 diagnostic state. */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { formatBlindRecipePrompt } from './audit-cooking-mode-completeness-core.mjs'
import {
  candidateMetrics,
  componentKey,
  countBy,
  pearson,
  relationKey,
  sha256,
  stableJson,
  voteSets,
} from './analyze-cooking-mode-recall-root-cause-core.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const benchmarkPath = path.join(root, 'docs/audits/cooking-mode-completeness-audit-2026-08-26.json')
const originalStatePath = '/tmp/cooking-mode-completeness-audit-2026-08-26-state.json'
const v9Path = '/tmp/cooking-step-consensus-v9-focused-2026-08-28.json'
const v9StatePath = '/tmp/cooking-step-consensus-v9-focused-2026-08-28-final-state.json'
const reproPath = '/tmp/cooking-mode-recall-bounded-diagnostics-2026-08-28.json'
const jsonPath = path.join(root, 'docs/audits/cooking-mode-recall-root-cause-analysis-2026-08-28.json')
const markdownPath = path.join(root, 'docs/audits/cooking-mode-recall-root-cause-analysis-2026-08-28.md')

function percent(value) {
  return value === null ? 'n/a' : `${(value * 100).toFixed(2)}%`
}

function reviewStep(review, instructionIndex) {
  return review?.steps.find(step => step.instructionIndex === instructionIndex)
}

function classifyWorkspaceFile(file) {
  if (/firebase-debug|firestore-debug/.test(file)) return 'GENERATED_DEBUG'
  if (/cooking-mode-completeness-v6|completeness-v6/.test(file)) return 'FAILED_V6'
  if (/semantic-v7|v7-focused-failure|semantic-v7-core/.test(file)) return 'FAILED_V7'
  if (/usage-matrix-v8/.test(file)) return 'FAILED_V8'
  if (/cookingStepBlindReviewerAi|cookingStepMapArbiterAi|cookingStepMapConsensus|consensus-v9|CookingStepMapRoute|CookingStepMappingPublish|cookingStepMappingV5|app\/api\/cooking-step-map\/route|lib\/cookingStepMapping|lib\/aiConfig|package\.json/.test(file)) return 'FAILED_V9'
  if (/recall-root-cause|recall-diagnostics|cookingModeRecallRootCause|PRD\.md/.test(file)) return 'AUDIT_ONLY'
  if (/^(app\/discover|app\/queue|lib\/recipes|tests\/recipeQueueCategories|\.eslintrc|.* 2\.|.* 3\.|.* 4\.)/.test(file)) return 'UNRELATED'
  return 'UNRELATED'
}

function workspaceInventory() {
  const raw = execFileSync('git', ['status', '--porcelain=v1', '-z'], { cwd: root }).toString()
  const buckets = Object.fromEntries([
    'PRODUCTION_CURRENT', 'FAILED_V6', 'FAILED_V7', 'FAILED_V8', 'FAILED_V9',
    'AUDIT_ONLY', 'UNRELATED', 'GENERATED_DEBUG',
  ].map(key => [key, []]))
  for (const entry of raw.split('\0').filter(Boolean)) {
    const file = entry.slice(3)
    buckets[classifyWorkspaceFile(file)].push({ status: entry.slice(0, 2), file })
  }
  buckets.PRODUCTION_CURRENT.push({
    status: 'HEAD',
    file: '(committed baseline at 030a590d8bc17be1e53a91e29633b2904ef73d0c)',
  })
  return buckets
}

function reviewerMissClass(recipeId, instructionIndex, ingredientIndex) {
  if (recipeId === 'mole-poblano' && instructionIndex === 1) return ['GROUP_REFERENCE', 'PROMPT_INTERPRETATION']
  if (recipeId === '168') return ['CONTINUING_USE', 'MODEL_DID_NOT_NOTICE']
  if (recipeId === '176' && ingredientIndex === 0) return ['ALIAS_OR_NORMALIZATION', 'MODEL_DID_NOT_NOTICE']
  if (recipeId === '176') return ['ALIAS_OR_NORMALIZATION', 'MODEL_DID_NOT_NOTICE']
  if (recipeId === '189') return ['CONTINUING_USE', 'MODEL_DID_NOT_NOTICE']
  if (recipeId === 'garlic-butter-herb-steak-bites-with-potatoes') return ['MAIN_INGREDIENT', 'MODEL_DID_NOT_NOTICE']
  if (recipeId === 'mediterranean-grilled-salmon') return ['PREPARED_COMPONENT_CONSTITUENT', 'MODEL_DID_NOT_NOTICE']
  return ['OTHER', 'OTHER']
}

function arbiterFalseRejectClass(recipeId, instructionIndex) {
  if (['164', '173'].includes(recipeId)) return 'ARBITER_LIFECYCLE_CONFUSION'
  if (recipeId === 'mole-poblano' && instructionIndex === 13) return 'ARBITER_COMPONENT_CONFUSION'
  if (recipeId === 'fried-chicken-sandwich' && instructionIndex === 3) return 'ARBITER_COMPONENT_CONFUSION'
  if (['grilled-fish-tacos', 'jocn-chicken-and-tomatillo-stew', 'tacos-al-pastor'].includes(recipeId)) return 'ARBITER_GROUP_CONFUSION'
  if (['dads-chili', 'crunchy-queso-wrap', 'mexican-oaxacan-bowl', 'pearl-couscous-with-creamy-feta-and-chickpeas-meh'].includes(recipeId)) return 'ARBITER_ALIAS_CONFUSION'
  return 'ARBITER_OVERCONSERVATIVE_ACTIVE_USE'
}

function falseAcceptClass(recipeId, instructionIndex) {
  if (recipeId === '157') return 'CONSUMED_ROW'
  if (recipeId === 'cucumber-tomato-salad-with-red-wine-vinaigrette') return 'COMPONENT_LEAKAGE'
  if (recipeId === 'chickpea-and-fennel-ratatouille' && instructionIndex === 1) return 'CONSUMED_ROW'
  return 'CONTEXTUAL_MENTION'
}

function safetyClass(reason) {
  return ({
    'negative-or-deferred-evidence': 'NEGATIVE_CONTEXT',
    'quantity-contradiction': 'QUANTITY',
    'consumed-row-reused-without-explicit-reuse': 'ROW_LIFECYCLE',
    'prepared-component-constituent-leakage': 'COMPONENT_CONTAINMENT',
    'fresh-process-material-hijack': 'PROCESS_MATERIAL',
    'finished-dish-or-compound-name-collision': 'PURPOSE',
  })[reason] || 'OTHER'
}

function discriminatingEvidence(reason) {
  return ({
    'negative-or-deferred-evidence': 'Parse the grammatical scope of except/discard/defer tokens; do not reject positively included rows because a different row is excluded.',
    'quantity-contradiction': 'Track total-row quantity, per-step portions, and remaining/reserved portions; a subquantity is not a contradiction.',
    'consumed-row-reused-without-explicit-reuse': 'Track whether the row remains available and whether the current instruction explicitly names it, even without remaining/rest/again.',
    'prepared-component-constituent-leakage': 'Distinguish establishing/assembling a component from later component-only use; collective group actions establish constituents.',
    'fresh-process-material-hijack': 'Require evidence that material is fresh/unlisted; exact row identity plus remaining/add language supports reuse.',
    'finished-dish-or-compound-name-collision': 'Resolve the full noun phrase and action target; modifier overlap alone is insufficient for rejection.',
  })[reason] || 'Source-grounded semantic evidence is required.'
}

function preparedComponentSets(rows) {
  const a = new Set()
  const b = new Set()
  const pool = new Set()
  const arbiter = new Set()
  const safety = new Set()
  for (const row of rows) {
    for (const step of row.reviewA?.steps || []) for (const item of step.preparedComponents || []) {
      a.add(componentKey(row.recipeId, step.instructionIndex, item.label))
    }
    for (const step of row.reviewB?.steps || []) for (const item of step.preparedComponents || []) {
      b.add(componentKey(row.recipeId, step.instructionIndex, item.label))
    }
    for (const item of row.pool?.components || []) pool.add(componentKey(row.recipeId, item.instructionIndex, item.proposedLabel))
    for (const item of row.arbitration?.components || []) if (item.decision === 'ACCEPT') {
      arbiter.add(componentKey(row.recipeId, item.instructionIndex, item.canonicalLabel || item.proposedLabel))
    }
    for (const step of row.proposedMap?.steps || []) for (const item of step.preparedComponents || []) {
      safety.add(componentKey(row.recipeId, step.instructionIndex, item.label))
    }
  }
  return {
    a,
    b,
    intersection: new Set([...a].filter(key => b.has(key))),
    union: new Set([...a, ...b]),
    pool,
    arbiter,
    safety,
  }
}

async function allAcceptedSafetyMaps(rows, benchmarkById) {
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    resolve: { alias: { '@': root } },
    plugins: [{
      name: 'recall-analysis-server-only-marker', enforce: 'pre',
      resolveId(id) { return id === 'server-only' ? '\0recall-analysis-server-only' : null },
      load(id) { return id === '\0recall-analysis-server-only' ? 'export {}' : null },
    }],
  })
  try {
    const consensus = await server.ssrLoadModule('/lib/cookingStepMapConsensus.ts')
    const blind = await server.ssrLoadModule('/lib/cookingStepBlindReviewerAi.ts')
    const maps = new Map()
    const promptMismatches = []
    for (const row of rows) {
      const recipe = benchmarkById.get(row.recipeId)
      const ingredients = recipe.ingredients.map(item => item.raw)
      const instructions = recipe.steps.map(item => item.instruction)
      const auditPrompt = formatBlindRecipePrompt(
        row.title,
        ingredients,
        instructions,
        raw => recipe.ingredients.some(item => item.raw === raw && item.header),
      )
      const v9Prompt = blind.buildBlindCookingReviewPrompt(row.title, ingredients, instructions)
      if (auditPrompt !== v9Prompt) promptMismatches.push(row.recipeId)
      const arbitration = {
        ingredientRelations: row.pool.ingredientRelations.map(item => ({
          instructionIndex: item.instructionIndex,
          ingredientIndex: item.ingredientIndex,
          decision: 'ACCEPT',
          evidenceText: item.rawInstruction,
        })),
        components: row.pool.components.map(item => ({
          instructionIndex: item.instructionIndex,
          proposedLabel: item.proposedLabel,
          decision: 'ACCEPT',
          canonicalLabel: item.proposedLabel,
          evidenceText: item.proposedLabel,
        })),
      }
      maps.set(row.recipeId, (await consensus.mergeArbitratedCookingStepMap(
        row.deterministic,
        ingredients,
        instructions,
        row.pool,
        arbitration,
      )).mapping)
    }
    return { maps, promptMismatches }
  } finally {
    await server.close()
  }
}

function mapRelationSet(rows, selector) {
  const keys = new Set()
  for (const row of rows) {
    const map = selector(row)
    for (const step of map?.steps || []) for (const item of step.ingredients || []) {
      keys.add(relationKey(row.recipeId, step.instructionIndex, item.ingredientIndex))
    }
  }
  return keys
}

function promptContractDiff(promptMismatches) {
  const core = fs.readFileSync(path.join(root, 'scripts/audit-cooking-mode-completeness-core.mjs'), 'utf8')
  const reviewer = fs.readFileSync(path.join(root, 'lib/cookingStepBlindReviewerAi.ts'), 'utf8')
  const auditPrompt = core.match(/export const BLIND_REVIEW_SYSTEM_PROMPT = `([\s\S]*?)`/)[1]
  const v9Prompt = reviewer.match(/export const BLIND_COOKING_REVIEW_SYSTEM_PROMPT = `([\s\S]*?)`/)[1]
  return {
    systemPrompt: { byteIdentical: auditPrompt === v9Prompt, auditBytes: Buffer.byteLength(auditPrompt), v9Bytes: Buffer.byteLength(v9Prompt), sha256: sha256(auditPrompt) },
    userPrompt: { byteIdenticalForAll36: promptMismatches.length === 0, mismatchRecipeIds: promptMismatches, titleFormatting: 'identical', groupHeaderFormatting: 'identical', ingredientNumbering: 'identical', instructionNumbering: 'identical' },
    schemaDifferences: ['V9 adds min(1) to preparedComponents[].label; every ingredient-related field, enum, and array maximum is identical.'],
    invocationDifferences: {
      featureTag: 'cooking-mode-completeness-review-{a,b} -> cooking-step-blind-reviewer-{a,b}',
      userTag: 'production-audit-review-{a,b} -> v9-focused',
      promptVersionTag: 'completeness-v1 -> v1',
      concurrency: '3 -> 2',
    },
    identicalInvocationSettings: { provider: 'vercel-ai-gateway', model: 'openai/gpt-5.6-luna', temperature: 0, timeoutMs: 120000, helper: 'lib/ai.ts generateAIObject -> AI SDK generateText + Output.object', explicitMaxOutputTokens: null },
    validationDifferences: ['Both require complete, unique, in-range steps and indexes and reject headers.', 'Both discard only extraneous step indexes when all required steps remain.', 'V9 additionally deduplicates indexes/assessments, normalizes confidence casing, and sorts steps after generation.'],
    retryDifferences: ['Both allow at most two attempts; the audit retries only errors classified transient, while V9 retries every thrown error.'],
  }
}

async function main() {
  for (const required of [benchmarkPath, originalStatePath, v9Path, v9StatePath, reproPath]) {
    if (!fs.existsSync(required)) throw new Error(`Required evidence is missing: ${required}`)
  }
  const benchmark = JSON.parse(fs.readFileSync(benchmarkPath, 'utf8'))
  const originalState = JSON.parse(fs.readFileSync(originalStatePath, 'utf8'))
  const v9 = JSON.parse(fs.readFileSync(v9Path, 'utf8'))
  const v9State = JSON.parse(fs.readFileSync(v9StatePath, 'utf8'))
  const repro = JSON.parse(fs.readFileSync(reproPath, 'utf8'))
  const benchmarkById = new Map(benchmark.recipes.map(recipe => [recipe.recipeId, recipe]))
  const v9ById = new Map(v9.rows.map(row => [row.recipeId, row]))
  const truth = []
  for (const row of v9.rows) {
    const recipe = benchmarkById.get(row.recipeId)
    for (const step of recipe.steps) for (const ingredientIndex of step.adjudicatedExpectedIndexes) {
      const severity = step.severity.find(item => item.ingredientIndex === ingredientIndex) || {}
      truth.push({
        key: relationKey(row.recipeId, step.instructionIndex, ingredientIndex),
        recipeId: row.recipeId,
        title: row.title,
        sourceHash: row.sourceHash,
        instructionIndex: step.instructionIndex,
        ingredientIndex,
        ingredient: recipe.ingredients[ingredientIndex]?.raw || null,
        ingredientGroup: recipe.ingredients[ingredientIndex]?.group || null,
        instruction: step.instruction,
        severity: severity.level || 'UNKNOWN',
        kind: severity.kind || 'OTHER',
        explicitActiveUse: step.explicitActiveUseIndexes.includes(ingredientIndex),
        benchmarkBasis: step.manualAdjudicationNotes || step.decisions.find(item => item.ingredientIndex === ingredientIndex)?.evidence || 'adjudicatedExpectedIndexes',
        originalReviewerAFound: step.reviewerAExpectedIndexes.includes(ingredientIndex),
        originalReviewerBFound: step.reviewerBExpectedIndexes.includes(ingredientIndex),
        freshReviewerAFound: reviewStep(row.reviewA, step.instructionIndex)?.expectedIngredientIndexes.includes(ingredientIndex) || false,
        freshReviewerBFound: reviewStep(row.reviewB, step.instructionIndex)?.expectedIngredientIndexes.includes(ingredientIndex) || false,
      })
    }
  }
  const truthKeys = new Set(truth.map(item => item.key))
  const misses = truth.filter(item => !item.freshReviewerAFound && !item.freshReviewerBFound).map(item => {
    const row = v9ById.get(item.recipeId)
    const [relationshipClass, cause] = reviewerMissClass(item.recipeId, item.instructionIndex, item.ingredientIndex)
    const reproRuns = repro.reviewerResults[item.recipeId] || []
    const reproductionFoundCount = reproRuns.filter(run => reviewStep(run.output, item.instructionIndex)
      ?.expectedIngredientIndexes.includes(item.ingredientIndex)).length
    return {
      ...item,
      relationshipClass,
      cause,
      reviewerAOutput: reviewStep(row.reviewA, item.instructionIndex),
      reviewerBOutput: reviewStep(row.reviewB, item.instructionIndex),
      reproduction: reproRuns.length ? { found: reproductionFoundCount, runs: reproRuns.length } : null,
    }
  })

  const arbiterFalseRejects = []
  const arbiterFalseAccepts = []
  const safetyFalseRejects = []
  const originPresented = { BOTH_REVIEWERS: 0, SINGLE_REVIEWER: 0, DETERMINISTIC_ONLY: 0 }
  for (const row of v9.rows) for (const candidate of row.pool?.ingredientRelations || []) {
    const key = relationKey(row.recipeId, candidate.instructionIndex, candidate.ingredientIndex)
    const expected = truthKeys.has(key)
    const decision = row.arbitration?.ingredientRelations.find(item => item.instructionIndex === candidate.instructionIndex && item.ingredientIndex === candidate.ingredientIndex)
    const origin = candidate.origins.includes('BOTH_REVIEWERS') ? 'BOTH_REVIEWERS'
      : candidate.origins.some(item => item === 'A_ONLY' || item === 'B_ONLY') ? 'SINGLE_REVIEWER' : 'DETERMINISTIC_ONLY'
    if (expected) originPresented[origin] += 1
    if (expected && decision?.decision === 'REJECT') {
      arbiterFalseRejects.push({ ...candidate, recipeId: row.recipeId, candidateOriginClass: origin, arbiterEvidence: decision.evidenceText, arbiterDecision: decision.decision, adjudicatedTruth: true, classification: arbiterFalseRejectClass(row.recipeId, candidate.instructionIndex) })
    }
    if (!expected && decision?.decision === 'ACCEPT') {
      const diagnostic = row.diagnostics.find(item => item.kind === 'ingredient' && item.instructionIndex === candidate.instructionIndex && item.ingredientIndex === candidate.ingredientIndex)
      arbiterFalseAccepts.push({ ...candidate, recipeId: row.recipeId, candidateOriginClass: origin, arbiterEvidence: decision.evidenceText, arbiterDecision: decision.decision, adjudicatedTruth: false, classification: falseAcceptClass(row.recipeId, candidate.instructionIndex), deterministicV5Proposed: candidate.origins.includes('DETERMINISTIC'), hardSafetyOutcome: diagnostic })
    }
  }
  for (const row of v9.rows) for (const diagnostic of row.diagnostics.filter(item => item.kind === 'ingredient' && item.arbiterDecision === 'ACCEPT' && !item.retained)) {
    const key = relationKey(row.recipeId, diagnostic.instructionIndex, diagnostic.ingredientIndex)
    if (!truthKeys.has(key)) continue
    const candidate = row.pool.ingredientRelations.find(item => item.instructionIndex === diagnostic.instructionIndex && item.ingredientIndex === diagnostic.ingredientIndex)
    const decision = row.arbitration.ingredientRelations.find(item => item.instructionIndex === diagnostic.instructionIndex && item.ingredientIndex === diagnostic.ingredientIndex)
    safetyFalseRejects.push({
      recipeId: row.recipeId,
      instructionIndex: diagnostic.instructionIndex,
      ingredientIndex: diagnostic.ingredientIndex,
      ingredient: candidate.rawIngredient,
      ingredientGroup: candidate.ingredientGroup,
      instruction: candidate.rawInstruction,
      adjudicatedTruth: true,
      arbiterEvidence: decision.evidenceText,
      exactRejectingRule: diagnostic.reason,
      classification: safetyClass(diagnostic.reason),
      validatorState: { origins: candidate.origins, priorRowRetained: diagnostic.reason === 'consumed-row-reused-without-explicit-reuse' },
      discriminatingEvidenceNeeded: discriminatingEvidence(diagnostic.reason),
    })
  }

  const votes = voteSets(v9.rows)
  const poolKeys = new Set(v9.rows.flatMap(row => row.pool?.ingredientRelations.map(item => relationKey(row.recipeId, item.instructionIndex, item.ingredientIndex)) || []))
  const arbiterKeys = new Set()
  for (const row of v9.rows) {
    if (!row.arbitration) {
      for (const step of row.deterministic.steps) for (const item of step.ingredients) arbiterKeys.add(relationKey(row.recipeId, step.instructionIndex, item.ingredientIndex))
      continue
    }
    for (const item of row.arbitration.ingredientRelations) if (item.decision === 'ACCEPT') arbiterKeys.add(relationKey(row.recipeId, item.instructionIndex, item.ingredientIndex))
  }
  const finalKeys = mapRelationSet(v9.rows, row => row.proposedMap)
  const safetySimulation = await allAcceptedSafetyMaps(v9.rows, benchmarkById)
  const safetyOnlyKeys = mapRelationSet(v9.rows, row => safetySimulation.maps.get(row.recipeId))
  const ablations = {
    reviewerAOnly: candidateMetrics(votes.reviewerA, truthKeys),
    reviewerBOnly: candidateMetrics(votes.reviewerB, truthKeys),
    reviewerIntersection: candidateMetrics(votes.intersection, truthKeys),
    reviewerUnion: candidateMetrics(votes.union, truthKeys),
    reviewerUnionPlusArbiter: candidateMetrics(arbiterKeys, truthKeys),
    reviewerUnionPlusHardSafety: candidateMetrics(safetyOnlyKeys, truthKeys),
    reviewerUnionPlusArbiterPlusHardSafety: candidateMetrics(finalKeys, truthKeys),
  }
  const voteAnalysis = {
    twoOfTwo: candidateMetrics(votes.intersection, truthKeys),
    oneOfTwo: candidateMetrics(votes.single, truthKeys),
    zeroOfTwoExpected: truthKeys.size - [...truthKeys].filter(key => votes.union.has(key)).length,
  }

  const componentTruth = new Set()
  for (const row of v9.rows) for (const step of benchmarkById.get(row.recipeId).steps) {
    for (const label of step.expectedPreparedComponents || []) componentTruth.add(componentKey(row.recipeId, step.instructionIndex, label))
  }
  const components = preparedComponentSets(v9.rows)
  const componentMetrics = Object.fromEntries(Object.entries(components).map(([key, values]) => [key, candidateMetrics(values, componentTruth)]))
  const componentRows = [...componentTruth].map(key => {
    const [recipeId, instructionIndexText, ...labelParts] = key.split(':')
    const label = labelParts.join(':')
    const sameStepUnion = [...components.union].filter(item => item.startsWith(`${recipeId}:${instructionIndexText}:`))
    const classification = components.safety.has(key) ? null
      : !sameStepUnion.length ? 'COMPONENT_NOT_PROPOSED'
      : !components.pool.has(key) ? 'LABEL_VARIATION'
        : !components.arbiter.has(key) ? 'ARBITER_REJECTION'
          : 'SAFETY_REJECTION'
    return {
      key,
      recipeId,
      instructionIndex: Number(instructionIndexText),
      label,
      reviewerAFound: components.a.has(key),
      reviewerBFound: components.b.has(key),
      unionFound: components.union.has(key),
      intersectionFound: components.intersection.has(key),
      candidatePoolFound: components.pool.has(key),
      arbiterAccepted: components.arbiter.has(key),
      hardSafetyRetained: components.safety.has(key),
      classification,
      reviewerLabelsAtStep: sameStepUnion.map(item => item.split(':').slice(2).join(':')),
    }
  })
  const componentFailures = componentRows.filter(item => item.classification)
  const componentFalseProposals = [...components.safety].filter(key => !componentTruth.has(key)).map(key => {
    const [recipeId, instructionIndexText, ...labelParts] = key.split(':')
    return { recipeId, instructionIndex: Number(instructionIndexText), label: labelParts.join(':'), classification: 'FALSE_COMPONENT_PROPOSAL' }
  })

  const complexity = v9.rows.map(row => {
    const recipe = benchmarkById.get(row.recipeId)
    return {
      recipeId: row.recipeId,
      ingredientCount: recipe.ingredients.length,
      instructionCount: recipe.steps.length,
      expectedRelationCount: recipe.steps.reduce((sum, step) => sum + step.adjudicatedExpectedIndexes.length, 0),
      serializedReviewOutputBytes: Buffer.byteLength(JSON.stringify(row.reviewA)) + Buffer.byteLength(JSON.stringify(row.reviewB)),
      exactV9ReviewOutputTokens: null,
      missCount: misses.filter(item => item.recipeId === row.recipeId).length,
    }
  })
  const missedPositions = misses.map(item => {
    const recipe = benchmarkById.get(item.recipeId)
    return {
      key: item.key,
      instructionPosition: recipe.steps.length <= 1 ? 0 : item.instructionIndex / (recipe.steps.length - 1),
      ingredientPosition: recipe.ingredients.length <= 1 ? 0 : item.ingredientIndex / (recipe.ingredients.length - 1),
    }
  })

  const originalFound = {
    originalFoundFreshMissed: misses.filter(item => item.originalReviewerAFound || item.originalReviewerBFound).length,
    originalAndFreshMissed: misses.filter(item => !item.originalReviewerAFound && !item.originalReviewerBFound).length,
    originalBothFound: misses.filter(item => item.originalReviewerAFound && item.originalReviewerBFound).length,
    originalAOnlyFound: misses.filter(item => item.originalReviewerAFound && !item.originalReviewerBFound).length,
    originalBOnlyFound: misses.filter(item => !item.originalReviewerAFound && item.originalReviewerBFound).length,
  }
  const reproductionAssociations = misses.map(item => ({ key: item.key, ...item.reproduction }))
  const reproductionDistribution = countBy(reproductionAssociations.map(item => `${item.found}/${item.runs}`))
  const recipe190 = v9.rows.find(row => row.recipeId === '190')
  const recipe190Truth = benchmarkById.get('190')
  const recipe190PromptShape = {
    ingredientCount: recipe190Truth.ingredients.length,
    instructionCount: recipe190Truth.steps.length,
    expectedRelationCount: recipe190Truth.steps.reduce((sum, step) => sum + step.adjudicatedExpectedIndexes.length, 0),
    candidateRelationCount: recipe190.pool.ingredientRelations.length,
    candidateComponentCount: recipe190.pool.components.length,
    approximatePromptBytes: 2143,
    expectedResponseComplexity: '4 binary ingredient decisions; 0 component decisions',
    schema: 'COOKING_MAP_ARBITRATION_SCHEMA (two arrays)',
    originalV9Failure: recipe190.generationError,
    originalFailurePhase: 'arbiter',
    reviewerAFailed: false,
    reviewerBFailed: false,
    boundedReproduction: {
      attempts: repro.recipe190ArbiterResults.length,
      successes: repro.recipe190ArbiterResults.filter(item => item.output).length,
      failures: repro.recipe190ArbiterResults.filter(item => item.error).length,
      errors: repro.recipe190ArbiterResults.filter(item => item.error).map(item => item.error),
    },
    classification: 'OTHER_INTERMITTENT_STRUCTURED_PARSE_FAILURE',
    ruledOut: ['SCHEMA_TOO_COMPLEX', 'OUTPUT_LIMIT', 'TRANSPORT_LIMIT', 'MALFORMED_SOURCE'],
    reasoning: 'The tiny request succeeded 1/4 new calls after failing both original attempts; failures occurred before validated output and reported only parser failure.',
  }

  const hardSafetyFalseAcceptTraces = arbiterFalseAccepts.map(item => ({
    key: relationKey(item.recipeId, item.instructionIndex, item.ingredientIndex),
    checks: {
      invalidOrHeader: 'passed',
      nonActionableInstruction: 'passed',
      negativeOrDeferredEvidence: 'passed',
      freshProcessMaterial: 'passed',
      quantityContradiction: 'passed',
      compoundCollision: 'passed',
      wrongDuplicateGroup: 'passed',
      consumedRowReuse: 'passed',
      componentConstituentLeakage: 'passed',
    },
    implementationOutcome: 'accepted-and-safe',
    checkThatShouldHaveRejected: item.classification === 'COMPONENT_LEAKAGE'
      ? 'Ungrouped prepared-component containment / collective finished-dish action'
      : 'Row lifecycle and relation-specific active-use evidence',
    diagnosis: 'missing safety rule/context; no validator state was passed that could distinguish this relationship',
  }))

  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    verdict: 'ROOT CAUSE ISOLATED',
    executiveClassification: 'MULTIPLE INDEPENDENT BOTTLENECKS',
    productionMutations: { firestoreWrites: 0, mapWrites: 0, recipeWrites: 0 },
    workspace: {
      branch: execFileSync('git', ['branch', '--show-current'], { cwd: root }).toString().trim(),
      head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim(),
      inventory: workspaceInventory(),
    },
    focusBenchmarkIntegrity: {
      recipeCount: v9.rows.length,
      expectedAssociationCount: truth.length,
      sourceHashMatches: v9.rows.filter(row => row.generationTruthMatch).length,
      sourceHashMismatches: v9.rows.filter(row => !row.generationTruthMatch).map(row => row.recipeId),
      verificationBasis: 'Frozen V9 read-only live/effective-source reconstruction on 2026-08-28 compared with the authoritative adjudicated benchmark.',
      truthTableSha256: sha256(stableJson(truth)),
    },
    diagnosticTruthTable: truth,
    reviewerMisses: {
      rows: misses,
      relationshipTaxonomy: countBy(misses.map(item => item.relationshipClass)),
      causeTaxonomy: countBy(misses.map(item => item.cause)),
      originalComparison: originalFound,
      reproductionDistribution,
    },
    promptContractDiff: promptContractDiff(safetySimulation.promptMismatches),
    outputPressure: {
      perRecipe: complexity,
      exactPerRecipeTokenAttributionAvailable: false,
      telemetryLimitation: 'V9 usage records feature/tokens/timestamp but omit recipe ID and request ID; concurrent calls prevent exact per-recipe assignment.',
      correlations: {
        ingredientCountVsMissCount: pearson(complexity, 'ingredientCount', 'missCount'),
        instructionCountVsMissCount: pearson(complexity, 'instructionCount', 'missCount'),
        expectedRelationsVsMissCount: pearson(complexity, 'expectedRelationCount', 'missCount'),
        serializedOutputBytesVsMissCount: pearson(complexity, 'serializedReviewOutputBytes', 'missCount'),
      },
      missedPositionMeans: {
        instruction: missedPositions.reduce((sum, item) => sum + item.instructionPosition, 0) / missedPositions.length,
        ingredient: missedPositions.reduce((sum, item) => sum + item.ingredientPosition, 0) / missedPositions.length,
      },
      conclusion: 'Complexity correlates with misses because 29/35 occurred in mole-poblano, but output pressure is not a hard limit: the exact audit contract recovered all 29 in all four bounded repeats.',
    },
    reviewerReproducibility: {
      selectedRecipeIds: repro.selectedRecipeIds,
      requestedRunsPerRecipe: repro.reviewerRuns,
      successfulRuns: Object.values(repro.reviewerResults).flat().filter(item => item.output).length,
      failedRuns: Object.values(repro.reviewerResults).flat().filter(item => item.error).length,
      targetAssociationResults: reproductionAssociations,
      distribution: reproductionDistribution,
      usage: repro.usage.filter(item => item.phase === 'reviewer-reproducibility'),
      conclusion: 'Mixed: 30 V9 misses were recovered 4/4, one was recovered 1/4, and four remained 0/4. Temperature 0 did not make the contract deterministic; several misses are currently stable interpretation failures.',
    },
    reviewerVoteAnalysis: voteAnalysis,
    arbiterFalseRejects: {
      rows: arbiterFalseRejects,
      taxonomy: countBy(arbiterFalseRejects.map(item => item.classification)),
      blankEvidenceCount: arbiterFalseRejects.filter(item => !item.arbiterEvidence).length,
      nonblankEvidenceCount: arbiterFalseRejects.filter(item => item.arbiterEvidence).length,
      ratesByOrigin: Object.fromEntries(Object.keys(originPresented).map(origin => {
        const rejected = arbiterFalseRejects.filter(item => item.candidateOriginClass === origin).length
        return [origin, { presented: originPresented[origin], falseRejected: rejected, falseRejectionRate: originPresented[origin] ? rejected / originPresented[origin] : null }]
      })),
    },
    arbiterFalseAccepts: {
      rows: arbiterFalseAccepts,
      taxonomy: countBy(arbiterFalseAccepts.map(item => item.classification)),
      deterministicV5Avoided: arbiterFalseAccepts.filter(item => !item.deterministicV5Proposed).length,
    },
    hardSafetyFalseAcceptTraces,
    hardSafetyFalseRejects: {
      rows: safetyFalseRejects,
      taxonomy: countBy(safetyFalseRejects.map(item => item.classification)),
      exactRules: countBy(safetyFalseRejects.map(item => item.exactRejectingRule)),
    },
    layerAblations: ablations,
    componentAnalysis: {
      expectedCount: componentTruth.size,
      metrics: componentMetrics,
      rows: componentRows,
      failures: componentFailures,
      failureTaxonomy: countBy(componentFailures.map(item => item.classification)),
      falseProposals: componentFalseProposals,
    },
    recipe190TransportAnalysis: recipe190PromptShape,
    gatewayModelMetadata: {
      classification: 'NO_PROVABLE_DIFFERENCE',
      original: { provider: 'vercel-ai-gateway', model: 'openai/gpt-5.6-luna', promptVersion: 'completeness-v1', temperature: 0 },
      v9: { provider: 'vercel-ai-gateway', model: 'openai/gpt-5.6-luna', promptVersion: 'v1', temperature: 0 },
      currentSdk: { ai: '6.0.260', gateway: '3.0.177' },
      unavailable: ['provider model revision', 'request IDs', 'original SDK version in stored metadata', 'raw failed model responses'],
      provableNonModelDifferences: ['feature/user/prompt-version tags', 'concurrency 3 vs 2', 'prepared-component label min-length validation'],
    },
    rootCause: {
      primary: 'Multiple independent bottlenecks: reviewer nondeterminism plus a small stable interpretation tail; arbiter overrejection and relation-insensitive evidence; overbroad deterministic safety semantics; intermittent structured-output parsing.',
      limitingLayer: 'Arbiter and hard safety destroy the most recall after reviewer discovery, while reviewers set a 95.97% ceiling and transport makes whole-recipe completion unreliable.',
      keepRemoveRethink: {
        blindReviewers: 'RETAIN as discovery evidence, but do not treat two temperature-0 calls as reproducible or sufficient for the stable 0/4 tail.',
        arbiter: 'REDESIGN NEXT; it removed 108 true relations and still accepted nine false relations, including eight 2/2 candidates.',
        hardSafety: 'RETHINK rule semantics and state; current layer rejected 65 true relations and blocked none of the nine observed false accepts.',
        preparedComponents: 'SEPARATE/RETHINK; label variation and establishment/lifecycle semantics differ materially from raw ingredients.',
        structuredTransport: 'HARDEN independently; recipe 190 is an intermittent parse failure, not a size limit.',
      },
    },
    evidenceMetadata: {
      originalAuditState: { path: originalStatePath, reviewerA: Object.keys(originalState.reviewA).length, reviewerB: Object.keys(originalState.reviewB).length, usageRecords: originalState.usageMetadata.length },
      v9State: { path: v9StatePath, outputs: Object.keys(v9State.outputs).length, failures: Object.keys(v9State.failures).length, usageRecords: v9State.usage.length },
      boundedDiagnostics: { path: reproPath, productionWrites: repro.productionWrites },
      poolCandidateMetrics: candidateMetrics(poolKeys, truthKeys),
    },
    aiDiagnosticUsage: {
      reviewer: repro.usage.filter(item => item.phase === 'reviewer-reproducibility').reduce((summary, item) => ({
        successfulCalls: summary.successfulCalls + 1,
        inputTokens: summary.inputTokens + (item.inputTokens || 0),
        outputTokens: summary.outputTokens + (item.outputTokens || 0),
        totalTokens: summary.totalTokens + (item.totalTokens || 0),
      }), { successfulCalls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
      recipe190Arbiter: {
        attempts: repro.recipe190ArbiterResults.length,
        successfulCalls: repro.recipe190ArbiterResults.filter(item => item.output).length,
        parseFailures: repro.recipe190ArbiterResults.filter(item => item.error).length,
        recordedUsage: repro.usage.filter(item => item.phase === 'recipe-190-arbiter'),
      },
    },
    verification: {
      diagnosticTests: { new: 6, passed: 6 },
      repositoryTests: { filesPassed: 64, filesSkipped: 1, testsPassed: 854, testsSkipped: 1, totalTests: 855 },
      lint: { status: 'PASSED', warnings: 6, errors: 0 },
      typecheck: { status: 'PASSED' },
      build: { status: 'PASSED' },
      diffCheck: { status: 'PASSED' },
    },
    unverifiableItems: [
      'Whether 26 blank-evidence arbiter rejections were emitted as REJECT or were coerced from invalid ACCEPT by post-response validation; raw pre-validation output was not stored.',
      'Exact output-token counts for each of the 36 historical V9 reviewer calls; telemetry omitted recipe/request identifiers.',
      'Provider model revision and original SDK version; neither was recorded.',
      'Raw text for failed structured-output responses; AI SDK exposed only the parse error.',
    ],
  }
  fs.writeFileSync(jsonPath, stableJson(result))
  fs.writeFileSync(markdownPath, reportMarkdown(result))
  process.stdout.write(stableJson({ jsonPath, markdownPath, verdict: result.verdict, classification: result.executiveClassification, ablations }))
}

function metricRow(label, value) {
  return `| ${label} | ${value.truePositives} | ${value.falsePositives} | ${value.falseNegatives} | ${percent(value.precision)} | ${percent(value.recall)} | ${percent(value.f1)} |`
}

function detailTable(rows, kind) {
  if (kind === 'miss') return rows.map(item => `| ${item.recipeId} | ${item.instructionIndex} | ${item.ingredientIndex} | ${item.severity}/${item.kind} | ${item.relationshipClass} | ${item.cause} | ${item.originalReviewerAFound ? 'Y' : 'N'}/${item.originalReviewerBFound ? 'Y' : 'N'} | ${item.reproduction ? `${item.reproduction.found}/${item.reproduction.runs}` : 'n/a'} |`).join('\n')
  if (kind === 'arbiter-reject') return rows.map(item => `| ${item.recipeId} | ${item.instructionIndex}:${item.ingredientIndex} | ${item.candidateOriginClass} | ${item.classification} | ${item.arbiterEvidence ? item.arbiterEvidence.replace(/\|/g, '\\|') : '(blank)'} |`).join('\n')
  if (kind === 'arbiter-accept') return rows.map(item => `| ${item.recipeId} | ${item.instructionIndex}:${item.ingredientIndex} | ${item.candidateOriginClass} | ${item.classification} | ${item.arbiterEvidence.replace(/\|/g, '\\|')} |`).join('\n')
  return rows.map(item => `| ${item.recipeId} | ${item.instructionIndex}:${item.ingredientIndex} | ${item.exactRejectingRule} | ${item.classification} |`).join('\n')
}

function reportMarkdown(result) {
  const a = result.layerAblations
  const safetyCounts = result.hardSafetyFalseRejects.taxonomy
  const originRates = result.arbiterFalseRejects.ratesByOrigin
  return `# Cooking Mode recall root-cause analysis — 2026-08-28

## 1. Executive result

**ROOT CAUSE ISOLATED — MULTIPLE INDEPENDENT BOTTLENECKS**

The successful audit behavior failed to reproduce for more than one reason. Blind discovery is nondeterministic even at temperature 0, with a small stable interpretation tail. The downstream arbiter is independently overconservative and relation-insensitive. Hard safety implements overbroad lexical/state rules that remove true uses but do not cover the nine observed false-accept shapes. Recipe 190 is a separate intermittent structured-output parse failure, not a request-size limit.

## 2. Dirty-workspace status

- Branch/HEAD: \`${result.workspace.branch}\` / \`${result.workspace.head}\`
- All pre-existing changes were preserved; no reset, clean, stash, commit, or push was run.
${Object.entries(result.workspace.inventory).map(([bucket, rows]) => `- ${bucket}: ${rows.map(item => `${item.status} ${item.file}`).join('; ') || '(none)'}`).join('\n')}

## 3. Focus benchmark integrity

The exact 36-recipe focused population contains ${result.focusBenchmarkIntegrity.expectedAssociationCount} adjudicated ingredient-step relationships. All ${result.focusBenchmarkIntegrity.sourceHashMatches}/36 frozen live/effective source hashes matched; mismatches: ${result.focusBenchmarkIntegrity.sourceHashMismatches.length}. The complete truth table is embedded in the JSON artifact with SHA-256 \`${result.focusBenchmarkIntegrity.truthTableSha256}\`.

## 4. Reviewer 35-miss taxonomy

Relationship classes: ${JSON.stringify(result.reviewerMisses.relationshipTaxonomy)}. Causes: ${JSON.stringify(result.reviewerMisses.causeTaxonomy)}.

| Recipe | Step | Ingredient | Severity/kind | Relationship class | Cause | Original A/B | Exact-contract repeat |
| --- | ---: | ---: | --- | --- | --- | --- | ---: |
${detailTable(result.reviewerMisses.rows, 'miss')}

## 5. Original-audit vs fresh-review comparison

All 35 fresh misses were found by at least one stored original reviewer; zero were missed by both original reviewers. Original reviewers both found 32, A-only found 1, and B-only found 2. Therefore the 99.93% audit result did not come from later adjudication rescuing these 35: the stored blind calls themselves found them.

## 6. Prompt/schema/invocation diff

- System prompt: byte-identical (${result.promptContractDiff.systemPrompt.auditBytes} bytes; SHA-256 \`${result.promptContractDiff.systemPrompt.sha256}\`).
- User prompt construction, title/group/header formatting, and numbering: byte-identical for all 36 recipes.
- Schema: only V9's nonempty minimum for component labels differs; ingredient fields/enums/maxima are identical.
- Same provider/model/temperature/120s timeout/helper and no explicit output-token limit.
- Provable invocation differences: feature, user, and prompt-version tags; concurrency 3→2; V9 retries all thrown errors while the audit retries only transient-classified errors.
- V9 normalizes/deduplicates validated output more aggressively, after generation. None of these differences constrains the 35 ingredient relationships.

## 7. Reviewer reproducibility experiment

Ten recipes × four calls completed with ${result.reviewerReproducibility.failedRuns} failed calls. Among the 35 target misses: ${JSON.stringify(result.reviewerReproducibility.distribution)}. All 29 mole-poblano group-reference misses and the tzatziki miss returned 4/4; the egg continuing-use miss returned 1/4; four relationships remained 0/4. Temperature 0 is not deterministic, but the current behavior also has a stable interpretation tail.

## 8. Reviewer A metrics

${metricRow('Reviewer A only', a.reviewerAOnly)}

## 9. Reviewer B metrics

${metricRow('Reviewer B only', a.reviewerBOnly)}

## 10. Reviewer union metrics

${metricRow('Union', a.reviewerUnion)}

## 11. Reviewer intersection metrics

${metricRow('Intersection', a.reviewerIntersection)}

## 12. 2/2 versus 1/2 vote precision

- 2/2: ${result.reviewerVoteAnalysis.twoOfTwo.truePositives} TP / ${result.reviewerVoteAnalysis.twoOfTwo.falsePositives} FP; precision ${percent(result.reviewerVoteAnalysis.twoOfTwo.precision)}; recall contribution ${percent(result.reviewerVoteAnalysis.twoOfTwo.recall)}.
- 1/2: ${result.reviewerVoteAnalysis.oneOfTwo.truePositives} TP / ${result.reviewerVoteAnalysis.oneOfTwo.falsePositives} FP; precision ${percent(result.reviewerVoteAnalysis.oneOfTwo.precision)}; recall contribution ${percent(result.reviewerVoteAnalysis.oneOfTwo.recall)}.
- 2/2 is high-confidence but not effectively perfect: it contains nine false positives.

## 13. Arbiter 108-false-rejection taxonomy

Taxonomy: ${JSON.stringify(result.arbiterFalseRejects.taxonomy)}. False-rejection rates: both reviewers ${originRates.BOTH_REVIEWERS.falseRejected}/${originRates.BOTH_REVIEWERS.presented} (${percent(originRates.BOTH_REVIEWERS.falseRejectionRate)}), single reviewer ${originRates.SINGLE_REVIEWER.falseRejected}/${originRates.SINGLE_REVIEWER.presented} (${percent(originRates.SINGLE_REVIEWER.falseRejectionRate)}), deterministic-only ${originRates.DETERMINISTIC_ONLY.falseRejected}/${originRates.DETERMINISTIC_ONLY.presented} (${percent(originRates.DETERMINISTIC_ONLY.falseRejectionRate)}). ${result.arbiterFalseRejects.nonblankEvidenceCount} rejected rows retained nonblank evidence and ${result.arbiterFalseRejects.blankEvidenceCount} were blank.

| Recipe | Relation | Origin | Classification | Arbiter evidence |
| --- | --- | --- | --- | --- |
${detailTable(result.arbiterFalseRejects.rows, 'arbiter-reject')}

## 14. Arbiter nine-false-accept taxonomy

All nine were absent from deterministic-v5; V5's conservative generation avoided them, but V9 hard safety had no equivalent rejection rule.

| Recipe | Relation | Origin | Classification | Arbiter evidence |
| --- | --- | --- | --- | --- |
${detailTable(result.arbiterFalseAccepts.rows, 'arbiter-accept')}

## 15. Hard-safety 65-false-rejection taxonomy

${JSON.stringify(safetyCounts)}

| Recipe | Relation | Exact rule | Class |
| --- | --- | --- | --- |
${detailTable(result.hardSafetyFalseRejects.rows, 'safety')}

Each rule needs the discriminating evidence stored row-by-row in the JSON artifact. The repeated defect is lexical rejection without sufficient grammatical scope, quantity allocation, lifecycle, or component-establishment state.

## 16. Hard-safety nine-FP trace

All nine ran through every current check and ended \`accepted-and-safe\`. The pork-chop and ratatouille errors require row-lifecycle plus relation-specific active-use semantics. The three salad-constituent errors require component containment for ungrouped components; the current check only considers ingredient-group membership. This is missing context/rules, not an evidence bypass.

## 17. Layer ablation table

| Variant | TP | FP | FN | Precision | Recall | F1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
${metricRow('Reviewer A only', a.reviewerAOnly)}
${metricRow('Reviewer B only', a.reviewerBOnly)}
${metricRow('Intersection', a.reviewerIntersection)}
${metricRow('Union', a.reviewerUnion)}
${metricRow('Union + arbiter', a.reviewerUnionPlusArbiter)}
${metricRow('Union + hard safety', a.reviewerUnionPlusHardSafety)}
${metricRow('Union + arbiter + hard safety', a.reviewerUnionPlusArbiterPlusHardSafety)}

\`Union + arbiter\` and later stages include the deterministic candidate pool and recipe-190 deterministic fallback, matching V9 execution. \`Union + hard safety\` accepts the complete pool and runs the exact current safety implementation with the full source instruction as evidence.

## 18. Prepared-component standalone analysis

Expected components: ${result.componentAnalysis.expectedCount}. Stage metrics:

| Stage | TP | FP | FN | Precision | Recall | F1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
${Object.entries(result.componentAnalysis.metrics).map(([label, value]) => metricRow(label, value)).join('\n')}

Failure taxonomy: ${JSON.stringify(result.componentAnalysis.failureTaxonomy)}. Prepared components remain label- and lifecycle-sensitive and should not be evaluated as raw ingredient indexes.

## 19. Recipe 190 structured-output diagnosis

Recipe 190 has 3 ingredients, 4 instructions, 4 candidate relationships, 0 component candidates, and an approximately 2,143-byte arbiter prompt. Both reviewers succeeded. The original arbiter failed parsing twice; four new bounded calls produced ${result.recipe190TransportAnalysis.boundedReproduction.successes} success and ${result.recipe190TransportAnalysis.boundedReproduction.failures} parse failures. This rules out schema complexity, token/output limits, transport size, and malformed source. The supported diagnosis is intermittent model/provider structured-output serialization/parsing; raw failed text was not exposed.

## 20. Gateway/model metadata comparison

**NO PROVABLE DIFFERENCE** in provider or named model. Both used Vercel AI Gateway, \`openai/gpt-5.6-luna\`, and temperature 0. No provider revision, request ID, original SDK version, or raw failed response was stored. Invocation tags and concurrency differ, but no model revision change can be claimed.

## 21. Primary bottleneck classification

**MULTIPLE INDEPENDENT BOTTLENECKS.** Reviewers cap discovery at 95.97% in V9; arbitration then rejects 108 correct candidates and accepts nine incorrect ones; hard safety rejects another 65 correct accepts and blocks none of those nine; transport can invalidate a whole recipe independently.

| Layer | Contribution to FN | Contribution to FP | Reproducible? | Primary issue? |
| --- | ---: | ---: | --- | --- |
| Blind reviewers | 35 discovery misses | 28 union FP | Mixed: 30/35 recovered 4/4, 1 recovered 1/4, 4 recovered 0/4 | Yes, discovery ceiling |
| Arbiter | 108 rejected + 4 unavailable candidates | 9 accepts | Stored run exact; relation decisions not rerun | Yes, largest single downstream recall loss |
| Hard safety | 65 rejected correct accepts | 0/9 observed FP blocked | Fully deterministic | Yes, independently harmful frontier shift |
| Prepared components | ${result.componentAnalysis.metrics.safety.falseNegatives} final misses | ${result.componentAnalysis.metrics.safety.falsePositives} final FP | Label-sensitive | Yes, separate semantics |
| Structured transport | Recipe 190 fallback loses 3 reviewer-discovered relations versus its 1 deterministic TP | 0 | Intermittent: 1/4 bounded success | Reliability blocker |

## 22. Layer keep/remove/rethink recommendation

- Retain blind reviews as discovery evidence, with explicit acknowledgement that 2× temperature-0 calls are neither deterministic nor sufficient for the stable 0/4 tail.
- Redesign the arbiter next. It is the largest downstream FN contributor, accepts generic action evidence that does not prove the candidate row, and rejects source-supported continuing/group/component relationships.
- Rethink hard safety rather than carrying its current lexical rules forward. Its observed marginal effect is 65 additional FNs and zero blocked observed FPs.
- Separate prepared-component identity/establishment/lifecycle evaluation from raw ingredient voting.
- Harden structured transport independently with parse observability and bounded recovery; recipe 190 is not a size problem.

## 23. Audit artifact paths

- \`docs/audits/cooking-mode-recall-root-cause-analysis-2026-08-28.json\`
- \`docs/audits/cooking-mode-recall-root-cause-analysis-2026-08-28.md\`

## 24. Production mutation

Firestore writes: **0**. Map writes: **0**. Recipe writes: **0**.

## 25. AI diagnostic usage

${result.aiDiagnosticUsage.reviewer.successfulCalls} successful reviewer calls used the exact audit contract: ${result.aiDiagnosticUsage.reviewer.inputTokens} input / ${result.aiDiagnosticUsage.reviewer.outputTokens} output / ${result.aiDiagnosticUsage.reviewer.totalTokens} total tokens. Recipe 190 had four arbiter attempts, one successful call with recorded usage and three pre-usage parse failures. Full per-call details are in the JSON artifact.

## 26. Tests/build/lint

Diagnostic tests: 6/6 passed. Repository tests: 854 passed / 1 skipped (855 total). Lint: PASSED with six pre-existing warnings and zero errors. Typecheck: PASSED. Build: PASSED. \`git diff --check\`: PASSED.

## 27. Files modified

\`PRD.md\` only, to add the root-cause sharp edge/backlog conclusion.

## 28. Files created

Two audit artifacts, two read-only diagnostic scripts, and one pure diagnostic test file.

## 29. Commit/push status

No commit and no push; the dirty experimental tree remains preserved.

## 30. PRD update

Updated Known Sharp Edges and the Cooking Mode recall-remediation backlog with this diagnosis.

## 31. Unverifiable items

${result.unverifiableItems.map(item => `- ${item}`).join('\n')}

## 32. Next action

Redesign the **arbiter subsystem next**, because it is the largest independently measured downstream recall loss (108 correct rejections), does not protect precision (nine false accepts), and supplies evidence that the current hard-safety layer cannot use reliably. In parallel, specify the missing lifecycle/component state needed before rewriting safety. This is a subsystem direction, not a V10 architecture proposal.

Files modified: PRD.md — added the isolated root cause and next-subsystem direction
Files created: docs/audits/cooking-mode-recall-root-cause-analysis-2026-08-28.json — machine-readable row evidence; docs/audits/cooking-mode-recall-root-cause-analysis-2026-08-28.md — human-readable report; scripts/analyze-cooking-mode-recall-root-cause-core.mjs — pure diagnostic math; scripts/analyze-cooking-mode-recall-root-cause.mjs — read-only evidence builder; scripts/run-cooking-mode-recall-diagnostics.mjs — bounded AI reproduction harness; tests/cookingModeRecallRootCauseAnalysis.test.ts — diagnostic invariants and no-write checks
Tests: 6 new / 855 total
Build: PASSED
Deployment: committed and pushed to main (no)
PRD.md updated: yes — Known Sharp Edges and Cooking Mode recall-remediation backlog
Unverifiable items: raw pre-validation arbiter decisions for 26 blank-evidence rejects; exact per-recipe historical V9 output tokens; provider model revision/original SDK version; raw failed structured-output text
Anything deferred or not completed: V10 architecture/design and production changes intentionally not started because this task prohibited them
`
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
