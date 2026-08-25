import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import {
  RECIPE_CATEGORIES,
  normalizeRecipeCategory,
  resolveRecipeCategory,
} from '@/lib/recipeCategories'

const planner = require('../scripts/recipe-category-migration-planner.js')
const migrationScript = require('../scripts/migrate-recipe-categories.js')
const applySupport = require('../scripts/recipe-category-migration-apply.js')

const contract = { RECIPE_CATEGORIES, normalizeRecipeCategory, resolveRecipeCategory }
const applyContract = {
  ...contract,
  isRecipeCategory: (value: unknown) => RECIPE_CATEGORIES.includes(value as any),
}
const approvedManifest = JSON.parse(fs.readFileSync(
  path.join(process.cwd(), 'docs/audits/recipe-category-migration-dryrun-2026-08-25.json'),
  'utf8',
))

function recipe(id: string, category?: unknown, title = id) {
  const data: Record<string, unknown> = { title }
  if (category !== undefined) data.category = category
  return { id, data, updateTime: null }
}

function meta(recipeID: string, category?: unknown) {
  const data: Record<string, unknown> = { recipeID }
  if (category !== undefined) data.overrides = { category }
  return { id: recipeID, data, updateTime: null }
}

describe('recipe category migration shared planning', () => {
  it('leaves a canonical category out of the write set', () => {
    expect(planner.discoverSharedDecisions([recipe('canonical', 'Seafood')], contract)).toEqual([])
  })

  it('turns a direct alias into an exact approved decision', () => {
    const [decision] = planner.discoverSharedDecisions([recipe('chicken-dish', 'Chicken')], contract)
    expect(decision).toMatchObject({
      recipeID: 'chicken-dish', expectedOldCategory: 'Chicken', proposedCategory: 'Chicken & Poultry',
      mappingSource: 'direct-legacy-alias',
    })
  })

  it('resolves a mixed legacy value only for an approved exact recipe ID', () => {
    const [decision] = planner.discoverSharedDecisions([recipe('bread', 'Breakfast, Snacks & Sides')], contract)
    expect(decision.proposedCategory).toBe('Sides')
    const plan = planner.planSharedRecipes([recipe('unknown', 'Breakfast, Snacks & Sides')], [], contract)
    expect(plan.unexpectedRecords[0].status).toBe('UNRESOLVED')
  })

  it('resolves Other only for an approved exact recipe ID', () => {
    const [decision] = planner.discoverSharedDecisions([recipe('167', 'Other')], contract)
    expect(decision.proposedCategory).toBe('Snacks')
    const plan = planner.planSharedRecipes([recipe('168', 'Other')], [], contract)
    expect(plan.unexpectedRecords[0].status).toBe('UNRESOLVED')
  })

  it('includes the approved candied-pecans content correction despite a canonical-looking old value', () => {
    const [decision] = planner.discoverSharedDecisions([
      recipe('maple-roasted-candied-pecans', 'Vegetarian Mains'),
    ], contract)
    expect(decision).toMatchObject({ expectedOldCategory: 'Vegetarian Mains', proposedCategory: 'Snacks' })
  })

  it('marks an exact old-value match READY', () => {
    const recipes = [recipe('dish', 'Chicken')]
    const decisions = planner.discoverSharedDecisions(recipes, contract)
    expect(planner.planSharedRecipes(recipes, decisions, contract).rows[0].status).toBe('READY')
  })

  it('fails closed when the old value changed', () => {
    const decisions = planner.discoverSharedDecisions([recipe('dish', 'Chicken')], contract)
    const row = planner.planSharedRecipes([recipe('dish', 'Sides')], decisions, contract).rows[0]
    expect(row.status).toBe('PRECONDITION_MISMATCH')
    expect(row.observedCategory).toBe('Sides')
  })

  it('recognizes an exact approved new value as ALREADY_MIGRATED', () => {
    const decisions = planner.discoverSharedDecisions([recipe('dish', 'Chicken')], contract)
    const row = planner.planSharedRecipes([recipe('dish', 'Chicken & Poultry')], decisions, contract).rows[0]
    expect(row.status).toBe('ALREADY_MIGRATED')
  })

  it('distinguishes missing and unknown category data', () => {
    const plan = planner.planSharedRecipes([
      recipe('missing'),
      recipe('unknown', 'Dessert'),
    ], [], contract)
    expect(plan.unexpectedRecords.map((row: any) => row.status).sort()).toEqual(['MISSING_CATEGORY', 'UNEXPECTED_CATEGORY'])
  })

  it('never falls back to Chicken for arbitrary input', () => {
    const plan = planner.planSharedRecipes([recipe('mystery', 'Totally New')], [], contract)
    expect(plan.unexpectedRecords[0]).not.toHaveProperty('proposedCategory')
    expect(plan.unexpectedRecords[0].status).toBe('UNEXPECTED_CATEGORY')
  })
})

describe('recipe category migration override planning', () => {
  it('proposes legacy removal when the override becomes semantically redundant', () => {
    const recipes = [recipe('side-dish', 'Sides')]
    const shared = planner.discoverSharedDecisions(recipes, contract)
    const result = planner.classifyOverride(meta('side-dish', 'Breakfast, Snacks & Sides'), new Map(recipes.map(r => [r.id, r])), new Map(shared.map((d: any) => [d.recipeID, d])), contract)
    expect(result).toMatchObject({
      proposedAction: 'REMOVE_LEGACY',
      canonicalSharedCategory: 'Sides',
      canonicalOverrideCategory: 'Sides',
      overrideResolutionSource: 'exact-redundancy-against-canonical-shared-side',
    })
  })

  it('proposes redundant removal for an identical canonical override', () => {
    const recipes = [recipe('soup', 'Soups, Stews & Chili')]
    const result = planner.classifyOverride(meta('soup', 'Soups, Stews & Chili'), new Map(recipes.map(r => [r.id, r])), new Map(), contract)
    expect(result.proposedAction).toBe('REMOVE_REDUNDANT')
  })

  it('preserves the approved Spicy Quinoa override', () => {
    const recipes = [recipe('182', 'Vegetarian Mains', 'Spicy Quinoa with Sweet Potatoes')]
    const result = planner.classifyOverride(meta('182', 'Salads & Bowls'), new Map(recipes.map(r => [r.id, r])), new Map(), contract)
    expect(result).toMatchObject({ proposedAction: 'PRESERVE', canonicalOverrideCategory: 'Salads & Bowls' })
    expect(result.reason).toMatch(/Explicitly approved intentional/)
  })

  it('turns a changed override into a mismatch and REVIEW', () => {
    const recipes = [recipe('soup', 'Soups, Stews & Chili')]
    const decisions = planner.discoverOverrideDecisions([meta('soup', 'Soups, Stews & Chili')], recipes, [], contract)
    const row = planner.planOverrides([meta('soup', 'Other')], recipes, [], decisions, contract).rows[0]
    expect(row).toMatchObject({ status: 'PRECONDITION_MISMATCH', proposedAction: 'REVIEW' })
  })

  it('sends an unknown override to REVIEW', () => {
    const recipes = [recipe('soup', 'Soups, Stews & Chili')]
    const result = planner.classifyOverride(meta('soup', 'Dessert'), new Map(recipes.map(r => [r.id, r])), new Map(), contract)
    expect(result.proposedAction).toBe('REVIEW')
  })

  it('treats a missing override as already clean with no action', () => {
    const recipes = [recipe('soup', 'Soups, Stews & Chili')]
    const result = planner.classifyOverride(meta('soup'), new Map(recipes.map(r => [r.id, r])), new Map(), contract)
    expect(result.proposedAction).toBe('ALREADY_CLEAN')
  })
})

describe('recipe category migration manifest safety', () => {
  function validManifest(): any {
    const shared = planner.planSharedRecipes(
      [recipe('a', 'Chicken'), recipe('b', 'Beef')],
      planner.discoverSharedDecisions([recipe('b', 'Beef'), recipe('a', 'Chicken')], contract),
      contract,
    )
    const recipes = [recipe('a', 'Chicken'), recipe('b', 'Beef')]
    const overrideDecision = planner.discoverOverrideDecisions([meta('a', 'Chicken & Poultry')], recipes, shared.rows, contract)
    const overrides = planner.planOverrides([meta('a', 'Chicken & Poultry')], recipes, shared.rows, overrideDecision, contract)
    const summaries = planner.buildSummaries(shared, overrides)
    const removal = overrides.rows.map((row: any) => ({ ...row, canonicalSharedCategory: 'Chicken & Poultry', canonicalOverrideCategory: 'Chicken & Poultry' }))
    return {
      canonicalCategories: [...RECIPE_CATEGORIES],
      sharedRecipeSummary: summaries.sharedRecipeSummary,
      sharedRecipeChanges: shared.rows,
      overrideSummary: summaries.overrideSummary,
      overrideChanges: removal,
      preservedOverrides: [],
      unexpectedRecords: [],
    }
  }

  it('orders shared and override decisions deterministically', () => {
    const shared = planner.discoverSharedDecisions([recipe('10', 'Chicken'), recipe('2', 'Beef')], contract)
    const overrides = planner.discoverOverrideDecisions(
      [meta('10', 'Chicken & Poultry'), meta('2', 'Beef & Pork')],
      [recipe('10', 'Chicken'), recipe('2', 'Beef')], shared, contract,
    )
    expect(shared.map((row: any) => row.recipeID)).toEqual(['2', '10'])
    expect(overrides.map((row: any) => row.recipeID)).toEqual(['2', '10'])
  })

  it('rejects duplicate recipe and override rows', () => {
    const manifest = validManifest()
    manifest.sharedRecipeChanges.push({ ...manifest.sharedRecipeChanges[0] })
    expect(() => planner.validateManifest(manifest, contract)).toThrow(/duplicate manifest shared row/)
  })

  it('reconciles totals and requires expected old values on every apply-capable row', () => {
    const manifest = validManifest()
    expect(planner.validateManifest(manifest, contract)).toBe(true)
    manifest.sharedRecipeChanges[0].expectedOldCategory = null
    expect(() => planner.validateManifest(manifest, contract)).toThrow(/lacks exact expected old category/)
  })

  it('rejects a preserved override that also appears in the deletion set', () => {
    const manifest = validManifest()
    manifest.preservedOverrides = [{ ...manifest.overrideChanges[0] }]
    manifest.overrideSummary.preserved = 1
    expect(() => planner.validateManifest(manifest, contract)).toThrow(/also appears in deletion set/)
  })

  it('rejects a removal whose override is not redundant after shared migration', () => {
    const manifest = validManifest()
    manifest.overrideChanges[0].canonicalOverrideCategory = 'Sides'
    expect(() => planner.validateManifest(manifest, contract)).toThrow(/not semantically redundant/)
  })

  it('keeps default invocation in dry-run mode', () => {
    expect(migrationScript.parseArgs([])).toMatchObject({ apply: false })
  })

  it('refuses apply without a manifest', () => {
    expect(() => migrationScript.parseArgs([
      '--apply', '--confirm', applySupport.APPLY_CONFIRMATION,
    ])).toThrow(/--manifest is required/)
  })

  it('refuses apply without confirmation', () => {
    expect(() => migrationScript.parseArgs([
      '--apply', '--manifest', applySupport.APPROVED_MANIFEST_PATH,
    ])).toThrow(/--confirm is required/)
  })

  it('refuses an incorrect apply confirmation', () => {
    expect(() => migrationScript.parseArgs([
      '--apply', '--manifest', applySupport.APPROVED_MANIFEST_PATH, '--confirm', 'WRONG',
    ])).toThrow(/--confirm must equal/)
  })

  it('refuses apply concepts when --apply is missing', () => {
    expect(() => migrationScript.parseArgs([
      '--manifest', applySupport.APPROVED_MANIFEST_PATH,
    ])).toThrow(/require explicit --apply/)
  })

  it('refuses malformed manifest JSON', () => {
    expect(() => migrationScript.parseManifestContents('{broken')).toThrow(/malformed manifest JSON/)
  })
})

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

function approvedState(phase: 'before' | 'after' = 'before') {
  const proposedCounts = new Map<string, number>()
  const recipes = approvedManifest.sharedRecipeChanges.map((row: any) => {
    proposedCounts.set(row.proposedCategory, (proposedCounts.get(row.proposedCategory) || 0) + 1)
    return recipe(row.recipeID, phase === 'before' ? row.expectedOldCategory : row.proposedCategory, row.title)
  })
  for (const item of recipes) item.data.recipeID = item.id
  const recipeIds = new Set(recipes.map((item: any) => item.id))
  for (const row of [...approvedManifest.overrideChanges, ...approvedManifest.preservedOverrides]) {
    if (recipeIds.has(row.recipeID)) continue
    const item = recipe(
      row.recipeID,
      phase === 'before' ? row.sharedCategoryBefore : row.sharedCategoryAfter,
      row.title,
    )
    item.data.recipeID = item.id
    recipes.push(item)
    recipeIds.add(item.id)
    proposedCounts.set(row.sharedCategoryAfter, (proposedCounts.get(row.sharedCategoryAfter) || 0) + 1)
  }
  for (const [category, expectedCount] of Object.entries(applySupport.EXPECTED_DISTRIBUTION)) {
    const remaining = Number(expectedCount) - (proposedCounts.get(category) || 0)
    expect(remaining).toBeGreaterThanOrEqual(0)
    for (let index = 0; index < remaining; index += 1) {
      const item = recipe(`filler-${category}-${index}`, category)
      item.data.recipeID = item.id
      item.data.defaultRole = category === 'Sides' ? 'side' : 'main'
      recipes.push(item)
    }
  }
  const metaDocs = approvedManifest.overrideChanges.map((row: any) => ({
    id: row.metaDocumentID,
    data: {
      recipeID: row.recipeID,
      note: `keep-${row.recipeID}`,
      overrides: phase === 'before'
        ? { category: row.expectedOverrideCategory, servings: 6 }
        : { servings: 6 },
    },
    updateTime: null,
  }))
  const preserved = approvedManifest.preservedOverrides[0]
  metaDocs.push({
    id: preserved.metaDocumentID,
    data: {
      recipeID: preserved.recipeID,
      rating: 5,
      overrides: { category: preserved.expectedOverrideCategory, servings: 4 },
    },
    updateTime: null,
  })
  return { recipes, metaDocs, weekPlans: [] }
}

function fakeDb() {
  function collection(refPath: string): any {
    return {
      path: refPath,
      doc(id: string) {
        const docPath = `${refPath}/${id}`
        return {
          path: docPath,
          collection(name: string) { return collection(`${docPath}/${name}`) },
        }
      },
    }
  }
  return { collection }
}

describe('recipe category exact-manifest apply validation', () => {
  it('accepts only the committed exact 66 + 24 + 1 approved population', () => {
    expect(applySupport.validateApprovedManifest(
      approvedManifest, applyContract, approvedManifest.ownerContext.uid,
    )).toMatchObject({ ownerUid: approvedManifest.ownerContext.uid })
  })

  it('rejects a duplicate mutation target', () => {
    const manifest = clone(approvedManifest)
    manifest.sharedRecipeChanges[1] = clone(manifest.sharedRecipeChanges[0])
    expect(() => applySupport.validateApprovedManifest(
      manifest, applyContract, manifest.ownerContext.uid,
    )).toThrow(/duplicate mutation target/)
  })

  it('rejects a noncanonical proposed category', () => {
    const manifest = clone(approvedManifest)
    manifest.sharedRecipeChanges[0].proposedCategory = 'Dessert'
    expect(() => applySupport.validateApprovedManifest(
      manifest, applyContract, manifest.ownerContext.uid,
    )).toThrow(/noncanonical/)
  })

  it('accepts exact live old values as a writable 90-operation plan', () => {
    const result = applySupport.validateLiveState(approvedManifest, approvedState(), applyContract, 'before')
    expect(result).toMatchObject({ ok: true, sharedReady: 66, overrideRemovalsReady: 24, preservedOverridesVerified: 1 })
  })

  it('blocks the complete migration when one shared category changed', () => {
    const state = approvedState()
    state.recipes.find((item: any) => item.id === approvedManifest.sharedRecipeChanges[0].recipeID)!.data.category = 'Seafood'
    expect(applySupport.validateLiveState(approvedManifest, state, applyContract, 'before').ok).toBe(false)
  })

  it('blocks a missing shared document', () => {
    const state = approvedState()
    state.recipes = state.recipes.filter((item: any) => item.id !== approvedManifest.sharedRecipeChanges[0].recipeID)
    expect(applySupport.validateLiveState(approvedManifest, state, applyContract, 'before').errors.join('\n')).toMatch(/shared document is missing/)
  })

  it('blocks an already-migrated shared row during the first approved apply', () => {
    const state = approvedState()
    const row = approvedManifest.sharedRecipeChanges[0]
    state.recipes.find((item: any) => item.id === row.recipeID)!.data.category = row.proposedCategory
    expect(applySupport.validateLiveState(approvedManifest, state, applyContract, 'before').ok).toBe(false)
  })

  it('blocks a changed override', () => {
    const state = approvedState()
    state.metaDocs[0].data.overrides.category = 'Seafood'
    expect(applySupport.validateLiveState(approvedManifest, state, applyContract, 'before').ok).toBe(false)
  })

  it('blocks a missing override', () => {
    const state = approvedState()
    delete state.metaDocs[0].data.overrides.category
    expect(applySupport.validateLiveState(approvedManifest, state, applyContract, 'before').ok).toBe(false)
  })

  it('blocks a changed preserved Spicy Quinoa override', () => {
    const state = approvedState()
    state.metaDocs.find((item: any) => item.id === '182')!.data.overrides.category = 'Vegetarian Mains'
    expect(applySupport.validateLiveState(approvedManifest, state, applyContract, 'before').errors.join('\n')).toMatch(/182: preserved override changed/)
  })

  it('enqueues zero writes after any failed precondition', () => {
    const state = approvedState()
    state.recipes[0].data.category = 'Seafood'
    const writes: any[] = []
    const transaction = { update: (...args: any[]) => writes.push(args) }
    expect(() => applySupport.validateAndEnqueueWrites(
      transaction, fakeDb(), approvedManifest, state, applyContract, Symbol('delete'),
    )).toThrow(/APPLY BLOCKED/)
    expect(writes).toHaveLength(0)
  })

  it('enqueues exactly 66 category updates and 24 nested deletes with no preserved write', () => {
    const writes: any[] = []
    const deleteSentinel = Symbol('delete')
    const transaction = { update: (...args: any[]) => writes.push(args) }
    const result = applySupport.validateAndEnqueueWrites(
      transaction, fakeDb(), approvedManifest, approvedState(), applyContract, deleteSentinel,
    )
    expect(result).toMatchObject({ sharedWrites: 66, overrideDeletes: 24, totalWrites: 90, preservedOverrideWrites: 0 })
    expect(writes.filter(([, payload]) => Object.keys(payload).join() === 'category')).toHaveLength(66)
    const deletes = writes.filter(([, payload]) => Object.keys(payload).join() === 'overrides.category')
    expect(deletes).toHaveLength(24)
    expect(deletes.every(([, payload]) => payload['overrides.category'] === deleteSentinel)).toBe(true)
    expect(writes.some(([ref]) => ref.path.endsWith('/meta/182'))).toBe(false)
  })

  it('post-apply validation requires all 90 readbacks and preserves override siblings', () => {
    const state = approvedState('after')
    const result = applySupport.validateLiveState(approvedManifest, state, applyContract, 'after')
    expect(result).toMatchObject({ ok: true, sharedDocuments: 236, categoryOverrides: 1, preservedOverridesVerified: 1 })
    expect(state.metaDocs[0].data).toMatchObject({ note: expect.stringMatching(/^keep-/), overrides: { servings: 6 } })
    expect(state.metaDocs.find((item: any) => item.id === '182')!.data.overrides.category).toBe('Salads & Bowls')
  })
})
