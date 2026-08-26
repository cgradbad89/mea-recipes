#!/usr/bin/env node
/**
 * Bounded, read-only v2 remediation validation.
 *
 * This fixed allowlist is the union of the prior 20-recipe stability subset,
 * the six still-source-eligible recipes with incorrect accepted AI additions,
 * and three validator-gap controls. It performs document reads and Gateway
 * calls only. There is intentionally no write/apply mode.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import {
  callWithOneTransientRetry,
  classifyRecipeSource,
  compareStability,
  extractAiAdditions,
} from './audit-cooking-step-mappings-core.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { loadEnv, getAdmin } = require('./_lib.js')
const LIMITS = { maxContentLength: 64_000, maxIngredients: 200, maxInstructions: 150, maxLineLength: 4_000 }
const OUTPUT = '/tmp/cooking-step-mapping-remediation-validation-2026-08-25.json'

const PREVIOUS_STABILITY_IDS = [
  '158',
  '159',
  'buttersoy-chicken-and-asparagus-stirfry',
  'chicken-chickpea-salad',
  'chicken-chow-mein',
  'chicken-wild-rice',
  'chickpea-curry',
  'chili-lime-fish',
  'chipotle-tahini-bowls',
  'chopped-thai-shrimp-salad-with-garlic-lime-dressing',
  'creamy-chickpea-spinach-masala-with-tadka',
  'dan-dan-noodles',
  'italian-sausage-and-white-bean-salad',
  'mediterranean-quinoa-bowl',
  'mole-poblano',
  'peruvian-roasted-chicken-with-spicy-cilantro-sauce',
  'rainbow-quinoa-salad',
  'sheet-pan-chicken-tinga-bowls',
  'singapore-mei-fun',
  'taco-soup',
]

const PRIOR_INCORRECT_ELIGIBLE_IDS = [
  '151',
  '158',
  '159',
  '194',
  'moqueca-brazilian-fish-stew',
  'queso-chicken-chili-with-roasted-corn-and-jalape-o',
]

const VALIDATOR_CONTROL_IDS = [
  'grilled-chicken-salad',
  'michelada-chicken',
  'hot-mustard-grilled-chicken',
]

const TARGET_IDS = [...new Set([
  ...PREVIOUS_STABILITY_IDS,
  ...PRIOR_INCORRECT_ELIGIBLE_IDS,
  ...VALIDATOR_CONTROL_IDS,
])].sort()

if (TARGET_IDS.length > 30) throw new Error(`Bounded validation allowlist unexpectedly grew to ${TARGET_IDS.length}`)

async function loadProductionModules() {
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    resolve: { alias: { '@': ROOT } },
    plugins: [{
      name: 'validation-server-only-marker', enforce: 'pre',
      resolveId(id) { return id === 'server-only' ? '\0validation-server-only' : null },
      load(id) { return id === '\0validation-server-only' ? 'export {}' : null },
    }],
  })
  try {
    return {
      recipeContent: await server.ssrLoadModule('/lib/recipeContent.ts'),
      mapping: await server.ssrLoadModule('/lib/cookingStepMapping.ts'),
      mappingAi: await server.ssrLoadModule('/lib/cookingStepMappingAi.ts'),
      close: () => server.close(),
    }
  } catch (error) {
    await server.close()
    throw error
  }
}

async function runAi(modules, deterministicMap, ingredients, instructions, recipeId, runLabel) {
  const result = await callWithOneTransientRetry(() => modules.mappingAi.resolveCookingStepMappingsWithAi(
    deterministicMap,
    ingredients,
    instructions,
    `cooking-step-remediation-${recipeId}-${runLabel}`,
  ))
  if (result.status === 'failed') return { ...result, candidateMap: deterministicMap, additions: [] }
  const candidateMap = modules.mappingAi.mergeValidatedAiCookingMappings(
    deterministicMap,
    ingredients,
    instructions,
    result.value,
  )
  return {
    ...result,
    candidateMap,
    additions: extractAiAdditions(recipeId, candidateMap, ingredients, instructions),
  }
}

async function main() {
  loadEnv()
  const modules = await loadProductionModules()
  try {
    const firestore = getAdmin().firestore()
    const rows = []
    let requests = 0
    let providerFailures = 0

    for (const recipeId of TARGET_IDS) {
      const snapshot = await firestore.collection('recipes').doc(recipeId).get()
      if (!snapshot.exists) {
        rows.push({ recipeId, status: 'MISSING', stability: 'NOT_EVALUATED' })
        continue
      }
      const data = snapshot.data()
      const content = typeof data.content === 'string' ? data.content : ''
      const parsed = modules.recipeContent.parseRecipeContent(content)
      const source = classifyRecipeSource({ ...data, recipeId }, parsed, LIMITS)
      if (!parsed.ingredients.length || !parsed.instructions.length) {
        rows.push({ recipeId, title: data.title || '', status: source.status, stability: 'NOT_EVALUATED' })
        continue
      }

      const deterministicMap = await modules.mapping.buildHashedDeterministicCookingStepMap(
        parsed.ingredients,
        parsed.instructions,
      )
      const aiEligible = source.status === 'ELIGIBLE' && modules.mapping.hasAiEligibleCookingSteps(deterministicMap)
      if (!aiEligible) {
        rows.push({
          recipeId,
          title: data.title || '',
          status: source.status,
          sourceReason: source.reason,
          aiEligible: false,
          ingredients: parsed.ingredients,
          instructions: parsed.instructions,
          deterministicMap,
          primaryMap: deterministicMap,
          repeatMap: deterministicMap,
          primaryAdditions: [],
          repeatAdditions: [],
          stability: 'EXACT_STABLE',
        })
        continue
      }

      const primary = await runAi(modules, deterministicMap, parsed.ingredients, parsed.instructions, recipeId, 'primary')
      const repeat = await runAi(modules, deterministicMap, parsed.ingredients, parsed.instructions, recipeId, 'repeat')
      requests += primary.attempts + repeat.attempts
      providerFailures += Number(primary.status === 'failed') + Number(repeat.status === 'failed')
      const primaryValidation = modules.mapping.validateCookingStepIngredientMap(
        primary.candidateMap, parsed.ingredients, parsed.instructions, deterministicMap,
      )
      const repeatValidation = modules.mapping.validateCookingStepIngredientMap(
        repeat.candidateMap, parsed.ingredients, parsed.instructions, deterministicMap,
      )
      rows.push({
        recipeId,
        title: data.title || '',
        status: source.status,
        aiEligible: true,
        ingredients: parsed.ingredients,
        instructions: parsed.instructions,
        deterministicMap,
        primaryStatus: primary.status,
        repeatStatus: repeat.status,
        primaryAttempts: primary.attempts,
        repeatAttempts: repeat.attempts,
        primaryValidation,
        repeatValidation,
        primaryMap: primary.candidateMap,
        repeatMap: repeat.candidateMap,
        primaryAdditions: primary.additions,
        repeatAdditions: repeat.additions,
        stability: primaryValidation.valid && repeatValidation.valid
          ? compareStability(primary.candidateMap, repeat.candidateMap)
          : 'ERROR',
      })
    }

    const stabilityRows = PREVIOUS_STABILITY_IDS.map(recipeId => rows.find(row => row.recipeId === recipeId))
    const output = {
      validationDate: '2026-08-25',
      executionTimestamp: new Date().toISOString(),
      mode: 'READ_ONLY_BOUNDED_REMEDIATION_VALIDATION',
      productionWrites: 0,
      uniqueRecipes: TARGET_IDS.length,
      requests,
      providerFailures,
      previousStabilitySubset: {
        total: PREVIOUS_STABILITY_IDS.length,
        exactStable: stabilityRows.filter(row => row?.stability === 'EXACT_STABLE').length,
        semanticallyStable: stabilityRows.filter(row => row?.stability === 'SEMANTICALLY_STABLE').length,
        materialDifferences: stabilityRows.filter(row => row?.stability === 'MATERIAL_DIFFERENCE').length,
        errors: stabilityRows.filter(row => row?.stability === 'ERROR' || row?.stability === 'NOT_EVALUATED').length,
      },
      sets: {
        priorStability: PREVIOUS_STABILITY_IDS,
        priorIncorrectStillEligible: PRIOR_INCORRECT_ELIGIBLE_IDS,
        validatorControls: VALIDATOR_CONTROL_IDS,
      },
      rows,
    }
    fs.writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`)
    console.log(JSON.stringify({ output: OUTPUT, ...output.previousStabilitySubset, uniqueRecipes: TARGET_IDS.length, requests, providerFailures }, null, 2))
  } finally {
    await modules.close()
  }
}

await main()
