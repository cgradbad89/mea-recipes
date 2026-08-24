#!/usr/bin/env node
/**
 * Conservative recipe-time audit/remediation for the shared production catalog.
 *
 * Dry-run is the default and performs no writes:
 *   node update-recipe-times.js --report=docs/audits/recipe-time-dry-run-2026-08-24.json
 *
 * Apply requires explicit project/count confirmations and a previously generated
 * dry-run report whose catalog/update fingerprint still matches production.
 * The only possible writes are recipes/{id}.prepTime and .cookTime.
 */

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const assert = require('assert/strict')
const { loadEnv, getAdmin } = require('./scripts/_lib')
const remediation = require('./scripts/recipe-time-remediation-data.json')

const PROJECT_ID = 'malignant-metro'
const COLLECTION = 'recipes'
const ALLOWED_FIELDS = new Set(['prepTime', 'cookTime'])

function isEmpty(value) {
  return value === undefined || value === null || String(value).trim() === ''
}

// Keep byte-for-byte behavior aligned with lib/recipes.ts parseTimeToMinutes.
function parseTimeToMinutes(input) {
  if (!input) return 0
  const s = String(input).toLowerCase().trim()
  if (!s) return 0

  const iso = s.match(/^pt(?:(\d+)h)?(?:(\d+)m)?$/i)
  if (iso) {
    const h = parseInt(iso[1] || '0', 10)
    const m = parseInt(iso[2] || '0', 10)
    return h * 60 + m
  }

  let total = 0
  const hourMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/)
  if (hourMatch) total += parseFloat(hourMatch[1]) * 60
  const minMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)\b/)
  if (minMatch) total += parseFloat(minMatch[1])
  if (total === 0) {
    const bare = s.match(/^(\d+(?:\.\d+)?)$/)
    if (bare) total = parseFloat(bare[1])
  }
  const rounded = Math.round(total)
  return Number.isFinite(rounded) ? rounded : 0
}

function formatMinutes(mins) {
  if (!mins || mins <= 0) return ''
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`
}

function getTotalTime(prepTime, cookTime) {
  const minutes = parseTimeToMinutes(prepTime) + parseTimeToMinutes(cookTime)
  return { minutes, display: formatMinutes(minutes) }
}

function stableValue(value) {
  if (value === undefined) return { __type: 'undefined' }
  if (value === null || typeof value !== 'object') return value
  if (typeof value.toMillis === 'function') return { __type: 'timestamp', millis: value.toMillis() }
  if (Buffer.isBuffer(value)) return { __type: 'buffer', base64: value.toString('base64') }
  if (Array.isArray(value)) return value.map(stableValue)
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]))
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')
}

function textSha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function withoutTimeFields(data) {
  return Object.fromEntries(Object.entries(data).filter(([key]) => !ALLOWED_FIELDS.has(key)))
}

function normalizeExpected(value) {
  return isEmpty(value) ? null : String(value)
}

function assertExpectedCurrent(id, field, actual, expected) {
  assert.equal(
    normalizeExpected(actual),
    normalizeExpected(expected),
    `${id}.${field} changed since review`,
  )
}

function validateManifest(data = remediation) {
  assert.equal(data.projectId, PROJECT_ID, 'manifest projectId must be malignant-metro')
  assert.ok(Array.isArray(data.excludedRecipes), 'excludedRecipes must be an array')
  assert.ok(Array.isArray(data.updates), 'updates must be an array')
  const updateIds = new Set()
  for (const entry of data.updates) {
    assert.deepEqual(Object.keys(entry).sort(), ['after', 'before', 'evidence', 'id', 'kind'].sort(), `${entry.id}: unexpected keys`)
    assert.ok(entry.id && typeof entry.id === 'string', 'every update requires a string id')
    assert.ok(!updateIds.has(entry.id), `duplicate update id: ${entry.id}`)
    updateIds.add(entry.id)
    assert.ok(entry.kind === 'backfill' || entry.kind === 'correction', `${entry.id}: invalid kind`)
    assert.ok(typeof entry.evidence === 'string' && entry.evidence.trim(), `${entry.id}: evidence required`)
    assert.deepEqual(Object.keys(entry.before).sort(), ['cookTime', 'prepTime'], `${entry.id}: before fields invalid`)
    assert.deepEqual(Object.keys(entry.after).sort(), ['cookTime', 'prepTime'], `${entry.id}: after fields invalid`)
    for (const field of ALLOWED_FIELDS) {
      const value = entry.after[field]
      assert.ok(typeof value === 'string' && value.trim(), `${entry.id}.${field}: non-empty string required`)
      assert.ok(value.trim().toLowerCase() === '0 min' || parseTimeToMinutes(value) > 0, `${entry.id}.${field}: unparseable value`)
    }
    assert.ok(getTotalTime(entry.after.prepTime, entry.after.cookTime).minutes > 0, `${entry.id}: total must be positive`)
  }

  const excludedIds = new Set()
  for (const entry of data.excludedRecipes) {
    assert.deepEqual(Object.keys(entry).sort(), ['contentSha256', 'id', 'reason'], `${entry.id}: invalid exclusion keys`)
    assert.ok(entry.id && entry.reason && /^[a-f0-9]{64}$/.test(entry.contentSha256), `${entry.id}: invalid exclusion`)
    assert.ok(!excludedIds.has(entry.id), `duplicate excluded id: ${entry.id}`)
    assert.ok(!updateIds.has(entry.id), `${entry.id}: cannot be updated and excluded`)
    excludedIds.add(entry.id)
  }
  return { updateIds, excludedIds }
}

function buildAudit(catalogDocs, data = remediation) {
  const { updateIds, excludedIds } = validateManifest(data)
  const byId = new Map(catalogDocs.map(doc => [doc.id, doc]))
  assert.equal(byId.size, catalogDocs.length, 'catalog contains duplicate ids')

  const excluded = data.excludedRecipes.map(entry => {
    const doc = byId.get(entry.id)
    assert.ok(doc, `excluded recipe not found: ${entry.id}`)
    assert.equal(textSha256(doc.data.content || ''), entry.contentSha256, `${entry.id}: excluded content changed`)
    return { id: entry.id, title: doc.data.title || '', reason: entry.reason }
  })

  const proposedUpdates = data.updates.map(entry => {
    const doc = byId.get(entry.id)
    assert.ok(doc, `manifest recipe not found: ${entry.id}`)
    assertExpectedCurrent(entry.id, 'prepTime', doc.data.prepTime, entry.before.prepTime)
    assertExpectedCurrent(entry.id, 'cookTime', doc.data.cookTime, entry.before.cookTime)
    const patch = {}
    for (const field of ALLOWED_FIELDS) {
      if (normalizeExpected(doc.data[field]) !== normalizeExpected(entry.after[field])) patch[field] = entry.after[field]
    }
    assert.ok(Object.keys(patch).length > 0, `${entry.id}: manifest entry produces no change`)
    assert.ok(Object.keys(patch).every(field => ALLOWED_FIELDS.has(field)), `${entry.id}: forbidden patch field`)
    const total = getTotalTime(entry.after.prepTime, entry.after.cookTime)
    return {
      id: entry.id,
      title: doc.data.title || '',
      kind: entry.kind,
      before: { prepTime: normalizeExpected(doc.data.prepTime), cookTime: normalizeExpected(doc.data.cookTime) },
      after: entry.after,
      patch,
      resultingTotalMinutes: total.minutes,
      resultingTotal: total.display,
      evidence: entry.evidence,
      updateTime: doc.updateTime,
      nonTimeFingerprint: fingerprint(withoutTimeFields(doc.data)),
    }
  })

  const afterById = new Map(proposedUpdates.map(update => [update.id, update.after]))
  const coverageFailures = []
  for (const doc of catalogDocs) {
    if (excludedIds.has(doc.id)) continue
    const after = afterById.get(doc.id) || doc.data
    for (const field of ALLOWED_FIELDS) {
      const value = after[field]
      if (isEmpty(value)) coverageFailures.push(`${doc.id}.${field} remains empty`)
      else if (String(value).trim().toLowerCase() !== '0 min' && parseTimeToMinutes(value) <= 0) coverageFailures.push(`${doc.id}.${field} is unparseable`)
    }
  }
  assert.deepEqual(coverageFailures, [], `usable-catalog coverage failed:\n${coverageFailures.join('\n')}`)
  assert.equal(updateIds.size, proposedUpdates.length, 'not every manifest update was audited')

  const catalogFingerprint = fingerprint(catalogDocs.map(doc => ({
    id: doc.id,
    prepTime: normalizeExpected(doc.data.prepTime),
    cookTime: normalizeExpected(doc.data.cookTime),
    updateTime: doc.updateTime,
    nonTimeFingerprint: fingerprint(withoutTimeFields(doc.data)),
  })))
  const updateFingerprint = fingerprint(proposedUpdates.map(({ id, before, after, patch }) => ({ id, before, after, patch })))
  return {
    catalogCount: catalogDocs.length,
    usableRecipeCount: catalogDocs.length - excluded.length,
    excluded,
    proposedUpdates,
    summary: {
      backfills: proposedUpdates.filter(update => update.kind === 'backfill').length,
      corrections: proposedUpdates.filter(update => update.kind === 'correction').length,
      changedRecipes: proposedUpdates.length,
      changedPrepFields: proposedUpdates.filter(update => Object.hasOwn(update.patch, 'prepTime')).length,
      changedCookFields: proposedUpdates.filter(update => Object.hasOwn(update.patch, 'cookTime')).length,
    },
    catalogFingerprint,
    updateFingerprint,
  }
}

function parseArgs(argv) {
  const args = { apply: false }
  for (const raw of argv) {
    if (raw === '--apply') args.apply = true
    else if (raw.startsWith('--report=')) args.report = raw.slice('--report='.length)
    else if (raw.startsWith('--dry-run-report=')) args.dryRunReport = raw.slice('--dry-run-report='.length)
    else if (raw.startsWith('--confirm-project=')) args.confirmProject = raw.slice('--confirm-project='.length)
    else if (raw.startsWith('--confirm-count=')) args.confirmCount = Number(raw.slice('--confirm-count='.length))
    else throw new Error(`unknown argument: ${raw}`)
  }
  return args
}

function publicUpdate(update) {
  const { updateTime, nonTimeFingerprint, ...safe } = update
  return safe
}

function makeReport(audit, mode, extra = {}) {
  return {
    generatedAt: new Date().toISOString(),
    mode,
    projectId: PROJECT_ID,
    collection: COLLECTION,
    allowedWriteFields: [...ALLOWED_FIELDS],
    canonicalTotalFieldPersisted: false,
    ...audit,
    proposedUpdates: audit.proposedUpdates.map(publicUpdate),
    ...extra,
  }
}

function writeReport(reportPath, report) {
  if (!reportPath) return
  const absolute = path.resolve(reportPath)
  fs.mkdirSync(path.dirname(absolute), { recursive: true })
  fs.writeFileSync(absolute, `${JSON.stringify(stableValue(report), null, 2)}\n`)
  console.log(`Report: ${absolute}`)
}

async function fetchCatalog(db) {
  const snap = await db.collection(COLLECTION).get()
  return snap.docs.map(doc => ({ id: doc.id, data: doc.data(), updateTime: doc.updateTime })).sort((a, b) => a.id.localeCompare(b.id))
}

async function applyAudit(db, audit) {
  const batch = db.batch()
  for (const update of audit.proposedUpdates) {
    batch.update(db.collection(COLLECTION).doc(update.id), update.patch, { lastUpdateTime: update.updateTime })
  }
  await batch.commit()
}

async function verifyApply(db, audit) {
  const refs = audit.proposedUpdates.map(update => db.collection(COLLECTION).doc(update.id))
  const snaps = await db.getAll(...refs)
  const byId = new Map(snaps.map(snap => [snap.id, snap]))
  const verified = []
  for (const update of audit.proposedUpdates) {
    const snap = byId.get(update.id)
    assert.ok(snap && snap.exists, `post-apply recipe missing: ${update.id}`)
    const data = snap.data()
    assert.equal(data.prepTime, update.after.prepTime, `${update.id}.prepTime post-apply mismatch`)
    assert.equal(data.cookTime, update.after.cookTime, `${update.id}.cookTime post-apply mismatch`)
    assert.equal(fingerprint(withoutTimeFields(data)), update.nonTimeFingerprint, `${update.id}: non-time field changed`)
    verified.push({ id: update.id, prepTime: data.prepTime, cookTime: data.cookTime, total: getTotalTime(data.prepTime, data.cookTime) })
  }
  return verified
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  loadEnv()
  assert.equal(process.env.FIREBASE_PROJECT_ID, PROJECT_ID, 'FIREBASE_PROJECT_ID is not malignant-metro')
  const db = getAdmin().firestore()
  const audit = buildAudit(await fetchCatalog(db))
  console.log(`Catalog: ${audit.catalogCount} documents (${audit.usableRecipeCount} usable, ${audit.excluded.length} excluded)`)
  console.log(`Proposed: ${audit.summary.changedRecipes} recipes (${audit.summary.backfills} backfills, ${audit.summary.corrections} corrections)`)
  console.log(`Fields: ${audit.summary.changedPrepFields} prepTime, ${audit.summary.changedCookFields} cookTime`)
  console.log(`Fingerprints: catalog=${audit.catalogFingerprint} updates=${audit.updateFingerprint}`)

  if (!args.apply) {
    const report = makeReport(audit, 'dry-run', { writesPerformed: 0, gateStatus: 'PASSED' })
    writeReport(args.report, report)
    console.log('DRY RUN PASSED — no production writes performed.')
    return report
  }

  assert.equal(args.confirmProject, PROJECT_ID, `apply requires --confirm-project=${PROJECT_ID}`)
  assert.equal(args.confirmCount, audit.summary.changedRecipes, `apply requires --confirm-count=${audit.summary.changedRecipes}`)
  assert.ok(args.dryRunReport, 'apply requires --dry-run-report=<path>')
  const dryRun = JSON.parse(fs.readFileSync(path.resolve(args.dryRunReport), 'utf8'))
  assert.equal(dryRun.mode, 'dry-run', 'provided report is not a dry-run')
  assert.equal(dryRun.gateStatus, 'PASSED', 'provided dry-run did not pass')
  assert.equal(dryRun.projectId, PROJECT_ID, 'dry-run project mismatch')
  assert.equal(dryRun.catalogFingerprint, audit.catalogFingerprint, 'catalog changed since dry-run')
  assert.equal(dryRun.updateFingerprint, audit.updateFingerprint, 'update set changed since dry-run')
  assert.equal(dryRun.summary.changedRecipes, audit.summary.changedRecipes, 'dry-run count mismatch')

  const backup = audit.proposedUpdates.map(update => ({ id: update.id, before: update.before, updateTime: update.updateTime }))
  await applyAudit(db, audit)
  const verified = await verifyApply(db, audit)
  const report = makeReport(audit, 'apply', {
    dryRunReport: args.dryRunReport,
    writesPerformed: audit.summary.changedRecipes,
    gateStatus: 'PASSED',
    backup,
    postApplyVerified: verified,
  })
  writeReport(args.report, report)
  console.log(`APPLY PASSED — ${verified.length} recipes read back; non-time fields unchanged.`)
  return report
}

if (require.main === module) {
  main().catch(error => {
    console.error(`FAILED: ${error.stack || error.message}`)
    process.exitCode = 1
  })
}

module.exports = { ALLOWED_FIELDS, buildAudit, formatMinutes, getTotalTime, isEmpty, parseArgs, parseTimeToMinutes, validateManifest }
