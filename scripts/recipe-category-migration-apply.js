'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')

const PROJECT_ID = 'malignant-metro'
const APPROVED_MANIFEST_PATH = 'docs/audits/recipe-category-migration-dryrun-2026-08-25.json'
const APPROVED_MANIFEST_SHA256 = 'e1f266550d037b7683e2f4640e7aeca1d84471879399bb75522441ef69470e67'
const APPLY_CONFIRMATION = 'APPLY-APPROVED-CATEGORY-MIGRATION'
const EXPECTED = Object.freeze({
  sharedDocuments: 236,
  sharedWrites: 66,
  categoryOverridesBefore: 25,
  overrideDeletes: 24,
  preservedOverrides: 1,
  totalWrites: 90,
})
const PRESERVED_OVERRIDE = Object.freeze({
  recipeID: '182',
  title: 'Spicy Quinoa with Sweet Potatoes',
  overrideCategory: 'Salads & Bowls',
  sharedBefore: 'Vegetarian',
  sharedAfter: 'Vegetarian Mains',
})
const EXPECTED_DISTRIBUTION = Object.freeze({
  'Chicken & Poultry': 38,
  'Beef & Pork': 20,
  Seafood: 12,
  'Vegetarian Mains': 27,
  'Pasta, Noodles & Rice': 23,
  'Salads & Bowls': 33,
  'Soups, Stews & Chili': 34,
  Breakfast: 4,
  Snacks: 4,
  Drinks: 3,
  'Sauces & Condiments': 4,
  Sides: 34,
})

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key)
}

function sha256(contents) {
  return crypto.createHash('sha256').update(contents).digest('hex')
}

function stableValue(value) {
  if (value === undefined) return { __type: 'undefined' }
  if (value === null || typeof value !== 'object') return value
  if (typeof value.toDate === 'function') return value.toDate().toISOString()
  if (typeof value.path === 'string' && value.firestore) return { __reference: value.path }
  if (Buffer.isBuffer(value)) return { __buffer: value.toString('base64') }
  if (Array.isArray(value)) return value.map(stableValue)
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]))
}

function fingerprint(value) {
  return sha256(JSON.stringify(stableValue(value)))
}

function categoryOverride(meta) {
  const overrides = meta?.data?.overrides
  if (!overrides || typeof overrides !== 'object' || !own(overrides, 'category')) return undefined
  return overrides.category
}

function categoryOverrideDocs(metaDocs) {
  return metaDocs.filter(meta => {
    const value = categoryOverride(meta)
    return value !== undefined && value !== null && value !== ''
  })
}

function recipeIdForMeta(meta) {
  return typeof meta?.data?.recipeID === 'string' && meta.data.recipeID.length
    ? meta.data.recipeID
    : meta.id
}

function validateApprovedManifest(manifest, contract, ownerUid) {
  assert.ok(manifest && typeof manifest === 'object' && !Array.isArray(manifest), 'manifest must be a JSON object')
  assert.equal(manifest.projectId, PROJECT_ID, `manifest projectId must be ${PROJECT_ID}`)
  assert.equal(manifest.mode, 'DRY_RUN_ONLY', 'approved manifest must be committed dry-run evidence')
  assert.equal(manifest.overallGate, 'READY FOR HUMAN MIGRATION REVIEW', 'manifest gate is not ready')
  assert.deepEqual(manifest.canonicalCategories, [...contract.RECIPE_CATEGORIES], 'manifest canonical categories differ from production contract')
  assert.ok(Array.isArray(manifest.sharedRecipeChanges), 'manifest lacks sharedRecipeChanges')
  assert.ok(Array.isArray(manifest.overrideChanges), 'manifest lacks overrideChanges')
  assert.ok(Array.isArray(manifest.preservedOverrides), 'manifest lacks preservedOverrides')
  assert.ok(Array.isArray(manifest.overrideAuditRows), 'manifest lacks overrideAuditRows')
  assert.ok(Array.isArray(manifest.preconditionFailures), 'manifest lacks preconditionFailures')
  assert.ok(Array.isArray(manifest.unexpectedRecords), 'manifest lacks unexpectedRecords')
  assert.equal(manifest.preconditionFailures.length, 0, 'manifest contains precondition failures')
  assert.equal(manifest.unexpectedRecords.length, 0, 'manifest contains unexpected records')
  assert.equal(manifest.productionBaseline?.sharedRecipeDocuments, EXPECTED.sharedDocuments, 'manifest shared-document baseline differs')
  assert.equal(manifest.productionBaseline?.categoryOverrides, EXPECTED.categoryOverridesBefore, 'manifest override baseline differs')
  assert.equal(manifest.sharedRecipeChanges.length, EXPECTED.sharedWrites, 'manifest must contain exactly 66 shared rows')
  assert.equal(manifest.overrideChanges.length, EXPECTED.overrideDeletes, 'manifest must contain exactly 24 override removals')
  assert.equal(manifest.preservedOverrides.length, EXPECTED.preservedOverrides, 'manifest must contain exactly one preserved override')
  assert.equal(manifest.overrideAuditRows.length, EXPECTED.categoryOverridesBefore, 'manifest override audit must contain exactly 25 rows')
  assert.deepEqual(manifest.sharedRecipeSummary, {
    alreadyMigrated: 0, preconditionMismatch: 0, ready: 66, unexpected: 0, unresolved: 0,
  }, 'manifest shared summary is not the exact approved population')
  assert.deepEqual(manifest.overrideSummary, {
    alreadyClean: 0, preconditionMismatch: 0, preserved: 1, proposedRemovals: 24, reviewRequired: 0,
  }, 'manifest override summary is not the exact approved population')

  const canonical = new Set(contract.RECIPE_CATEGORIES)
  const targets = new Set()
  for (const row of manifest.sharedRecipeChanges) {
    assert.equal(row.status, 'READY', `${row.recipeID}: approved shared row is not READY`)
    assert.equal(typeof row.recipeID, 'string', 'shared row lacks recipeID')
    assert.equal(typeof row.expectedOldCategory, 'string', `${row.recipeID}: shared row lacks expectedOldCategory`)
    assert.equal(row.observedCategory, row.expectedOldCategory, `${row.recipeID}: approved observation differs from expected old category`)
    assert.ok(canonical.has(row.proposedCategory), `${row.recipeID}: proposed category is noncanonical`)
    assert.notEqual(row.proposedCategory, row.expectedOldCategory, `${row.recipeID}: approved shared mutation is a no-op`)
    const resolution = contract.resolveRecipeCategory(row.expectedOldCategory, row.recipeID)
    assert.equal(resolution?.category, row.proposedCategory, `${row.recipeID}: approved result differs from canonical contract`)
    const target = `recipes/${row.recipeID}`
    assert.ok(!targets.has(target), `duplicate mutation target: ${target}`)
    targets.add(target)
  }

  const owner = ownerUid || manifest.ownerContext?.uid
  assert.equal(typeof owner, 'string', 'manifest owner uid is missing')
  assert.equal(manifest.ownerContext?.uid, owner, 'manifest owner uid differs from authenticated owner')
  assert.equal(manifest.ownerContext?.path, `users/${owner}/recipes/root/meta`, 'manifest owner path differs from exact meta path')

  for (const row of manifest.overrideChanges) {
    assert.equal(row.uid, owner, `${row.recipeID}: override uid differs from owner`)
    assert.equal(row.status, 'READY', `${row.recipeID}: approved override removal is not READY`)
    assert.ok(row.proposedAction === 'REMOVE_LEGACY' || row.proposedAction === 'REMOVE_REDUNDANT', `${row.recipeID}: unexpected override mutation action`)
    assert.equal(row.observedOverrideCategory, row.expectedOverrideCategory, `${row.recipeID}: approved override observation differs from expected value`)
    assert.equal(row.canonicalOverrideCategory, row.canonicalSharedCategory, `${row.recipeID}: removal is not redundant after migration`)
    assert.ok(canonical.has(row.sharedCategoryAfter), `${row.recipeID}: override row shared result is noncanonical`)
    assert.equal(typeof row.metaDocumentID, 'string', `${row.recipeID}: override row lacks exact meta document ID`)
    const target = `users/${owner}/recipes/root/meta/${row.metaDocumentID}`
    assert.ok(!targets.has(target), `duplicate mutation target: ${target}`)
    targets.add(target)
  }

  const preserved = manifest.preservedOverrides[0]
  assert.equal(preserved.uid, owner, 'preserved override uid differs from owner')
  assert.equal(preserved.recipeID, PRESERVED_OVERRIDE.recipeID, 'unexpected preserved override recipeID')
  assert.equal(preserved.title, PRESERVED_OVERRIDE.title, 'unexpected preserved override title')
  assert.equal(preserved.metaDocumentID, PRESERVED_OVERRIDE.recipeID, 'preserved override meta document ID changed')
  assert.equal(preserved.status, 'PRESERVED', 'approved preserved override is not PRESERVED')
  assert.equal(preserved.proposedAction, 'PRESERVE', 'approved preserved override action changed')
  assert.equal(preserved.expectedOverrideCategory, PRESERVED_OVERRIDE.overrideCategory, 'preserved override expected value changed')
  assert.equal(preserved.observedOverrideCategory, PRESERVED_OVERRIDE.overrideCategory, 'preserved override approved observation changed')
  assert.equal(preserved.sharedCategoryBefore, PRESERVED_OVERRIDE.sharedBefore, 'preserved override shared-before value changed')
  assert.equal(preserved.sharedCategoryAfter, PRESERVED_OVERRIDE.sharedAfter, 'preserved override shared-after value changed')
  assert.ok(!targets.has(`users/${owner}/recipes/root/meta/${preserved.metaDocumentID}`), 'preserved override appears in write targets')

  const auditKeys = manifest.overrideAuditRows.map(row => `${row.metaDocumentID}:${row.recipeID}`).sort()
  const approvedKeys = [...manifest.overrideChanges, ...manifest.preservedOverrides]
    .map(row => `${row.metaDocumentID}:${row.recipeID}`).sort()
  assert.deepEqual(auditKeys, approvedKeys, 'override audit contains rows outside the exact removal/preserve population')
  assert.equal(targets.size, EXPECTED.totalWrites, 'manifest does not contain exactly 90 unique mutation targets')
  return { ownerUid: owner, mutationTargets: targets }
}

function projectedSharedCategory(recipe, sharedById) {
  return sharedById.get(recipe.id)?.proposedCategory ?? recipe.data.category
}

function distributionFor(recipes, categoryFor = recipe => recipe.data.category) {
  const distribution = {}
  for (const recipe of recipes) {
    const category = categoryFor(recipe)
    distribution[category] = (distribution[category] || 0) + 1
  }
  return Object.fromEntries(Object.keys(distribution).sort().map(key => [key, distribution[key]]))
}

function validateLiveState(manifest, state, contract, phase = 'before') {
  const errors = []
  const before = phase === 'before'
  const recipeById = new Map(state.recipes.map(recipe => [recipe.id, recipe]))
  const metaById = new Map(state.metaDocs.map(meta => [meta.id, meta]))
  const sharedRows = new Map(manifest.sharedRecipeChanges.map(row => [row.recipeID, row]))
  const expectedOverrideRows = before ? [...manifest.overrideChanges, ...manifest.preservedOverrides] : manifest.preservedOverrides

  if (recipeById.size !== state.recipes.length) errors.push('production recipe query contains duplicate document IDs')
  if (metaById.size !== state.metaDocs.length) errors.push('production meta query contains duplicate document IDs')
  if (state.recipes.length !== EXPECTED.sharedDocuments) errors.push(`shared document count: expected ${EXPECTED.sharedDocuments}, observed ${state.recipes.length}`)

  for (const row of manifest.sharedRecipeChanges) {
    const recipe = recipeById.get(row.recipeID)
    if (!recipe) {
      errors.push(`${row.recipeID}: shared document is missing`)
      continue
    }
    if (recipe.data.recipeID !== row.recipeID) errors.push(`${row.recipeID}: stored recipeID is ${JSON.stringify(recipe.data.recipeID)}`)
    const expectedCategory = before ? row.expectedOldCategory : row.proposedCategory
    if (recipe.data.category !== expectedCategory) {
      errors.push(`${row.recipeID}: expected shared category ${JSON.stringify(expectedCategory)}, observed ${JSON.stringify(recipe.data.category)}`)
    }
    if (!contract.isRecipeCategory(row.proposedCategory)) errors.push(`${row.recipeID}: proposed category is noncanonical`)
  }

  for (const row of manifest.overrideChanges) {
    const meta = metaById.get(row.metaDocumentID)
    if (!meta) {
      errors.push(`${row.recipeID}: meta document ${row.metaDocumentID} is missing`)
      continue
    }
    if (recipeIdForMeta(meta) !== row.recipeID) errors.push(`${row.recipeID}: meta recipeID does not match target`)
    const observed = categoryOverride(meta)
    if (before && observed !== row.expectedOverrideCategory) {
      errors.push(`${row.recipeID}: expected override ${JSON.stringify(row.expectedOverrideCategory)}, observed ${JSON.stringify(observed)}`)
    }
    if (!before && observed !== undefined) {
      errors.push(`${row.recipeID}: overrides.category remains present as ${JSON.stringify(observed)}`)
    }
    const shared = recipeById.get(row.recipeID)
    const sharedAfter = shared ? projectedSharedCategory(shared, sharedRows) : undefined
    if (sharedAfter !== row.sharedCategoryAfter) {
      errors.push(`${row.recipeID}: approved shared result ${JSON.stringify(row.sharedCategoryAfter)}, projected ${JSON.stringify(sharedAfter)}`)
    }
  }

  const preserved = manifest.preservedOverrides[0]
  const preservedMeta = metaById.get(preserved.metaDocumentID)
  if (!preservedMeta) errors.push('182: preserved meta document is missing')
  else {
    if (recipeIdForMeta(preservedMeta) !== PRESERVED_OVERRIDE.recipeID) errors.push('182: preserved meta recipeID changed')
    if (categoryOverride(preservedMeta) !== PRESERVED_OVERRIDE.overrideCategory) errors.push(`182: preserved override changed to ${JSON.stringify(categoryOverride(preservedMeta))}`)
  }
  const preservedShared = recipeById.get(PRESERVED_OVERRIDE.recipeID)
  const preservedSharedExpected = before ? PRESERVED_OVERRIDE.sharedBefore : PRESERVED_OVERRIDE.sharedAfter
  if (!preservedShared || preservedShared.data.category !== preservedSharedExpected) {
    errors.push(`182: expected shared category ${JSON.stringify(preservedSharedExpected)}, observed ${JSON.stringify(preservedShared?.data?.category)}`)
  }

  const overrideDocs = categoryOverrideDocs(state.metaDocs)
  const expectedOverrideCount = before ? EXPECTED.categoryOverridesBefore : EXPECTED.preservedOverrides
  if (overrideDocs.length !== expectedOverrideCount) errors.push(`category override count: expected ${expectedOverrideCount}, observed ${overrideDocs.length}`)
  const observedOverrideTargets = overrideDocs.map(meta => `${meta.id}:${recipeIdForMeta(meta)}:${categoryOverride(meta)}`).sort()
  const expectedOverrideTargets = expectedOverrideRows.map(row => `${row.metaDocumentID}:${row.recipeID}:${row.expectedOverrideCategory}`).sort()
  if (JSON.stringify(observedOverrideTargets) !== JSON.stringify(expectedOverrideTargets)) {
    errors.push(`category override population differs; expected ${JSON.stringify(expectedOverrideTargets)}, observed ${JSON.stringify(observedOverrideTargets)}`)
  }

  const projectedDistribution = distributionFor(state.recipes, recipe => before
    ? projectedSharedCategory(recipe, sharedRows)
    : recipe.data.category)
  for (const recipe of state.recipes) {
    const projected = before ? projectedSharedCategory(recipe, sharedRows) : recipe.data.category
    if (!contract.isRecipeCategory(projected)) errors.push(`${recipe.id}: projected/final category ${JSON.stringify(projected)} is noncanonical`)
  }
  if (JSON.stringify(projectedDistribution) !== JSON.stringify(distributionForExpected())) {
    errors.push(`shared category distribution differs; expected ${JSON.stringify(distributionForExpected())}, observed ${JSON.stringify(projectedDistribution)}`)
  }

  return {
    ok: errors.length === 0,
    phase,
    errors,
    sharedDocuments: state.recipes.length,
    categoryOverrides: overrideDocs.length,
    distribution: projectedDistribution,
    sharedReady: before ? manifest.sharedRecipeChanges.filter(row => recipeById.get(row.recipeID)?.data?.category === row.expectedOldCategory).length : 0,
    overrideRemovalsReady: before ? manifest.overrideChanges.filter(row => categoryOverride(metaById.get(row.metaDocumentID)) === row.expectedOverrideCategory).length : 0,
    preservedOverridesVerified: preservedMeta && categoryOverride(preservedMeta) === PRESERVED_OVERRIDE.overrideCategory ? 1 : 0,
  }
}

function distributionForExpected() {
  return Object.fromEntries(Object.keys(EXPECTED_DISTRIBUTION).sort().map(key => [key, EXPECTED_DISTRIBUTION[key]]))
}

function assertLiveState(manifest, state, contract, phase = 'before') {
  const result = validateLiveState(manifest, state, contract, phase)
  assert.equal(result.ok, true, `APPLY BLOCKED — PRECONDITION FAILURE\n${result.errors.join('\n')}`)
  return result
}

function enqueueWrites(transaction, db, manifest, deleteSentinel) {
  let sharedWrites = 0
  let overrideDeletes = 0
  for (const row of manifest.sharedRecipeChanges) {
    transaction.update(db.collection('recipes').doc(row.recipeID), { category: row.proposedCategory })
    sharedWrites += 1
  }
  const metaRoot = db.collection('users').doc(manifest.ownerContext.uid).collection('recipes').doc('root').collection('meta')
  for (const row of manifest.overrideChanges) {
    transaction.update(metaRoot.doc(row.metaDocumentID), { 'overrides.category': deleteSentinel })
    overrideDeletes += 1
  }
  assert.equal(sharedWrites, EXPECTED.sharedWrites)
  assert.equal(overrideDeletes, EXPECTED.overrideDeletes)
  return { sharedWrites, overrideDeletes, totalWrites: sharedWrites + overrideDeletes, preservedOverrideWrites: 0 }
}

function validateAndEnqueueWrites(transaction, db, manifest, state, contract, deleteSentinel) {
  const preflight = assertLiveState(manifest, state, contract, 'before')
  const writes = enqueueWrites(transaction, db, manifest, deleteSentinel)
  return { preflight, ...writes }
}

function stripRecipeCategory(data) {
  const value = stableValue(data)
  delete value.category
  return value
}

function stripOverrideCategory(data) {
  const value = stableValue(data)
  if (value.overrides && typeof value.overrides === 'object') delete value.overrides.category
  return value
}

function safetyProjection(state) {
  return {
    recipesWithoutCategory: state.recipes.map(recipe => ({ id: recipe.id, data: stripRecipeCategory(recipe.data) })),
    metaWithoutOverrideCategory: state.metaDocs.map(meta => ({ id: meta.id, data: stripOverrideCategory(meta.data) })),
    weekPlans: (state.weekPlans || []).map(plan => ({ id: plan.id, data: stableValue(plan.data) })),
  }
}

function compareSafety(beforeState, afterState) {
  const before = safetyProjection(beforeState)
  const after = safetyProjection(afterState)
  return {
    otherRecipeFieldsUnchanged: fingerprint(before.recipesWithoutCategory) === fingerprint(after.recipesWithoutCategory),
    otherMetaFieldsUnchanged: fingerprint(before.metaWithoutOverrideCategory) === fingerprint(after.metaWithoutOverrideCategory),
    weekPlansUnchanged: fingerprint(before.weekPlans) === fingerprint(after.weekPlans),
    beforeFingerprint: fingerprint(before),
    afterFingerprint: fingerprint(after),
  }
}

function buildRevertEvidence({ manifestPath, manifestSha256, repositoryHead, manifest, preflight }) {
  assert.equal(preflight.ok, true, 'cannot generate revert evidence from a failed preflight')
  return {
    generatedAt: new Date().toISOString(),
    purpose: 'Manual recovery evidence only; executing a revert requires separate explicit authorization.',
    approvedManifestPath: manifestPath,
    approvedManifestSha256: manifestSha256,
    preApplyRepositoryHead: repositoryHead,
    sharedCategoryRestores: manifest.sharedRecipeChanges.map(row => ({
      recipeID: row.recipeID,
      beforeCategory: row.expectedOldCategory,
      afterCategory: row.proposedCategory,
    })),
    overrideCategoryRestores: manifest.overrideChanges.map(row => ({
      recipeID: row.recipeID,
      metaDocumentID: row.metaDocumentID,
      beforeOverrideCategory: row.expectedOverrideCategory,
      afterOverrideCategory: 'absent',
    })),
    validation: {
      preflightPassed: true,
      sharedRows: manifest.sharedRecipeChanges.length,
      overrideRows: manifest.overrideChanges.length,
      totalRows: manifest.sharedRecipeChanges.length + manifest.overrideChanges.length,
    },
  }
}

module.exports = {
  APPLY_CONFIRMATION,
  APPROVED_MANIFEST_PATH,
  APPROVED_MANIFEST_SHA256,
  EXPECTED,
  EXPECTED_DISTRIBUTION,
  PRESERVED_OVERRIDE,
  assertLiveState,
  buildRevertEvidence,
  categoryOverride,
  compareSafety,
  distributionFor,
  enqueueWrites,
  fingerprint,
  recipeIdForMeta,
  safetyProjection,
  sha256,
  stableValue,
  validateApprovedManifest,
  validateAndEnqueueWrites,
  validateLiveState,
}
