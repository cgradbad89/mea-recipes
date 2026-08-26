#!/usr/bin/env node
/**
 * Exact-manifest production apply for the 41 recovered hybrid-v5 maps.
 *
 * Candidate values come only from the hard-locked manifest. The separately
 * locked semantic artifact supplies validator baselines only. This file has no
 * AI, mapping-generation, candidate-repair, or arbitrary-manifest path.
 *
 * Usage:
 *   node scripts/apply-recovered-recipe-mapping-v5-manifest.mjs --dry-run
 *   node scripts/apply-recovered-recipe-mapping-v5-manifest.mjs --apply
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import {
  AUTHORIZED_MANIFEST_PATH,
  AUTHORIZED_MANIFEST_SHA256,
  EXPECTED_COUNTS,
  SEMANTIC_EVIDENCE_PATH,
  UNRESOLVED_RECIPE_IDS,
  buildApplyPlan,
  commitApplyPlan,
  documentHash,
  hasMap,
  loadAuthorizedManifest,
  loadValidationBaselines,
  parseMode,
  snapshotProtectedDocuments,
  verifyProtectedDocumentsUnchanged,
  verifyReadback,
} from './apply-recovered-recipe-mapping-v5-core.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { loadEnv, getAdmin } = require('./_lib.js')
const RUNTIME_REPORTS = Object.freeze({
  'dry-run': '/tmp/recovered-recipes-mapping-v5-apply-dry-run.json',
  apply: '/tmp/recovered-recipes-mapping-v5-apply-execution.json',
})

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

async function loadValidationModules() {
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false },
    resolve: { alias: { '@': ROOT } },
    plugins: [{
      name: 'recovered-v5-apply-server-only', enforce: 'pre',
      resolveId(id) { return id === 'server-only' ? '\0recovered-v5-apply-server-only' : null },
      load(id) { return id === '\0recovered-v5-apply-server-only' ? 'export {}' : null },
    }],
  })
  try {
    const recipeContent = await server.ssrLoadModule('/lib/recipeContent.ts')
    const mapping = await server.ssrLoadModule('/lib/cookingStepMapping.ts')
    if (
      mapping.COOKING_MAPPING_PARSER_VERSION !== 'recipe-content-v1' ||
      mapping.COOKING_MAPPING_ENGINE_VERSION !== 'deterministic-v5' ||
      mapping.COOKING_MAPPING_HYBRID_ENGINE_VERSION !== 'hybrid-v5'
    ) throw new Error('Live validation contract differs from the approved hybrid-v5 configuration')
    return {
      parseRecipeContent: recipeContent.parseRecipeContent,
      computeSourceHash: mapping.computeCookingMappingSourceHash,
      validateCandidate: mapping.validateCookingStepIngredientMap,
      close: () => server.close(),
    }
  } catch (error) {
    await server.close()
    throw error
  }
}

async function readAllRecipes(db) {
  const snapshot = await db.collection('recipes').get()
  return new Map(snapshot.docs.map(doc => [doc.id, {
    id: doc.id,
    exists: true,
    data: doc.data(),
    updateTime: doc.updateTime,
  }]))
}

function skipReasons(plan) {
  return plan.skipped.reduce((reasons, row) => {
    reasons[row.reason] = (reasons[row.reason] || 0) + 1
    return reasons
  }, {})
}

async function validateOriginalMappedCorpus(allRecipes, manifestIds, modules) {
  const rows = [...allRecipes.values()].filter(live => hasMap(live.data) && !manifestIds.has(live.id))
  if (rows.length !== 187) throw new Error(`Expected 187 original mapped recipes, received ${rows.length}`)
  const failures = []
  for (const live of rows) {
    const persisted = live.data.cookingStepIngredientMap
    const parsed = modules.parseRecipeContent(typeof live.data.content === 'string' ? live.data.content : '')
    const sourceHash = await modules.computeSourceHash(parsed.ingredients, parsed.instructions)
    const validation = modules.validateCandidate(persisted, parsed.ingredients, parsed.instructions, persisted)
    if (!['deterministic-v4', 'hybrid-v4'].includes(persisted?.engineVersion) ||
        persisted?.sourceHash !== sourceHash || !validation.valid) {
      failures.push({ recipeId: live.id, engineVersion: persisted?.engineVersion || null,
        sourceHashMatches: persisted?.sourceHash === sourceHash, validation })
    }
  }
  if (failures.length) throw new Error(`Original 187-map validation failed: ${stableJson(failures)}`)
  return { recipeIds: rows.map(row => row.id).sort(), valid: rows.length, failures }
}

function validateUnresolvedPopulation(allRecipes) {
  const failures = []
  for (const recipeId of UNRESOLVED_RECIPE_IDS) {
    const live = allRecipes.get(recipeId)
    if (!live?.exists) failures.push({ recipeId, reason: 'RECIPE_MISSING' })
    else if (hasMap(live.data)) failures.push({ recipeId, reason: 'MAP_PRESENT' })
  }
  if (failures.length) throw new Error(`Unresolved-eight safety gate failed: ${stableJson(failures)}`)
  return { rows: UNRESOLVED_RECIPE_IDS.length, mapsPresent: 0, failures }
}

function preflightSummary(plan) {
  return {
    readyRows: EXPECTED_COUNTS.READY,
    readyToWrite: plan.readyToWrite.length,
    skipped: plan.skipped.length,
    errors: plan.unexpectedErrors.length,
    skipReasons: skipReasons(plan),
    skipRows: plan.skipped,
    errorRows: plan.unexpectedErrors,
  }
}

async function main() {
  const mode = parseMode(process.argv.slice(2))

  // Manifest bytes are always checked before environment or Firestore access.
  const manifestBytes = fs.readFileSync(path.join(ROOT, AUTHORIZED_MANIFEST_PATH))
  const manifest = loadAuthorizedManifest(manifestBytes)
  const readyRows = manifest.rows.filter(row => row.classification === 'READY')
  const manifestIds = new Set(readyRows.map(row => row.recipeId))
  const evidenceBytes = fs.readFileSync(path.join(ROOT, SEMANTIC_EVIDENCE_PATH))
  const baselines = loadValidationBaselines(evidenceBytes, readyRows)
  const modules = await loadValidationModules()

  let report
  try {
    loadEnv()
    const db = getAdmin().firestore()
    const before = await readAllRecipes(db)
    if (before.size !== 236) throw new Error(`Expected 236 shared recipes, received ${before.size}`)
    const original = await validateOriginalMappedCorpus(before, manifestIds, modules)
    const unresolved = validateUnresolvedPopulation(before)
    const originalSnapshot = snapshotProtectedDocuments(before, original.recipeIds)
    const unresolvedSnapshot = snapshotProtectedDocuments(before, UNRESOLVED_RECIPE_IDS)
    const plan = await buildApplyPlan({ readyRows, liveById: before, baselines, ...modules })
    const preflight = preflightSummary(plan)
    console.log(stableJson({ phase: 'PRE-APPLY GATE', ...preflight }))
    if (plan.unexpectedErrors.length) throw new Error(`ABORT: ${plan.unexpectedErrors.length} preflight errors; 0 writes`)

    const base = {
      mode,
      executedAt: new Date().toISOString(),
      approvedManifest: { path: AUTHORIZED_MANIFEST_PATH, sha256: manifest.actualSha256, rows: manifest.counts.rows },
      repository: {
        branch: execFileSync('git', ['branch', '--show-current'], { cwd: ROOT, encoding: 'utf8' }).trim(),
        startingSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
      },
      manifest: manifest.counts,
      preflight,
      aiAndRecomputation: {
        aiCalls: 0,
        deterministicMappingGenerations: 0,
        hybridMappingGenerations: 0,
        manifestCandidateSubstitutions: 0,
      },
      preApplyCorpus: {
        sharedRecipes: before.size,
        originalMapped: original.valid,
        recoveredMapped: [...manifestIds].filter(id => hasMap(before.get(id)?.data)).length,
        unresolvedWithoutMaps: unresolved.rows,
      },
    }

    if (mode === 'dry-run') {
      report = {
        ...base,
        result: 'DRY_RUN_PASS',
        apply: { batchCount: 0, attemptedWrites: 0, committedWrites: 0, writeField: 'cookingStepIngredientMap' },
        productionWrites: 0,
      }
    } else {
      let apply
      let commitError = null
      try {
        apply = await commitApplyPlan(db, plan)
      } catch (error) {
        commitError = error instanceof Error ? error.message : String(error)
        apply = { batchCount: plan.readyToWrite.length ? 1 : 0,
          attemptedWrites: plan.readyToWrite.length, committedWrites: 0 }
      }

      // Always reread after commit attempt; an ambiguous commit is never replayed.
      const after = await readAllRecipes(db)
      const readback = await verifyReadback({ readyRows, plan, liveById: after, baselines, ...modules })
      const originalSafety = verifyProtectedDocumentsUnchanged(originalSnapshot, after)
      const unresolvedSafety = verifyProtectedDocumentsUnchanged(unresolvedSnapshot, after)
      const originalAfter = await validateOriginalMappedCorpus(after, manifestIds, modules)
      const unresolvedAfter = validateUnresolvedPopulation(after)
      const postPlan = await buildApplyPlan({ readyRows, liveById: after, baselines, ...modules })
      const postApply = {
        readyToWrite: postPlan.readyToWrite.length,
        mapAlreadyPresent: postPlan.skipped.filter(row => row.reason === 'MAP_ALREADY_PRESENT').length,
        otherSkips: postPlan.skipped.filter(row => row.reason !== 'MAP_ALREADY_PRESENT').length,
        errors: postPlan.unexpectedErrors.length,
      }
      const mapped = [...after.values()].filter(live => hasMap(live.data)).length
      const criticalFailure = Boolean(commitError) ||
        readback.unexpectedStates > 0 || readback.rawNonMapMismatches > 0 ||
        originalSafety.changed > 0 || unresolvedSafety.changed > 0 ||
        originalAfter.failures.length > 0 || unresolvedAfter.failures.length > 0 ||
        postApply.readyToWrite > 0 || postApply.otherSkips > 0 || postApply.errors > 0
      report = {
        ...base,
        result: criticalFailure ? 'FAIL' : (plan.skipped.length ? 'PASS WITH SKIPS' : 'PASS'),
        apply: { ...apply, writeField: 'cookingStepIngredientMap', commitError },
        readback,
        corpusSafety: {
          original187Changed: originalSafety.changed,
          original187ValidAfter: originalAfter.valid,
          unresolved8Changed: unresolvedSafety.changed,
          unresolved8MapsAfter: unresolvedAfter.mapsPresent,
        },
        postApply,
        finalCorpus: { sharedRecipes: after.size, mapped, unmapped: after.size - mapped },
        criticalFailure,
      }
    }
  } finally {
    await modules.close()
  }

  fs.writeFileSync(RUNTIME_REPORTS[mode], stableJson(report), { mode: 0o600 })
  console.log(stableJson(report))
  if (report.criticalFailure) throw new Error('Critical apply/readback failure; do not replay')
  if (report.approvedManifest.sha256 !== AUTHORIZED_MANIFEST_SHA256) throw new Error('Manifest lock changed')
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exitCode = 1
})
