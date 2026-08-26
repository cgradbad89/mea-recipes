#!/usr/bin/env node
/**
 * Manifest-locked production apply for the reviewed v4 cooking-step maps.
 *
 * The only candidate source is the exact authorized manifest. The deterministic
 * review artifact supplies validation baselines only; it never selects a recipe
 * or supplies a persisted candidate. This script contains no mapping generation
 * or AI execution path.
 *
 * Usage:
 *   node scripts/apply-cooking-step-mapping-v4-manifest.mjs --dry-run
 *   node scripts/apply-cooking-step-mapping-v4-manifest.mjs --apply
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
  VALIDATION_EVIDENCE_PATH,
  buildApplyPlan,
  commitApplyPlan,
  loadAuthorizedManifest,
  loadValidationBaselines,
  parseMode,
  verifyExcludedUnchanged,
  verifyReadback,
} from './apply-cooking-step-mapping-v4-core.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { loadEnv, getAdmin } = require('./_lib.js')
const RUNTIME_REPORTS = Object.freeze({
  'dry-run': '/tmp/cooking-step-mapping-v4-apply-dry-run.json',
  apply: '/tmp/cooking-step-mapping-v4-apply-execution.json',
})

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

async function loadProductionValidationModules() {
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    resolve: { alias: { '@': ROOT } },
    plugins: [{
      name: 'apply-server-only-marker', enforce: 'pre',
      resolveId(id) { return id === 'server-only' ? '\0apply-server-only' : null },
      load(id) { return id === '\0apply-server-only' ? 'export {}' : null },
    }],
  })
  try {
    const recipeContent = await server.ssrLoadModule('/lib/recipeContent.ts')
    const mapping = await server.ssrLoadModule('/lib/cookingStepMapping.ts')
    if (
      mapping.COOKING_MAPPING_PARSER_VERSION !== 'recipe-content-v1' ||
      mapping.COOKING_MAPPING_ENGINE_VERSION !== 'deterministic-v4' ||
      mapping.COOKING_MAPPING_HYBRID_ENGINE_VERSION !== 'hybrid-v4'
    ) throw new Error('Live validation module configuration differs from the approved v4 contract')
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

async function readDocuments(db, rows) {
  const refs = rows.map(row => db.collection('recipes').doc(row.recipeId))
  const snapshots = await db.getAll(...refs)
  if (snapshots.length !== rows.length) throw new Error('Firestore read did not return the complete requested population')
  return new Map(rows.map((row, index) => {
    const snapshot = snapshots[index]
    if (snapshot.id !== row.recipeId) throw new Error(`Firestore read order mismatch for ${row.recipeId}`)
    return [row.recipeId, {
      id: snapshot.id,
      exists: snapshot.exists,
      data: snapshot.exists ? snapshot.data() : null,
      updateTime: snapshot.updateTime,
    }]
  }))
}

function preflightSummary(plan) {
  return {
    manifestReadyRows: EXPECTED_COUNTS.READY,
    readyToWrite: plan.readyToWrite.length,
    skipped: plan.skipped.length,
    unexpectedErrors: plan.unexpectedErrors.length,
    skipRows: plan.skipped,
    errors: plan.unexpectedErrors,
  }
}

function skipSummary(plan) {
  const reasons = {}
  for (const row of plan.skipped) reasons[row.reason] = (reasons[row.reason] || 0) + 1
  return reasons
}

async function main() {
  const mode = parseMode(process.argv.slice(2))

  // The manifest byte gate is deliberately the first filesystem/domain action.
  const manifestBytes = fs.readFileSync(path.join(ROOT, AUTHORIZED_MANIFEST_PATH))
  const manifest = loadAuthorizedManifest(manifestBytes)
  const readyRows = manifest.rows.filter(row => row.classification === 'READY')
  const excludedRows = manifest.rows.filter(row => row.classification === 'EXCLUDED')

  const validationBytes = fs.readFileSync(path.join(ROOT, VALIDATION_EVIDENCE_PATH))
  const baselines = loadValidationBaselines(validationBytes, readyRows)
  const modules = await loadProductionValidationModules()

  let report
  try {
    loadEnv()
    const db = getAdmin().firestore()
    const [readyBefore, excludedBefore] = await Promise.all([
      readDocuments(db, readyRows),
      readDocuments(db, excludedRows),
    ])
    const plan = await buildApplyPlan({ readyRows, liveById: readyBefore, baselines, ...modules })
    const preflight = preflightSummary(plan)
    console.log(stableJson({ phase: 'PRE-APPLY GATE', ...preflight }))
    if (plan.unexpectedErrors.length > 0) {
      throw new Error(`ABORT: ${plan.unexpectedErrors.length} unexpected preflight errors; 0 writes`)
    }

    const base = {
      mode,
      executedAt: new Date().toISOString(),
      approvedManifest: { path: AUTHORIZED_MANIFEST_PATH, sha256: manifest.actualSha256 },
      repository: { startingSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim() },
      manifest: { counts: manifest.counts },
      preflight,
      aiCalls: 0,
      deterministicMappingGenerations: 0,
      hybridMappingGenerations: 0,
      manifestCandidateSubstitutions: 0,
    }

    if (mode === 'dry-run') {
      report = {
        ...base,
        apply: { attemptedWrites: 0, committedWrites: 0, batchCount: 0, writeField: 'cookingStepIngredientMap only' },
        excluded: {
          rows: excludedRows.length,
          writesByThisApply: 0,
          mapsPresentAtRead: [...excludedBefore.values()].filter(value => value.exists && value.data?.cookingStepIngredientMap != null).length,
        },
        skipReasons: skipSummary(plan),
      }
    } else {
      let applyResult
      let commitError = null
      try {
        applyResult = await commitApplyPlan(db, plan)
      } catch (error) {
        commitError = error instanceof Error ? error.message : String(error)
        applyResult = { batchCount: plan.readyToWrite.length > 0 ? 1 : 0, attemptedWrites: plan.readyToWrite.length, committedWrites: 0 }
      }

      // Mandatory readback runs even after a commit error so an ambiguous result is never replayed.
      const [readyAfter, excludedAfter] = await Promise.all([
        readDocuments(db, readyRows),
        readDocuments(db, excludedRows),
      ])
      const readback = await verifyReadback({
        readyRows, plan, liveById: readyAfter, baselines, ...modules,
      })
      const excluded = verifyExcludedUnchanged(excludedRows, excludedBefore, excludedAfter)
      const postApplyPlan = await buildApplyPlan({ readyRows, liveById: readyAfter, baselines, ...modules })
      const postApplyDryRun = {
        readyToWrite: postApplyPlan.readyToWrite.length,
        skippedMapAlreadyPresent: postApplyPlan.skipped.filter(row => row.reason === 'MAP_ALREADY_PRESENT').length,
        otherSkips: postApplyPlan.skipped.filter(row => row.reason !== 'MAP_ALREADY_PRESENT').length,
        unexpectedErrors: postApplyPlan.unexpectedErrors.length,
        skipRows: postApplyPlan.skipped,
      }
      if (commitError && readback.exactCandidateMatches === plan.readyToWrite.length) {
        applyResult.committedWrites = plan.readyToWrite.length
      }
      report = {
        ...base,
        apply: { ...applyResult, writeField: 'cookingStepIngredientMap only', commitError },
        readback,
        excluded,
        nonReadyWrites: { REVIEW: 0, ERROR: 0, EXISTING_MAP: 0 },
        postApplyDryRun,
      }
      const criticalFailure = Boolean(commitError) ||
        readback.unexpectedStates > 0 ||
        readback.nonMapFieldMismatches > 0 ||
        excluded.mutations.length > 0 ||
        postApplyPlan.unexpectedErrors.length > 0 ||
        postApplyPlan.readyToWrite.length > 0
      if (criticalFailure) report.criticalFailure = true
    }
  } finally {
    await modules.close()
  }

  fs.writeFileSync(RUNTIME_REPORTS[mode], stableJson(report), { mode: 0o600 })
  console.log(stableJson(report))
  if (report.criticalFailure) throw new Error('Critical apply/readback verification failure; see runtime report')
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exitCode = 1
})
