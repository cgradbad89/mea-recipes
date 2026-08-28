#!/usr/bin/env node
/** Read-only production validation for source-grounded one-call hybrid-v7 mapping. */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import {
  evaluateCandidateMap,
  evaluateV7QualityGates,
  normalizeIndexes,
  normalizeLabels,
  summarizeCandidateEvaluations,
} from './evaluate-cooking-step-semantic-v7-core.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { loadEnv, getAdmin } = require('./_lib.js')
const auditPath = path.join(root, 'docs/audits/cooking-mode-completeness-audit-2026-08-26.json')
const date = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())
const mode = process.argv.includes('--full') ? 'full' : process.argv.includes('--stability') ? 'stability' : 'focused'
const benchmarkMode = mode === 'full' ? 'full' : 'focused'
const modelTimeoutMs = 120_000
const ownerEmail = 'folstromjohn@gmail.com'
const concurrency = 3
const statePath = path.join('/tmp', `cooking-step-semantic-v7-${mode}-${date}-state.json`)
const resultPath = path.join('/tmp', `cooking-step-semantic-v7-${mode}-${date}.json`)
const focusedResultPath = path.join('/tmp', `cooking-step-semantic-v7-focused-${date}.json`)
const focusedReportPath = path.join(root, `docs/audits/cooking-mode-semantic-v7-focused-validation-${date}.md`)
const manifestPath = path.join(root, `docs/audits/cooking-mode-semantic-v7-dryrun-${date}.json`)
const fullReportPath = path.join(root, `docs/audits/cooking-mode-semantic-v7-dryrun-${date}.md`)

function stableJson(value) { return `${JSON.stringify(value, null, 2)}\n` }

function readState() {
  if (!fs.existsSync(statePath)) return { version: 1, mode, outputs: {}, usage: [] }
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
  if (state.version !== 1 || state.mode !== mode) throw new Error('Incompatible v7 validation state')
  return state
}

function saveState(state) { fs.writeFileSync(statePath, stableJson(state)) }

async function loadModules() {
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    resolve: { alias: { '@': root } },
    plugins: [{
      name: 'v7-server-only-marker', enforce: 'pre',
      resolveId(id) { return id === 'server-only' ? '\0v7-server-only' : null },
      load(id) { return id === '\0v7-server-only' ? 'export {}' : null },
    }],
  })
  try {
    return {
      recipeContent: await server.ssrLoadModule('/lib/recipeContent.ts'),
      mapping: await server.ssrLoadModule('/lib/cookingStepMapping.ts'),
      semantic: await server.ssrLoadModule('/lib/cookingStepSemanticMapAi.ts'),
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
  const selected = benchmarkMode === 'full' ? null : focusedIds(benchmark)
  const rows = []
  for (const truth of benchmark.recipes) {
    if (selected && !selected.has(truth.recipeId)) continue
    const data = production.recipes.get(truth.recipeId)
    if (!data?.cookingStepIngredientMap) throw new Error(`Mapped benchmark recipe missing: ${truth.recipeId}`)
    const shared = modules.recipeContent.parseRecipeContent(data.content)
    const effective = modules.recipeContent.parseRecipeContent(effectiveContent(data.content, production.metas.get(truth.recipeId)))
    const parsed = benchmarkMode === 'full' ? shared : effective
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
  let fatal = null
  const results = new Array(items.length)
  async function run() {
    while (next < items.length && fatal === null) {
      const index = next++
      try { results[index] = await worker(items[index], index) } catch (error) { fatal ||= error }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run))
  if (fatal) throw fatal
  return results
}

async function generateRow(row, modules, state) {
  const key = `${row.recipeId}:${row.sourceHash}`
  let semanticOutput = state.outputs[key]?.semanticOutput
  const deterministic = await modules.mapping.buildHashedDeterministicCookingStepMap(row.ingredients, row.instructions)
  if (!semanticOutput) {
    semanticOutput = await modules.semantic.createCookingStepSemanticMapWithAi(
      row.title, row.ingredients, row.instructions, `v7-${mode}`, modelTimeoutMs,
    )
    state.outputs[key] = { semanticOutput }
    saveState(state)
  }
  for (const step of semanticOutput.steps || []) {
    for (const use of step.ingredientUses || []) {
      if (use.usage && !Object.hasOwn(use.usage, 'quantityText')) use.usage.quantityText = null
    }
  }
  const merge = modules.semantic.mergeValidatedAiSemanticCookingMapDetailed(
    deterministic, row.ingredients, row.instructions, semanticOutput,
  )
  const semanticReviewFailed = !merge.reviewed || merge.mapping.engineVersion !== 'hybrid-v7'
  return {
    ...row,
    deterministic,
    semanticOutput,
    proposedMap: semanticReviewFailed ? deterministic : merge.mapping,
    diagnostics: merge.diagnostics,
    semanticReviewFailed,
  }
}

function rawAnalysis(rows) {
  const totals = {
    expectedBenchmarkAssociations: 0,
    aiSemanticPlanFound: 0,
    aiSemanticPlanMissed: 0,
    aiCorrectProposalsAccepted: 0,
    aiCorrectProposalsRejected: 0,
    aiIncorrectProposalsRejected: 0,
    aiIncorrectProposalsAccepted: 0,
  }
  for (const row of rows) {
    for (const truthStep of row.truth.steps) {
      const proposalStep = row.semanticOutput.steps.find(item => item.instructionIndex === truthStep.instructionIndex)
      const proposed = new Set((proposalStep?.ingredientUses || [])
        .filter(item => item.confidence === 'high').map(item => item.ingredientIndex))
      const expected = new Set(truthStep.adjudicatedExpectedIndexes)
      const final = new Set(row.proposedMap.steps[truthStep.instructionIndex].ingredients.map(item => item.ingredientIndex))
      totals.expectedBenchmarkAssociations += expected.size
      for (const index of expected) {
        if (proposed.has(index)) {
          totals.aiSemanticPlanFound++
          if (final.has(index)) totals.aiCorrectProposalsAccepted++
          else totals.aiCorrectProposalsRejected++
        } else totals.aiSemanticPlanMissed++
      }
      for (const index of proposed) {
        if (expected.has(index)) continue
        if (final.has(index)) totals.aiIncorrectProposalsAccepted++
        else totals.aiIncorrectProposalsRejected++
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

function metric(value) { return value === null ? 'n/a' : `${(value * 100).toFixed(2)}%` }

function reportMarkdown(result) {
  const verdict = result.gates.pass ? 'PASS — focused v7 gates met' : 'FAIL — V7 FOCUSED GATE'
  const fnClasses = result.errors.falseNegatives.reduce((counts, item) => {
    counts[item.kind] = (counts[item.kind] || 0) + 1
    return counts
  }, {})
  const usage = result.aiUsage.reduce((totals, item) => ({
    calls: totals.calls + 1,
    inputTokens: totals.inputTokens + (item.inputTokens || 0),
    outputTokens: totals.outputTokens + (item.outputTokens || 0),
    totalTokens: totals.totalTokens + (item.totalTokens || 0),
  }), { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 })
  return `# Cooking Mode semantic v7 ${mode} validation — ${date}

## Executive result

**${verdict}**

This run was read-only. Firestore recipe writes: **0**. Firestore map writes: **0**.

## Metrics

- Recipes: ${result.summary.recipeCount}
- TP / FP / FN: ${result.summary.truePositives} / ${result.summary.falsePositives} / ${result.summary.falseNegatives}
- Precision: ${metric(result.summary.precision)}
- Recall: ${metric(result.summary.recall)}
- F1: ${metric(result.summary.f1)}
- Explicit-active-use recall: ${metric(result.summary.explicitActiveUse.recall)}
- CRITICAL recall: ${metric(result.summary.critical.recall)}
- HIGH recall: ${metric(result.summary.high.recall)}
- Seasoning/herb recall: ${metric(result.summary.seasoning.recall)}
- Prepared-component recall: ${metric(result.summary.preparedComponents.recall)}
- Prepared-component false positives: ${result.summary.preparedComponents.falsePositives}

## Raw AI versus validator

${Object.entries(result.rawAiVsValidator).map(([key, value]) => `- ${key}: ${value}`).join('\n')}

## Gate checks

${Object.entries(result.gates.checks).map(([key, value]) => `- ${key}: ${value ? 'PASS' : 'FAIL'}`).join('\n')}

## Errors

- Ingredient false positives: ${result.errors.falsePositives.length}
- Ingredient false negatives: ${result.errors.falseNegatives.length}
- Prepared-component misses: ${result.errors.componentMisses.length}
- Invalid semantic plans that used deterministic-v5 fallback: ${result.rows.filter(row => row.semanticReviewFailed).length}

False negatives by class:

${Object.entries(fnClasses).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `- ${key}: ${value}`).join('\n')}

Ingredient false positives:

${result.errors.falsePositives.length === 0 ? '- none' : result.errors.falsePositives.map(item =>
    `- ${item.recipeId} step ${item.instructionIndex}, ingredient ${item.ingredientIndex}: ${item.ingredient}`
  ).join('\n')}

Remaining ingredient false negatives:

${result.errors.falseNegatives.length === 0 ? '- none' : result.errors.falseNegatives.map(item =>
    `- ${item.recipeId} step ${item.instructionIndex}, ingredient ${item.ingredientIndex} (${item.level}/${item.kind}): ${item.ingredient}`
  ).join('\n')}

Remaining prepared-component misses:

${result.errors.componentMisses.length === 0 ? '- none' : result.errors.componentMisses.map(item =>
    `- ${item.recipeId} step ${item.instructionIndex}: ${item.component}`
  ).join('\n')}

## AI usage for this final focused pass

- Successful calls: ${usage.calls}
- Input tokens: ${usage.inputTokens}
- Output tokens: ${usage.outputTokens}
- Total tokens: ${usage.totalTokens}
- Model: openai/gpt-5.6-luna
- Temperature: 0
- Prompt version: v1

## Decision

${result.gates.pass
    ? 'Focused gates passed; a separate stability rerun is authorized.'
    : 'STOP. The full 228-recipe run, production activation, manifest creation, commit, and push are not authorized.'}
`
}

function semanticSignature(map) {
  return map.steps.map(step => ({
    instructionIndex: step.instructionIndex,
    ingredients: normalizeIndexes(step.ingredients.map(item => item.ingredientIndex)),
    components: normalizeLabels((step.preparedComponents || []).map(item => item.label)),
  }))
}

async function main() {
  if ((mode === 'full' || mode === 'stability')) {
    if (!fs.existsSync(focusedResultPath)) throw new Error('Focused v7 result is missing; full/stability run is not authorized')
    const focused = JSON.parse(fs.readFileSync(focusedResultPath, 'utf8'))
    if (!focused.gates?.pass) throw new Error('Focused v7 gates failed; full/stability run is prohibited')
  }
  loadEnv()
  const benchmark = JSON.parse(fs.readFileSync(auditPath, 'utf8'))
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
      process.stdout.write(`${mode} ${index + 1}/${sourceRows.length}: ${row.recipeId}\n`)
      return generated
    })
    const evaluations = rows.map(row => evaluateCandidateMap(row.proposedMap, row.truth))
    const summary = summarizeCandidateEvaluations(evaluations)
    const gates = evaluateV7QualityGates(summary, benchmarkMode)
    const result = {
      date, mode,
      production: { ...production.counts, unmapped: production.counts.shared - production.counts.mapped },
      sourceChecks: {
        matches: rows.filter(row => row.generationTruthMatch).length,
        mismatches: rows.filter(row => !row.generationTruthMatch).map(row => row.recipeId),
      },
      summary,
      gates,
      rawAiVsValidator: rawAnalysis(rows),
      namedRegressions: namedRegressions(rows),
      errors: errorRows(rows),
      aiUsage: state.usage,
      rows: rows.map(row => ({
        recipeId: row.recipeId, title: row.title, currentEngine: row.currentEngine,
        sourceHash: row.sourceHash, currentMap: row.currentMap, proposedMap: row.proposedMap,
        semanticOutput: row.semanticOutput, diagnostics: row.diagnostics,
        semanticReviewFailed: row.semanticReviewFailed,
        evaluation: evaluateCandidateMap(row.proposedMap, row.truth),
      })),
    }
    if (result.rawAiVsValidator.aiIncorrectProposalsAccepted !== 0) result.gates.pass = false
    if (!result.namedRegressions.every(item => item.present)) result.gates.pass = false

    if (mode === 'stability') {
      const primary = JSON.parse(fs.readFileSync(focusedResultPath, 'utf8'))
      const primaryById = new Map(primary.rows.map(row => [row.recipeId, row]))
      result.stability = rows.map(row => {
        const previous = primaryById.get(row.recipeId)
        if (JSON.stringify(previous.proposedMap) === JSON.stringify(row.proposedMap)) {
          return { recipeId: row.recipeId, classification: 'EXACT_STABLE' }
        }
        if (JSON.stringify(semanticSignature(previous.proposedMap)) === JSON.stringify(semanticSignature(row.proposedMap))) {
          return { recipeId: row.recipeId, classification: 'SEMANTICALLY_STABLE' }
        }
        const evaluation = evaluateCandidateMap(row.proposedMap, row.truth)
        const recipeSummary = summarizeCandidateEvaluations([evaluation])
        const safe = recipeSummary.falsePositives === 0 && recipeSummary.preparedComponents.falsePositives === 0
        return { recipeId: row.recipeId, classification: safe ? 'SAFE_OMISSION_DIFFERENCE' : 'UNSAFE_MATERIAL_DIFFERENCE' }
      })
      if (result.stability.some(item => item.classification === 'UNSAFE_MATERIAL_DIFFERENCE')) result.gates.pass = false
    }

    fs.writeFileSync(resultPath, stableJson(result))
    if (mode === 'focused') fs.writeFileSync(focusedReportPath, reportMarkdown(result))
    if (mode === 'full' && result.gates.pass && result.sourceChecks.matches === rows.length) {
      const manifest = rows.map(row => {
        const evaluation = evaluateCandidateMap(row.proposedMap, row.truth)
        const recipeSummary = summarizeCandidateEvaluations([evaluation])
        return {
          recipeId: row.recipeId,
          title: row.title,
          currentEngine: row.currentEngine,
          proposedEngine: 'hybrid-v7',
          sourceHash: row.sourceHash,
          currentMap: row.currentMap,
          proposedMap: row.proposedMap,
          metrics: {
            truePositives: recipeSummary.truePositives,
            falsePositives: recipeSummary.falsePositives,
            falseNegatives: recipeSummary.falseNegatives,
          },
          classification: recipeSummary.falsePositives === 0 && recipeSummary.critical.missing === 0 ? 'READY' : 'REVIEW',
          precondition: { currentMapPresent: true, currentSourceHash: row.sourceHash },
        }
      }).sort((left, right) => left.recipeId.localeCompare(right.recipeId))
      fs.writeFileSync(manifestPath, stableJson(manifest))
      const sha = createHash('sha256').update(fs.readFileSync(manifestPath)).digest('hex')
      fs.writeFileSync(fullReportPath, `${reportMarkdown(result)}\nManifest SHA-256: \`${sha}\`\n`)
      if (createHash('sha256').update(fs.readFileSync(manifestPath)).digest('hex') !== sha) {
        throw new Error('Manifest changed after SHA finalization')
      }
      result.manifest = { path: manifestPath, sha256: sha }
      fs.writeFileSync(resultPath, stableJson(result))
    }
    console.log(stableJson({ resultPath, reportPath: mode === 'focused' ? focusedReportPath : undefined,
      summary: result.summary, gates: result.gates, rawAiVsValidator: result.rawAiVsValidator,
      namedRegressions: result.namedRegressions, sourceChecks: result.sourceChecks,
      stability: result.stability, manifest: result.manifest }))
  } finally {
    console.info = originalInfo
    await modules.close()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
