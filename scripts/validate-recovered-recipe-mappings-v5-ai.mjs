#!/usr/bin/env node
/**
 * Bounded, read-only hybrid-v5 validation. The fixed 26-recipe allowlist is
 * the current hard subset of repaired recipes with AI-eligible deterministic
 * semantics. Every recipe receives one primary and one stability request.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import {
  callWithOneTransientRetry,
  compareStability,
  extractAiAdditions,
  mapConcurrent,
} from './audit-cooking-step-mappings-core.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { loadEnv, getAdmin } = require('./_lib.js')
const DATE = '2026-08-26'
const DETERMINISTIC_INPUT = path.join('/tmp', `recovered-recipes-mapping-v5-deterministic-validation-${DATE}.json`)
const OUTPUT = path.join('/tmp', `recovered-recipes-mapping-v5-bounded-ai-${DATE}.json`)
const TARGET_IDS = [
  'chana-masala',
  'chicken-fajitas',
  'chicken-paprikash',
  'chicken-tacos-w-pineapple',
  'chinese-chili-oil',
  'couscous-salad-with-lime-basil-vinaigrette',
  'creamy-cauliflower-soup-with-rosemary-olive-oil',
  'crunchy-queso-wrap',
  'dads-chili',
  'easy-chicken-ramen',
  'filipino-brased-chicken-tocino',
  'huevos-rotos-broken-eggs',
  'kung-pao-tofu',
  'lemon-herb-pasta-salad-with-marinated-chickpeas',
  'mole-poblano',
  'onepot-chicken-and-lentil',
  'onepot-ratatouille-pasta',
  'peanut-butter-oat-protein-shake',
  'pearl-couscous-with-creamy-feta-and-chickpeas-meh',
  'peruvian-chicken-w-green-sauce',
  'peruvian-roasted-chicken-with-spicy-cilantro-sauce',
  'pork-fried-rice',
  'pozole-verde-wowza',
  'roasted-white-bean-and-tomato-pasta',
  'spicy-ovenfried-rice-with-gochujang-and-fried-eggs',
  'zibdiyit-gambari-spicy-shrimp-and-tomato-stew',
]

async function loadModules() {
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false },
    resolve: { alias: { '@': ROOT } },
    plugins: [{
      name: 'v5-ai-server-only', enforce: 'pre',
      resolveId(id) { return id === 'server-only' ? '\0v5-ai-server-only' : null },
      load(id) { return id === '\0v5-ai-server-only' ? 'export {}' : null },
    }],
  })
  try {
    return {
      mapping: await server.ssrLoadModule('/lib/cookingStepMapping.ts'),
      mappingAi: await server.ssrLoadModule('/lib/cookingStepMappingAi.ts'),
      recipeContent: await server.ssrLoadModule('/lib/recipeContent.ts'),
      close: () => server.close(),
    }
  } catch (error) {
    await server.close()
    throw error
  }
}

async function aiRun(modules, row, label) {
  const result = await callWithOneTransientRetry(() => modules.mappingAi.resolveCookingStepMappingsWithAi(
    row.deterministicMap,
    row.ingredients,
    row.instructions,
    `recovered-recipe-mapping-v5-${label}`,
  ))
  if (result.status === 'failed') return { ...result, candidateMap: row.deterministicMap, additions: [] }
  const candidateMap = modules.mappingAi.mergeValidatedAiCookingMappings(
    row.deterministicMap, row.ingredients, row.instructions, result.value,
  )
  const validation = modules.mapping.validateCookingStepIngredientMap(
    candidateMap, row.ingredients, row.instructions, row.deterministicMap,
  )
  return {
    ...result,
    candidateMap,
    validation,
    additions: extractAiAdditions(row.recipeId, candidateMap, row.ingredients, row.instructions),
  }
}

async function main() {
  if (TARGET_IDS.length !== 26 || new Set(TARGET_IDS).size !== TARGET_IDS.length) {
    throw new Error('Bounded v5 AI population must contain 26 unique recipes')
  }
  const deterministic = JSON.parse(fs.readFileSync(DETERMINISTIC_INPUT, 'utf8'))
  const byId = new Map(deterministic.rows.map(row => [row.recipeId, row]))
  if (deterministic.deterministic.invalidCandidates !== 0 ||
      deterministic.existingMappedSafety.runtimeAccepted !== 187 ||
      deterministic.existingMappedSafety.fallbacks !== 0) {
    throw new Error('Deterministic and 187-map gates must pass before bounded AI')
  }
  for (const recipeId of TARGET_IDS) {
    const row = byId.get(recipeId)
    if (!row || !row.deterministicMap.steps.some(step =>
      ['ambiguous', 'implicit-reference', 'prepared-component'].includes(step.unresolvedReason))) {
      throw new Error(`${recipeId}: fixed bounded target is no longer AI-eligible`)
    }
  }

  loadEnv()
  const modules = await loadModules()
  const originalInfo = console.info
  const usage = { primaryRequests: 0, stabilityRequests: 0, metadata: [] }
  console.info = (...values) => {
    if (values[0] === '[ai-usage]' && values[1]) usage.metadata.push(values[1])
    originalInfo(...values)
  }
  try {
    const snapshots = await getAdmin().firestore().collection('recipes').get()
    const live = new Map(snapshots.docs.map(doc => [doc.id, doc.data()]))
    const rows = TARGET_IDS.map(recipeId => {
      const baseline = byId.get(recipeId)
      const data = live.get(recipeId)
      const parsed = modules.recipeContent.parseRecipeContent(typeof data?.content === 'string' ? data.content : '')
      const currentMapAbsent = data?.cookingStepIngredientMap === undefined || data?.cookingStepIngredientMap === null
      if (!data || !currentMapAbsent || JSON.stringify(parsed.ingredients) !== JSON.stringify(baseline.ingredients) ||
          JSON.stringify(parsed.instructions) !== JSON.stringify(baseline.instructions)) {
        throw new Error(`${recipeId}: live AI precondition changed`)
      }
      return { ...baseline, currentMapAbsent, primary: null, repeat: null, stability: null }
    })

    await mapConcurrent(rows, 3, async row => {
      row.primary = await aiRun(modules, row, 'primary')
      usage.primaryRequests += row.primary.attempts
    })
    await mapConcurrent(rows, 3, async row => {
      row.repeat = await aiRun(modules, row, 'stability')
      usage.stabilityRequests += row.repeat.attempts
      row.stability = row.primary.status === 'completed' && row.repeat.status === 'completed' &&
        row.primary.validation?.valid && row.repeat.validation?.valid
        ? compareStability(row.primary.candidateMap, row.repeat.candidateMap)
        : 'ERROR'
    })

    const output = {
      auditDate: DATE,
      generatedAt: new Date().toISOString(),
      mode: 'READ_ONLY_BOUNDED_HYBRID_V5_VALIDATION',
      auditVersion: deterministic.auditVersion,
      population: { recipes: rows.length, targetIds: TARGET_IDS },
      usage,
      metrics: {
        primaryRequests: usage.primaryRequests,
        stabilityRequests: usage.stabilityRequests,
        retries: usage.primaryRequests + usage.stabilityRequests - rows.length * 2,
        failures: rows.filter(row => row.primary.status !== 'completed' || row.repeat.status !== 'completed').length,
        primaryAcceptedRelationships: rows.reduce((sum, row) => sum + row.primary.additions.length, 0),
        repeatAcceptedRelationships: rows.reduce((sum, row) => sum + row.repeat.additions.length, 0),
        exactStable: rows.filter(row => row.stability === 'EXACT_STABLE').length,
        semanticallyStable: rows.filter(row => row.stability === 'SEMANTICALLY_STABLE').length,
        safeOmissionDifference: rows.filter(row => row.stability === 'SAFE_OMISSION_DIFFERENCE').length,
        unsafeMaterialDifference: rows.filter(row => row.stability === 'UNSAFE_MATERIAL_DIFFERENCE').length,
        errors: rows.filter(row => row.stability === 'ERROR').length,
      },
      consumedVinaigretteSalt: {
        primaryRejected: !rows.find(row => row.recipeId === 'couscous-salad-with-lime-basil-vinaigrette')
          .primary.additions.some(item => item.kind === 'ingredient' && item.ingredientIndex === 15),
        repeatRejected: !rows.find(row => row.recipeId === 'couscous-salad-with-lime-basil-vinaigrette')
          .repeat.additions.some(item => item.kind === 'ingredient' && item.ingredientIndex === 15),
      },
      productionMutation: { recipeWrites: 0, mapWrites: 0, firestoreMutations: 0 },
      rows,
    }
    fs.writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`)
    console.log(JSON.stringify({ output: OUTPUT, metrics: output.metrics, consumedVinaigretteSalt: output.consumedVinaigretteSalt, productionMutation: output.productionMutation }, null, 2))
  } finally {
    console.info = originalInfo
    await modules.close()
  }
}

await main()
