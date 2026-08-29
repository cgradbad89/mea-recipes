#!/usr/bin/env node
/**
 * Cooking Mode final closeout for exactly three authorized recipes.
 *
 * No mode invokes AI, candidate generation, mapping research, or a broad
 * corpus writer. Review preparation reuses only persisted same-revision
 * proposals and append-only review/attestation/approval services. Apply and
 * rollback consume only the SHA-locked manifest.
 *
 * Usage:
 *   node scripts/cooking-mode-selective-promotion.mjs --prepare-reviews
 *   node scripts/cooking-mode-selective-promotion.mjs --generate-manifest
 *   node scripts/cooking-mode-selective-promotion.mjs --dry-run
 *   node scripts/cooking-mode-selective-promotion.mjs --apply
 *   node scripts/cooking-mode-selective-promotion.mjs --verify
 *   node scripts/cooking-mode-selective-promotion.mjs --rollback
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { loadEnv, getAdmin } = require('./_lib.js')

const MANIFEST_PATH = 'docs/audits/cooking-mode-selective-promotion-manifest-2026-08-29.json'
const MANIFEST_AUDIT_PATH = 'docs/audits/cooking-mode-selective-promotion-manifest-2026-08-29.md'
const APPLY_JSON_PATH = 'docs/audits/cooking-mode-selective-promotion-apply-2026-08-29.json'
const APPLY_MD_PATH = 'docs/audits/cooking-mode-selective-promotion-apply-2026-08-29.md'
const AUTHORIZED_MANIFEST_SHA256 = 'eb804ad43b50c42c72f02ab54136ef8d2a5f10a1c84301e4ab7d34a86c512a26'
const ADMIN_EMAIL = 'folstromjohn@gmail.com'
const RECIPE_IDS = Object.freeze([
  'garlic-butter-herb-steak-bites-with-potatoes',
  'caprese-salad',
  'grilled-zucchini-and-summer-squash',
])

function parseMode(argv) {
  const allowed = new Set(['--prepare-reviews', '--generate-manifest', '--dry-run', '--apply', '--verify', '--rollback'])
  if (argv.length !== 1 || !allowed.has(argv[0])) {
    throw new Error('Pass exactly one supported mode: --prepare-reviews | --generate-manifest | --dry-run | --apply | --verify | --rollback')
  }
  return argv[0].slice(2)
}

async function loadModules() {
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false },
    resolve: { alias: { '@': ROOT } },
    plugins: [{
      name: 'selective-promotion-server-only', enforce: 'pre',
      resolveId(id) { return id === 'server-only' ? '\0selective-promotion-server-only' : null },
      load(id) { return id === '\0selective-promotion-server-only' ? 'export {}' : null },
    }],
  })
  try {
    const [recipeContent, mapping, identity, proposals, review, human, completeness, approved, promotion] = await Promise.all([
      server.ssrLoadModule('/lib/recipeContent.ts'),
      server.ssrLoadModule('/lib/cookingStepMapping.ts'),
      server.ssrLoadModule('/lib/cookingModeMappingIdentity.ts'),
      server.ssrLoadModule('/lib/cookingModeMappingProposalPersistence.ts'),
      server.ssrLoadModule('/lib/cookingModeMappingReviewPersistence.ts'),
      server.ssrLoadModule('/lib/cookingModeMappingHumanRelationship.ts'),
      server.ssrLoadModule('/lib/cookingModeMappingCompletenessAttestation.ts'),
      server.ssrLoadModule('/lib/cookingModeMappingApprovedPersistence.ts'),
      server.ssrLoadModule('/lib/cookingModeMappingPromotion.ts'),
    ])
    return {
      recipeContent, mapping, identity, proposals, review, human, completeness, approved, promotion,
      close: () => server.close(),
    }
  } catch (error) {
    await server.close()
    throw error
  }
}

function deriveProvenance(candidates) {
  const withVotes = candidates.find(candidate => candidate.reviewerA && candidate.reviewerB)
  return {
    reviewerARunId: withVotes?.reviewerA?.runId ?? '',
    reviewerBRunId: withVotes?.reviewerB?.runId ?? '',
    reviewerAOutputHash: withVotes?.reviewerA?.normalizedOutputHash ?? null,
    reviewerBOutputHash: withVotes?.reviewerB?.normalizedOutputHash ?? null,
    autoAcceptCandidateCount: candidates.filter(candidate => candidate.routingDecision === 'AUTO_ACCEPT').length,
    humanDecidedCandidateCount: candidates.filter(candidate => candidate.decisionSource === 'HUMAN').length,
  }
}

async function liveRecipeContext(db, recipeId, modules) {
  const snap = await db.collection('recipes').doc(recipeId).get()
  if (!snap.exists) throw new Error(`Recipe missing: ${recipeId}`)
  const data = snap.data()
  const parsed = modules.recipeContent.parseRecipeContent(typeof data.content === 'string' ? data.content : '')
  const source = {
    recipeId,
    parserVersion: modules.mapping.COOKING_MAPPING_PARSER_VERSION,
    ingredients: parsed.ingredients,
    instructions: parsed.instructions,
  }
  const recipeRevision = await modules.identity.computeMappingRecipeRevision(source)
  return { ref: snap.ref, snap, data, source, recipeRevision }
}

async function currentProposalFor(db, context, modules) {
  const snapshot = await context.ref.collection('mappingProposals').get()
  const proposal = snapshot.docs.map(doc => doc.data()).find(item =>
    item.persistenceStatus === 'READY' && item.recipeRevision === context.recipeRevision)
  if (!proposal) throw new Error(`No same-revision READY proposal for ${context.source.recipeId}`)
  const candidates = await modules.proposals.listMappingCandidates(context.source.recipeId, proposal.proposalId, db)
  return { proposal, candidates }
}

async function appendDesiredDecision(db, recipeId, proposal, candidate, desired, adminUid, modules) {
  if (candidate.finalDecision === desired) return { outcome: 'UNCHANGED', candidateId: candidate.candidateId }
  const event = await modules.review.appendMappingReviewDecision({
    recipeId,
    proposalId: proposal.proposalId,
    candidateId: candidate.candidateId,
    recipeRevision: proposal.recipeRevision,
    decision: desired,
    reasonCode: desired === 'ACCEPT' ? 'LIFECYCLE_OR_REUSE' : 'SOURCE_NO_ACTIVE_USE',
    note: null,
    decidedBy: adminUid,
    supersedesDecisionId: candidate.effectiveReviewEventId ?? undefined,
  }, { db })
  return { outcome: 'APPENDED', candidateId: candidate.candidateId, decisionId: event.decisionId, decision: desired }
}

async function approveCurrentState(db, context, proposal, adminUid, modules) {
  const candidates = await modules.proposals.listMappingCandidates(context.source.recipeId, proposal.proposalId, db)
  const completion = modules.review.computeProposalCompletion(candidates)
  if (!completion.complete) throw new Error(`Proposal remains unresolved for ${context.source.recipeId}: ${completion.unresolvedCandidateIds.join(', ')}`)
  const attestation = await modules.completeness.recordMappingCompletenessAttestation({
    recipeId: context.source.recipeId,
    proposalId: proposal.proposalId,
    recipeRevision: proposal.recipeRevision,
    attestedBy: adminUid,
  }, { db })
  const outcome = await modules.approved.buildApprovedMapping({
    recipeId: context.source.recipeId,
    recipeRevision: proposal.recipeRevision,
    parserVersion: proposal.parserVersion,
    mappingSourceHash: proposal.mappingSourceHash,
    proposalId: proposal.proposalId,
    reviewerContractVersion: proposal.reviewerContractVersion,
    evidenceContractVersion: proposal.evidenceContractVersion,
    routingContractVersion: proposal.routingContractVersion,
    candidates,
    proposalBlockingReasons: proposal.blockingReasons,
    approvedBy: adminUid,
    completenessAttestation: attestation,
    provenance: deriveProvenance(candidates),
  })
  if (!outcome.ok) throw new Error(`Approved-map build rejected for ${context.source.recipeId}: ${outcome.reason}`)
  await modules.approved.persistApprovedMapping(outcome.map, { db })
  const current = await modules.approved.getCurrentApprovedMappingPointer(context.source.recipeId, context.recipeRevision, db)
  if (current.status !== 'CURRENT' || current.pointer?.mapId !== outcome.map.mapId) {
    await modules.approved.updateCurrentApprovedMappingPointer(context.source.recipeId, outcome.map.mapId, { db })
  }
  const readback = await modules.approved.getApprovedMapping(context.source.recipeId, outcome.map.mapId, db)
  if (!readback || readback.mapHash !== outcome.map.mapHash) throw new Error(`Approved-map readback failed for ${context.source.recipeId}`)
  return readback
}

async function prepareReviews(db, adminUid, modules) {
  const steakId = RECIPE_IDS[0]
  const steak = await liveRecipeContext(db, steakId, modules)
  const steakState = await currentProposalFor(db, steak, modules)
  const bad = steakState.candidates.find(candidate =>
    candidate.ingredientText.toLowerCase() === 'salt and pepper' && candidate.stepIndex === 2)
  if (!bad || bad.provenance.candidateOrigin !== 'HUMAN_ADDED') {
    throw new Error('Expected Steak human-added salt and pepper → step 3 candidate was not found')
  }
  let steakCorrection = { outcome: 'UNCHANGED_ALREADY_REJECTED', candidateId: bad.candidateId }
  if (bad.finalDecision !== 'REJECT') {
    const event = await modules.human.removeHumanMappingRelationship({
      recipeId: steakId,
      proposalId: steakState.proposal.proposalId,
      candidateId: bad.candidateId,
      recipeRevision: steak.recipeRevision,
      reasonCode: 'SOURCE_NO_ACTIVE_USE',
      note: 'Final closeout correction: step 3 adds fresh chopped herbs, not salt and pepper.',
      removedBy: adminUid,
    }, { db })
    steakCorrection = { outcome: 'APPENDED_REJECT', candidateId: bad.candidateId, decisionId: event.decisionId }
  }
  const steakMap = await approveCurrentState(db, steak, steakState.proposal, adminUid, modules)

  const zucchiniId = RECIPE_IDS[2]
  const zucchini = await liveRecipeContext(db, zucchiniId, modules)
  const zucchiniState = await currentProposalFor(db, zucchini, modules)
  const desired = new Map([
    // Step 3 (zero-based 2): grill the two vegetables; the coating ingredients
    // were actively added on the prior step and are not independently used here.
    ['0:2', 'ACCEPT'], ['1:2', 'ACCEPT'],
    ['2:2', 'REJECT'], ['3:2', 'REJECT'], ['4:2', 'REJECT'], ['5:2', 'REJECT'], ['6:2', 'REJECT'],
    // Step 4 (zero-based 3): transfer the grilled vegetables and add basil.
    // Basil is already AUTO_ACCEPT; these are the remaining review candidates.
    ['0:3', 'ACCEPT'], ['1:3', 'ACCEPT'],
    ['2:3', 'REJECT'], ['3:3', 'REJECT'], ['4:3', 'REJECT'], ['5:3', 'REJECT'], ['6:3', 'REJECT'],
  ])
  const zucchiniDecisions = []
  for (const candidate of zucchiniState.candidates) {
    const decision = desired.get(`${candidate.ingredientRowIndex}:${candidate.stepIndex}`)
    if (!decision) continue
    zucchiniDecisions.push(await appendDesiredDecision(
      db, zucchiniId, zucchiniState.proposal, candidate, decision, adminUid, modules,
    ))
  }
  const zucchiniMap = await approveCurrentState(db, zucchini, zucchiniState.proposal, adminUid, modules)

  assertApprovedSemantics(steak, steakMap)
  assertApprovedSemantics(zucchini, zucchiniMap)
  return {
    aiCalls: 0,
    steak: { correction: steakCorrection, mapId: steakMap.mapId, mapHash: steakMap.mapHash },
    zucchini: { decisions: zucchiniDecisions, mapId: zucchiniMap.mapId, mapHash: zucchiniMap.mapHash },
  }
}

function relationshipTexts(context, map) {
  return map.relationships.map(relationship => ({
    ingredientRowIndex: relationship.ingredientRowIndex,
    ingredient: context.source.ingredients[relationship.ingredientRowIndex],
    stepIndex: relationship.stepIndex,
    step: context.source.instructions[relationship.stepIndex],
  }))
}

function hasRelationship(context, map, ingredientPattern, stepIndex) {
  return relationshipTexts(context, map).some(row => row.stepIndex === stepIndex && ingredientPattern.test(row.ingredient))
}

function assertApprovedSemantics(context, map) {
  const id = context.source.recipeId
  if (id === RECIPE_IDS[0]) {
    if (!hasRelationship(context, map, /potato/i, 0)) throw new Error('Steak approved map lacks potatoes → step 1')
    if (!hasRelationship(context, map, /steak/i, 1)) throw new Error('Steak approved map lacks steak → step 2')
    if (hasRelationship(context, map, /^salt and pepper$/i, 2)) throw new Error('Steak approved map still has salt and pepper → step 3')
  } else if (id === RECIPE_IDS[1]) {
    if (!hasRelationship(context, map, /mozzarella/i, 0)) throw new Error('Caprese approved map lacks mozzarella → step 1')
  } else if (id === RECIPE_IDS[2]) {
    for (const pattern of [/italian herbs/i, /black pepper/i, /yellow summer squash/i]) {
      if (!hasRelationship(context, map, pattern, 1)) throw new Error(`Zucchini approved map lacks ${pattern} → step 2`)
    }
  }
}

async function loadCurrentApproved(db, context, modules) {
  const pointer = await modules.approved.getCurrentApprovedMappingPointer(context.source.recipeId, context.recipeRevision, db)
  if (pointer.status !== 'CURRENT' || !pointer.pointer) throw new Error(`Current-approved pointer is not CURRENT for ${context.source.recipeId}`)
  const map = await modules.approved.getApprovedMapping(context.source.recipeId, pointer.pointer.mapId, db)
  if (!map || map.mapHash !== pointer.pointer.mapHash) throw new Error(`Current approved map readback failed for ${context.source.recipeId}`)
  assertApprovedSemantics(context, map)
  return map
}

async function generateManifest(db, modules) {
  const rows = []
  for (const recipeId of RECIPE_IDS) {
    const context = await liveRecipeContext(db, recipeId, modules)
    const approved = await loadCurrentApproved(db, context, modules)
    const oldRuntimeMap = context.data.cookingStepIngredientMap
    if (!oldRuntimeMap) throw new Error(`Existing runtime map missing for ${recipeId}`)
    const oldRuntimeMapHash = await modules.promotion.computeCanonicalJsonSha256(oldRuntimeMap)
    const newRuntimeMap = modules.promotion.materializeApprovedMapForLegacyRuntime(approved, context.source.instructions.length)
    const newRuntimeMapHash = await modules.promotion.computeCanonicalJsonSha256(newRuntimeMap)
    rows.push({
      recipeId,
      recipeRevision: context.recipeRevision,
      approvedMapId: approved.mapId,
      approvedMapHash: approved.mapHash,
      oldRuntimeMapExactValue: oldRuntimeMap,
      oldRuntimeMapHash,
      newRuntimeMapExactValue: newRuntimeMap,
      newRuntimeMapHash,
      writeTarget: `recipes/${recipeId}.cookingStepIngredientMap`,
      preconditions: {
        recipeRevision: context.recipeRevision,
        approvedMapId: approved.mapId,
        approvedMapHash: approved.mapHash,
        currentApprovedPointerStatus: 'CURRENT',
        existingRuntimeMapHash: oldRuntimeMapHash,
      },
      rollbackValue: oldRuntimeMap,
    })
  }
  const manifest = {
    schemaVersion: 1,
    manifestId: 'cooking-mode-selective-promotion-2026-08-29',
    recipes: rows,
  }
  const manifestSha256 = await modules.promotion.computeCanonicalJsonSha256(manifest)
  const canonical = modules.promotion.canonicalJson(manifest)
  fs.writeFileSync(path.join(ROOT, MANIFEST_PATH), `${canonical}\n`)
  const table = rows.map(row =>
    `| \`${row.recipeId}\` | \`${row.recipeRevision}\` | \`${row.approvedMapId}\` | \`${row.oldRuntimeMapHash}\` | \`${row.newRuntimeMapHash}\` |`,
  ).join('\n')
  const markdown = `# Cooking Mode Selective Promotion Manifest\n\n` +
    `Date: 2026-08-29\n\n` +
    `Status: **FROZEN FOR APPLY**\n\n` +
    `Canonical manifest SHA-256: \`${manifestSha256}\`\n\n` +
    `The JSON artifact contains exactly three authorized recipes, each recipe's exact old runtime value and rollback value, the exact approved-map-derived new runtime value, hashes, write target, and fail-closed preconditions. Hashing uses recursively key-sorted compact JSON without a trailing newline.\n\n` +
    `| Recipe | Recipe revision | Approved map | Old runtime hash | New runtime hash |\n|---|---|---|---|---|\n${table}\n\n` +
    `Apply rule: verify this SHA, recheck all three authoritative preconditions, and commit all three field-only writes in one Firestore transaction. No AI, review change, routing change, candidate generation, or runtime recomputation is permitted during apply.\n\n` +
    `Rollback rule: require the current runtime hash to equal the recorded new hash, then restore the exact recorded old value for all three in one transaction.\n`
  fs.writeFileSync(path.join(ROOT, MANIFEST_AUDIT_PATH), markdown)
  return { manifestSha256, path: MANIFEST_PATH, recipes: rows.length }
}

async function loadLockedManifest(modules) {
  if (!/^[0-9a-f]{64}$/.test(AUTHORIZED_MANIFEST_SHA256)) {
    throw new Error('AUTHORIZED_MANIFEST_SHA256 is not locked; generate the manifest and patch the exact hash before dry-run/apply')
  }
  const bytes = fs.readFileSync(path.join(ROOT, MANIFEST_PATH), 'utf8')
  const manifest = JSON.parse(bytes)
  if (modules.promotion.canonicalJson(manifest) + '\n' !== bytes) throw new Error('Manifest file is not exact canonical JSON plus one newline')
  if (!(await modules.promotion.verifySelectivePromotionManifestHash(manifest, AUTHORIZED_MANIFEST_SHA256))) {
    throw new Error('Manifest SHA-256 does not match the locked authorized hash')
  }
  if (manifest.recipes.length !== 3 || manifest.recipes.map(row => row.recipeId).join('|') !== RECIPE_IDS.join('|')) {
    throw new Error('Manifest recipe allowlist/order differs from the exact authorized three-recipe list')
  }
  return manifest
}

async function snapshotAllRecipes(db, modules) {
  const snap = await db.collection('recipes').get()
  return new Map(await Promise.all(snap.docs.map(async doc => [doc.id, {
    data: doc.data(),
    hash: await modules.promotion.computeCanonicalJsonSha256(doc.data()),
  }])))
}

async function verifyReadback(db, manifest, before, modules) {
  const after = await snapshotAllRecipes(db, modules)
  const targetIds = new Set(RECIPE_IDS)
  const failures = []
  const rows = []
  for (const row of manifest.recipes) {
    const beforeDoc = before.get(row.recipeId)?.data
    const afterDoc = after.get(row.recipeId)?.data
    const runtimeHash = await modules.promotion.computeCanonicalJsonSha256(afterDoc?.cookingStepIngredientMap ?? null)
    const beforeProtected = { ...beforeDoc }; delete beforeProtected.cookingStepIngredientMap
    const afterProtected = { ...afterDoc }; delete afterProtected.cookingStepIngredientMap
    const protectedUnchanged = modules.promotion.canonicalJson(beforeProtected) === modules.promotion.canonicalJson(afterProtected)
    const exactRuntimeValue = modules.promotion.canonicalJson(afterDoc?.cookingStepIngredientMap) === modules.promotion.canonicalJson(row.newRuntimeMapExactValue)
    if (runtimeHash !== row.newRuntimeMapHash || !exactRuntimeValue || !protectedUnchanged) {
      failures.push({ recipeId: row.recipeId, runtimeHash, exactRuntimeValue, protectedUnchanged })
    }
    rows.push({ recipeId: row.recipeId, runtimeHash, exactRuntimeValue, protectedUnchanged })
  }
  const unauthorizedChanges = []
  for (const [id, previous] of before) {
    if (targetIds.has(id)) continue
    if (after.get(id)?.hash !== previous.hash) unauthorizedChanges.push(id)
  }
  if (after.size !== before.size) failures.push({ reason: 'RECIPE_POPULATION_CHANGED', before: before.size, after: after.size })
  if (unauthorizedChanges.length) failures.push({ reason: 'UNAUTHORIZED_RECIPE_CHANGES', recipeIds: unauthorizedChanges })
  return { ok: failures.length === 0, rows, failures, unauthorizedChanges, recipeCount: after.size }
}

function rollbackInputs(manifest) {
  return manifest.recipes.map(row => ({
    recipeId: row.recipeId,
    expectedCurrentRuntimeMapHash: row.newRuntimeMapHash,
    rollbackRuntimeMap: row.rollbackValue,
    expectedRollbackRuntimeMapHash: row.oldRuntimeMapHash,
  }))
}

function writeApplyArtifacts(report, modules) {
  fs.writeFileSync(path.join(ROOT, APPLY_JSON_PATH), `${modules.promotion.canonicalJson(report)}\n`)
  const rows = report.readback.rows.map(row =>
    `| \`${row.recipeId}\` | \`${row.runtimeHash}\` | ${row.exactRuntimeValue ? 'PASS' : 'FAIL'} | ${row.protectedUnchanged ? 'PASS' : 'FAIL'} |`,
  ).join('\n')
  const markdown = `# Cooking Mode Selective Promotion — Production Apply\n\n` +
    `Date: 2026-08-29\n\n` +
    `Result: **${report.result}**\n\n` +
    `Manifest SHA-256: \`${report.manifestSha256}\`\n\n` +
    `Atomicity: all three authoritative states were checked and all three \`cookingStepIngredientMap\` values were merge-written in one Firestore transaction.\n\n` +
    `| Recipe | Runtime hash read back | Exact manifest value | Other root fields unchanged |\n|---|---|---|---|\n${rows}\n\n` +
    `Production writes: ${report.productionWrites}. Unauthorized recipe writes detected: ${report.readback.unauthorizedChanges.length}. AI calls: 0. Mapping recomputations: 0 (the deterministic approved→legacy conversion was frozen before apply and only equality-validated during preflight).\n\n` +
    `Rollback readiness: exact old values/hashes and expected current new hashes are retained in the immutable manifest. Rollback was ${report.rollbackExecuted ? 'executed because verification failed' : 'not executed because production readback passed'}.\n`
  fs.writeFileSync(path.join(ROOT, APPLY_MD_PATH), markdown)
}

async function run() {
  const mode = parseMode(process.argv.slice(2))
  loadEnv()
  const admin = getAdmin()
  const db = admin.firestore()
  const modules = await loadModules()
  try {
    if (mode === 'prepare-reviews') {
      const adminUser = await admin.auth().getUserByEmail(ADMIN_EMAIL)
      console.log(JSON.stringify(await prepareReviews(db, adminUser.uid, modules), null, 2))
      return
    }
    if (mode === 'generate-manifest') {
      console.log(JSON.stringify(await generateManifest(db, modules), null, 2))
      return
    }

    const manifest = await loadLockedManifest(modules)
    const promotionInputs = modules.promotion.promotionInputsFromManifest(manifest)
    if (mode === 'dry-run') {
      const results = await modules.promotion.dryRunApprovedMappingPromotion(promotionInputs, db)
      const ready = results.filter(row => row.status === 'READY').length
      console.log(JSON.stringify({ result: ready === 3 ? 'PASS' : 'FAIL', ready, total: 3, manifestSha256: AUTHORIZED_MANIFEST_SHA256, results }, null, 2))
      if (ready !== 3) process.exitCode = 1
      return
    }
    if (mode === 'verify') {
      const snapshot = await snapshotAllRecipes(db, modules)
      const syntheticBefore = new Map(snapshot)
      for (const row of manifest.recipes) {
        syntheticBefore.get(row.recipeId).data = {
          ...syntheticBefore.get(row.recipeId).data,
          cookingStepIngredientMap: row.oldRuntimeMapExactValue,
        }
      }
      console.log(JSON.stringify(await verifyReadback(db, manifest, syntheticBefore, modules), null, 2))
      return
    }
    if (mode === 'rollback') {
      console.log(JSON.stringify(await modules.promotion.rollbackPromotedMappings(rollbackInputs(manifest), db), null, 2))
      return
    }

    const before = await snapshotAllRecipes(db, modules)
    const dryRun = await modules.promotion.dryRunApprovedMappingPromotion(promotionInputs, db)
    if (dryRun.some(row => row.status !== 'READY')) throw new Error(`Apply preflight is not 3/3 READY: ${JSON.stringify(dryRun)}`)
    const applied = await modules.promotion.promoteApprovedMappingsToRuntime(promotionInputs, db)
    const readback = await verifyReadback(db, manifest, before, modules)
    let rollbackExecuted = false
    if (!readback.ok) {
      await modules.promotion.rollbackPromotedMappings(rollbackInputs(manifest), db)
      rollbackExecuted = true
    }
    const report = {
      schemaVersion: 1,
      result: readback.ok ? 'PASS' : 'FAIL_ROLLED_BACK',
      manifestSha256: AUTHORIZED_MANIFEST_SHA256,
      authorizedRecipeIds: RECIPE_IDS,
      dryRun,
      applied,
      productionWrites: readback.ok ? 3 : 6,
      writeField: 'cookingStepIngredientMap only',
      aiCalls: 0,
      rollbackExecuted,
      readback,
    }
    writeApplyArtifacts(report, modules)
    console.log(JSON.stringify(report, null, 2))
    if (!readback.ok) process.exitCode = 1
  } finally {
    await modules.close()
  }
}

run().catch(error => {
  console.error(error)
  process.exit(1)
})
