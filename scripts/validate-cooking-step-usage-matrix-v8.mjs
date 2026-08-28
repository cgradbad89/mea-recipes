#!/usr/bin/env node
/** Read-only focused validation for exhaustive one-call hybrid-v8 mapping. */
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
const benchmarkPath = path.join(root, 'docs/audits/cooking-mode-completeness-audit-2026-08-26.json')
const designInputPath = path.join(root, 'docs/audits/cooking-mode-usage-matrix-v8-design-input-2026-08-27.json')
const statePath = path.join('/tmp', `cooking-step-usage-matrix-v8-focused-${date}-state.json`)
const resultPath = path.join('/tmp', `cooking-step-usage-matrix-v8-focused-${date}.json`)
const reportPath = path.join(root, `docs/audits/cooking-mode-usage-matrix-v8-focused-validation-${date}.md`)
const ownerEmail = 'folstromjohn@gmail.com'
const modelTimeoutMs = 120_000
const concurrency = 3

function stableJson(value) { return `${JSON.stringify(value, null, 2)}\n` }
function normalizeLabel(value) { return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase() }
function ratio(numerator, denominator) { return denominator === 0 ? null : numerator / denominator }
function metric(value) { return value === null ? 'n/a' : `${(value * 100).toFixed(2)}%` }

function readState() {
  if (!fs.existsSync(statePath)) return { version: 1, mode: 'focused', outputs: {}, failures: {}, usage: [] }
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
  if (state.version !== 1 || state.mode !== 'focused') throw new Error('Incompatible v8 validation state')
  return state
}

function saveState(state) { fs.writeFileSync(statePath, stableJson(state)) }

async function loadModules() {
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    resolve: { alias: { '@': root } },
    plugins: [{
      name: 'v8-server-only-marker', enforce: 'pre',
      resolveId(id) { return id === 'server-only' ? '\0v8-server-only' : null },
      load(id) { return id === '\0v8-server-only' ? 'export {}' : null },
    }],
  })
  try {
    return {
      recipeContent: await server.ssrLoadModule('/lib/recipeContent.ts'),
      mapping: await server.ssrLoadModule('/lib/cookingStepMapping.ts'),
      usageMatrix: await server.ssrLoadModule('/lib/cookingStepUsageMatrixAi.ts'),
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
  const controls = [...benchmark.recipes].sort((left, right) => {
    const leftFn = left.steps.reduce((sum, step) => sum + step.falseNegativeIndexes.length, 0)
    const rightFn = right.steps.reduce((sum, step) => sum + step.falseNegativeIndexes.length, 0)
    return leftFn - rightFn || left.recipeId.localeCompare(right.recipeId)
  })
  for (const row of controls) {
    if (selected.size >= 36) break
    selected.add(row.recipeId)
  }
  return selected
}

async function buildRows(production, benchmark, modules) {
  if (benchmark.recipes.length !== 228) throw new Error(`Benchmark population changed: ${benchmark.recipes.length}/228`)
  const selected = focusedIds(benchmark)
  const rows = []
  for (const truth of benchmark.recipes) {
    if (!selected.has(truth.recipeId)) continue
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

async function generateRow(row, modules, state) {
  const key = `${row.recipeId}:${row.sourceHash}`
  const deterministic = await modules.mapping.buildHashedDeterministicCookingStepMap(row.ingredients, row.instructions)
  let matrixOutput = state.outputs[key]?.matrixOutput
  let generationError = state.failures[key] || null
  if (!matrixOutput && !generationError) {
    try {
      matrixOutput = await modules.usageMatrix.createCookingStepUsageMatrixWithAi(
        row.title, row.ingredients, row.instructions, 'v8-focused', modelTimeoutMs,
      )
      state.outputs[key] = { matrixOutput }
    } catch (error) {
      generationError = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      state.failures[key] = generationError
    }
    saveState(state)
  }
  const merge = matrixOutput
    ? modules.usageMatrix.mergeValidatedCookingUsageMatrixDetailed(
      deterministic, row.ingredients, row.instructions, matrixOutput,
    )
    : { mapping: deterministic, reviewed: false, diagnostics: [] }
  return {
    ...row,
    deterministic,
    matrixOutput: matrixOutput || null,
    proposedMap: merge.reviewed ? merge.mapping : deterministic,
    diagnostics: merge.diagnostics,
    matrixReviewFailed: !merge.reviewed,
    generationError,
  }
}

function rawAnalysis(rows) {
  const totals = {
    expectedBenchmarkAssociations: 0,
    useNowCorrect: 0,
    useNowIncorrect: 0,
    expectedUsesClassifiedNotThisStep: 0,
    expectedUsesClassifiedUncertain: 0,
    expectedUsesUnavailableFromFailedMatrix: 0,
    correctUseNowAccepted: 0,
    correctUseNowRejected: 0,
    incorrectUseNowAccepted: 0,
    incorrectUseNowRejected: 0,
    componentEstablishmentsCorrect: 0,
    componentEstablishmentsIncorrect: 0,
    componentUsesCorrect: 0,
    componentUsesIncorrect: 0,
    correctComponentUsesAccepted: 0,
    correctComponentUsesRejected: 0,
    incorrectComponentUsesAccepted: 0,
    incorrectComponentUsesRejected: 0,
  }
  for (const row of rows) {
    for (const truthStep of row.truth.steps) {
      const expected = new Set(truthStep.adjudicatedExpectedIndexes)
      totals.expectedBenchmarkAssociations += expected.size
      const rawStep = row.matrixOutput?.steps?.find(item => item.instructionIndex === truthStep.instructionIndex)
      const decisions = new Map((rawStep?.ingredientDecisions || []).map(item => [item.ingredientIndex, item]))
      const final = new Set(row.proposedMap.steps[truthStep.instructionIndex].ingredients.map(item => item.ingredientIndex))
      for (const ingredientIndex of expected) {
        const decision = decisions.get(ingredientIndex)
        if (!decision) totals.expectedUsesUnavailableFromFailedMatrix++
        else if (decision.decision === 'USE_NOW') {
          totals.useNowCorrect++
          if (final.has(ingredientIndex)) totals.correctUseNowAccepted++
          else totals.correctUseNowRejected++
        } else if (decision.decision === 'NOT_THIS_STEP') totals.expectedUsesClassifiedNotThisStep++
        else totals.expectedUsesClassifiedUncertain++
      }
      for (const decision of decisions.values()) {
        if (decision.decision !== 'USE_NOW' || expected.has(decision.ingredientIndex)) continue
        totals.useNowIncorrect++
        if (final.has(decision.ingredientIndex)) totals.incorrectUseNowAccepted++
        else totals.incorrectUseNowRejected++
      }

      const expectedComponents = new Set(normalizeLabels(truthStep.expectedPreparedComponents || []))
      const finalComponents = new Set(normalizeLabels(
        (row.proposedMap.steps[truthStep.instructionIndex].preparedComponents || []).map(item => item.label),
      ))
      const definitions = new Map((row.matrixOutput?.components || []).map(item => [item.componentId, normalizeLabel(item.canonicalLabel)]))
      for (const component of row.matrixOutput?.components || []) {
        if (component.establishedAtInstructionIndex !== truthStep.instructionIndex) continue
        if (expectedComponents.has(normalizeLabel(component.canonicalLabel))) totals.componentEstablishmentsCorrect++
        else totals.componentEstablishmentsIncorrect++
      }
      for (const use of rawStep?.componentUses || []) {
        if (use.decision !== 'USE_NOW') continue
        const label = definitions.get(use.componentId) || ''
        if (expectedComponents.has(label)) {
          totals.componentUsesCorrect++
          if (finalComponents.has(label)) totals.correctComponentUsesAccepted++
          else totals.correctComponentUsesRejected++
        } else {
          totals.componentUsesIncorrect++
          if (finalComponents.has(label)) totals.incorrectComponentUsesAccepted++
          else totals.incorrectComponentUsesRejected++
        }
      }
    }
  }
  return totals
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

function historicalSafety(rows, designInput) {
  const relevant = designInput.failures.filter(item =>
    item.failureClass === 'V6_INCORRECT_USE_ACCEPTED_BY_VALIDATOR' ||
    item.failureClass === 'V7_INCORRECT_USE_ACCEPTED_BY_VALIDATOR')
  return relevant.map(item => {
    const row = rows.find(candidate => candidate.recipeId === item.recipeId)
    return {
      recipeId: item.recipeId,
      instructionIndex: item.instructionIndex,
      ingredientIndex: item.ingredientIndex,
      historicalClass: item.failureClass,
      rejected: !row?.proposedMap.steps[item.instructionIndex].ingredients.some(reference =>
        reference.ingredientIndex === item.ingredientIndex),
    }
  })
}

function errorRows(rows) {
  const falsePositives = []
  const falseNegatives = []
  const componentMisses = []
  for (const row of rows) {
    const evaluation = evaluateCandidateMap(row.proposedMap, row.truth)
    for (const step of evaluation.steps) {
      const truthStep = row.truth.steps.find(item => item.instructionIndex === step.instructionIndex)
      for (const ingredientIndex of step.falsePositiveIndexes) falsePositives.push({
        recipeId: row.recipeId, title: row.title, instructionIndex: step.instructionIndex,
        ingredientIndex, ingredient: row.ingredients[ingredientIndex], instruction: row.instructions[step.instructionIndex],
      })
      for (const ingredientIndex of step.falseNegativeIndexes) {
        const severity = truthStep.severity.find(item => item.ingredientIndex === ingredientIndex)
        falseNegatives.push({
          recipeId: row.recipeId, title: row.title, instructionIndex: step.instructionIndex,
          ingredientIndex, ingredient: row.ingredients[ingredientIndex], instruction: row.instructions[step.instructionIndex],
          level: severity?.level || 'UNKNOWN', kind: severity?.kind || 'OTHER',
        })
      }
      for (const component of step.preparedComponents.missing) componentMisses.push({
        recipeId: row.recipeId, title: row.title, instructionIndex: step.instructionIndex,
        component, instruction: row.instructions[step.instructionIndex],
      })
    }
  }
  return { falsePositives, falseNegatives, componentMisses }
}

function evaluateGates(summary, raw, named, historical, failedMatrices) {
  const checks = {
    precision: summary.precision === 1,
    overallRecall: (summary.recall ?? 0) >= 0.97,
    explicitActiveUseRecall: (summary.explicitActiveUse.recall ?? 0) >= 0.99,
    criticalRecall: summary.critical.recall === 1,
    highRecall: (summary.high.recall ?? 0) >= 0.99,
    seasoningRecall: (summary.seasoning.recall ?? 0) >= 0.98,
    preparedComponentRecall: (summary.preparedComponents.recall ?? 0) >= 0.95,
    preparedComponentPrecision: summary.preparedComponents.falsePositives === 0,
    incorrectUseNowAccepted: raw.incorrectUseNowAccepted === 0,
    incorrectComponentUsesAccepted: raw.incorrectComponentUsesAccepted === 0,
    historicalFalsePositivesRejected: historical.every(item => item.rejected),
    userRegressions: named.every(item => item.present),
    completeMatrices: failedMatrices === 0,
  }
  return { pass: Object.values(checks).every(Boolean), checks }
}

function blocker(result) {
  const rawIngredientRecall = ratio(
    result.rawAiMatrix.useNowCorrect,
    result.rawAiMatrix.expectedBenchmarkAssociations,
  )
  if ((rawIngredientRecall ?? 0) < 0.97) return 'AI classification recall'
  if ((result.summary.preparedComponents.recall ?? 0) < 0.95) return 'component modeling'
  return 'deterministic validator behavior'
}

function reportMarkdown(result) {
  const usage = result.aiUsage.reduce((totals, item) => ({
    calls: totals.calls + 1,
    inputTokens: totals.inputTokens + (item.inputTokens || 0),
    outputTokens: totals.outputTokens + (item.outputTokens || 0),
    totalTokens: totals.totalTokens + (item.totalTokens || 0),
  }), { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 })
  return `# Cooking Mode usage-matrix v8 focused validation — ${date}

## Executive result

**${result.gates.pass ? 'PASS — V8 FOCUSED GATE' : 'FAIL — V8 FOCUSED GATE'}**

This run was read-only. Firestore recipe writes: **0**. Firestore map writes: **0**.

## Focused metrics

- Recipes: ${result.summary.recipeCount}
- TP / FP / FN: ${result.summary.truePositives} / ${result.summary.falsePositives} / ${result.summary.falseNegatives}
- Precision / recall / F1: ${metric(result.summary.precision)} / ${metric(result.summary.recall)} / ${metric(result.summary.f1)}
- Explicit-active-use recall: ${metric(result.summary.explicitActiveUse.recall)}
- CRITICAL recall: ${metric(result.summary.critical.recall)}
- HIGH recall: ${metric(result.summary.high.recall)}
- Seasoning/herb recall: ${metric(result.summary.seasoning.recall)}
- Prepared-component recall: ${metric(result.summary.preparedComponents.recall)}
- Prepared-component false positives: ${result.summary.preparedComponents.falsePositives}

## Raw AI matrix

${Object.entries(result.rawAiMatrix).map(([key, value]) => `- ${key}: ${value}`).join('\n')}

## Gate checks

${Object.entries(result.gates.checks).map(([key, value]) => `- ${key}: ${value ? 'PASS' : 'FAIL'}`).join('\n')}

## Safety and regressions

- Historical V6/V7 false-positive cases rejected: ${result.historicalSafety.filter(item => item.rejected).length}/${result.historicalSafety.length}
- User regressions present: ${result.namedRegressions.filter(item => item.present).length}/${result.namedRegressions.length}
- Complete structurally valid matrices: ${result.rows.filter(row => !row.matrixReviewFailed).length}/${result.rows.length}

## Errors

- Ingredient false positives: ${result.errors.falsePositives.length}
- Ingredient false negatives: ${result.errors.falseNegatives.length}
- Prepared-component misses: ${result.errors.componentMisses.length}
- Matrix/generation failures: ${result.rows.filter(row => row.matrixReviewFailed).length}

## AI usage

- Successful calls: ${usage.calls}
- Input / output / total tokens: ${usage.inputTokens} / ${usage.outputTokens} / ${usage.totalTokens}
- Model: openai/gpt-5.6-luna
- Temperature: 0
- Prompt version: v1

## Decision

${result.gates.pass
    ? 'Focused gates passed; focused stability is authorized.'
    : `STOP. Primary remaining blocker: **${blocker(result)}**. Stability, the full 228-recipe run, manifest/SHA, migration prompt, production activation, commit, and push are not authorized.`}
`
}

async function main() {
  loadEnv()
  const benchmark = JSON.parse(fs.readFileSync(benchmarkPath, 'utf8'))
  const designInput = JSON.parse(fs.readFileSync(designInputPath, 'utf8'))
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
      process.stdout.write(`focused ${index + 1}/${sourceRows.length}: ${row.recipeId}${generated.generationError ? ' ERROR' : ''}\n`)
      return generated
    })
    const evaluations = rows.map(row => evaluateCandidateMap(row.proposedMap, row.truth))
    const summary = summarizeCandidateEvaluations(evaluations)
    const rawAiMatrix = rawAnalysis(rows)
    const named = namedRegressions(rows)
    const historical = historicalSafety(rows, designInput)
    const failedMatrices = rows.filter(row => row.matrixReviewFailed).length
    const result = {
      date,
      mode: 'focused',
      production: { ...production.counts, unmapped: production.counts.shared - production.counts.mapped },
      sourceChecks: {
        matches: rows.filter(row => row.generationTruthMatch).length,
        mismatches: rows.filter(row => !row.generationTruthMatch).map(row => row.recipeId),
      },
      summary,
      rawAiMatrix,
      namedRegressions: named,
      historicalSafety: historical,
      errors: errorRows(rows),
      aiUsage: state.usage,
      rows: rows.map(row => ({
        recipeId: row.recipeId, title: row.title, currentEngine: row.currentEngine,
        sourceHash: row.sourceHash, currentMap: row.currentMap, proposedMap: row.proposedMap,
        matrixOutput: row.matrixOutput, diagnostics: row.diagnostics,
        matrixReviewFailed: row.matrixReviewFailed, generationError: row.generationError,
        evaluation: evaluateCandidateMap(row.proposedMap, row.truth),
      })),
    }
    result.gates = evaluateGates(summary, rawAiMatrix, named, historical, failedMatrices)
    result.primaryBlocker = result.gates.pass ? null : blocker(result)
    fs.writeFileSync(resultPath, stableJson(result))
    fs.writeFileSync(reportPath, reportMarkdown(result))
    console.log(stableJson({
      resultPath, reportPath, summary: result.summary, rawAiMatrix: result.rawAiMatrix,
      gates: result.gates, sourceChecks: result.sourceChecks, primaryBlocker: result.primaryBlocker,
    }))
  } finally {
    console.info = originalInfo
    await modules.close()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
