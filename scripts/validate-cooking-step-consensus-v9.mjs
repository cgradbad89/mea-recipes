#!/usr/bin/env node
/** Read-only quality validation for dual-blind-reviewer hybrid-v9 mapping. */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import {
  evaluateCandidateMap,
  normalizeLabels,
  summarizeCandidateEvaluations,
} from './evaluate-cooking-step-semantic-v7-core.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { loadEnv, getAdmin } = require('./_lib.js')
const date = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())
const mode = process.argv.includes('--full') ? 'full' : process.argv.includes('--stability') ? 'stability' : 'focused'
const benchmarkPath = path.join(root, 'docs/audits/cooking-mode-completeness-audit-2026-08-26.json')
const designInputPath = path.join(root, 'docs/audits/cooking-mode-usage-matrix-v8-design-input-2026-08-27.json')
const priorV8ResultPath = '/tmp/cooking-step-usage-matrix-v8-focused-2026-08-27.json'
const regressionInputPath = path.join(root, `docs/audits/cooking-mode-consensus-v9-regression-input-${date}.json`)
const focusedResultPath = path.join('/tmp', `cooking-step-consensus-v9-focused-${date}.json`)
const stabilityResultPath = path.join('/tmp', `cooking-step-consensus-v9-stability-${date}.json`)
const fullResultPath = path.join('/tmp', `cooking-step-consensus-v9-full-${date}.json`)
const statePath = path.join('/tmp', `cooking-step-consensus-v9-${mode}-${date}-final-state.json`)
const reportPath = path.join(root, `docs/audits/cooking-mode-consensus-v9-${mode}-validation-${date}.md`)
const manifestJsonPath = path.join(root, `docs/audits/cooking-mode-consensus-v9-dryrun-${date}.json`)
const manifestReportPath = path.join(root, `docs/audits/cooking-mode-consensus-v9-dryrun-${date}.md`)
const ownerEmail = 'folstromjohn@gmail.com'
const modelTimeoutMs = 120_000
const concurrency = 2

function stableJson(value) { return `${JSON.stringify(value, null, 2)}\n` }
function ratio(numerator, denominator) { return denominator === 0 ? null : numerator / denominator }
function metric(value) { return value === null ? 'n/a' : `${(value * 100).toFixed(2)}%` }
function sha256(value) { return createHash('sha256').update(value).digest('hex') }
function relationKey(recipeId, instructionIndex, ingredientIndex) {
  return `${recipeId}:${instructionIndex}:${ingredientIndex}`
}
function componentKey(recipeId, instructionIndex, label) {
  return `${recipeId}:${instructionIndex}:${String(label || '').trim().replace(/\s+/g, ' ').toLowerCase()}`
}

function readState() {
  if (!fs.existsSync(statePath)) return { version: 2, mode, outputs: {}, failures: {}, usage: [] }
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
  if (state.version !== 2 || state.mode !== mode) throw new Error('Incompatible v9 validation state')
  return state
}

function saveState(state) { fs.writeFileSync(statePath, stableJson(state)) }

async function loadModules() {
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    resolve: { alias: { '@': root } },
    plugins: [{
      name: 'v9-server-only-marker', enforce: 'pre',
      resolveId(id) { return id === 'server-only' ? '\0v9-server-only' : null },
      load(id) { return id === '\0v9-server-only' ? 'export {}' : null },
    }],
  })
  try {
    return {
      recipeContent: await server.ssrLoadModule('/lib/recipeContent.ts'),
      mapping: await server.ssrLoadModule('/lib/cookingStepMapping.ts'),
      blind: await server.ssrLoadModule('/lib/cookingStepBlindReviewerAi.ts'),
      arbiter: await server.ssrLoadModule('/lib/cookingStepMapArbiterAi.ts'),
      consensus: await server.ssrLoadModule('/lib/cookingStepMapConsensus.ts'),
      close: () => server.close(),
    }
  } catch (error) {
    await server.close()
    throw error
  }
}

async function readProduction() {
  const admin = getAdmin()
  const [recipes, owner] = await Promise.all([
    admin.firestore().collection('recipes').get(),
    admin.auth().getUserByEmail(ownerEmail),
  ])
  const metas = await admin.firestore()
    .collection('users').doc(owner.uid).collection('recipes').doc('root').collection('meta').get()
  return {
    recipes: new Map(recipes.docs.map(document => [document.id, document.data()])),
    metas: new Map(metas.docs.map(document => [document.id, document.data()])),
    counts: {
      shared: recipes.size,
      mapped: recipes.docs.filter(document => Boolean(document.data().cookingStepIngredientMap)).length,
    },
  }
}

function effectiveContent(sharedContent, meta) {
  return typeof meta?.overrides?.content === 'string' && meta.overrides.content.length > 0
    ? meta.overrides.content : sharedContent
}

function focusedIds(benchmark) {
  const selected = new Set([
    'garlic-butter-herb-steak-bites-with-potatoes',
    'caprese-salad',
    'grilled-zucchini-and-summer-squash',
  ])
  const scored = benchmark.recipes.map(recipe => {
    const falseNegatives = recipe.steps.reduce((sum, step) => sum + step.falseNegativeIndexes.length, 0)
    const critical = recipe.steps.reduce((sum, step) => sum + step.severity
      .filter(item => item.level === 'CRITICAL' && step.falseNegativeIndexes.includes(item.ingredientIndex)).length, 0)
    const seasoning = recipe.steps.reduce((sum, step) => sum + step.severity
      .filter(item => item.kind === 'SEASONING_HERB' && step.falseNegativeIndexes.includes(item.ingredientIndex)).length, 0)
    const prepared = recipe.steps.reduce((sum, step) => sum + (step.expectedPreparedComponents || []).length, 0)
    return { recipeId: recipe.recipeId, score: critical * 100 + prepared * 20 + seasoning * 5 + falseNegatives }
  }).sort((left, right) => right.score - left.score || left.recipeId.localeCompare(right.recipeId))
  for (const row of scored) {
    if (selected.size >= 31) break
    selected.add(row.recipeId)
  }
  const controls = [...benchmark.recipes].sort((left, right) =>
    left.metrics.falseNegatives - right.metrics.falseNegatives || left.recipeId.localeCompare(right.recipeId))
  for (const row of controls) {
    if (selected.size >= 36) break
    selected.add(row.recipeId)
  }
  return selected
}

async function buildRows(production, benchmark, modules) {
  if (benchmark.recipes.length !== 228) throw new Error(`Benchmark population changed: ${benchmark.recipes.length}/228`)
  const selected = mode === 'full' ? null : focusedIds(benchmark)
  const rows = []
  for (const truth of benchmark.recipes) {
    if (selected && !selected.has(truth.recipeId)) continue
    const data = production.recipes.get(truth.recipeId)
    if (!data?.cookingStepIngredientMap) throw new Error(`Mapped benchmark recipe missing: ${truth.recipeId}`)
    const parsed = modules.recipeContent.parseRecipeContent(
      effectiveContent(data.content, production.metas.get(truth.recipeId)),
    )
    const sourceHash = await modules.mapping.computeCookingMappingSourceHash(parsed.ingredients, parsed.instructions)
    rows.push({
      recipeId: truth.recipeId,
      title: data.title || truth.title,
      truth,
      ingredients: parsed.ingredients,
      instructions: parsed.instructions,
      sourceHash,
      currentMap: data.cookingStepIngredientMap,
      currentEngine: data.cookingStepIngredientMap.engineVersion,
      generationTruthMatch: sourceHash === truth.sourceHash,
    })
  }
  const mismatches = rows.filter(row => !row.generationTruthMatch).map(row => row.recipeId)
  if (mismatches.length) {
    throw new Error(`Source hashes changed and require manual re-adjudication: ${mismatches.join(', ')}`)
  }
  return rows.sort((left, right) => left.recipeId.localeCompare(right.recipeId))
}

async function mapConcurrent(items, worker) {
  let next = 0
  const results = new Array(items.length)
  async function run() {
    while (next < items.length) {
      const index = next++
      results[index] = await worker(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run))
  return results
}

async function retryOnce(call) {
  try { return await call() } catch (firstError) {
    try { return await call() } catch (secondError) {
      throw new Error(`first attempt: ${firstError?.message || firstError}; retry: ${secondError?.message || secondError}`)
    }
  }
}

async function generateRow(row, modules, state) {
  const key = `${row.recipeId}:${row.sourceHash}`
  const deterministic = await modules.mapping.buildHashedDeterministicCookingStepMap(row.ingredients, row.instructions)
  let saved = state.outputs[key]
  let generationError = null
  if (!saved?.arbitration) {
    let phase = 'blind-reviewers'
    try {
      const [reviewA, reviewB] = saved?.reviewA && saved?.reviewB
        ? [saved.reviewA, saved.reviewB]
        : await Promise.all([
          retryOnce(() => modules.blind.reviewCookingStepMapBlindlyWithAi(
            'A', row.title, row.ingredients, row.instructions, `v9-${mode}`, modelTimeoutMs,
          )),
          retryOnce(() => modules.blind.reviewCookingStepMapBlindlyWithAi(
            'B', row.title, row.ingredients, row.instructions, `v9-${mode}`, modelTimeoutMs,
          )),
        ])
      const pool = modules.consensus.buildCookingMapCandidatePool(
        deterministic, row.ingredients, row.instructions, reviewA, reviewB,
      )
      saved = { reviewA, reviewB }
      state.outputs[key] = saved
      saveState(state)
      phase = 'arbiter'
      const arbitration = await retryOnce(() => modules.arbiter.arbitrateCookingStepMapWithAi(
        row.title, row.ingredients, row.instructions, pool, `v9-${mode}`, modelTimeoutMs,
      ))
      saved = { ...saved, arbitration }
      state.outputs[key] = saved
      delete state.failures[key]
    } catch (error) {
      generationError = `${phase}: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`
      state.failures[key] = generationError
    }
    saveState(state)
  }
  if (!saved?.arbitration) {
    const pool = saved?.reviewA && saved?.reviewB
      ? modules.consensus.buildCookingMapCandidatePool(
        deterministic, row.ingredients, row.instructions, saved.reviewA, saved.reviewB,
      ) : null
    return {
      ...row, deterministic, reviewA: saved?.reviewA || null, reviewB: saved?.reviewB || null, pool, arbitration: null,
      proposedMap: deterministic, diagnostics: [], generationError: generationError || state.failures[key],
    }
  }
  const pool = modules.consensus.buildCookingMapCandidatePool(
    deterministic, row.ingredients, row.instructions, saved.reviewA, saved.reviewB,
  )
  const merged = await modules.consensus.mergeArbitratedCookingStepMap(
    deterministic, row.ingredients, row.instructions, pool, saved.arbitration,
  )
  return {
    ...row,
    deterministic,
    reviewA: saved.reviewA,
    reviewB: saved.reviewB,
    pool,
    arbitration: saved.arbitration,
    proposedMap: merged.mapping,
    diagnostics: merged.diagnostics,
    generationError: null,
  }
}

function truthStep(row, instructionIndex) {
  return row.truth.steps.find(step => step.instructionIndex === instructionIndex)
}

function reviewerMetrics(rows) {
  const totals = {
    expectedAssociations: 0,
    reviewerAFound: 0,
    reviewerBFound: 0,
    unionFound: 0,
    intersectionFound: 0,
    missedByBoth: 0,
  }
  for (const row of rows) {
    for (const step of row.truth.steps) {
      const expected = step.adjudicatedExpectedIndexes
      const a = new Set(row.reviewA?.steps.find(item => item.instructionIndex === step.instructionIndex)
        ?.expectedIngredientIndexes || [])
      const b = new Set(row.reviewB?.steps.find(item => item.instructionIndex === step.instructionIndex)
        ?.expectedIngredientIndexes || [])
      for (const index of expected) {
        totals.expectedAssociations++
        if (a.has(index)) totals.reviewerAFound++
        if (b.has(index)) totals.reviewerBFound++
        if (a.has(index) || b.has(index)) totals.unionFound++
        if (a.has(index) && b.has(index)) totals.intersectionFound++
        if (!a.has(index) && !b.has(index)) totals.missedByBoth++
      }
    }
  }
  return {
    ...totals,
    reviewerARecall: ratio(totals.reviewerAFound, totals.expectedAssociations),
    reviewerBRecall: ratio(totals.reviewerBFound, totals.expectedAssociations),
    unionRecall: ratio(totals.unionFound, totals.expectedAssociations),
    intersectionRecall: ratio(totals.intersectionFound, totals.expectedAssociations),
  }
}

function arbiterMetrics(rows) {
  const totals = {
    correctCandidateRelationshipsPresented: 0,
    incorrectCandidateRelationshipsPresented: 0,
    correctAccept: 0,
    correctReject: 0,
    correctUncertain: 0,
    correctUnavailable: 0,
    incorrectAccept: 0,
    incorrectReject: 0,
    incorrectUncertain: 0,
    incorrectUnavailable: 0,
  }
  for (const row of rows) {
    for (const candidate of row.pool?.ingredientRelations || []) {
      const expected = truthStep(row, candidate.instructionIndex).adjudicatedExpectedIndexes
        .includes(candidate.ingredientIndex)
      const decision = row.arbitration?.ingredientRelations.find(item =>
        item.instructionIndex === candidate.instructionIndex && item.ingredientIndex === candidate.ingredientIndex)?.decision
      if (expected) totals.correctCandidateRelationshipsPresented++
      else totals.incorrectCandidateRelationshipsPresented++
      const key = `${expected ? 'correct' : 'incorrect'}${!decision ? 'Unavailable' :
        decision === 'ACCEPT' ? 'Accept' : decision === 'REJECT' ? 'Reject' : 'Uncertain'}`
      totals[key]++
    }
  }
  return {
    ...totals,
    correctAcceptanceRate: ratio(totals.correctAccept, totals.correctCandidateRelationshipsPresented),
  }
}

function hardSafetyMetrics(rows) {
  const totals = {
    correctArbiterAcceptRetained: 0,
    correctArbiterAcceptRejected: 0,
    incorrectArbiterAcceptRetained: 0,
    incorrectArbiterAcceptBlocked: 0,
  }
  for (const row of rows) {
    for (const diagnostic of row.diagnostics.filter(item => item.kind === 'ingredient' && item.arbiterDecision === 'ACCEPT')) {
      const expected = truthStep(row, diagnostic.instructionIndex).adjudicatedExpectedIndexes
        .includes(diagnostic.ingredientIndex)
      if (expected && diagnostic.retained) totals.correctArbiterAcceptRetained++
      else if (expected) totals.correctArbiterAcceptRejected++
      else if (diagnostic.retained) totals.incorrectArbiterAcceptRetained++
      else totals.incorrectArbiterAcceptBlocked++
    }
  }
  const correctTotal = totals.correctArbiterAcceptRetained + totals.correctArbiterAcceptRejected
  return {
    ...totals,
    correctArbiterAcceptRejectionRate: ratio(totals.correctArbiterAcceptRejected, correctTotal),
  }
}

function buildRegressionInput(benchmark, designInput) {
  const ingredientFalsePositives = new Map()
  const addIngredient = (recipeId, instructionIndex, ingredientIndex, origin) => {
    const key = relationKey(recipeId, instructionIndex, ingredientIndex)
    const existing = ingredientFalsePositives.get(key) || {
      recipeId: String(recipeId), instructionIndex, ingredientIndex, origins: [],
    }
    if (!existing.origins.includes(origin)) existing.origins.push(origin)
    ingredientFalsePositives.set(key, existing)
  }
  for (const failure of designInput.failures) {
    if (failure.failureClass === 'V6_INCORRECT_USE_ACCEPTED_BY_VALIDATOR') {
      addIngredient(failure.recipeId, failure.instructionIndex, failure.ingredientIndex, 'V6_FALSE_POSITIVE')
    }
    if (failure.failureClass === 'V7_INCORRECT_USE_ACCEPTED_BY_VALIDATOR') {
      addIngredient(failure.recipeId, failure.instructionIndex, failure.ingredientIndex, 'V7_FALSE_POSITIVE')
    }
  }
  for (const recipe of benchmark.recipes) {
    for (const step of recipe.steps) {
      for (const ingredientIndex of step.falsePositiveIndexes) {
        addIngredient(recipe.recipeId, step.instructionIndex, ingredientIndex, 'EXISTING_PRODUCTION_FALSE_POSITIVE')
      }
    }
  }

  const componentFalsePositives = new Map()
  if (fs.existsSync(priorV8ResultPath)) {
    const prior = JSON.parse(fs.readFileSync(priorV8ResultPath, 'utf8'))
    const truthById = new Map(benchmark.recipes.map(recipe => [recipe.recipeId, recipe]))
    for (const row of prior.rows) {
      const truth = truthById.get(row.recipeId)
      if (!truth) continue
      for (const step of row.matrixOutput?.steps || []) {
        const expected = new Set(truth.steps.find(item => item.instructionIndex === step.instructionIndex)
          ?.adjudicatedExpectedIndexes || [])
        for (const decision of step.ingredientDecisions || []) {
          if (decision.decision === 'USE_NOW' && !expected.has(decision.ingredientIndex)) {
            addIngredient(row.recipeId, step.instructionIndex, decision.ingredientIndex, 'V8_RAW_FALSE_POSITIVE')
          }
        }
      }
      for (const evaluation of row.evaluation?.steps || []) {
        for (const label of evaluation.preparedComponents?.falsePositives || []) {
          const key = componentKey(row.recipeId, evaluation.instructionIndex, label)
          componentFalsePositives.set(key, {
            recipeId: row.recipeId,
            instructionIndex: evaluation.instructionIndex,
            label,
            origins: ['V8_ACCEPTED_COMPONENT_FALSE_POSITIVE'],
          })
        }
      }
    }
  }

  const positiveValidatorRegressions = designInput.failures
    .filter(item => item.failureClass === 'V7_CORRECT_USE_REJECTED_BY_VALIDATOR')
    .map(item => ({
      recipeId: String(item.recipeId),
      instructionIndex: item.instructionIndex,
      ingredientIndex: item.ingredientIndex,
      origin: 'V7_CORRECT_USE_REJECTED_BY_VALIDATOR',
    }))
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ingredientFalsePositives: [...ingredientFalsePositives.values()].sort((left, right) =>
      left.recipeId.localeCompare(right.recipeId) || left.instructionIndex - right.instructionIndex ||
      left.ingredientIndex - right.ingredientIndex),
    componentFalsePositives: [...componentFalsePositives.values()].sort((left, right) =>
      left.recipeId.localeCompare(right.recipeId) || left.instructionIndex - right.instructionIndex),
    positiveValidatorRegressions,
  }
}

function evaluateRegressionInput(rows, regressionInput) {
  const rowById = new Map(rows.map(row => [row.recipeId, row]))
  const ingredientFalsePositives = regressionInput.ingredientFalsePositives.flatMap(item => {
    const row = rowById.get(item.recipeId)
    if (!row) return []
    const accepted = row.proposedMap.steps[item.instructionIndex]?.ingredients
      .some(reference => reference.ingredientIndex === item.ingredientIndex) || false
    return [{ ...item, rejected: !accepted }]
  })
  const componentFalsePositives = regressionInput.componentFalsePositives.flatMap(item => {
    const row = rowById.get(item.recipeId)
    if (!row) return []
    const labels = normalizeLabels((row.proposedMap.steps[item.instructionIndex]?.preparedComponents || [])
      .map(component => component.label))
    return [{ ...item, rejected: !labels.includes(String(item.label).toLowerCase()) }]
  })
  const positiveValidatorRegressions = regressionInput.positiveValidatorRegressions.flatMap(item => {
    const row = rowById.get(item.recipeId)
    if (!row) return []
    const arbiterDecision = row.arbitration?.ingredientRelations.find(decision =>
      decision.instructionIndex === item.instructionIndex && decision.ingredientIndex === item.ingredientIndex)?.decision || null
    const diagnostic = row.diagnostics.find(candidate => candidate.kind === 'ingredient' &&
      candidate.instructionIndex === item.instructionIndex && candidate.ingredientIndex === item.ingredientIndex)
    return [{ ...item, arbiterDecision, retained: Boolean(diagnostic?.retained), safetyReason: diagnostic?.reason || null }]
  })
  return { ingredientFalsePositives, componentFalsePositives, positiveValidatorRegressions }
}

function namedRegressions(rows) {
  const checks = [
    ['garlic-butter-herb-steak-bites-with-potatoes', 0, /potato/i],
    ['garlic-butter-herb-steak-bites-with-potatoes', 1, /sirloin|steak/i],
    ['caprese-salad', 0, /mozzarella/i],
    ['grilled-zucchini-and-summer-squash', 1, /italian herb/i],
    ['grilled-zucchini-and-summer-squash', 1, /black pepper/i],
    ['grilled-zucchini-and-summer-squash', 1, /yellow summer squash/i],
  ]
  return checks.map(([recipeId, instructionIndex, pattern]) => {
    const row = rows.find(item => item.recipeId === recipeId)
    const ingredientIndex = row?.ingredients.findIndex(raw => pattern.test(raw)) ?? -1
    return {
      recipeId, instructionIndex, ingredientIndex,
      present: row?.proposedMap.steps[instructionIndex].ingredients
        .some(reference => reference.ingredientIndex === ingredientIndex) || false,
    }
  })
}

function errors(rows) {
  const result = { falsePositives: [], falseNegatives: [], componentFalsePositives: [], componentMisses: [] }
  for (const row of rows) {
    const evaluation = evaluateCandidateMap(row.proposedMap, row.truth)
    for (const step of evaluation.steps) {
      const truth = truthStep(row, step.instructionIndex)
      for (const ingredientIndex of step.falsePositiveIndexes) result.falsePositives.push({
        recipeId: row.recipeId, instructionIndex: step.instructionIndex, ingredientIndex,
        ingredient: row.ingredients[ingredientIndex], instruction: row.instructions[step.instructionIndex],
      })
      for (const ingredientIndex of step.falseNegativeIndexes) {
        const severity = truth.severity.find(item => item.ingredientIndex === ingredientIndex)
        result.falseNegatives.push({
          recipeId: row.recipeId, instructionIndex: step.instructionIndex, ingredientIndex,
          ingredient: row.ingredients[ingredientIndex], instruction: row.instructions[step.instructionIndex],
          level: severity?.level || 'UNKNOWN', kind: severity?.kind || 'OTHER',
        })
      }
      for (const label of step.preparedComponents.falsePositives) result.componentFalsePositives.push({
        recipeId: row.recipeId, instructionIndex: step.instructionIndex, label,
      })
      for (const label of step.preparedComponents.missing) result.componentMisses.push({
        recipeId: row.recipeId, instructionIndex: step.instructionIndex, label,
      })
    }
  }
  return result
}

function qualityGates(summary, reviewer, arbiter, safety, regressions, named, rows) {
  const focused = mode !== 'full'
  const checks = {
    reviewerUnionRecall: (reviewer.unionRecall ?? 0) >= 0.995,
    arbiterIncorrectAccept: arbiter.incorrectAccept === 0,
    arbiterCorrectAcceptance: (arbiter.correctAcceptanceRate ?? 0) >= 0.99,
    hardSafetyIncorrectFinalAccepted: safety.incorrectArbiterAcceptRetained === 0,
    hardSafetyCorrectRejectionRate: (safety.correctArbiterAcceptRejectionRate ?? 1) <= 0.005,
    precision: summary.precision === 1,
    overallRecall: (summary.recall ?? 0) >= 0.98,
    explicitActiveUseRecall: (summary.explicitActiveUse.recall ?? 0) >= 0.99,
    criticalRecall: summary.critical.recall === 1,
    highRecall: (summary.high.recall ?? 0) >= 0.99,
    seasoningRecall: (summary.seasoning.recall ?? 0) >= 0.98,
    preparedComponentRecall: (summary.preparedComponents.recall ?? 0) >= 0.95,
    preparedComponentPrecision: summary.preparedComponents.falsePositives === 0,
    userRegressions: named.every(item => item.present),
    historicalIngredientFalsePositives: regressions.ingredientFalsePositives.every(item => item.rejected),
    historicalComponentFalsePositives: regressions.componentFalsePositives.every(item => item.rejected),
    validatorPositiveRegressions: regressions.positiveValidatorRegressions.every(item =>
      item.arbiterDecision === 'ACCEPT' && item.retained),
    completeRuns: rows.every(row => !row.generationError),
  }
  return { pass: Object.values(checks).every(Boolean), checks, focused }
}

function reportMarkdown(result) {
  const usage = result.aiUsage.reduce((totals, item) => ({
    calls: totals.calls + 1,
    inputTokens: totals.inputTokens + (item.inputTokens || 0),
    outputTokens: totals.outputTokens + (item.outputTokens || 0),
    totalTokens: totals.totalTokens + (item.totalTokens || 0),
  }), { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 })
  const verdict = result.gates.pass
    ? `PASS — V9 ${mode.toUpperCase()} GATE`
    : mode === 'focused' ? 'FAIL — V9 FOCUSED GATE' : `FAIL — V9 ${mode.toUpperCase()} GATE`
  return `# Cooking Mode consensus v9 ${mode} validation — ${date}

## Executive result

**${verdict}**

This run was read-only. Firestore recipe writes: **0**. Firestore map writes: **0**.

## Reviewer discovery before arbitration

- Expected associations: ${result.reviewerMetrics.expectedAssociations}
- Reviewer A: ${result.reviewerMetrics.reviewerAFound} (${metric(result.reviewerMetrics.reviewerARecall)})
- Reviewer B: ${result.reviewerMetrics.reviewerBFound} (${metric(result.reviewerMetrics.reviewerBRecall)})
- Union: ${result.reviewerMetrics.unionFound} (${metric(result.reviewerMetrics.unionRecall)})
- Intersection: ${result.reviewerMetrics.intersectionFound} (${metric(result.reviewerMetrics.intersectionRecall)})
- Missed by both: ${result.reviewerMetrics.missedByBoth}

## Arbiter metrics

${Object.entries(result.arbiterMetrics).map(([key, value]) => `- ${key}: ${typeof value === 'number' && key.endsWith('Rate') ? metric(value) : value}`).join('\n')}

## Hard-safety metrics

${Object.entries(result.hardSafetyMetrics).map(([key, value]) => `- ${key}: ${typeof value === 'number' && key.endsWith('Rate') ? metric(value) : value}`).join('\n')}

## Final quality

- Recipes: ${result.summary.recipeCount}
- TP / FP / FN: ${result.summary.truePositives} / ${result.summary.falsePositives} / ${result.summary.falseNegatives}
- Precision / recall / F1: ${metric(result.summary.precision)} / ${metric(result.summary.recall)} / ${metric(result.summary.f1)}
- Explicit-active-use recall: ${metric(result.summary.explicitActiveUse.recall)}
- CRITICAL recall: ${metric(result.summary.critical.recall)}
- HIGH recall: ${metric(result.summary.high.recall)}
- Seasoning/herb recall: ${metric(result.summary.seasoning.recall)}
- Prepared-component recall: ${metric(result.summary.preparedComponents.recall)}
- Prepared-component false positives: ${result.summary.preparedComponents.falsePositives}

## Regression gates

- Named UI regressions: ${result.namedRegressions.filter(item => item.present).length}/${result.namedRegressions.length}
- Historical ingredient false positives rejected: ${result.regressions.ingredientFalsePositives.filter(item => item.rejected).length}/${result.regressions.ingredientFalsePositives.length}
- Historical component false positives rejected: ${result.regressions.componentFalsePositives.filter(item => item.rejected).length}/${result.regressions.componentFalsePositives.length}
- Former V7 correct validator rejections accepted and retained: ${result.regressions.positiveValidatorRegressions.filter(item => item.arbiterDecision === 'ACCEPT' && item.retained).length}/${result.regressions.positiveValidatorRegressions.length}

## Gate checks

${Object.entries(result.gates.checks).map(([key, value]) => `- ${key}: ${value ? 'PASS' : 'FAIL'}`).join('\n')}

## Remaining errors

- Ingredient false positives: ${result.errors.falsePositives.length}
- Ingredient false negatives: ${result.errors.falseNegatives.length}
- Component false positives: ${result.errors.componentFalsePositives.length}
- Component misses: ${result.errors.componentMisses.length}
- Generation/validation failures: ${result.rows.filter(row => row.generationError).length}

## AI usage

- Successful requests: ${usage.calls}
- Input / output / total tokens: ${usage.inputTokens} / ${usage.outputTokens} / ${usage.totalTokens}
- Model: openai/gpt-5.6-luna
- Temperature: 0
- Blind reviewer prompt: v1
- Map arbiter prompt: v1

## Decision

${result.gates.pass
    ? (mode === 'focused' ? 'Focused quality passed; focused stability is authorized.' : `${mode} quality passed.`)
    : 'STOP. Do not run later gates, generate a migration manifest, activate V9, commit, or push.'}
`
}

function semanticMapShape(map) {
  return map.steps.map(step => ({
    instructionIndex: step.instructionIndex,
    ingredients: step.ingredients.map(item => item.ingredientIndex).sort((a, b) => a - b),
    components: normalizeLabels((step.preparedComponents || []).map(item => item.label)),
  }))
}

function stabilityResult(primary, repeated) {
  const primaryById = new Map(primary.rows.map(row => [row.recipeId, row]))
  const classifications = repeated.map(row => {
    const first = primaryById.get(row.recipeId)
    if (!first || row.generationError) return { recipeId: row.recipeId, classification: 'UNSAFE_MATERIAL_DIFFERENCE' }
    if (JSON.stringify(first.proposedMap) === JSON.stringify(row.proposedMap)) {
      return { recipeId: row.recipeId, classification: 'EXACT_STABLE' }
    }
    if (JSON.stringify(semanticMapShape(first.proposedMap)) === JSON.stringify(semanticMapShape(row.proposedMap))) {
      return { recipeId: row.recipeId, classification: 'SEMANTICALLY_STABLE' }
    }
    const evaluation = evaluateCandidateMap(row.proposedMap, row.truth)
    const unsafe = evaluation.steps.some(step => step.falsePositiveIndexes.length ||
      step.preparedComponents.falsePositives.length)
    return {
      recipeId: row.recipeId,
      classification: unsafe ? 'UNSAFE_MATERIAL_DIFFERENCE' : 'SAFE_OMISSION_DIFFERENCE',
      primary: semanticMapShape(first.proposedMap),
      repeat: semanticMapShape(row.proposedMap),
    }
  })
  return {
    classifications,
    counts: Object.fromEntries(['EXACT_STABLE', 'SEMANTICALLY_STABLE', 'SAFE_OMISSION_DIFFERENCE', 'UNSAFE_MATERIAL_DIFFERENCE']
      .map(value => [value, classifications.filter(item => item.classification === value).length])),
    pass: classifications.every(item => item.classification !== 'UNSAFE_MATERIAL_DIFFERENCE'),
  }
}

function createMigrationManifest(result) {
  const rows = result.rows.map(row => {
    if (row.generationError) return { recipeId: row.recipeId, classification: 'ERROR', error: row.generationError }
    if (!row.generationTruthMatch) return { recipeId: row.recipeId, classification: 'EXCLUDED', reason: 'source-hash-mismatch' }
    const evaluation = evaluateCandidateMap(row.proposedMap, row.truth)
    const exact = evaluation.steps.every(step => step.falsePositiveIndexes.length === 0 &&
      step.falseNegativeIndexes.length === 0 && step.preparedComponents.falsePositives.length === 0 &&
      step.preparedComponents.missing.length === 0)
    return {
      recipeId: row.recipeId,
      classification: exact ? 'READY' : 'REVIEW',
      liveSourceHash: row.sourceHash,
      currentMap: row.currentMap,
      proposedMap: row.proposedMap,
      qualityMetrics: evaluation,
      livePreconditions: {
        sourceHash: row.sourceHash,
        currentMap: row.currentMap,
      },
    }
  }).sort((left, right) => left.recipeId.localeCompare(right.recipeId))
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    architecture: 'deterministic-v5 -> blind reviewer A + blind reviewer B -> source-grounded arbiter -> hard safety -> hybrid-v9',
    productionWrites: 0,
    rows,
  }
}

async function main() {
  loadEnv()
  const benchmark = JSON.parse(fs.readFileSync(benchmarkPath, 'utf8'))
  const designInput = JSON.parse(fs.readFileSync(designInputPath, 'utf8'))
  if (mode !== 'focused') {
    if (!fs.existsSync(focusedResultPath)) throw new Error('Focused V9 result is missing')
    const focused = JSON.parse(fs.readFileSync(focusedResultPath, 'utf8'))
    if (!focused.gates?.pass) throw new Error('Focused V9 gate failed; later validation is prohibited')
    if (mode === 'full') {
      if (!fs.existsSync(stabilityResultPath)) throw new Error('Focused V9 stability result is missing')
      const stability = JSON.parse(fs.readFileSync(stabilityResultPath, 'utf8'))
      if (!stability.stability?.pass) throw new Error('Focused V9 stability failed; full validation is prohibited')
    }
  }
  const regressionInput = buildRegressionInput(benchmark, designInput)
  if (mode === 'focused') fs.writeFileSync(regressionInputPath, stableJson(regressionInput))
  const state = readState()
  const modules = await loadModules()
  const originalInfo = console.info
  console.info = (label, metadata, ...rest) => {
    if (label === '[ai-usage]') {
      state.usage.push({ ...metadata, capturedAt: new Date().toISOString() })
      saveState(state)
      return
    }
    originalInfo(label, metadata, ...rest)
  }
  try {
    const production = await readProduction()
    const sourceRows = await buildRows(production, benchmark, modules)
    const rows = await mapConcurrent(sourceRows, async (row, index) => {
      const generated = await generateRow(row, modules, state)
      process.stdout.write(`${mode} ${index + 1}/${sourceRows.length}: ${row.recipeId}${generated.generationError ? ' ERROR' : ''}\n`)
      return generated
    })
    const evaluations = rows.map(row => evaluateCandidateMap(row.proposedMap, row.truth))
    const summary = summarizeCandidateEvaluations(evaluations)
    const reviewer = reviewerMetrics(rows)
    const arbiter = arbiterMetrics(rows)
    const safety = hardSafetyMetrics(rows)
    const regressions = evaluateRegressionInput(rows, regressionInput)
    const named = namedRegressions(rows)
    const result = {
      date,
      mode,
      production: { ...production.counts, unmapped: production.counts.shared - production.counts.mapped },
      productionMutations: 0,
      sourceChecks: { matches: rows.length, mismatches: [] },
      summary,
      reviewerMetrics: reviewer,
      arbiterMetrics: arbiter,
      hardSafetyMetrics: safety,
      namedRegressions: named,
      regressions,
      errors: errors(rows),
      aiUsage: state.usage,
      rows: rows.map(row => ({
        recipeId: row.recipeId,
        title: row.title,
        sourceHash: row.sourceHash,
        currentEngine: row.currentEngine,
        generationTruthMatch: row.generationTruthMatch,
        currentMap: row.currentMap,
        deterministic: row.deterministic,
        reviewA: row.reviewA,
        reviewB: row.reviewB,
        pool: row.pool,
        arbitration: row.arbitration,
        diagnostics: row.diagnostics,
        proposedMap: row.proposedMap,
        generationError: row.generationError,
        evaluation: evaluateCandidateMap(row.proposedMap, row.truth),
      })),
    }
    result.gates = qualityGates(summary, reviewer, arbiter, safety, regressions, named, rows)

    if (mode === 'stability') {
      const primary = JSON.parse(fs.readFileSync(focusedResultPath, 'utf8'))
      result.stability = stabilityResult(primary, rows)
      result.gates.pass = result.gates.pass && result.stability.pass
    }

    const resultPath = mode === 'focused' ? focusedResultPath : mode === 'stability' ? stabilityResultPath : fullResultPath
    fs.writeFileSync(resultPath, stableJson(result))
    fs.writeFileSync(reportPath, reportMarkdown(result))

    let manifest = null
    if (mode === 'full' && result.gates.pass) {
      manifest = createMigrationManifest(result)
      const serialized = stableJson(manifest)
      fs.writeFileSync(manifestJsonPath, serialized)
      const hash = sha256(serialized)
      if (sha256(fs.readFileSync(manifestJsonPath)) !== hash) throw new Error('manifest SHA verification failed')
      fs.writeFileSync(manifestReportPath, `# Cooking Mode consensus v9 dry run — ${date}\n\n- Manifest: ${path.basename(manifestJsonPath)}\n- SHA-256: \`${hash}\`\n- READY: ${manifest.rows.filter(row => row.classification === 'READY').length}\n- REVIEW: ${manifest.rows.filter(row => row.classification === 'REVIEW').length}\n- EXCLUDED: ${manifest.rows.filter(row => row.classification === 'EXCLUDED').length}\n- ERROR: ${manifest.rows.filter(row => row.classification === 'ERROR').length}\n- Production writes: 0\n`)
      manifest = { path: manifestJsonPath, reportPath: manifestReportPath, sha256: hash }
    }
    process.stdout.write(stableJson({
      resultPath, reportPath, regressionInputPath, summary, reviewerMetrics: reviewer,
      arbiterMetrics: arbiter, hardSafetyMetrics: safety, gates: result.gates,
      stability: result.stability || null, manifest,
    }))
  } finally {
    console.info = originalInfo
    await modules.close()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
