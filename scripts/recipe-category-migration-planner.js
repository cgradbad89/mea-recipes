'use strict'

const assert = require('node:assert/strict')

const HETEROGENEOUS_LEGACY_VALUES = new Set([
  'Breakfast, Snacks & Sides',
  'Other',
  'Non-Recipe / Notes',
])

const INTENTIONAL_OVERRIDE = Object.freeze({
  recipeIDs: ['182', 'spicy-quinoa-with-sweet-potatoes'],
  title: 'Spicy Quinoa with Sweet Potatoes',
  category: 'Salads & Bowls',
})

function compareRecipeID(a, b) {
  return String(a.recipeID).localeCompare(String(b.recipeID), 'en', { numeric: true })
}

function rawCategory(data) {
  return Object.prototype.hasOwnProperty.call(data, 'category') ? data.category : null
}

function mappingReason(recipeID, expectedOldCategory, proposedCategory, mappingSource) {
  if (recipeID === 'maple-roasted-candied-pecans') {
    return 'Approved content correction encoded for this exact recipe ID: candied pecans are Snacks, not Vegetarian Mains.'
  }
  if (mappingSource === 'recipe-specific-legacy') {
    return `Approved exact recipe-specific compatibility in lib/recipeCategories.ts maps ${JSON.stringify(expectedOldCategory)} to ${JSON.stringify(proposedCategory)} for this recipe ID only.`
  }
  return `Approved deterministic direct alias in lib/recipeCategories.ts maps ${JSON.stringify(expectedOldCategory)} to ${JSON.stringify(proposedCategory)}.`
}

function discoverSharedDecisions(recipes, contract) {
  const decisions = []
  for (const recipe of recipes) {
    const observed = rawCategory(recipe.data)
    const resolution = contract.resolveRecipeCategory(observed, recipe.id)
    if (!resolution) continue
    if (resolution.source === 'canonical' && resolution.category === observed) continue
    decisions.push({
      recipeID: recipe.id,
      title: typeof recipe.data.title === 'string' ? recipe.data.title : '',
      expectedOldCategory: observed,
      proposedCategory: resolution.category,
      mappingSource: resolution.source,
      reason: mappingReason(recipe.id, observed, resolution.category, resolution.source),
    })
  }
  return uniqueSorted(decisions, 'shared decision')
}

function classifyUnexpectedRecipe(recipe, contract) {
  const observed = rawCategory(recipe.data)
  if (typeof observed !== 'string' || observed.trim() === '') {
    return {
      recipeID: recipe.id,
      title: typeof recipe.data.title === 'string' ? recipe.data.title : '',
      observedCategory: observed,
      status: 'MISSING_CATEGORY',
      reason: 'Stored category is missing, blank, or malformed; no migration is proposed.',
    }
  }
  const resolution = contract.resolveRecipeCategory(observed, recipe.id)
  if (resolution?.source === 'canonical') return null
  if (resolution) {
    return {
      recipeID: recipe.id,
      title: typeof recipe.data.title === 'string' ? recipe.data.title : '',
      observedCategory: observed,
      proposedCategory: resolution.category,
      status: 'UNEXPECTED_CATEGORY',
      reason: 'This approved legacy mapping appeared outside the frozen exact decision set; review is required before adding it.',
    }
  }
  if (HETEROGENEOUS_LEGACY_VALUES.has(observed)) {
    return {
      recipeID: recipe.id,
      title: typeof recipe.data.title === 'string' ? recipe.data.title : '',
      observedCategory: observed,
      status: 'UNRESOLVED',
      reason: 'Heterogeneous legacy category has no approved exact recipe-specific mapping.',
    }
  }
  return {
    recipeID: recipe.id,
    title: typeof recipe.data.title === 'string' ? recipe.data.title : '',
    observedCategory: observed,
    status: 'UNEXPECTED_CATEGORY',
    reason: 'Stored category is neither canonical nor an approved compatibility value.',
  }
}

function planSharedRecipes(recipes, decisions, contract) {
  const byId = new Map(recipes.map(recipe => [recipe.id, recipe]))
  assert.equal(byId.size, recipes.length, 'production recipe query contains duplicate document IDs')
  const decisionIds = new Set(decisions.map(decision => decision.recipeID))
  assert.equal(decisionIds.size, decisions.length, 'approved shared decisions contain duplicate recipe IDs')

  const rows = decisions.map(decision => {
    const recipe = byId.get(decision.recipeID)
    const observed = recipe ? rawCategory(recipe.data) : null
    let status
    let reason = decision.reason
    if (!recipe) {
      status = 'PRECONDITION_MISMATCH'
      reason = 'Previously expected recipe document is missing from production.'
    } else if (observed === decision.expectedOldCategory) {
      status = 'READY'
    } else if (observed === decision.proposedCategory) {
      status = 'ALREADY_MIGRATED'
      reason = 'Production already contains the exact approved proposed category; no write is needed.'
    } else {
      status = 'PRECONDITION_MISMATCH'
      reason = `Expected ${JSON.stringify(decision.expectedOldCategory)} but production now contains ${JSON.stringify(observed)}; no inference or write is allowed.`
    }
    return {
      recipeID: decision.recipeID,
      title: recipe && typeof recipe.data.title === 'string' ? recipe.data.title : decision.title,
      expectedOldCategory: decision.expectedOldCategory,
      observedCategory: observed,
      proposedCategory: decision.proposedCategory,
      mappingSource: decision.mappingSource,
      status,
      reason,
    }
  }).sort(compareRecipeID)

  const unexpectedRecords = recipes
    .filter(recipe => !decisionIds.has(recipe.id))
    .map(recipe => classifyUnexpectedRecipe(recipe, contract))
    .filter(Boolean)
    .sort(compareRecipeID)

  return { rows, unexpectedRecords }
}

function getRecipeIDFromMeta(meta) {
  return typeof meta.data.recipeID === 'string' && meta.data.recipeID.trim()
    ? meta.data.recipeID
    : meta.id
}

function getOverrideCategory(meta) {
  const overrides = meta?.data?.overrides
  if (!overrides || typeof overrides !== 'object') return null
  return Object.prototype.hasOwnProperty.call(overrides, 'category') ? overrides.category : null
}

function sharedCategoryAfter(recipeID, sharedById, sharedDecisionById) {
  const shared = sharedById.get(recipeID)
  if (!shared) return { before: null, after: null }
  const before = rawCategory(shared.data)
  const decision = sharedDecisionById.get(recipeID)
  return { before, after: decision?.proposedCategory ?? before }
}

function classifyOverride(meta, sharedById, sharedDecisionById, contract) {
  const recipeID = getRecipeIDFromMeta(meta)
  const observedOverride = getOverrideCategory(meta)
  const shared = sharedCategoryAfter(recipeID, sharedById, sharedDecisionById)
  const canonicalShared = contract.normalizeRecipeCategory(shared.after, recipeID)
  const title = sharedById.get(recipeID)?.data?.title || ''
  let canonicalOverride = contract.normalizeRecipeCategory(observedOverride, recipeID)
  let overrideResolutionSource = canonicalOverride ? 'canonical-category-contract' : null
  // The approved cleanup rule is narrower than a global category alias: when an
  // exact recipe's post-migration shared value is Sides, this historic combined
  // override can only be redundant for that row. It remains unresolved for every
  // other shared category and is never treated as a reusable write alias.
  if (!canonicalOverride && observedOverride === 'Breakfast, Snacks & Sides' && canonicalShared === 'Sides') {
    canonicalOverride = 'Sides'
    overrideResolutionSource = 'exact-redundancy-against-canonical-shared-side'
  }

  const base = {
    recipeID,
    title,
    sharedStoredCategory: shared.before,
    sharedCategoryBefore: shared.before,
    sharedCategoryAfter: shared.after,
    rawOverrideCategory: observedOverride,
    canonicalSharedCategory: canonicalShared,
    canonicalOverrideCategory: canonicalOverride,
    overrideResolutionSource,
  }

  if (observedOverride === null || observedOverride === undefined || observedOverride === '') {
    return { ...base, proposedAction: 'ALREADY_CLEAN', reason: 'No category override is currently stored.' }
  }
  if (!canonicalShared) {
    return { ...base, proposedAction: 'REVIEW', reason: 'Shared category after the approved migration is unresolved.' }
  }
  if (!canonicalOverride) {
    return { ...base, proposedAction: 'REVIEW', reason: 'Override category has no approved canonical meaning.' }
  }
  if ((INTENTIONAL_OVERRIDE.recipeIDs.includes(recipeID) || title === INTENTIONAL_OVERRIDE.title)
      && observedOverride === INTENTIONAL_OVERRIDE.category) {
    return { ...base, proposedAction: 'PRESERVE', reason: 'Explicitly approved intentional personal classification: Spicy Quinoa remains Salads & Bowls.' }
  }
  if (canonicalOverride === canonicalShared) {
    const legacy = observedOverride !== canonicalOverride
    return {
      ...base,
      proposedAction: legacy ? 'REMOVE_LEGACY' : 'REMOVE_REDUNDANT',
      reason: legacy
        ? observedOverride === 'Breakfast, Snacks & Sides'
          ? 'For this exact recipe, the canonical shared category after migration is Sides, so the historic combined override adds no remaining personal distinction.'
          : 'The approved compatibility mapping gives this legacy override the same canonical meaning as the shared category after migration.'
        : 'The canonical override is identical to the shared category after migration and adds no personal distinction.',
    }
  }
  return {
    ...base,
    proposedAction: 'PRESERVE',
    reason: 'The canonical override intentionally differs from the shared category after migration.',
  }
}

function discoverOverrideDecisions(metaDocs, sharedRecipes, sharedDecisions, contract) {
  const sharedById = new Map(sharedRecipes.map(recipe => [recipe.id, recipe]))
  const sharedDecisionById = new Map(sharedDecisions.map(decision => [decision.recipeID, decision]))
  return uniqueSorted(metaDocs
    .map(meta => classifyOverride(meta, sharedById, sharedDecisionById, contract))
    .filter(row => row.proposedAction !== 'ALREADY_CLEAN')
    .map(row => ({
      recipeID: row.recipeID,
      title: row.title,
      expectedOverrideCategory: row.rawOverrideCategory,
      proposedAction: row.proposedAction,
      sharedCategoryBefore: row.sharedCategoryBefore,
      sharedCategoryAfter: row.sharedCategoryAfter,
      reason: row.reason,
    })), 'override decision')
}

function planOverrides(metaDocs, sharedRecipes, sharedDecisions, overrideDecisions, contract) {
  const sharedById = new Map(sharedRecipes.map(recipe => [recipe.id, recipe]))
  const sharedDecisionById = new Map(sharedDecisions.map(decision => [decision.recipeID, decision]))
  const metaByRecipeId = new Map()
  for (const meta of metaDocs) {
    const recipeID = getRecipeIDFromMeta(meta)
    assert.ok(!metaByRecipeId.has(recipeID), `production meta query contains duplicate recipe ID: ${recipeID}`)
    metaByRecipeId.set(recipeID, meta)
  }
  const decisionIds = new Set(overrideDecisions.map(decision => decision.recipeID))
  assert.equal(decisionIds.size, overrideDecisions.length, 'approved override decisions contain duplicate recipe IDs')

  const rows = overrideDecisions.map(decision => {
    const meta = metaByRecipeId.get(decision.recipeID)
    if (!meta || getOverrideCategory(meta) === null || getOverrideCategory(meta) === undefined || getOverrideCategory(meta) === '') {
      const shared = sharedCategoryAfter(decision.recipeID, sharedById, sharedDecisionById)
      return {
        recipeID: decision.recipeID,
        title: decision.title,
        expectedOverrideCategory: decision.expectedOverrideCategory,
        observedOverrideCategory: null,
        sharedCategoryBefore: shared.before,
        sharedCategoryAfter: shared.after,
        status: decision.proposedAction === 'REMOVE_LEGACY' || decision.proposedAction === 'REMOVE_REDUNDANT'
          ? 'ALREADY_CLEAN'
          : 'PRECONDITION_MISMATCH',
        proposedAction: decision.proposedAction === 'REMOVE_LEGACY' || decision.proposedAction === 'REMOVE_REDUNDANT'
          ? 'ALREADY_CLEAN'
          : 'REVIEW',
        reason: decision.proposedAction === 'REMOVE_LEGACY' || decision.proposedAction === 'REMOVE_REDUNDANT'
          ? 'The exact previously proposed override is no longer present; no delete is needed.'
          : 'A previously preserved override is no longer present; review the production drift.',
      }
    }

    const observed = getOverrideCategory(meta)
    if (observed !== decision.expectedOverrideCategory) {
      const shared = sharedCategoryAfter(decision.recipeID, sharedById, sharedDecisionById)
      return {
        recipeID: decision.recipeID,
        title: sharedById.get(decision.recipeID)?.data?.title || decision.title,
        expectedOverrideCategory: decision.expectedOverrideCategory,
        observedOverrideCategory: observed,
        sharedCategoryBefore: shared.before,
        sharedCategoryAfter: shared.after,
        status: 'PRECONDITION_MISMATCH',
        proposedAction: 'REVIEW',
        reason: `Expected override ${JSON.stringify(decision.expectedOverrideCategory)} but production now contains ${JSON.stringify(observed)}; no delete is allowed.`,
      }
    }

    const semantic = classifyOverride(meta, sharedById, sharedDecisionById, contract)
    const sameDecision = semantic.proposedAction === decision.proposedAction
    return {
      recipeID: semantic.recipeID,
      title: semantic.title || decision.title,
      expectedOverrideCategory: decision.expectedOverrideCategory,
      observedOverrideCategory: semantic.rawOverrideCategory,
      sharedCategoryBefore: semantic.sharedCategoryBefore,
      sharedCategoryAfter: semantic.sharedCategoryAfter,
      canonicalSharedCategory: semantic.canonicalSharedCategory,
      canonicalOverrideCategory: semantic.canonicalOverrideCategory,
      status: !sameDecision ? 'PRECONDITION_MISMATCH'
        : semantic.proposedAction === 'PRESERVE' ? 'PRESERVED'
          : semantic.proposedAction === 'REVIEW' ? 'REVIEW'
            : 'READY',
      proposedAction: sameDecision ? semantic.proposedAction : 'REVIEW',
      reason: sameDecision
        ? semantic.reason
        : `Semantic result changed from ${decision.proposedAction} to ${semantic.proposedAction}; review is required.`,
    }
  }).sort(compareRecipeID)

  const unexpectedOverrides = metaDocs
    .filter(meta => {
      const category = getOverrideCategory(meta)
      return category !== null && category !== undefined && category !== '' && !decisionIds.has(getRecipeIDFromMeta(meta))
    })
    .map(meta => {
      const semantic = classifyOverride(meta, sharedById, sharedDecisionById, contract)
      return {
        ...semantic,
        status: 'REVIEW',
        proposedAction: 'REVIEW',
        reason: 'Category override appeared outside the frozen exact decision set; review is required.',
      }
    })
    .sort(compareRecipeID)

  return { rows, unexpectedOverrides }
}

function uniqueSorted(rows, label) {
  const sorted = [...rows].sort(compareRecipeID)
  const ids = new Set()
  for (const row of sorted) {
    assert.ok(row.recipeID && typeof row.recipeID === 'string', `${label} requires recipeID`)
    assert.ok(!ids.has(row.recipeID), `duplicate ${label} recipe ID: ${row.recipeID}`)
    ids.add(row.recipeID)
  }
  return sorted
}

function buildSummaries(sharedPlan, overridePlan) {
  const sharedRecipeSummary = {
    ready: sharedPlan.rows.filter(row => row.status === 'READY').length,
    alreadyMigrated: sharedPlan.rows.filter(row => row.status === 'ALREADY_MIGRATED').length,
    preconditionMismatch: sharedPlan.rows.filter(row => row.status === 'PRECONDITION_MISMATCH').length,
    unresolved: sharedPlan.unexpectedRecords.filter(row => row.status === 'UNRESOLVED' || row.status === 'MISSING_CATEGORY').length,
    unexpected: sharedPlan.unexpectedRecords.filter(row => row.status === 'UNEXPECTED_CATEGORY').length,
  }
  const overrideSummary = {
    proposedRemovals: overridePlan.rows.filter(row => row.status === 'READY' && (row.proposedAction === 'REMOVE_LEGACY' || row.proposedAction === 'REMOVE_REDUNDANT')).length,
    alreadyClean: overridePlan.rows.filter(row => row.status === 'ALREADY_CLEAN').length,
    preserved: overridePlan.rows.filter(row => row.status === 'PRESERVED').length,
    reviewRequired: overridePlan.rows.filter(row => row.status === 'REVIEW').length + overridePlan.unexpectedOverrides.length,
    preconditionMismatch: overridePlan.rows.filter(row => row.status === 'PRECONDITION_MISMATCH').length,
  }
  return { sharedRecipeSummary, overrideSummary }
}

function determineGate(sharedPlan, overridePlan) {
  if (sharedPlan.rows.some(row => row.status === 'PRECONDITION_MISMATCH') || overridePlan.rows.some(row => row.status === 'PRECONDITION_MISMATCH') || sharedPlan.unexpectedRecords.some(row => row.status === 'UNEXPECTED_CATEGORY')) {
    return 'NOT READY — PRODUCTION DRIFT DETECTED'
  }
  if (sharedPlan.unexpectedRecords.some(row => row.status === 'UNRESOLVED' || row.status === 'MISSING_CATEGORY')) {
    return 'NOT READY — UNRESOLVED CATEGORY DATA'
  }
  if (overridePlan.rows.some(row => row.status === 'REVIEW') || overridePlan.unexpectedOverrides.length > 0) {
    return 'NOT READY — OVERRIDE CLEANUP AMBIGUITY'
  }
  return 'READY FOR HUMAN MIGRATION REVIEW'
}

function validateManifest(manifest, contract) {
  assert.deepEqual(manifest.canonicalCategories, [...contract.RECIPE_CATEGORIES], 'manifest canonical categories differ from production contract')
  assert.equal(new Set(manifest.canonicalCategories).size, 12, 'canonical category contract must contain 12 unique values')
  const canonical = new Set(contract.RECIPE_CATEGORIES)

  uniqueSorted(manifest.sharedRecipeChanges, 'manifest shared row')
  uniqueSorted(manifest.overrideChanges, 'manifest override removal row')
  uniqueSorted(manifest.preservedOverrides, 'manifest preserved override row')

  for (const row of manifest.sharedRecipeChanges) {
    assert.ok(canonical.has(row.proposedCategory), `${row.recipeID}: proposed shared category is not canonical`)
    if (row.status === 'READY') {
      assert.equal(typeof row.expectedOldCategory, 'string', `${row.recipeID}: READY row lacks exact expected old category`)
      assert.equal(row.observedCategory, row.expectedOldCategory, `${row.recipeID}: READY old-value precondition does not match observation`)
      const resolution = contract.resolveRecipeCategory(row.expectedOldCategory, row.recipeID)
      assert.equal(resolution?.category, row.proposedCategory, `${row.recipeID}: proposal differs from canonical helper`)
      assert.ok(row.expectedOldCategory !== row.proposedCategory, `${row.recipeID}: canonical no-op accidentally proposed`)
    }
  }

  const deletionIds = new Set()
  for (const row of manifest.overrideChanges) {
    assert.ok(row.expectedOverrideCategory !== null && row.expectedOverrideCategory !== undefined, `${row.recipeID}: override removal lacks expected value`)
    assert.equal(row.observedOverrideCategory, row.expectedOverrideCategory, `${row.recipeID}: override removal precondition does not match observation`)
    assert.ok(row.proposedAction === 'REMOVE_LEGACY' || row.proposedAction === 'REMOVE_REDUNDANT', `${row.recipeID}: non-removal row in overrideChanges`)
    assert.equal(row.canonicalOverrideCategory, row.canonicalSharedCategory, `${row.recipeID}: proposed removal is not semantically redundant`)
    deletionIds.add(row.recipeID)
  }
  for (const row of manifest.preservedOverrides) {
    assert.ok(!deletionIds.has(row.recipeID), `${row.recipeID}: preserved override also appears in deletion set`)
  }

  const s = manifest.sharedRecipeSummary
  assert.equal(s.ready + s.alreadyMigrated + s.preconditionMismatch, manifest.sharedRecipeChanges.length, 'shared summary does not reconcile')
  const allUnexpected = manifest.unexpectedRecords.filter(row => row.recordType === 'sharedRecipe')
  assert.equal(s.unresolved + s.unexpected, allUnexpected.length, 'shared unexpected summary does not reconcile')
  assert.equal(manifest.overrideSummary.proposedRemovals, manifest.overrideChanges.length, 'override removal summary does not reconcile')
  assert.equal(manifest.overrideSummary.preserved, manifest.preservedOverrides.length, 'preserved override summary does not reconcile')
  return true
}

module.exports = {
  HETEROGENEOUS_LEGACY_VALUES,
  INTENTIONAL_OVERRIDE,
  buildSummaries,
  classifyOverride,
  determineGate,
  discoverOverrideDecisions,
  discoverSharedDecisions,
  getOverrideCategory,
  planOverrides,
  planSharedRecipes,
  validateManifest,
}
