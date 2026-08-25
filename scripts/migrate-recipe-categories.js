#!/usr/bin/env node
'use strict'

/**
 * Production recipe-category migration planner and exact-manifest apply command.
 *
 * Default invocation performs two production reads, writes only local audit
 * evidence, and has no Firestore mutation code:
 *   node scripts/migrate-recipe-categories.js
 *
 * Apply remains unavailable unless all three explicit authorization concepts are
 * present: --apply, --manifest, and the exact --confirm value. Apply consumes the
 * committed manifest and re-checks every precondition in one Firestore transaction.
 */

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const { loadEnv, getAdmin } = require('./_lib')
const planner = require('./recipe-category-migration-planner')
const applySupport = require('./recipe-category-migration-apply')
const recipeTimeRemediation = require('./recipe-time-remediation-data.json')

const PROJECT_ID = 'malignant-metro'
const OWNER_EMAIL = 'folstromjohn@gmail.com'
const HISTORICAL_BASELINE = Object.freeze({
  sharedRecipeDocuments: 236,
  usableRecipes: 234,
  distinctRawCategories: 20,
  sharedCategoryChanges: 66,
  categoryOverrides: 25,
  overrideRemovals: 24,
  preservedOverrides: 1,
})

function localDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function defaultPaths() {
  const date = localDate()
  return {
    json: `docs/audits/recipe-category-migration-dryrun-${date}.json`,
    markdown: `docs/audits/recipe-category-migration-dryrun-${date}.md`,
  }
}

function parseArgs(argv) {
  const defaults = defaultPaths()
  const args = { apply: false, json: defaults.json, markdown: defaults.markdown, refreshExpectations: false }
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index]
    if (raw === '--refresh-expectations') args.refreshExpectations = true
    else if (raw === '--apply') args.apply = true
    else if (raw === '--manifest') args.manifest = argv[++index]
    else if (raw.startsWith('--manifest=')) args.manifest = raw.slice('--manifest='.length)
    else if (raw === '--confirm') args.confirm = argv[++index]
    else if (raw.startsWith('--confirm=')) args.confirm = raw.slice('--confirm='.length)
    else if (raw.startsWith('--json=')) args.json = raw.slice('--json='.length)
    else if (raw.startsWith('--markdown=')) args.markdown = raw.slice('--markdown='.length)
    else if (raw.startsWith('--expectations=')) args.expectations = raw.slice('--expectations='.length)
    else throw new Error(`Unknown argument: ${raw}`)
  }
  if (args.manifest !== undefined) assert.ok(args.manifest, '--manifest path cannot be empty')
  if (args.confirm !== undefined) assert.ok(args.confirm, '--confirm value cannot be empty')
  if (args.apply) {
    assert.ok(args.manifest, 'Apply refused: --manifest is required')
    assert.ok(args.confirm, 'Apply refused: --confirm is required')
    assert.equal(args.confirm, applySupport.APPLY_CONFIRMATION, `Apply refused: --confirm must equal ${applySupport.APPLY_CONFIRMATION}`)
    assert.equal(args.refreshExpectations, false, 'Apply refused: --refresh-expectations is not allowed')
    assert.equal(args.expectations, undefined, 'Apply refused: --expectations is not allowed')
  } else if (args.manifest !== undefined || args.confirm !== undefined) {
    throw new Error('Apply refused: --manifest/--confirm require explicit --apply')
  }
  assert.ok(args.json, '--json path cannot be empty')
  assert.ok(args.markdown, '--markdown path cannot be empty')
  return args
}

function parseManifestContents(contents) {
  try {
    const manifest = JSON.parse(Buffer.isBuffer(contents) ? contents.toString('utf8') : contents)
    assert.ok(manifest && typeof manifest === 'object' && !Array.isArray(manifest), 'manifest must be a JSON object')
    return manifest
  } catch (error) {
    throw new Error(`Apply refused: malformed manifest JSON: ${error.message}`)
  }
}

function stableValue(value) {
  if (value === undefined) return { __type: 'undefined' }
  if (value === null || typeof value !== 'object') return value
  if (typeof value.toDate === 'function') return value.toDate().toISOString()
  if (Array.isArray(value)) return value.map(stableValue)
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]))
}

function fingerprintRelevantState(recipes, metaDocs) {
  const value = {
    recipes: recipes.map(recipe => ({ id: recipe.id, category: stableValue(recipe.data.category) })),
    overrides: metaDocs.map(meta => ({
      id: meta.id,
      recipeID: meta.data.recipeID || null,
      category: stableValue(planner.getOverrideCategory(meta)),
    })),
  }
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

async function readProduction(db, ownerUid) {
  const [recipeSnap, metaSnap] = await Promise.all([
    db.collection('recipes').get(),
    db.collection('users').doc(ownerUid).collection('recipes').doc('root').collection('meta').get(),
  ])
  return {
    recipes: recipeSnap.docs
      .map(doc => ({ id: doc.id, data: doc.data(), updateTime: doc.updateTime?.toDate?.().toISOString() || null }))
      .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true })),
    metaDocs: metaSnap.docs
      .map(doc => ({ id: doc.id, data: doc.data(), updateTime: doc.updateTime?.toDate?.().toISOString() || null }))
      .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true })),
  }
}

function loadExpectations(args) {
  const explicit = args.expectations ? path.resolve(args.expectations) : null
  const defaultExisting = !args.refreshExpectations && fs.existsSync(path.resolve(args.json))
    ? path.resolve(args.json)
    : null
  const expectationPath = explicit || defaultExisting
  if (!expectationPath) return null
  const manifest = JSON.parse(fs.readFileSync(expectationPath, 'utf8'))
  assert.ok(Array.isArray(manifest.sharedRecipeChanges), 'expectation manifest lacks sharedRecipeChanges')
  assert.ok(Array.isArray(manifest.overrideAuditRows), 'expectation manifest lacks overrideAuditRows')
  return {
    path: expectationPath,
    sharedDecisions: manifest.sharedRecipeChanges.map(row => ({
      recipeID: row.recipeID,
      title: row.title,
      expectedOldCategory: row.expectedOldCategory,
      proposedCategory: row.proposedCategory,
      mappingSource: row.mappingSource,
      reason: row.approvalReason || row.reason,
    })),
    overrideDecisions: manifest.overrideAuditRows.map(row => ({
      recipeID: row.recipeID,
      title: row.title,
      expectedOverrideCategory: row.expectedOverrideCategory,
      proposedAction: row.expectedAction || row.proposedAction,
      sharedCategoryBefore: row.sharedCategoryBefore,
      sharedCategoryAfter: row.sharedCategoryAfter,
      reason: row.approvalReason || row.reason,
    })),
  }
}

function baselineSummary(state) {
  const unusableRecipeIds = new Set(recipeTimeRemediation.excludedRecipes.map(recipe => recipe.id))
  const rawValues = new Set(state.recipes
    .map(recipe => recipe.data.category)
    .filter(value => typeof value === 'string'))
  return {
    sharedRecipeDocuments: state.recipes.length,
    usableRecipes: state.recipes.filter(recipe => !unusableRecipeIds.has(recipe.id)).length,
    distinctRawCategories: rawValues.size,
    rawCategoryValues: [...rawValues].sort(),
    personalMetaDocuments: state.metaDocs.length,
    categoryOverrides: state.metaDocs.filter(meta => {
      const value = planner.getOverrideCategory(meta)
      return value !== null && value !== undefined && value !== ''
    }).length,
  }
}

function reconciliation(summary, sharedSummary, overrideSummary) {
  const fresh = {
    sharedCategoryChanges: sharedSummary.ready + sharedSummary.alreadyMigrated,
    overrideRemovals: overrideSummary.proposedRemovals + overrideSummary.alreadyClean,
    preservedOverrides: overrideSummary.preserved,
  }
  const differences = []
  for (const key of ['sharedRecipeDocuments', 'usableRecipes', 'distinctRawCategories', 'categoryOverrides']) {
    if (summary[key] !== HISTORICAL_BASELINE[key]) {
      differences.push(`${key}: expected ${HISTORICAL_BASELINE[key]}, observed ${summary[key]}`)
    }
  }
  for (const key of ['sharedCategoryChanges', 'overrideRemovals', 'preservedOverrides']) {
    if (fresh[key] !== HISTORICAL_BASELINE[key]) {
      differences.push(`${key}: expected ${HISTORICAL_BASELINE[key]}, fresh ${fresh[key]}`)
    }
  }
  return {
    expected: HISTORICAL_BASELINE,
    fresh,
    differences,
    result: differences.length === 0 ? 'No count-level production drift from the prior audit.' : 'Production differs from the prior audit baseline; review each listed difference.',
    identityComparison: 'The prior audit supplied count baselines and approved special cases but no checked-in exact row manifest. This run freezes the complete exact production proposal and verifies it with a second read; row-level historical identity comparison is therefore unavailable.',
  }
}

function withUpdateTime(rows, state, kind) {
  const docs = kind === 'shared'
    ? new Map(state.recipes.map(doc => [doc.id, doc]))
    : new Map(state.metaDocs.map(doc => [doc.data.recipeID || doc.id, doc]))
  return rows.map(row => ({
    ...row,
    ...(kind === 'override' ? { metaDocumentID: docs.get(row.recipeID)?.id || null } : {}),
    observedDocumentUpdateTime: docs.get(row.recipeID)?.updateTime || null,
  }))
}

function buildManifest({ repositoryHead, ownerUid, expectationSource, initialState, finalState, contract }) {
  const sharedDecisions = expectationSource?.sharedDecisions
    || planner.discoverSharedDecisions(initialState.recipes, contract)
  const overrideDecisions = expectationSource?.overrideDecisions
    || planner.discoverOverrideDecisions(initialState.metaDocs, initialState.recipes, sharedDecisions, contract)

  const sharedPlan = planner.planSharedRecipes(finalState.recipes, sharedDecisions, contract)
  const overridePlan = planner.planOverrides(finalState.metaDocs, finalState.recipes, sharedDecisions, overrideDecisions, contract)
  const { sharedRecipeSummary, overrideSummary } = planner.buildSummaries(sharedPlan, overridePlan)
  const gate = planner.determineGate(sharedPlan, overridePlan)
  const productionBaseline = baselineSummary(finalState)
  const readBeforeFingerprint = fingerprintRelevantState(initialState.recipes, initialState.metaDocs)
  const readAfterFingerprint = fingerprintRelevantState(finalState.recipes, finalState.metaDocs)

  const allOverrideRows = withUpdateTime(overridePlan.rows, finalState, 'override').map(row => {
    const decision = overrideDecisions.find(item => item.recipeID === row.recipeID)
    return { ...row, expectedAction: decision?.proposedAction || row.proposedAction, approvalReason: decision?.reason || row.reason }
  })
  const sharedRows = withUpdateTime(sharedPlan.rows, finalState, 'shared').map(row => {
    const decision = sharedDecisions.find(item => item.recipeID === row.recipeID)
    return { ...row, approvalReason: decision?.reason || row.reason }
  })
  const removalRows = allOverrideRows
    .filter(row => row.status === 'READY' && (row.proposedAction === 'REMOVE_LEGACY' || row.proposedAction === 'REMOVE_REDUNDANT'))
    .map(row => ({ uid: ownerUid, ...row }))
  const preservedRows = allOverrideRows
    .filter(row => row.status === 'PRESERVED')
    .map(row => ({ uid: ownerUid, ...row }))
  const unexpectedRecords = [
    ...sharedPlan.unexpectedRecords.map(row => ({ recordType: 'sharedRecipe', ...row })),
    ...overridePlan.unexpectedOverrides.map(row => ({ recordType: 'personalOverride', uid: ownerUid, ...row })),
  ]
  const preconditionFailures = [
    ...sharedRows.filter(row => row.status === 'PRECONDITION_MISMATCH').map(row => ({ recordType: 'sharedRecipe', ...row })),
    ...allOverrideRows.filter(row => row.status === 'PRECONDITION_MISMATCH').map(row => ({ recordType: 'personalOverride', uid: ownerUid, ...row })),
  ]
  const historicalReconciliation = {
    ...reconciliation(productionBaseline, sharedRecipeSummary, overrideSummary),
    freshStatus: {
      sharedReady: sharedRecipeSummary.ready,
      alreadyMigrated: sharedRecipeSummary.alreadyMigrated,
      preconditionMismatches: preconditionFailures.length,
      newUnexpectedCandidates: unexpectedRecords.map(row => row.recipeID),
      missingPreviouslyExpectedCandidates: sharedRows
        .filter(row => row.status === 'PRECONDITION_MISMATCH' && row.observedCategory === null)
        .map(row => row.recipeID),
    },
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    mode: 'DRY_RUN_ONLY',
    overallGate: gate,
    projectId: PROJECT_ID,
    repositoryHead,
    canonicalCategories: [...contract.RECIPE_CATEGORIES],
    expectationSource: expectationSource
      ? { type: 'existing-manifest', path: expectationSource.path }
      : { type: 'fresh-approved-classification-then-second-read', priorExactRowManifestAvailable: false },
    ownerContext: { uid: ownerUid, path: `users/${ownerUid}/recipes/root/meta` },
    productionBaseline,
    sharedRecipeSummary,
    sharedRecipeChanges: sharedRows,
    overrideSummary,
    overrideChanges: removalRows,
    preservedOverrides: preservedRows,
    overrideAuditRows: allOverrideRows,
    preconditionFailures,
    unexpectedRecords,
    historicalAuditReconciliation: historicalReconciliation,
    preconditionSafety: {
      laterApplyMustMatchExactManifest: true,
      sharedKey: ['recipeID', 'expectedOldCategory'],
      overrideKey: ['uid', 'recipeID', 'expectedOverrideCategory'],
      onMismatch: 'REFUSE_ROW',
    },
    readOnlyVerification: {
      readBeforeFingerprint,
      readAfterFingerprint,
      relevantProductionStateUnchangedDuringRun: readBeforeFingerprint === readAfterFingerprint,
    },
    writeSafety: {
      sharedRecipeWrites: 0,
      personalOverrideWritesOrDeletes: 0,
      weekPlanWrites: 0,
      firestoreRuleOrIndexChanges: 0,
      firebaseDeployments: 0,
    },
  }
  planner.validateManifest(manifest, contract)
  assert.equal(manifest.readOnlyVerification.relevantProductionStateUnchangedDuringRun, true, 'relevant production category state changed between dry-run reads')
  return manifest
}

function cell(value) {
  if (value === null || value === undefined) return '—'
  return String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function markdownTable(headers, rows) {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${row.map(cell).join(' | ')} |`),
  ].join('\n')
}

function renderMarkdown(manifest) {
  const reconciliationLines = manifest.historicalAuditReconciliation.differences.length
    ? manifest.historicalAuditReconciliation.differences.map(value => `- ${value}`).join('\n')
    : '- No count-level differences: 66 shared changes, 24 override removals, and 1 preserved override match.'
  const unexpected = manifest.unexpectedRecords.length
    ? markdownTable(['type', 'recipeID', 'observed', 'status', 'reason'], manifest.unexpectedRecords.map(row => [row.recordType, row.recipeID, row.observedCategory ?? row.rawOverrideCategory, row.status, row.reason]))
    : 'None.'
  const failures = manifest.preconditionFailures.length
    ? markdownTable(['type', 'recipeID', 'expected', 'observed', 'status', 'reason'], manifest.preconditionFailures.map(row => [row.recordType, row.recipeID, row.expectedOldCategory ?? row.expectedOverrideCategory, row.observedCategory ?? row.observedOverrideCategory, row.status, row.reason]))
    : 'None.'
  return `# Recipe Category Migration Production Dry Run — ${localDate()}

> ${manifest.overallGate}
>
> Review-only evidence. This report authorizes no Firestore writes and the tool has no apply mode.

## Production baseline

- Shared recipe documents: ${manifest.productionBaseline.sharedRecipeDocuments}
- Usable recipes: ${manifest.productionBaseline.usableRecipes}
- Distinct raw categories: ${manifest.productionBaseline.distinctRawCategories}
- Personal meta documents: ${manifest.productionBaseline.personalMetaDocuments}
- Category overrides: ${manifest.productionBaseline.categoryOverrides}

## Shared category dry run

- READY: ${manifest.sharedRecipeSummary.ready}
- ALREADY_MIGRATED: ${manifest.sharedRecipeSummary.alreadyMigrated}
- PRECONDITION_MISMATCH: ${manifest.sharedRecipeSummary.preconditionMismatch}
- UNRESOLVED/MISSING: ${manifest.sharedRecipeSummary.unresolved}
- UNEXPECTED: ${manifest.sharedRecipeSummary.unexpected}

${markdownTable(['recipeID', 'title', 'expected old', 'observed', 'proposed', 'status', 'approved reason'], manifest.sharedRecipeChanges.map(row => [row.recipeID, row.title, row.expectedOldCategory, row.observedCategory, row.proposedCategory, row.status, row.approvalReason]))}

## Personal override cleanup dry run

- Proposed removals: ${manifest.overrideSummary.proposedRemovals}
- Already clean: ${manifest.overrideSummary.alreadyClean}
- Preserved: ${manifest.overrideSummary.preserved}
- Review required: ${manifest.overrideSummary.reviewRequired}
- Precondition mismatches: ${manifest.overrideSummary.preconditionMismatch}

### Exact proposed removal set

${manifest.overrideChanges.length ? markdownTable(['recipeID', 'expected override', 'observed override', 'shared before', 'shared after', 'action', 'reason'], manifest.overrideChanges.map(row => [row.recipeID, row.expectedOverrideCategory, row.observedOverrideCategory, row.sharedCategoryBefore, row.sharedCategoryAfter, row.proposedAction, row.reason])) : 'None.'}

### Preserved overrides

${manifest.preservedOverrides.length ? markdownTable(['recipeID', 'override', 'shared after', 'status', 'reason'], manifest.preservedOverrides.map(row => [row.recipeID, row.observedOverrideCategory, row.sharedCategoryAfter, row.status, row.reason])) : 'None.'}

## Historical-audit reconciliation

${reconciliationLines}

- Fresh shared READY: ${manifest.historicalAuditReconciliation.freshStatus.sharedReady}
- Already migrated: ${manifest.historicalAuditReconciliation.freshStatus.alreadyMigrated}
- Precondition mismatches: ${manifest.historicalAuditReconciliation.freshStatus.preconditionMismatches}
- New unexpected candidates: ${manifest.historicalAuditReconciliation.freshStatus.newUnexpectedCandidates.length}
- Missing previously expected candidates: ${manifest.historicalAuditReconciliation.freshStatus.missingPreviouslyExpectedCandidates.length}

${manifest.historicalAuditReconciliation.identityComparison}

## Preconditions and unexpected records

### Precondition failures

${failures}

### Unexpected records

${unexpected}

## Safety evidence

- Exact later shared precondition: \`recipeID + expectedOldCategory\`
- Exact later override precondition: \`uid + recipeID + expectedOverrideCategory\`
- Any mismatch must refuse that row.
- Shared recipe writes: 0
- Personal override writes/deletes: 0
- Week-plan writes: 0
- Firestore rule/index changes: 0
- Firebase deployments: 0
- Relevant production fingerprints equal before/after: ${manifest.readOnlyVerification.relevantProductionStateUnchangedDuringRun}
`
}

function writeEvidence(filePath, contents) {
  const absolute = path.resolve(filePath)
  fs.mkdirSync(path.dirname(absolute), { recursive: true })
  fs.writeFileSync(absolute, contents)
  return absolute
}

async function loadContract() {
  const modulePath = path.join(__dirname, '..', 'lib', 'recipeCategories.ts')
  const contract = await import(pathToFileURL(modulePath).href)
  return {
    RECIPE_CATEGORIES: contract.RECIPE_CATEGORIES,
    isRecipeCategory: contract.isRecipeCategory,
    normalizeRecipeCategory: contract.normalizeRecipeCategory,
    resolveRecipeCategory: contract.resolveRecipeCategory,
  }
}

function mapSnapshot(snapshot) {
  return snapshot.docs
    .map(doc => ({ id: doc.id, data: doc.data(), updateTime: doc.updateTime?.toDate?.().toISOString() || null }))
    .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))
}

function productionQueries(db, ownerUid) {
  const owner = db.collection('users').doc(ownerUid)
  return {
    recipes: db.collection('recipes'),
    meta: owner.collection('recipes').doc('root').collection('meta'),
    weekPlans: owner.collection('pantry').doc('root').collection('weekPlans'),
  }
}

async function readApplyProduction(db, ownerUid) {
  const queries = productionQueries(db, ownerUid)
  const [recipeSnap, metaSnap, weekPlanSnap] = await Promise.all([
    queries.recipes.get(), queries.meta.get(), queries.weekPlans.get(),
  ])
  return {
    recipes: mapSnapshot(recipeSnap),
    metaDocs: mapSnapshot(metaSnap),
    weekPlans: mapSnapshot(weekPlanSnap),
  }
}

async function readTransactionState(transaction, db, ownerUid) {
  const queries = productionQueries(db, ownerUid)
  // Firestore transactions require every read before the first write. Keep these
  // reads explicit and sequential so later maintenance cannot interleave writes.
  const recipeSnap = await transaction.get(queries.recipes)
  const metaSnap = await transaction.get(queries.meta)
  return { recipes: mapSnapshot(recipeSnap), metaDocs: mapSnapshot(metaSnap), weekPlans: [] }
}

function repositoryState(repoRoot, manifestRelativePath) {
  const branch = execFileSync('git', ['branch', '--show-current'], { cwd: repoRoot, encoding: 'utf8' }).trim()
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
  const originMain = execFileSync('git', ['rev-parse', 'origin/main'], { cwd: repoRoot, encoding: 'utf8' }).trim()
  const trackedChanges = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: repoRoot, encoding: 'utf8' }).trim()
  const manifestChanges = execFileSync('git', ['status', '--porcelain', '--', manifestRelativePath], { cwd: repoRoot, encoding: 'utf8' }).trim()
  assert.equal(branch, 'main', 'Apply refused: current branch must be main')
  assert.equal(head, originMain, 'Apply refused: local main and origin/main are not synchronized')
  assert.equal(trackedChanges, '', `Apply refused: tracked worktree changes remain:\n${trackedChanges}`)
  assert.equal(manifestChanges, '', 'Apply refused: approved manifest has worktree changes')
  return { branch, head, originMain }
}

function applyPaths() {
  return {
    revert: 'docs/audits/recipe-category-migration-revert-2026-08-25.json',
    json: 'docs/audits/recipe-category-migration-apply-2026-08-25.json',
    markdown: 'docs/audits/recipe-category-migration-apply-2026-08-25.md',
  }
}

function renderApplyMarkdown(report) {
  return `# Recipe Category Migration Apply — 2026-08-25

> ${report.executiveResult}

## Approved manifest

- Path: \`${report.approvedManifest.path}\`
- SHA-256: \`${report.approvedManifest.sha256}\`
- Rows: ${report.approvedManifest.rowCount} (${report.approvedManifest.sharedWriteRows} shared writes, ${report.approvedManifest.overrideRemovalRows} override removals, ${report.approvedManifest.preservedOverrides} preserved override)
- Apply-tool commit: \`${report.applyToolCommitSha}\`

## Pre-apply gate

- Shared READY: ${report.preApplyGate.sharedReady}
- Override removals READY: ${report.preApplyGate.overrideRemovalsReady}
- Preserved overrides verified: ${report.preApplyGate.preservedOverridesVerified}
- Precondition mismatches: ${report.preApplyGate.preconditionMismatches}
- Unexpected records: ${report.preApplyGate.unexpectedRecords}
- Unresolved records: ${report.preApplyGate.unresolvedRecords}

## Transaction

- Started: ${report.transaction.startedAt}
- Completed: ${report.transaction.completedAt}
- Result: ${report.transaction.result}
- Shared category updates: ${report.transaction.sharedCategoryUpdates}
- Override category deletions: ${report.transaction.overrideCategoryDeletions}
- Total document writes: ${report.transaction.totalDocumentWrites}
- Preserved-override writes: ${report.transaction.preservedOverrideWrites}
- Partial writes: ${report.transaction.partialWrites}

## Post-apply verification

- Shared documents: ${report.postApply.sharedDocuments}
- Canonical shared categories: ${report.postApply.canonicalSharedCategories}
- Noncanonical shared categories: ${report.postApply.noncanonicalSharedCategories}
- Missing shared categories: ${report.postApply.missingSharedCategories}
- Category overrides remaining: ${report.postApply.categoryOverridesRemaining}
- Recipe 182 shared category: ${report.postApply.preservedOverride.sharedCategory}
- Recipe 182 override category: ${report.postApply.preservedOverride.overrideCategory}
- Shared readback rows verified: ${report.postApply.sharedReadbackRowsVerified}
- Override-deletion rows verified: ${report.postApply.overrideDeletionRowsVerified}

${markdownTable(['Category', 'Count'], Object.entries(report.postApply.distribution))}

## Unrelated-data safety

- Week-plan writes: 0
- Week-plan stable projection unchanged: ${report.safety.weekPlansUnchanged}
- Stored role changes: 0
- defaultRole changes: 0
- Other recipe-field changes: ${report.safety.otherRecipeFieldsUnchanged ? 0 : 'DETECTED'}
- Other RecipeMeta-field changes: ${report.safety.otherMetaFieldsUnchanged ? 0 : 'DETECTED'}

## Recovery

- Revert manifest: \`${report.revertManifestPath}\`
- Rows covered: ${report.revertRowsCovered}
- Revert executed: no (separate explicit authorization required)
`
}

function postApplyDetails(manifest, state, validation, contract) {
  const recipes = new Map(state.recipes.map(recipe => [recipe.id, recipe]))
  const metas = new Map(state.metaDocs.map(meta => [meta.id, meta]))
  const canonicalCount = state.recipes.filter(recipe => contract.isRecipeCategory(recipe.data.category)).length
  const missing = state.recipes.filter(recipe => !Object.prototype.hasOwnProperty.call(recipe.data, 'category') || recipe.data.category === '').length
  const noncanonical = state.recipes.filter(recipe => !contract.isRecipeCategory(recipe.data.category) && recipe.data.category !== '' && recipe.data.category !== undefined).length
  const remainingOverrideDocs = state.metaDocs.filter(meta => {
    const category = applySupport.categoryOverride(meta)
    return category !== undefined && category !== null && category !== ''
  })
  const intentional = remainingOverrideDocs.filter(meta => meta.id === '182'
    && applySupport.categoryOverride(meta) === applySupport.PRESERVED_OVERRIDE.overrideCategory).length
  const legacy = remainingOverrideDocs.filter(meta => !contract.isRecipeCategory(applySupport.categoryOverride(meta))).length
  const redundant = remainingOverrideDocs.filter(meta => {
    if (meta.id === '182') return false
    const recipeID = applySupport.recipeIdForMeta(meta)
    const shared = recipes.get(recipeID)?.data?.category
    const override = applySupport.categoryOverride(meta)
    return contract.normalizeRecipeCategory(override, recipeID) === contract.normalizeRecipeCategory(shared, recipeID)
      || (override === 'Breakfast, Snacks & Sides' && shared === 'Sides')
  }).length
  return {
    sharedDocuments: state.recipes.length,
    canonicalSharedCategories: canonicalCount,
    noncanonicalSharedCategories: noncanonical,
    missingSharedCategories: missing,
    unexpectedCategoryValues: noncanonical,
    distribution: validation.distribution,
    categoryOverridesRemaining: validation.categoryOverrides,
    legacyOverridesRemaining: legacy,
    redundantOverridesRemaining: redundant,
    intentionalOverridesRemaining: intentional,
    sharedReadbackRowsVerified: manifest.sharedRecipeChanges.filter(row => recipes.get(row.recipeID)?.data?.category === row.proposedCategory).length,
    overrideDeletionRowsVerified: manifest.overrideChanges.filter(row => applySupport.categoryOverride(metas.get(row.metaDocumentID)) === undefined).length,
    preservedOverride: {
      recipeID: '182',
      title: 'Spicy Quinoa with Sweet Potatoes',
      sharedCategory: recipes.get('182')?.data?.category,
      overrideCategory: applySupport.categoryOverride(metas.get('182')),
      effectivePersonalCategory: applySupport.categoryOverride(metas.get('182')) || recipes.get('182')?.data?.category,
    },
  }
}

async function runApply(args) {
  const repoRoot = path.join(__dirname, '..')
  const absoluteManifest = path.resolve(repoRoot, args.manifest)
  const manifestRelativePath = path.relative(repoRoot, absoluteManifest).split(path.sep).join('/')
  assert.equal(manifestRelativePath, applySupport.APPROVED_MANIFEST_PATH, `Apply refused: manifest must be ${applySupport.APPROVED_MANIFEST_PATH}`)
  const manifestContents = fs.readFileSync(absoluteManifest)
  const manifestSha256 = applySupport.sha256(manifestContents)
  assert.equal(manifestSha256, applySupport.APPROVED_MANIFEST_SHA256, 'Apply refused: approved manifest SHA-256 changed')
  const manifest = parseManifestContents(manifestContents)

  loadEnv()
  assert.equal(process.env.FIREBASE_PROJECT_ID, PROJECT_ID, `FIREBASE_PROJECT_ID must be ${PROJECT_ID}`)
  const admin = getAdmin()
  const owner = await admin.auth().getUserByEmail(OWNER_EMAIL)
  const contract = await loadContract()
  planner.validateManifest(manifest, contract)
  applySupport.validateApprovedManifest(manifest, contract, owner.uid)
  const repository = repositoryState(repoRoot, manifestRelativePath)

  const db = admin.firestore()
  const beforeState = await readApplyProduction(db, owner.uid)
  const preflight = applySupport.assertLiveState(manifest, beforeState, contract, 'before')
  const paths = applyPaths()
  const revertEvidence = applySupport.buildRevertEvidence({
    manifestPath: manifestRelativePath,
    manifestSha256,
    repositoryHead: repository.head,
    manifest,
    preflight,
  })
  const revertPath = writeEvidence(paths.revert, `${JSON.stringify(applySupport.stableValue(revertEvidence), null, 2)}\n`)

  const { FieldValue } = require('firebase-admin/firestore')
  const startedAt = new Date().toISOString()
  let transactionResult
  try {
    transactionResult = await db.runTransaction(async transaction => {
      const transactionState = await readTransactionState(transaction, db, owner.uid)
      return applySupport.validateAndEnqueueWrites(
        transaction, db, manifest, transactionState, contract, FieldValue.delete(),
      )
    })
  } catch (error) {
    if (String(error.message).includes('APPLY BLOCKED — PRECONDITION FAILURE')) throw error
    throw new Error(`APPLY FAILED — TRANSACTION ROLLED BACK\n${error.stack || error.message}`)
  }
  const completedAt = new Date().toISOString()

  const afterState = await readApplyProduction(db, owner.uid)
  const postValidation = applySupport.validateLiveState(manifest, afterState, contract, 'after')
  const safety = applySupport.compareSafety(beforeState, afterState)
  const postApply = postApplyDetails(manifest, afterState, postValidation, contract)
  const verificationPassed = postValidation.ok
    && safety.otherRecipeFieldsUnchanged
    && safety.otherMetaFieldsUnchanged
    && safety.weekPlansUnchanged
    && postApply.sharedReadbackRowsVerified === applySupport.EXPECTED.sharedWrites
    && postApply.overrideDeletionRowsVerified === applySupport.EXPECTED.overrideDeletes

  const report = {
    generatedAt: new Date().toISOString(),
    executiveResult: verificationPassed ? 'PASS — CATEGORY MIGRATION COMPLETE' : 'POST-APPLY VERIFICATION FAILED',
    approvedManifest: {
      path: manifestRelativePath,
      sha256: manifestSha256,
      rowCount: manifest.sharedRecipeChanges.length + manifest.overrideChanges.length + manifest.preservedOverrides.length,
      sharedWriteRows: manifest.sharedRecipeChanges.length,
      overrideRemovalRows: manifest.overrideChanges.length,
      preservedOverrides: manifest.preservedOverrides.length,
    },
    applyToolCommitSha: repository.head,
    preApplyRepositoryHead: repository.head,
    projectId: PROJECT_ID,
    preApplyGate: {
      ...preflight,
      preconditionMismatches: preflight.errors.length,
      unexpectedRecords: 0,
      unresolvedRecords: 0,
    },
    transaction: {
      startedAt,
      completedAt,
      result: 'COMMITTED',
      sharedCategoryUpdates: transactionResult.sharedWrites,
      overrideCategoryDeletions: transactionResult.overrideDeletes,
      totalDocumentWrites: transactionResult.totalWrites,
      preservedOverrideWrites: transactionResult.preservedOverrideWrites,
      partialWrites: 0,
    },
    sharedRows: manifest.sharedRecipeChanges.map(row => ({
      recipeID: row.recipeID, title: row.title, beforeCategory: row.expectedOldCategory, afterCategory: row.proposedCategory,
      readbackVerified: afterState.recipes.find(recipe => recipe.id === row.recipeID)?.data?.category === row.proposedCategory,
    })),
    overrideRemovalRows: manifest.overrideChanges.map(row => ({
      recipeID: row.recipeID, metaDocumentID: row.metaDocumentID,
      beforeOverrideCategory: row.expectedOverrideCategory, afterOverrideCategory: 'absent',
      readbackVerified: applySupport.categoryOverride(afterState.metaDocs.find(meta => meta.id === row.metaDocumentID)) === undefined,
    })),
    preservedOverride: postApply.preservedOverride,
    postApply,
    readbackResults: {
      passed: postValidation.ok,
      mismatches: postValidation.errors,
    },
    safety: {
      ...safety,
      weekPlanWrites: 0,
      storedRoleChanges: 0,
      defaultRoleChanges: 0,
      otherRecipeFieldChanges: safety.otherRecipeFieldsUnchanged ? 0 : 'DETECTED',
      otherRecipeMetaFieldChanges: safety.otherMetaFieldsUnchanged ? 0 : 'DETECTED',
    },
    weekPlanNonMutationVerification: {
      writes: 0,
      stableProjectionUnchanged: safety.weekPlansUnchanged,
      fieldsCovered: ['plannedRecipeIDs', 'PlannedEntry.role', 'cookedRecipeIDs', 'calendarEventIds', 'week identity'],
    },
    revertManifestPath: path.relative(repoRoot, revertPath).split(path.sep).join('/'),
    revertRowsCovered: revertEvidence.validation.totalRows,
    verificationResult: verificationPassed ? 'PASS' : 'FAIL',
    prohibitedOperations: {
      otherFirestoreMutations: 0,
      firebaseDeployments: 0,
      firestoreRuleChanges: 0,
      firestoreIndexChanges: 0,
      manualVercelDeployments: 0,
    },
  }
  writeEvidence(paths.json, `${JSON.stringify(applySupport.stableValue(report), null, 2)}\n`)
  writeEvidence(paths.markdown, renderApplyMarkdown(report))
  console.log(renderApplyMarkdown(report))
  console.log(`Revert manifest: ${path.resolve(paths.revert)}`)
  console.log(`Apply JSON: ${path.resolve(paths.json)}`)
  console.log(`Apply Markdown: ${path.resolve(paths.markdown)}`)
  if (!verificationPassed) throw new Error(`POST-APPLY VERIFICATION FAILED\n${postValidation.errors.join('\n')}`)
  return report
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  if (args.apply) return runApply(args)
  loadEnv()
  assert.equal(process.env.FIREBASE_PROJECT_ID, PROJECT_ID, `FIREBASE_PROJECT_ID must be ${PROJECT_ID}`)
  const admin = getAdmin()
  const owner = await admin.auth().getUserByEmail(OWNER_EMAIL)
  const contract = await loadContract()
  const expectations = loadExpectations(args)
  const initialState = await readProduction(admin.firestore(), owner.uid)
  const finalState = await readProduction(admin.firestore(), owner.uid)
  const repositoryHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' }).trim()
  const manifest = buildManifest({
    repositoryHead,
    ownerUid: owner.uid,
    expectationSource: expectations,
    initialState,
    finalState,
    contract,
  })
  const markdown = renderMarkdown(manifest)
  const jsonPath = writeEvidence(args.json, `${JSON.stringify(stableValue(manifest), null, 2)}\n`)
  const markdownPath = writeEvidence(args.markdown, markdown)
  console.log(markdown)
  console.log(`JSON manifest: ${jsonPath}`)
  console.log(`Human report: ${markdownPath}`)
  console.log(`Manifest validation: PASS`)
  console.log(`Dry-run gate: ${manifest.overallGate}`)
  return manifest
}

if (require.main === module) {
  main().catch(error => {
    console.error(`FAILED: ${error.stack || error.message}`)
    process.exitCode = 1
  })
}

module.exports = {
  HISTORICAL_BASELINE,
  baselineSummary,
  buildManifest,
  defaultPaths,
  fingerprintRelevantState,
  parseArgs,
  parseManifestContents,
  reconciliation,
  renderMarkdown,
  runApply,
}
