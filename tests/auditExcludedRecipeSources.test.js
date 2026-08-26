import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  REMEDIATION_SPECS,
  RULES,
  ruleSimulation,
  simulateInstructions,
} from '../scripts/audit-excluded-recipe-sources.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/audits/cooking-step-mapping-dryrun-v4-2026-08-26.json'), 'utf8'))
const audit = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/audits/excluded-recipe-source-parser-audit-2026-08-26.json'), 'utf8'))
const validation = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/audits/excluded-recipe-parser-wave1a-validation-2026-08-26.json'), 'utf8'))

describe('excluded recipe source/parser audit', () => {
  it('covers exactly the 49 manifest-defined exclusions in deterministic recipe-id order', () => {
    const expected = manifest.filter(row => row.classification === 'EXCLUDED').map(row => row.recipeId).sort()
    const actual = audit.recipes.map(row => row.recipeId)
    expect(expected).toHaveLength(49)
    expect(Object.keys(REMEDIATION_SPECS).sort()).toEqual(expected)
    expect(actual).toEqual(expected)
  })

  it('has one deterministic disposition and primary defect per recipe', () => {
    expect(audit.summary.primaryDefects).toEqual({
      PARSER_DEFECT: 28,
      SOURCE_AND_PARSER_DEFECT: 6,
      SOURCE_DEFECT: 15,
    })
    expect(audit.summary.dispositions).toEqual({
      DATA_FIX_ONLY: 7,
      MANUAL_SOURCE_REQUIRED: 1,
      PARSER_AND_DATA_FIX: 6,
      PARSER_FIX_ONLY: 28,
      PRODUCT_DECISION_REQUIRED: 2,
      REIMPORT_REQUIRED: 5,
    })
    expect(audit.recipes.every(row => row.defects[0].type === row.primaryDefect)).toBe(true)
  })

  it('contains no production-write path or apply mode', () => {
    const source = fs.readFileSync(path.join(ROOT, 'scripts/audit-excluded-recipe-sources.mjs'), 'utf8')
    expect(source.match(/\.collection\('recipes'\)\.get\(\)/g)).toHaveLength(1)
    expect(source).not.toMatch(/\.doc\s*\(/)
    expect(source).not.toMatch(/\.batch\s*\(|bulkWriter|runTransaction|FieldValue|setDoc|updateDoc|deleteDoc/)
    expect(source).not.toMatch(/--apply|apply=true/)
  })

  it('keeps the Wave 1A validator read-only and free of mapping/AI execution', () => {
    const source = fs.readFileSync(path.join(ROOT, 'scripts/validate-excluded-recipe-parser-wave1a.mjs'), 'utf8')
    expect(source.match(/\.collection\('recipes'\)\.get\(\)/g)).toHaveLength(1)
    expect(source).not.toMatch(/\.doc\s*\(|\.batch\s*\(|bulkWriter|runTransaction|FieldValue|setDoc|updateDoc|deleteDoc/)
    expect(source).not.toMatch(/generateText|generateObject|AI_GATEWAY|buildHashedDeterministicCookingStepMap|--apply|apply=true/)
  })

  it('locks the live all-236 Wave 1A safety result and excluded-population outcome', () => {
    expect(validation.productionBaseline).toEqual({
      sharedRecipes: 236,
      mappedRecipes: 187,
      excludedRecipes: 49,
      existingMappedHashMismatches: 0,
    })
    expect(validation.allCorpusImpact).toEqual({
      NO_CHANGE: 200,
      EXPECTED_EXCLUDED_REPAIR: 36,
      UNEXPECTED_CHANGE: 0,
      unexpectedRecipeIds: [],
      missingExpectedRecipeIds: [],
    })
    expect(validation.mappedCorpusSafety).toEqual({
      ingredientArrayChanges: 0,
      instructionArrayChanges: 0,
      sourceHashChanges: 0,
      currentStoredSourceHashMismatches: 0,
      persistedMapInvalidations: 0,
    })
    expect(validation.excludedRecipeResults.previouslyExcluded).toBe(49)
    expect(validation.excludedRecipeResults.excludedRecipesImproved).toBe(36)
    expect(validation.excludedRecipeResults.parserOnlyRepaired).toBe(28)
    expect(validation.excludedRecipeResults.stillExcluded).toBe(21)
    expect(validation.excludedRecipeResults.affectedRecipes).toHaveLength(36)
    expect(validation.parserVersion).toEqual({ value: 'recipe-content-v1', retained: true })
    expect(validation.productionMutation).toEqual({ firestoreWrites: 0, recipeWrites: 0, mapWrites: 0, aiCalls: 0 })
  })

  it('simulations are pure and deterministic', () => {
    const content = 'INGREDIENTS\n1 cup rice\nINSTRUCTIONS\nStep 1\nCook the rice until tender.\nhttps://example.com/source'
    const original = `${content}`
    const first = simulateInstructions(content, ['STANDALONE_URL_FILTER'])
    const second = simulateInstructions(content, ['STANDALONE_URL_FILTER'])
    expect(first).toEqual(['Cook the rice until tender.'])
    expect(second).toEqual(first)
    expect(content).toBe(original)

    const recipes = [{ id: 'fixture', content, cookingStepIngredientMap: { sourceHash: 'fixture' } }]
    const parsedById = new Map([['fixture', { ingredients: ['1 cup rice'], instructions: ['Cook the rice until tender.', 'https://example.com/source'] }]])
    const excluded = new Set(['fixture'])
    expect(ruleSimulation(recipes, parsedById, excluded, 'STANDALONE_URL_FILTER'))
      .toEqual(ruleSimulation(recipes, parsedById, excluded, 'STANDALONE_URL_FILTER'))
  })

  it('locks mapped-corpus impact for every recommended rule', () => {
    const simulations = new Map(audit.parserRuleSimulations.map(rule => [rule.rule, rule]))
    for (const name of audit.recommendedSafeParserPackage) {
      expect(RULES[name].recommendation).toBe('IMPLEMENT')
      expect(simulations.get(name).mappedRecipesChanged).toBe(0)
      expect(simulations.get(name).sourceHashesChanged).toBe(0)
      expect(simulations.get(name).cleanIngredientsChanged).toBe(0)
    }
    expect(simulations.get('NOTES_TERMINATOR').mappedRecipesChanged).toBe(9)
    expect(simulations.get('TIP_TERMINATOR').mappedRecipesChanged).toBe(4)
  })
})
