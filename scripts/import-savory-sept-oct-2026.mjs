#!/usr/bin/env node
/**
 * Create-only production import for the nine authorized Savory Sep/Oct 2026 recipes.
 *
 * First run (strictly read-only):
 *   node scripts/import-savory-sept-oct-2026.mjs --dry-run \
 *     --report=docs/audits/savory-sept-oct-2026-import-dry-run.json
 *
 * Apply is locked to that clean dry-run, the exact manifest, project, and count:
 *   node scripts/import-savory-sept-oct-2026.mjs --apply \
 *     --dry-run-report=docs/audits/savory-sept-oct-2026-import-dry-run.json \
 *     --confirm-project=malignant-metro --confirm-count=9 \
 *     --report=docs/audits/savory-sept-oct-2026-import-apply.json
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import {
  EXPECTED_RECIPE_COUNT,
  PROJECT_ID,
  RECIPE_COLLECTION,
  applyPreparedEntries,
  assertDryRunClean,
  buildDryRunRows,
  fingerprint,
  sha256,
  stableValue,
  validateManifest,
  validateSourceMetadata,
  verifyStoredRecipe,
} from './savory-sept-oct-2026-import-core.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST_PATH = path.join(ROOT, 'scripts/savory-sept-oct-2026-manifest.json')
const require = createRequire(import.meta.url)
const { loadEnv, getAdmin } = require('./_lib.js')

function parseArgs(argv) {
  const args = { mode: null }
  for (const raw of argv) {
    if (raw === '--dry-run' || raw === '--apply') {
      assert.equal(args.mode, null, 'choose exactly one mode')
      args.mode = raw.slice(2)
    } else if (raw.startsWith('--report=')) args.report = raw.slice('--report='.length)
    else if (raw.startsWith('--dry-run-report=')) args.dryRunReport = raw.slice('--dry-run-report='.length)
    else if (raw.startsWith('--confirm-project=')) args.confirmProject = raw.slice('--confirm-project='.length)
    else if (raw.startsWith('--confirm-count=')) args.confirmCount = Number(raw.slice('--confirm-count='.length))
    else throw new Error(`unknown argument: ${raw}`)
  }
  assert.ok(args.mode === 'dry-run' || args.mode === 'apply', 'choose exactly one mode: --dry-run or --apply')
  assert.ok(args.report, '--report=<path> is required')
  return args
}

async function loadRepositoryModules() {
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false },
    resolve: { alias: { '@': ROOT } },
  })
  try {
    const [utils, recipeContent, categories, nutritionEngine, admin] = await Promise.all([
      server.ssrLoadModule('/lib/utils.ts'),
      server.ssrLoadModule('/lib/recipeContent.ts'),
      server.ssrLoadModule('/lib/recipeCategories.ts'),
      server.ssrLoadModule('/lib/nutritionEngine.ts'),
      server.ssrLoadModule('/lib/admin.ts'),
    ])
    return {
      recipeIdForTitle(title) {
        const id = utils.slugify(title)
        if (!id) throw new Error('recipe title produces an empty canonical ID')
        return id
      },
      parseRecipeContent: recipeContent.parseRecipeContent,
      isRecipeCategory: categories.isRecipeCategory,
      computeRecipeNutrition: nutritionEngine.computeRecipeNutrition,
      ADMIN_EMAIL: admin.ADMIN_EMAIL,
      close: () => server.close(),
    }
  } catch (error) {
    await server.close()
    throw error
  }
}

function verifyRecordedSources(manifest, entries) {
  assert.equal(manifest.sourceVerification?.status, 'verified', 'source verification evidence is not approved')
  assert.match(manifest.sourceVerification?.verifiedAt || '', /^\d{4}-\d{2}-\d{2}$/, 'source verification date missing')
  assert.equal(
    manifest.sourceVerification?.method,
    'Official Savory recipe page canonical link and Recipe JSON-LD inspected in a browser',
    'unexpected source verification method',
  )
  return new Map(entries.map(entry => {
    const verified = {
      canonicalURL: entry.sourceURL,
      ...entry.sourceMetadata,
      imageURL: entry.imageURL,
    }
    validateSourceMetadata(entry, verified)
    return [entry.sourceURL, verified]
  }))
}

async function readAllRecipes(db) {
  const snapshot = await db.collection(RECIPE_COLLECTION).get()
  return new Map(snapshot.docs.sort((a, b) => a.id.localeCompare(b.id)).map(doc => [doc.id, {
    id: doc.id,
    data: doc.data(),
    updateTime: doc.updateTime,
  }]))
}

function catalogBaseline(liveById) {
  return [...liveById.values()].map(row => ({
    id: row.id,
    documentFingerprint: fingerprint(row.data),
    updateTimeMillis: row.updateTime?.toMillis() ?? null,
  }))
}

function writeReport(reportPath, report) {
  const absolute = path.resolve(ROOT, reportPath)
  fs.mkdirSync(path.dirname(absolute), { recursive: true })
  fs.writeFileSync(absolute, `${JSON.stringify(stableValue(report), null, 2)}\n`)
  console.log(`Report: ${absolute}`)
}

function printRows(rows) {
  console.table(rows.map(row => ({
    title: row.title,
    targetID: row.targetRecipeID,
    exists: row.targetDocExists,
    ingredients: row.ingredientCount,
    instructions: row.instructionCount,
    source: row.sourceURLStatus,
    image: row.imageURLStatus,
    admin: row.addedByUidResolutionStatus,
    status: row.proposedWriteStatus,
  })))
}

async function buildReadOnlyState({ db, adminAuth, modules, manifest, manifestSha }) {
  const entries = validateManifest(manifest, modules)
  const sourceByUrl = verifyRecordedSources(manifest, entries)
  const [user, liveById] = await Promise.all([
    adminAuth.getUserByEmail(modules.ADMIN_EMAIL),
    readAllRecipes(db),
  ])
  assert.ok(!user.disabled, 'configured admin account is disabled')
  const liveDataById = new Map([...liveById].map(([id, row]) => [id, row.data]))
  const rows = buildDryRunRows(entries, {
    adminUid: user.uid,
    previewCreated: new Date().toString(),
    liveById: liveDataById,
    sourceByUrl,
  })
  return {
    entries,
    user,
    liveById,
    sourceByUrl,
    rows,
    manifestSha,
    sourceVerification: manifest.sourceVerification,
    baseline: catalogBaseline(liveById),
  }
}

async function runDryRun(state, args) {
  assertDryRunClean(state.rows)
  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'dry-run',
    gateStatus: 'PASSED',
    projectId: PROJECT_ID,
    batchId: 'savory-september-october-2026-nine-recipes',
    manifestPath: path.relative(ROOT, MANIFEST_PATH),
    manifestSha256: state.manifestSha,
    sourceVerification: state.sourceVerification,
    productionCatalogCount: state.liveById.size,
    catalogBaseline: state.baseline,
    catalogBaselineFingerprint: fingerprint(state.baseline),
    adminIdentity: {
      email: state.user.email,
      disabled: state.user.disabled,
      uidResolutionStatus: 'resolved',
      uidFingerprint: fingerprint(state.user.uid),
    },
    autumnHarvestExpectedCountDiscrepancy: state.entries.find(entry => entry.title === 'Autumn Harvest Quinoa Bowl').auditNote,
    rows: state.rows,
    proposedWrites: EXPECTED_RECIPE_COUNT,
    writesPerformed: 0,
  }
  printRows(state.rows)
  writeReport(args.report, report)
  console.log('DRY RUN PASSED — all nine recipes are absent and validated; zero production writes performed.')
  return report
}

function makeAdapter(db, computeRecipeNutrition) {
  return {
    async createIfAbsent(recipeID, document) {
      const ref = db.collection(RECIPE_COLLECTION).doc(recipeID)
      return db.runTransaction(async transaction => {
        const existing = await transaction.get(ref)
        if (existing.exists) return { created: false }
        transaction.create(ref, document)
        return { created: true }
      })
    },
    async computeNutrition(recipeID, adminUid) {
      return computeRecipeNutrition(recipeID, { userId: adminUid })
    },
    async storeNutrition(recipeID, nutrition) {
      await db.collection(RECIPE_COLLECTION).doc(recipeID).update({
        nutrition: { ...nutrition, computed_at: new Date() },
        nutritionStatus: 'computed',
      })
    },
    async read(recipeID) {
      const snapshot = await db.collection(RECIPE_COLLECTION).doc(recipeID).get()
      return snapshot.exists ? snapshot.data() : null
    },
    async deleteIfMatches(recipeID, allowedDocuments) {
      const ref = db.collection(RECIPE_COLLECTION).doc(recipeID)
      return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref)
        if (!snapshot.exists) return true
        const liveFingerprint = fingerprint(snapshot.data())
        if (!allowedDocuments.some(document => fingerprint(document) === liveFingerprint)) return false
        transaction.delete(ref)
        return true
      })
    },
  }
}

function assertDryRunStillApplies(dryRun, state, args) {
  assert.equal(args.confirmProject, PROJECT_ID, `apply requires --confirm-project=${PROJECT_ID}`)
  assert.equal(args.confirmCount, EXPECTED_RECIPE_COUNT, `apply requires --confirm-count=${EXPECTED_RECIPE_COUNT}`)
  assert.equal(dryRun.mode, 'dry-run', 'provided artifact is not a dry run')
  assert.equal(dryRun.gateStatus, 'PASSED', 'provided dry run did not pass')
  assert.equal(dryRun.projectId, PROJECT_ID, 'dry-run project mismatch')
  assert.equal(dryRun.writesPerformed, 0, 'dry-run artifact unexpectedly records writes')
  assert.equal(dryRun.manifestSha256, state.manifestSha, 'manifest changed since dry run')
  assert.equal(dryRun.adminIdentity.uidFingerprint, fingerprint(state.user.uid), 'admin identity changed since dry run')
  assert.equal(dryRun.catalogBaselineFingerprint, fingerprint(state.baseline), 'production catalog changed since dry run')
  assertDryRunClean(state.rows)
}

async function verifyProductionAfterApply(db, state, results, parseRecipeContent) {
  const after = await readAllRecipes(db)
  const successful = results.filter(result => result.written)
  const expectedIds = new Set([...state.liveById.keys(), ...successful.map(result => result.recipeID)])
  assert.equal(after.size, state.liveById.size + successful.length, 'production recipe count did not increase by successful write count')
  assert.deepEqual([...after.keys()].sort(), [...expectedIds].sort(), 'unexpected production recipe ID change')

  const unrelatedChanges = []
  for (const [id, before] of state.liveById) {
    const current = after.get(id)
    if (!current || fingerprint(current.data) !== fingerprint(before.data)) unrelatedChanges.push(id)
  }
  assert.deepEqual(unrelatedChanges, [], 'an unrelated recipe document changed')

  const titleCounts = []
  for (const entry of state.entries) {
    const exact = await db.collection(RECIPE_COLLECTION).where('title', '==', entry.title).get()
    titleCounts.push({ title: entry.title, count: exact.size, ids: exact.docs.map(doc => doc.id).sort() })
    const result = results.find(item => item.recipeID === entry.recipeID)
    assert.equal(exact.size, result?.written ? 1 : 0, `${entry.title}: unexpected exact-title count`)
    if (result?.written) {
      const stored = after.get(entry.recipeID)?.data
      verifyStoredRecipe({ ...entry, parsed: parseRecipeContent(stored?.content || '') }, stored, state.user.uid)
    }
  }
  const autumn = titleCounts.find(row => row.title === 'Autumn Harvest Quinoa Bowl')
  assert.equal(autumn?.count, successful.some(row => row.recipeID === 'autumn-harvest-quinoa-bowl') ? 1 : 0, 'Autumn Harvest duplicate check failed')

  return {
    catalogCountBefore: state.liveById.size,
    catalogCountAfter: after.size,
    expectedIncrease: successful.length,
    actualIncrease: after.size - state.liveById.size,
    exactTitleSearches: titleCounts,
    autumnHarvestCount: autumn?.count ?? null,
    unrelatedRecipeChanges: unrelatedChanges,
    documentIdsWritten: successful.map(result => result.recipeID),
  }
}

async function runApply(state, args, modules, db) {
  assert.ok(args.dryRunReport, '--dry-run-report=<path> is required for apply')
  const dryRunPath = path.resolve(ROOT, args.dryRunReport)
  const dryRun = JSON.parse(fs.readFileSync(dryRunPath, 'utf8'))
  assertDryRunStillApplies(dryRun, state, args)

  const results = await applyPreparedEntries(state.entries, {
    adminUid: state.user.uid,
    nowString: () => new Date().toString(),
    parseRecipeContent: modules.parseRecipeContent,
    adapter: makeAdapter(db, modules.computeRecipeNutrition),
  })
  const verification = await verifyProductionAfterApply(db, state, results, modules.parseRecipeContent)
  const failed = results.filter(result => !result.written)
  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'apply',
    gateStatus: failed.length ? 'PARTIAL_FAILURE' : 'PASSED',
    projectId: PROJECT_ID,
    batchId: 'savory-september-october-2026-nine-recipes',
    manifestPath: path.relative(ROOT, MANIFEST_PATH),
    manifestSha256: state.manifestSha,
    dryRunReport: path.relative(ROOT, dryRunPath),
    dryRunReportSha256: sha256(fs.readFileSync(dryRunPath)),
    results,
    verification,
    writesPerformed: results.filter(result => result.written).length,
    failedRecipes: failed.map(result => result.recipeID),
  }
  console.table(results.map(result => ({
    recipe: result.title,
    id: result.recipeID,
    written: result.written,
    nutrition: result.nutritionComputed,
    attempts: result.nutritionAttempts || 0,
    status: result.status,
  })))
  writeReport(args.report, report)
  if (failed.length) throw new Error(`${failed.length} recipe(s) failed; see apply report`)
  console.log(`APPLY PASSED — ${results.length} recipes created, nutrition-computed, and read-back verified.`)
  return report
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  loadEnv()
  assert.equal(process.env.FIREBASE_PROJECT_ID, PROJECT_ID, `FIREBASE_PROJECT_ID must be ${PROJECT_ID}`)
  const manifestBytes = fs.readFileSync(MANIFEST_PATH)
  const manifest = JSON.parse(manifestBytes.toString('utf8'))
  const manifestSha = sha256(manifestBytes)
  const modules = await loadRepositoryModules()
  try {
    const admin = getAdmin()
    const db = admin.firestore()
    const state = await buildReadOnlyState({ db, adminAuth: admin.auth(), modules, manifest, manifestSha })
    console.log(`Mode: ${args.mode.toUpperCase()} | Project: ${PROJECT_ID} | Catalog before: ${state.liveById.size}`)
    if (args.mode === 'dry-run') return await runDryRun(state, args)
    return await runApply(state, args, modules, db)
  } finally {
    await modules.close()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(`FAILED: ${error.stack || error.message}`)
    process.exitCode = 1
  })
}

export { main, parseArgs, verifyRecordedSources }
