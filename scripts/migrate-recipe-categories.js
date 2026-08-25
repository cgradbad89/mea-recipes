#!/usr/bin/env node
'use strict'

/**
 * Read-only production recipe-category migration planner.
 *
 * Default invocation performs two production reads, writes only local audit
 * evidence, and has no Firestore mutation code:
 *   node scripts/migrate-recipe-categories.js
 *
 * This tool intentionally has no apply mode. A later, separately approved tool
 * must consume the exact manifest and re-check every old-value precondition.
 */

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const { loadEnv, getAdmin } = require('./_lib')
const planner = require('./recipe-category-migration-planner')
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
  const args = { json: defaults.json, markdown: defaults.markdown, refreshExpectations: false }
  for (const raw of argv) {
    if (raw === '--refresh-expectations') args.refreshExpectations = true
    else if (raw.startsWith('--json=')) args.json = raw.slice('--json='.length)
    else if (raw.startsWith('--markdown=')) args.markdown = raw.slice('--markdown='.length)
    else if (raw.startsWith('--expectations=')) args.expectations = raw.slice('--expectations='.length)
    else if (raw === '--apply' || raw.startsWith('--apply=')) {
      throw new Error('Apply mode is intentionally not implemented. This prompt and tool are dry-run only.')
    } else throw new Error(`Unknown argument: ${raw}`)
  }
  assert.ok(args.json, '--json path cannot be empty')
  assert.ok(args.markdown, '--markdown path cannot be empty')
  return args
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
    normalizeRecipeCategory: contract.normalizeRecipeCategory,
    resolveRecipeCategory: contract.resolveRecipeCategory,
  }
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
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
  reconciliation,
  renderMarkdown,
}
