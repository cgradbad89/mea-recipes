import { describe, expect, it } from 'vitest'

import {
  RECIPE_CATEGORIES,
  normalizeRecipeCategory,
  resolveRecipeCategory,
} from '@/lib/recipeCategories'

const planner = require('../scripts/recipe-category-migration-planner.js')
const migrationScript = require('../scripts/migrate-recipe-categories.js')

const contract = { RECIPE_CATEGORIES, normalizeRecipeCategory, resolveRecipeCategory }

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

  it('has no apply CLI mode', () => {
    expect(() => migrationScript.parseArgs(['--apply'])).toThrow(/not implemented/)
  })
})
