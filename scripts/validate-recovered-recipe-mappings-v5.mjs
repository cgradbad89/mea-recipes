#!/usr/bin/env node
/**
 * Read-only deterministic-v5 validation for the 41 repaired recipes and the
 * immutable 187-map production corpus. This script has no apply mode and no
 * Firestore mutation method.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { mapStats } from './audit-cooking-step-mappings-core.mjs'
import {
  AUTHORIZED_RECIPE_IDS,
  UNRESOLVED_RECIPE_IDS,
  assertAuthorizedPopulation,
} from './audit-recovered-recipe-mappings-core.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { loadEnv, getAdmin } = require('./_lib.js')
const DATE = '2026-08-26'
const OUTPUT = path.join('/tmp', `recovered-recipes-mapping-v5-deterministic-validation-${DATE}.json`)
const HISTORICAL_MANIFEST = path.join(ROOT, `docs/audits/recovered-recipes-mapping-v4-dryrun-${DATE}.json`)
const HISTORICAL_MANIFEST_SHA256 = '289759234b88c4d29b18fe42a7f67f2e18473cc9285dd5df4ef9ced798ca1716'
const BEHAVIOR_FILES = [
  'lib/cookingStepMapping.ts', 'lib/cookingStepMappingAi.ts', 'lib/ai.ts',
  'lib/aiConfig.ts', 'lib/ingredientParser.ts', 'lib/recipeContent.ts',
  'types/recipe.ts', 'app/api/cooking-step-map/route.ts',
]

function sha256(value) { return createHash('sha256').update(value).digest('hex') }
function stableJson(value) { return `${JSON.stringify(value, null, 2)}\n` }
function behaviorFingerprint() {
  return sha256(BEHAVIOR_FILES.map(file => `${file}\0${fs.readFileSync(path.join(ROOT, file))}`).join('\0'))
}

async function loadModules() {
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false },
    resolve: { alias: { '@': ROOT } },
  })
  try {
    return {
      mapping: await server.ssrLoadModule('/lib/cookingStepMapping.ts'),
      recipeContent: await server.ssrLoadModule('/lib/recipeContent.ts'),
      aiConfig: await server.ssrLoadModule('/lib/aiConfig.ts'),
      close: () => server.close(),
    }
  } catch (error) {
    await server.close()
    throw error
  }
}

async function readRecipes() {
  const snapshot = await getAdmin().firestore().collection('recipes').get()
  return new Map(snapshot.docs.map(doc => [doc.id, doc.data()]))
}

async function main() {
  assertAuthorizedPopulation()
  if (new Set(AUTHORIZED_RECIPE_IDS).size !== 41 || AUTHORIZED_RECIPE_IDS.length !== 41) {
    throw new Error('Recovered population must contain exactly 41 unique IDs')
  }
  if (AUTHORIZED_RECIPE_IDS.some(id => UNRESOLVED_RECIPE_IDS.includes(id))) {
    throw new Error('An unresolved Wave 4/5 recipe entered the v5 validation population')
  }
  const historicalBytes = fs.readFileSync(HISTORICAL_MANIFEST)
  if (sha256(historicalBytes) !== HISTORICAL_MANIFEST_SHA256) {
    throw new Error('Historical v4 recovered manifest SHA changed')
  }
  const historicalRows = new Map(JSON.parse(historicalBytes).map(row => [row.recipeId, row]))

  loadEnv()
  const modules = await loadModules()
  try {
    const fingerprint = behaviorFingerprint()
    const firstRead = await readRecipes()
    const rows = []
    for (const recipeId of [...AUTHORIZED_RECIPE_IDS].sort()) {
      const data = firstRead.get(recipeId)
      if (!data) throw new Error(`${recipeId}: live recipe missing`)
      const parsed = modules.recipeContent.parseRecipeContent(typeof data.content === 'string' ? data.content : '')
      if (!parsed.ingredients.length || !parsed.instructions.length) throw new Error(`${recipeId}: parser output empty`)
      const map = await modules.mapping.buildHashedDeterministicCookingStepMap(parsed.ingredients, parsed.instructions)
      const validation = modules.mapping.validateCookingStepIngredientMap(map, parsed.ingredients, parsed.instructions, map)
      const historical = historicalRows.get(recipeId)
      rows.push({
        recipeId,
        title: typeof data.title === 'string' ? data.title : '',
        currentMapAbsent: data.cookingStepIngredientMap === undefined || data.cookingStepIngredientMap === null,
        sourceHash: map.sourceHash,
        sourceUnchangedFromV4Audit: historical?.sourceHash === map.sourceHash,
        ingredientCount: parsed.ingredients.length,
        ingredients: parsed.ingredients,
        instructions: parsed.instructions,
        deterministicMap: map,
        deterministicStats: mapStats(map),
        validation,
        references: map.steps.flatMap(step => step.ingredients.map(reference => ({
          instructionIndex: step.instructionIndex,
          instruction: parsed.instructions[step.instructionIndex],
          ingredientIndex: reference.ingredientIndex,
          ingredient: parsed.ingredients[reference.ingredientIndex],
          usage: reference.usage || null,
        }))),
        fullyUnmappedInstructions: map.steps.filter(step => step.ingredients.length === 0).map(step => ({
          instructionIndex: step.instructionIndex,
          instruction: parsed.instructions[step.instructionIndex],
          unresolvedReason: step.unresolvedReason || null,
        })),
      })
    }

    const existingMaps = []
    for (const [recipeId, data] of firstRead) {
      const persisted = data.cookingStepIngredientMap
      if (persisted === undefined || persisted === null) continue
      const parsed = modules.recipeContent.parseRecipeContent(typeof data.content === 'string' ? data.content : '')
      const deterministic = await modules.mapping.buildHashedDeterministicCookingStepMap(parsed.ingredients, parsed.instructions)
      const validation = modules.mapping.validateCookingStepIngredientMap(persisted, parsed.ingredients, parsed.instructions, deterministic)
      const resolved = await modules.mapping.resolveCookingStepIngredientMap(parsed.ingredients, parsed.instructions, persisted)
      existingMaps.push({
        recipeId,
        engineVersion: persisted.engineVersion || null,
        storedSourceHash: persisted.sourceHash || null,
        liveSourceHash: deterministic.sourceHash,
        sourceHashMatches: persisted.sourceHash === deterministic.sourceHash,
        validation,
        runtimeSource: resolved.source,
        fallbackReason: resolved.fallbackReason || null,
      })
    }
    existingMaps.sort((a, b) => a.recipeId.localeCompare(b.recipeId))

    const secondRead = await readRecipes()
    const finalPreconditions = []
    for (const row of rows) {
      const data = secondRead.get(row.recipeId)
      const parsed = modules.recipeContent.parseRecipeContent(typeof data?.content === 'string' ? data.content : '')
      const sourceHash = await modules.mapping.computeCookingMappingSourceHash(parsed.ingredients, parsed.instructions)
      finalPreconditions.push({
        recipeId: row.recipeId,
        liveRecipeExists: Boolean(data),
        currentMapAbsent: data?.cookingStepIngredientMap === undefined || data?.cookingStepIngredientMap === null,
        sourceHashMatches: sourceHash === row.sourceHash,
      })
    }
    if (behaviorFingerprint() !== fingerprint) throw new Error('Mapping behavior changed during validation')

    const output = {
      auditDate: DATE,
      generatedAt: new Date().toISOString(),
      mode: 'READ_ONLY_DETERMINISTIC_V5_REMEDIATION_VALIDATION',
      auditVersion: {
        gitSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
        behaviorFingerprint: fingerprint,
        schemaVersion: 1,
        parserVersion: modules.mapping.COOKING_MAPPING_PARSER_VERSION,
        deterministicEngineVersion: modules.mapping.COOKING_MAPPING_ENGINE_VERSION,
        hybridEngineVersion: modules.mapping.COOKING_MAPPING_HYBRID_ENGINE_VERSION,
        promptVersion: modules.aiConfig.COOKING_STEP_MAPPING_PROMPT_VERSION,
        model: modules.aiConfig.AI_MODEL,
        temperature: modules.aiConfig.COOKING_STEP_MAPPING_TEMPERATURE,
      },
      population: { wave1A: 28, wave2: 6, wave3: 7, unique: 41, unresolvedEightAdmitted: 0 },
      productionBaseline: {
        sharedRecipes: firstRead.size,
        recipesWithMaps: existingMaps.length,
        recipesWithoutMaps: firstRead.size - existingMaps.length,
      },
      deterministic: {
        recipes: rows.length,
        ingredientReferences: rows.reduce((sum, row) => sum + row.references.length, 0),
        fullyUnmappedInstructions: rows.reduce((sum, row) => sum + row.fullyUnmappedInstructions.length, 0),
        invalidCandidates: rows.filter(row => !row.validation.valid).length,
        changedSources: rows.filter(row => !row.sourceUnchangedFromV4Audit).length,
        existingMaps: rows.filter(row => !row.currentMapAbsent).length,
      },
      existingMappedSafety: {
        mappedRecipes: existingMaps.length,
        sourceHashMatches: existingMaps.filter(row => row.sourceHashMatches).length,
        structurallyValid: existingMaps.filter(row => row.validation.valid).length,
        runtimeAccepted: existingMaps.filter(row => row.runtimeSource === 'persisted').length,
        fallbacks: existingMaps.filter(row => row.runtimeSource !== 'persisted').length,
        rows: existingMaps,
      },
      finalPreconditions: {
        checked: finalPreconditions.length,
        passed: finalPreconditions.filter(row => row.liveRecipeExists && row.currentMapAbsent && row.sourceHashMatches).length,
        rows: finalPreconditions,
      },
      historicalManifest: { path: path.relative(ROOT, HISTORICAL_MANIFEST), sha256: HISTORICAL_MANIFEST_SHA256, unchanged: true },
      productionMutation: { recipeWrites: 0, mapWrites: 0, firestoreMutations: 0 },
      rows,
    }
    fs.writeFileSync(OUTPUT, stableJson(output))
    console.log(JSON.stringify({
      output: OUTPUT,
      auditVersion: output.auditVersion,
      population: output.population,
      productionBaseline: output.productionBaseline,
      deterministic: output.deterministic,
      existingMappedSafety: { ...output.existingMappedSafety, rows: undefined },
      finalPreconditions: { ...output.finalPreconditions, rows: undefined },
      productionMutation: output.productionMutation,
    }, null, 2))
  } finally {
    await modules.close()
  }
}

await main()
