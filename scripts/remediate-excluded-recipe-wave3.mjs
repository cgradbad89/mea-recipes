#!/usr/bin/env node
/**
 * Exact seven-recipe Wave 3 content remediation.
 *
 * Dry-run performs no write. Apply accepts only the pinned manifest SHA and
 * uses one update-time-preconditioned batch containing only { content }.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import {
  APPLY_MD_PATH,
  APPLY_PATH,
  AUTHORIZED_MANIFEST_SHA256,
  AUTHORIZED_RECIPE_IDS,
  MANIFEST_MD_PATH,
  MANIFEST_PATH,
  applyMarkdown,
  auditRemainingExcluded,
  buildApplyPlan,
  buildManifest,
  commitContentPlan,
  compareCorpusBaseline,
  compareMappedCorpus,
  manifestMarkdown,
  mappedCorpusSafety,
  sha256,
  stableJson,
  validateManifest,
  verifyCorpusChanges,
  verifyReadback,
} from './excluded-recipe-wave3-core.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { loadEnv, getAdmin } = require('./_lib.js')
const AUDIT_PATH = path.join(ROOT, 'docs/audits/excluded-recipe-source-parser-audit-2026-08-26.json')

function parseMode(args) {
  if (args.length !== 1 || !['--dry-run', '--plan', '--apply'].includes(args[0])) throw new Error('Choose exactly one mode: --dry-run, --plan, or --apply')
  return args[0].slice(2)
}

async function loadParser() {
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false },
    resolve: { alias: { '@': ROOT } },
  })
  try {
    const recipeContent = await server.ssrLoadModule('/lib/recipeContent.ts')
    return { parseRecipeContent: recipeContent.parseRecipeContent, close: () => server.close() }
  } catch (error) { await server.close(); throw error }
}

async function readAllRecipes(db) {
  const snapshot = await db.collection('recipes').get()
  return new Map(snapshot.docs.sort((a, b) => a.id.localeCompare(b.id)).map(doc => [doc.id, {
    id: doc.id, exists: doc.exists, data: doc.data(), updateTime: doc.updateTime,
  }]))
}

function exactSeven(allRecipes) {
  return new Map(AUTHORIZED_RECIPE_IDS.map(recipeId => [recipeId, allRecipes.get(recipeId)]))
}

function writeNewFile(relativePath, bytes) {
  const target = path.join(ROOT, relativePath)
  if (fs.existsSync(target)) {
    const existing = fs.readFileSync(target)
    if (!existing.equals(Buffer.from(bytes))) throw new Error(`Refusing to overwrite immutable artifact: ${relativePath}`)
    return
  }
  fs.writeFileSync(target, bytes, { flag: 'wx' })
}

async function dryRun(db, parseRecipeContent) {
  const allRecipes = await readAllRecipes(db)
  const audit = JSON.parse(fs.readFileSync(AUDIT_PATH, 'utf8'))
  const auditRows = audit.recipes.filter(row => AUTHORIZED_RECIPE_IDS.includes(row.recipeId))
  const corpusSafety = mappedCorpusSafety(allRecipes, parseRecipeContent)
  if (allRecipes.size !== 236) throw new Error(`Expected 236 production recipes, received ${allRecipes.size}`)
  if (corpusSafety.mappedRecipes !== 187 || corpusSafety.storedHashMismatches.length !== 0) throw new Error(`Mapped-corpus gate failed: ${stableJson(corpusSafety)}`)
  const manifest = buildManifest({ allRecipes, auditRows, parseRecipeContent, createdAt: new Date().toISOString() })
  if (manifest.counts.READY + manifest.counts.SKIP !== 7) throw new Error('Incomplete seven-recipe manifest')
  const bytes = stableJson(manifest)
  const manifestSha = sha256(bytes)
  writeNewFile(MANIFEST_PATH, bytes)
  writeNewFile(MANIFEST_MD_PATH, manifestMarkdown(manifest, manifestSha, corpusSafety))
  return {
    phase: 'DRY_RUN_COMPLETE',
    manifest: { path: MANIFEST_PATH, sha256: manifestSha, counts: manifest.counts },
    productionBaseline: { recipes: allRecipes.size, ...corpusSafety },
    writes: 0, mapWrites: 0, aiCalls: 0,
  }
}

async function planOnly(db, parseRecipeContent) {
  const manifestBytes = fs.readFileSync(path.join(ROOT, MANIFEST_PATH))
  const manifest = validateManifest(JSON.parse(manifestBytes.toString('utf8')), AUTHORIZED_MANIFEST_SHA256, manifestBytes)
  const allRecipes = await readAllRecipes(db)
  if (allRecipes.size !== 236) throw new Error(`Expected 236 production recipes, received ${allRecipes.size}`)
  const mappedBaselineGate = compareCorpusBaseline(manifest.corpusBaseline, allRecipes, parseRecipeContent, { mappedOnly: true })
  if (anyChanges(mappedBaselineGate)) throw new Error(`187-mapped-recipe planner gate failed: ${stableJson(mappedBaselineGate)}`)
  const plan = buildApplyPlan({ manifest, liveById: exactSeven(allRecipes), parseRecipeContent })
  return {
    phase: 'IMMUTABLE_MANIFEST_PLAN',
    manifest: { path: MANIFEST_PATH, sha256: sha256(manifestBytes) },
    readyToWrite: plan.readyToWrite.length,
    skipped: plan.skipped,
    errors: plan.errors,
    mappedBaselineGate,
    writes: 0,
    mapWrites: 0,
    aiCalls: 0,
  }
}

function anyChanges(result) {
  return Object.values(result).some(value => Array.isArray(value) && value.length > 0)
}

async function apply(db, parseRecipeContent) {
  const manifestBytes = fs.readFileSync(path.join(ROOT, MANIFEST_PATH))
  const manifest = validateManifest(JSON.parse(manifestBytes.toString('utf8')), AUTHORIZED_MANIFEST_SHA256, manifestBytes)

  const beforeAll = await readAllRecipes(db)
  if (beforeAll.size !== 236) throw new Error(`Expected 236 production recipes, received ${beforeAll.size}`)
  const mappedBaselineGate = compareCorpusBaseline(manifest.corpusBaseline, beforeAll, parseRecipeContent, { mappedOnly: true })
  if (anyChanges(mappedBaselineGate)) throw new Error(`187-mapped-recipe pre-apply gate failed: ${stableJson(mappedBaselineGate)}`)
  const beforeMapped = mappedCorpusSafety(beforeAll, parseRecipeContent)
  if (beforeMapped.mappedRecipes !== 187 || beforeMapped.storedHashMismatches.length !== 0) throw new Error(`Mapped-corpus pre-apply gate failed: ${stableJson(beforeMapped)}`)

  const plan = buildApplyPlan({ manifest, liveById: exactSeven(beforeAll), parseRecipeContent })
  console.log(stableJson({ phase: 'PRE_APPLY_GATE', readyToWrite: plan.readyToWrite.length, skipped: plan.skipped, errors: plan.errors, mappedBaselineGate }))
  if (plan.errors.length) throw new Error(`Unexpected pre-apply errors abort all writes: ${stableJson(plan.errors)}`)

  let applyResult
  let commitError = null
  try {
    applyResult = await commitContentPlan(db, plan)
  } catch (error) {
    commitError = error instanceof Error ? error.message : String(error)
    applyResult = { batchCount: plan.readyToWrite.length ? 1 : 0, attemptedWrites: plan.readyToWrite.length, committedWrites: 0, writtenRecipeIds: plan.readyToWrite.map(item => item.row.recipeId) }
  }

  const afterAll = await readAllRecipes(db)
  const afterSeven = exactSeven(afterAll)
  const readback = verifyReadback({ manifest, plan, liveById: afterSeven, parseRecipeContent })
  if (commitError && readback.exactContentMatches === plan.readyToWrite.length) applyResult.committedWrites = plan.readyToWrite.length
  const corpusChanges = verifyCorpusChanges({ beforeById: beforeAll, afterById: afterAll, writtenRecipeIds: applyResult.writtenRecipeIds })
  const mappedImpact = compareMappedCorpus(beforeAll, afterAll, parseRecipeContent)
  const afterMapped = mappedCorpusSafety(afterAll, parseRecipeContent)
  const postPlan = buildApplyPlan({ manifest, liveById: afterSeven, parseRecipeContent })
  const remainingExcludedPopulation = auditRemainingExcluded({ manifest, liveById: afterSeven, parseRecipeContent })
  const repairedRows = manifest.rows.filter(row => {
    const live = afterSeven.get(row.recipeId)
    return live?.data?.content === row.proposedContent && live.data.cookingStepIngredientMap == null
  }).length
  const criticalFailure = Boolean(commitError) || readback.unexpectedStates > 0 || readback.nonContentMismatches > 0 ||
    readback.mapFieldsPresent > 0 || corpusChanges.outsideAuthorizedMutations.length > 0 || corpusChanges.mappedRecipeMutations.length > 0 ||
    corpusChanges.persistedMapChanges.length > 0 || corpusChanges.nonContentMutations.length > 0 || mappedImpact.ingredientArrayChanges.length > 0 ||
    mappedImpact.instructionArrayChanges.length > 0 || mappedImpact.sourceHashChanges.length > 0 || afterMapped.mappedRecipes !== 187 ||
    afterMapped.storedHashMismatches.length > 0 || postPlan.readyToWrite.length > 0 || postPlan.errors.length > 0
  const executiveResult = criticalFailure ? 'FAIL' : plan.skipped.length > 0 && repairedRows < 7 ? 'PASS WITH SKIPS' : 'PASS'
  const report = {
    schemaVersion: 1,
    executionDate: '2026-08-26',
    executedAt: new Date().toISOString(),
    executiveResult,
    repository: {
      branch: execFileSync('git', ['branch', '--show-current'], { cwd: ROOT, encoding: 'utf8' }).trim(),
      startingSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    },
    manifest: { path: MANIFEST_PATH, sha256: sha256(manifestBytes), counts: manifest.counts },
    preApply: { readyToWrite: plan.readyToWrite.length, skipped: plan.skipped.length, skipRows: plan.skipped, errors: plan.errors, mappedBaselineGate },
    apply: { ...applyResult, commitError, writeField: 'content only' },
    readback,
    corpusSafety: {
      beforeMapped, afterMapped,
      mappedIngredientArrayChanges: mappedImpact.ingredientArrayChanges.length,
      mappedInstructionArrayChanges: mappedImpact.instructionArrayChanges.length,
      mappedSourceHashChanges: mappedImpact.sourceHashChanges.length,
      writesOutsideAuthorizedIds: corpusChanges.outsideAuthorizedMutations.length,
      writesToMappedRecipes: corpusChanges.mappedRecipeMutations.length,
      persistedMapChanges: corpusChanges.persistedMapChanges.length,
      nonContentFieldChanges: corpusChanges.nonContentMutations.length,
      details: corpusChanges, mappedImpact,
    },
    postApply: { readyToWrite: postPlan.readyToWrite.length, skipped: postPlan.skipped.length, skipRows: postPlan.skipped, errors: postPlan.errors },
    repairedRows,
    remainingExcludedPopulation,
    mapFieldsWritten: 0,
    aiCalls: 0,
    mappingGenerationCalls: 0,
  }
  writeNewFile(APPLY_PATH, stableJson(report))
  writeNewFile(APPLY_MD_PATH, applyMarkdown(report))
  console.log(stableJson(report))
  if (criticalFailure) throw new Error('Wave 3 apply/readback verification failed; see durable apply report')
  return report
}

async function main() {
  const mode = parseMode(process.argv.slice(2))
  const parser = await loadParser()
  try {
    loadEnv()
    const db = getAdmin().firestore()
    const result = mode === 'dry-run'
      ? await dryRun(db, parser.parseRecipeContent)
      : mode === 'plan'
        ? await planOnly(db, parser.parseRecipeContent)
        : await apply(db, parser.parseRecipeContent)
    console.log(stableJson(result))
  } finally { await parser.close() }
}

main().catch(error => { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1 })
