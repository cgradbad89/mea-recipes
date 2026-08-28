#!/usr/bin/env node
/** Bounded, read-only AI reproductions for the 2026-08-28 recall investigation. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { z } from 'zod'
import {
  BLIND_REVIEW_SYSTEM_PROMPT,
  formatBlindRecipePrompt,
  validateReviewOutput,
} from './audit-cooking-mode-completeness-core.mjs'
import { stableJson } from './analyze-cooking-mode-recall-root-cause-core.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const benchmarkPath = path.join(root, 'docs/audits/cooking-mode-completeness-audit-2026-08-26.json')
const v9Path = '/tmp/cooking-step-consensus-v9-focused-2026-08-28.json'
const outputPath = '/tmp/cooking-mode-recall-bounded-diagnostics-2026-08-28.json'
const modelTimeoutMs = 120_000
const reviewerRuns = 4
const selectedRecipeIds = [
  'mole-poblano',
  '176',
  '168',
  '189',
  'garlic-butter-herb-steak-bites-with-potatoes',
  'mediterranean-grilled-salmon',
  'fried-chicken-sandwich',
  'tacos-al-pastor',
  'grilled-fish-tacos',
  'crunchy-queso-wrap',
]

const impactSchema = z.object({
  ingredientIndex: z.number(),
  level: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
  kind: z.enum(['MAIN_STRUCTURAL', 'SUBSTANTIAL', 'SEASONING_HERB', 'GARNISH', 'OTHER']),
})
const reviewSchema = z.object({
  steps: z.array(z.object({
    instructionIndex: z.number(),
    expectedIngredientIndexes: z.array(z.number()).max(200),
    preparedComponents: z.array(z.object({ label: z.string().max(100) })).max(30),
    explicitActiveUseIndexes: z.array(z.number()).max(200),
    ingredientAssessments: z.array(impactSchema).max(200),
    confidence: z.enum(['HIGH', 'UNCERTAIN']),
    reasoningCategory: z.enum([
      'EXPLICIT_ACTIVE_USE', 'CLEAR_ALIAS', 'GROUP_REFERENCE', 'PREPARED_COMPONENT',
      'COLLECTIVE_REFERENCE', 'OTHER',
    ]),
  })).max(150),
})

async function loadModules() {
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    resolve: { alias: { '@': root } },
    plugins: [{
      name: 'recall-diagnostic-server-only-marker', enforce: 'pre',
      resolveId(id) { return id === 'server-only' ? '\0recall-diagnostic-server-only' : null },
      load(id) { return id === '\0recall-diagnostic-server-only' ? 'export {}' : null },
    }],
  })
  try {
    return {
      ai: await server.ssrLoadModule('/lib/ai.ts'),
      arbiter: await server.ssrLoadModule('/lib/cookingStepMapArbiterAi.ts'),
      close: () => server.close(),
    }
  } catch (error) {
    await server.close()
    throw error
  }
}

function readState() {
  if (!fs.existsSync(outputPath)) return {
    schemaVersion: 1,
    productionWrites: 0,
    selectedRecipeIds,
    reviewerRuns,
    reviewerResults: {},
    recipe190ArbiterResults: [],
    usage: [],
  }
  const state = JSON.parse(fs.readFileSync(outputPath, 'utf8'))
  if (state.schemaVersion !== 1) throw new Error('Incompatible diagnostic state')
  return state
}

function saveState(state) {
  fs.writeFileSync(outputPath, stableJson(state))
}

function normalizedReview(output, recipe) {
  const valid = output.steps.filter(step => Number.isInteger(step.instructionIndex) &&
    step.instructionIndex >= 0 && step.instructionIndex < recipe.steps.length)
  const complete = valid.length === recipe.steps.length &&
    new Set(valid.map(step => step.instructionIndex)).size === recipe.steps.length
  const result = complete ? { ...output, steps: valid } : output
  validateReviewOutput(
    result,
    recipe.ingredients.map(item => item.raw),
    recipe.steps.map(item => item.instruction),
    raw => recipe.ingredients.some(item => item.raw === raw && item.header),
  )
  return result
}

async function reviewerCall(modules, recipe, runIndex) {
  const prompt = formatBlindRecipePrompt(
    recipe.title,
    recipe.ingredients.map(item => item.raw),
    recipe.steps.map(item => item.instruction),
    raw => recipe.ingredients.some(item => item.raw === raw && item.header),
  )
  let firstError = null
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const output = await modules.ai.generateAIObject({
        feature: 'cooking-mode-completeness-review-a',
        userId: 'production-audit-review-a',
        promptVersion: 'completeness-v1',
        temperature: 0,
        timeout: modelTimeoutMs,
        system: BLIND_REVIEW_SYSTEM_PROMPT,
        prompt,
        schema: reviewSchema,
      })
      return { runIndex, attempts: attempt, output: normalizedReview(output, recipe), error: null }
    } catch (error) {
      firstError ||= String(error?.message || error)
      if (attempt === 2) return {
        runIndex,
        attempts: attempt,
        output: null,
        error: `first attempt: ${firstError}; retry: ${String(error?.message || error)}`,
      }
    }
  }
  throw new Error('unreachable')
}

async function main() {
  const benchmark = JSON.parse(fs.readFileSync(benchmarkPath, 'utf8'))
  const v9 = JSON.parse(fs.readFileSync(v9Path, 'utf8'))
  const benchmarkById = new Map(benchmark.recipes.map(recipe => [recipe.recipeId, recipe]))
  const state = readState()
  const modules = await loadModules()
  const originalInfo = console.info
  let usageContext = null
  console.info = (label, metadata, ...rest) => {
    if (label === '[ai-usage]') {
      state.usage.push({ ...usageContext, ...metadata, capturedAt: new Date().toISOString() })
      saveState(state)
      return
    }
    originalInfo(label, metadata, ...rest)
  }
  try {
    for (const recipeId of selectedRecipeIds) {
      const recipe = benchmarkById.get(recipeId)
      if (!recipe) throw new Error(`Missing benchmark recipe ${recipeId}`)
      const results = state.reviewerResults[recipeId] || []
      usageContext = { phase: 'reviewer-reproducibility', recipeId }
      const pendingRuns = Array.from(
        { length: reviewerRuns - results.length },
        (_, offset) => results.length + offset,
      )
      const completed = await Promise.all(pendingRuns.map(runIndex => reviewerCall(modules, recipe, runIndex)))
      for (const result of completed.sort((left, right) => left.runIndex - right.runIndex)) {
        results.push(result)
        process.stdout.write(`reviewer ${recipeId} ${result.runIndex + 1}/${reviewerRuns}${result.error ? ' ERROR' : ''}\n`)
      }
      state.reviewerResults[recipeId] = results
      saveState(state)
    }

    const recipe190 = v9.rows.find(row => row.recipeId === '190')
    if (!recipe190) throw new Error('V9 recipe 190 row is missing')
    for (let runIndex = state.recipe190ArbiterResults.length; runIndex < reviewerRuns; runIndex += 1) {
      usageContext = { phase: 'recipe-190-arbiter', recipeId: '190', runIndex }
      try {
        const output = await modules.arbiter.arbitrateCookingStepMapWithAi(
          recipe190.title,
          benchmarkById.get('190').ingredients.map(item => item.raw),
          benchmarkById.get('190').steps.map(item => item.instruction),
          recipe190.pool,
          'recall-root-cause-recipe-190',
          modelTimeoutMs,
        )
        state.recipe190ArbiterResults.push({ runIndex, output, error: null })
      } catch (error) {
        state.recipe190ArbiterResults.push({ runIndex, output: null, error: String(error?.message || error) })
      }
      saveState(state)
      const latest = state.recipe190ArbiterResults.at(-1)
      process.stdout.write(`recipe 190 arbiter ${runIndex + 1}/${reviewerRuns}${latest.error ? ' ERROR' : ''}\n`)
    }
    process.stdout.write(`${outputPath}\n`)
  } finally {
    console.info = originalInfo
    await modules.close()
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
