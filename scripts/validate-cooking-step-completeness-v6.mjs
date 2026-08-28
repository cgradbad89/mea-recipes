#!/usr/bin/env node
/**
 * Read-only production validation for the hybrid-v6 mapping pipeline.
 * Firestore access is reads only; generated candidates and AI state stay local.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import {
  evaluateCandidateMap,
  evaluateV6QualityGates,
  normalizeIndexes,
  summarizeCandidateEvaluations,
} from './evaluate-cooking-step-completeness-v6-core.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { loadEnv, getAdmin } = require('./_lib.js')
const AUDIT_PATH = path.join(ROOT, 'docs/audits/cooking-mode-completeness-audit-2026-08-26.json')
const DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())
const MODE = process.argv.includes('--full') ? 'full' : 'focused'
const EXPECTED_BENCHMARK_RECIPES = 228
const CONCURRENCY = 3
const MODEL_TIMEOUT_MS = 120_000
const OWNER_EMAIL = 'folstromjohn@gmail.com'
const STATE_PATH = path.join('/tmp', `cooking-step-completeness-v6-${MODE}-${DATE}-state.json`)
const RESULT_PATH = path.join('/tmp', `cooking-step-completeness-v6-${MODE}-${DATE}.json`)
const MANIFEST_PATH = path.join(ROOT, `docs/audits/cooking-mode-completeness-v6-dryrun-${DATE}.json`)
const REPORT_PATH = path.join(ROOT, `docs/audits/cooking-mode-completeness-v6-dryrun-${DATE}.md`)

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function readState() {
  if (!fs.existsSync(STATE_PATH)) return { version: 1, mode: MODE, outputs: {}, failures: [], usage: [] }
  const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))
  if (state.version !== 1 || state.mode !== MODE) throw new Error('incompatible v6 validation state')
  return state
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, stableJson(state))
}

async function loadModules() {
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    resolve: { alias: { '@': ROOT } },
    plugins: [{
      name: 'v6-server-only-marker', enforce: 'pre',
      resolveId(id) { return id === 'server-only' ? '\0v6-server-only' : null },
      load(id) { return id === '\0v6-server-only' ? 'export {}' : null },
    }],
  })
  try {
    return {
      recipeContent: await server.ssrLoadModule('/lib/recipeContent.ts'),
      mapping: await server.ssrLoadModule('/lib/cookingStepMapping.ts'),
      targeted: await server.ssrLoadModule('/lib/cookingStepMappingAi.ts'),
      completeness: await server.ssrLoadModule('/lib/cookingStepMappingCompletenessAi.ts'),
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
    admin.auth().getUserByEmail(OWNER_EMAIL),
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
  const mandatory = new Set([
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
    if (mandatory.size >= 31) break
    mandatory.add(row.recipeId)
  }
  const controls = [...benchmark.recipes]
    .sort((left, right) => {
      const leftFn = left.steps.reduce((sum, step) => sum + step.falseNegativeIndexes.length, 0)
      const rightFn = right.steps.reduce((sum, step) => sum + step.falseNegativeIndexes.length, 0)
      return leftFn - rightFn || left.recipeId.localeCompare(right.recipeId)
    })
  for (const row of controls) {
    if (mandatory.size >= 36) break
    mandatory.add(row.recipeId)
  }
  return mandatory
}

async function buildRows(production, benchmark, modules) {
  if (benchmark.recipes.length !== EXPECTED_BENCHMARK_RECIPES) {
    throw new Error(`benchmark population changed: ${benchmark.recipes.length}/${EXPECTED_BENCHMARK_RECIPES}`)
  }
  const selected = MODE === 'full' ? null : focusedIds(benchmark)
  const rows = []
  for (const truth of benchmark.recipes) {
    if (selected && !selected.has(truth.recipeId)) continue
    const data = production.recipes.get(truth.recipeId)
    if (!data?.cookingStepIngredientMap) throw new Error(`mapped benchmark recipe missing in production: ${truth.recipeId}`)
    const shared = modules.recipeContent.parseRecipeContent(data.content)
    const effective = modules.recipeContent.parseRecipeContent(effectiveContent(
      data.content, production.metas.get(truth.recipeId),
    ))
    const [sharedHash, effectiveHash] = await Promise.all([
      modules.mapping.computeCookingMappingSourceHash(shared.ingredients, shared.instructions),
      modules.mapping.computeCookingMappingSourceHash(effective.ingredients, effective.instructions),
    ])
    rows.push({
      recipeId: truth.recipeId,
      title: data.title || truth.title,
      currentMap: data.cookingStepIngredientMap,
      currentEngine: data.cookingStepIngredientMap.engineVersion,
      truth,
      ingredients: MODE === 'full' ? shared.ingredients : effective.ingredients,
      instructions: MODE === 'full' ? shared.instructions : effective.instructions,
      sourceHash: MODE === 'full' ? sharedHash : effectiveHash,
      effectiveSourceHash: effectiveHash,
      benchmarkSourceMatch: effectiveHash === truth.sourceHash,
      sharedSourceMatch: sharedHash === truth.sharedSourceHash,
      generationTruthMatch: (MODE === 'full' ? sharedHash : effectiveHash) === truth.sourceHash,
    })
  }
  return rows.sort((left, right) => left.recipeId.localeCompare(right.recipeId))
}

async function mapConcurrent(items, concurrency, worker) {
  let next = 0
  let fatal = null
  const results = new Array(items.length)
  async function run() {
    while (next < items.length && fatal === null) {
      const index = next++
      try {
        results[index] = await worker(items[index], index)
      } catch (error) {
        fatal ||= error
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run))
  if (fatal) throw fatal
  return results
}

async function generateRow(row, modules, state) {
  const key = `${row.recipeId}:${row.sourceHash}`
  const cached = state.outputs[key]
  let targetedOutput = cached?.targetedOutput ?? null
  let completenessOutput = cached?.completenessOutput ?? null
  const deterministic = await modules.mapping.buildHashedDeterministicCookingStepMap(row.ingredients, row.instructions)
  let candidate = deterministic

  if (modules.mapping.hasAiEligibleCookingSteps(deterministic)) {
    if (!cached || cached.targetedPending) {
      targetedOutput = await modules.targeted.resolveCookingStepMappingsWithAi(
        deterministic, row.ingredients, row.instructions, `v6-${MODE}-targeted`, MODEL_TIMEOUT_MS,
      )
    }
    candidate = modules.targeted.mergeValidatedAiCookingMappings(
      deterministic, row.ingredients, row.instructions, targetedOutput,
    )
  }
  if (!completenessOutput) {
    completenessOutput = await modules.completeness.reviewCookingStepCompletenessWithAi(
      row.ingredients, row.instructions, `v6-${MODE}-completeness`, MODEL_TIMEOUT_MS,
    )
  }
  const finalMap = modules.completeness.mergeValidatedAiCookingCompleteness(
    candidate, row.ingredients, row.instructions, completenessOutput,
  )
  if (finalMap.engineVersion !== 'hybrid-v6') throw new Error(`incomplete AI result for ${row.recipeId}`)
  state.outputs[key] = { targetedOutput, completenessOutput }
  saveState(state)
  return { ...row, candidateBeforeCompleteness: candidate, completenessOutput, proposedMap: finalMap }
}

function proposalIndexes(output, instructionIndex) {
  const step = output.steps.find(item => item.instructionIndex === instructionIndex)
  if (step?.confidence !== 'high') return []
  const rejected = new Set(step.rejectedAfterSafetyCheckIndexes || [])
  return normalizeIndexes([
    ...(step.expectedIngredientIndexes || []),
    ...(step.omissionCheckIngredientIndexes || []),
  ]).filter(index => !rejected.has(index))
}

function diagnosticsForRow(row, modules) {
  const evaluation = evaluateCandidateMap(row.proposedMap, row.truth)
  const proposedConfirmedFalseNegatives = []
  const validatorRejectedCorrectAdditions = []
  const remainingFalseNegatives = []
  for (const step of evaluation.steps) {
    const truthStep = row.truth.steps.find(item => item.instructionIndex === step.instructionIndex)
    const before = new Set(row.candidateBeforeCompleteness.steps[step.instructionIndex].ingredients
      .map(reference => reference.ingredientIndex))
    const proposed = new Set(proposalIndexes(row.completenessOutput, step.instructionIndex))
    const final = new Set(step.candidateIndexes)
    for (const ingredientIndex of truthStep.adjudicatedExpectedIndexes) {
      if (!before.has(ingredientIndex) && proposed.has(ingredientIndex)) {
        proposedConfirmedFalseNegatives.push({ instructionIndex: step.instructionIndex, ingredientIndex })
        if (!final.has(ingredientIndex)) {
          const validation = modules.mapping.validateAiCookingCompletenessReference(
            row.ingredients,
            row.instructions[step.instructionIndex],
            ingredientIndex,
            { instructionIndex: step.instructionIndex, priorSteps: row.proposedMap.steps.slice(0, step.instructionIndex) },
          )
          validatorRejectedCorrectAdditions.push({
            instructionIndex: step.instructionIndex,
            ingredientIndex,
            reason: validation.rejectionReason || 'duplicate-proposal-conflict',
          })
        }
      }
    }
    for (const ingredientIndex of step.falseNegativeIndexes) {
      const severity = truthStep.severity.find(item => item.ingredientIndex === ingredientIndex)
      remainingFalseNegatives.push({
        instructionIndex: step.instructionIndex,
        ingredientIndex,
        ingredient: row.ingredients[ingredientIndex],
        severity: severity?.level || 'UNKNOWN',
        kind: severity?.kind || 'OTHER',
        classification: proposed.has(ingredientIndex)
          ? 'VALIDATOR_REJECTED_CORRECT_ADDITION'
          : 'AI_COMPLETENESS_MISSED',
      })
    }
  }
  return { evaluation, proposedConfirmedFalseNegatives, validatorRejectedCorrectAdditions, remainingFalseNegatives }
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
    const present = row?.proposedMap.steps[instructionIndex].ingredients
      .some(reference => reference.ingredientIndex === ingredientIndex) || false
    return { recipeId, instructionIndex, ingredientIndex, present }
  })
}

function markdownReport(result, manifestSha) {
  const metric = value => value === null ? 'n/a' : `${(value * 100).toFixed(2)}%`
  return `# Cooking Mode completeness v6 dry run — ${DATE}

Verdict: **PASS — V6 READY FOR MAP MIGRATION**

This was a read-only production run. Firestore, recipe, and map writes: **0**.

## Coverage

- Adjudicated benchmark recipes: ${result.rows.length}
- Live shared recipes: ${result.production.shared}
- Live mapped recipes: ${result.production.mapped}
- Source-hash matches: ${result.sourceChecks.generationTruthMatches}/${result.rows.length}
- Manifest SHA-256: \`${manifestSha}\`

## Metrics

- TP / FP / FN: ${result.summary.truePositives} / ${result.summary.falsePositives} / ${result.summary.falseNegatives}
- Precision: ${metric(result.summary.precision)}
- Recall: ${metric(result.summary.recall)}
- F1: ${metric(result.summary.f1)}
- Explicit-active-use recall: ${metric(result.summary.explicitActiveUse.recall)}
- CRITICAL recall: ${metric(result.summary.critical.recall)}
- HIGH recall: ${metric(result.summary.high.recall)}
- Seasoning/herb recall: ${metric(result.summary.seasoning.recall)}
- Prepared-component recall: ${metric(result.summary.preparedComponents.recall)}

## Remaining false negatives

${result.remainingFalseNegatives.length === 0 ? 'None.' : result.remainingFalseNegatives.map(item =>
    `- ${item.recipeId} step ${item.instructionIndex}: ingredient ${item.ingredientIndex} (${item.severity}) — ${item.classification}`
  ).join('\n')}
`
}

async function main() {
  loadEnv()
  const benchmark = JSON.parse(fs.readFileSync(AUDIT_PATH, 'utf8'))
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
    const rows = await buildRows(production, benchmark, modules)
    const generated = await mapConcurrent(rows, CONCURRENCY, async (row, index) => {
      const value = await generateRow(row, modules, state)
      process.stdout.write(`${MODE} ${index + 1}/${rows.length}: ${row.recipeId}\n`)
      return value
    })
    const detailed = generated.map(row => ({ ...row, ...diagnosticsForRow(row, modules) }))
    const summary = summarizeCandidateEvaluations(detailed.map(row => row.evaluation))
    const gates = evaluateV6QualityGates(summary)
    const remainingFalseNegatives = detailed.flatMap(row => row.remainingFalseNegatives
      .map(item => ({ recipeId: row.recipeId, title: row.title, ...item })))
    const result = {
      date: DATE,
      mode: MODE,
      production: { ...production.counts, unmapped: production.counts.shared - production.counts.mapped },
      sourceChecks: {
        effectiveBenchmarkMatches: detailed.filter(row => row.benchmarkSourceMatch).length,
        sharedAuditMatches: detailed.filter(row => row.sharedSourceMatch).length,
        generationTruthMatches: detailed.filter(row => row.generationTruthMatch).length,
        mismatches: detailed.filter(row => !row.generationTruthMatch).map(row => row.recipeId),
      },
      summary,
      gates,
      namedRegressions: namedRegressions(detailed),
      aiUsage: state.usage,
      proposedConfirmedFalseNegatives: detailed.reduce((sum, row) => sum + row.proposedConfirmedFalseNegatives.length, 0),
      validatorRejectedCorrectAdditions: detailed.flatMap(row => row.validatorRejectedCorrectAdditions
        .map(item => ({ recipeId: row.recipeId, title: row.title, ...item }))),
      remainingFalseNegatives,
      rows: detailed.map(row => ({
        recipeId: row.recipeId,
        title: row.title,
        currentEngine: row.currentEngine,
        sourceHash: row.sourceHash,
        benchmarkSourceMatch: row.benchmarkSourceMatch,
        sharedSourceMatch: row.sharedSourceMatch,
        generationTruthMatch: row.generationTruthMatch,
        currentMap: row.currentMap,
        proposedMap: row.proposedMap,
        evaluation: row.evaluation,
      })),
    }
    fs.writeFileSync(RESULT_PATH, stableJson(result))
    console.log(stableJson({ resultPath: RESULT_PATH, summary, gates, sourceChecks: result.sourceChecks, namedRegressions: result.namedRegressions }))

    if (MODE === 'full' && gates.pass && result.sourceChecks.generationTruthMatches === rows.length &&
      result.namedRegressions.every(item => item.present)) {
      const manifest = detailed.map(row => ({
        recipeId: row.recipeId,
        title: row.title,
        currentEngine: row.currentEngine,
        proposedEngine: 'hybrid-v6',
        sourceHash: row.sourceHash,
        currentMap: row.currentMap,
        proposedMap: row.proposedMap,
        benchmark: {
          truePositives: row.evaluation.steps.reduce((sum, step) => sum + step.truePositiveIndexes.length, 0),
          falsePositives: row.evaluation.steps.reduce((sum, step) => sum + step.falsePositiveIndexes.length, 0),
          falseNegatives: row.evaluation.steps.reduce((sum, step) => sum + step.falseNegativeIndexes.length, 0),
        },
        semanticStatus: row.remainingFalseNegatives.length === 0 ? 'READY' : 'REVIEW',
        precondition: { currentSourceHash: row.sourceHash, currentMapPresent: true },
      })).sort((left, right) => left.recipeId.localeCompare(right.recipeId))
      fs.writeFileSync(MANIFEST_PATH, stableJson(manifest))
      const manifestSha = createHash('sha256').update(fs.readFileSync(MANIFEST_PATH)).digest('hex')
      fs.writeFileSync(REPORT_PATH, markdownReport(result, manifestSha))
      const verifiedSha = createHash('sha256').update(fs.readFileSync(MANIFEST_PATH)).digest('hex')
      if (verifiedSha !== manifestSha) throw new Error('manifest SHA changed after finalization')
      console.log(`manifest=${MANIFEST_PATH}\nreport=${REPORT_PATH}\nsha256=${manifestSha}`)
    }
  } finally {
    console.info = originalInfo
    await modules.close()
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
