#!/usr/bin/env node
/**
 * Read-only all-corpus validation for the Wave 1A parser remediation.
 *
 * The baseline parser is loaded from the immutable source/parser audit commit.
 * Current production recipes are read once, parsed by both implementations,
 * and compared without mapping generation, AI, or any Firestore write API.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import { createServer } from 'vite'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { loadEnv, getAdmin } = require('./_lib.js')
const DATE = '2026-08-26'
const BASELINE_COMMIT = '8af7af7070ba17168a1ed29ec85c7503af718a39'
const BASELINE_AUDIT_PATH = path.join(ROOT, 'docs/audits/excluded-recipe-source-parser-audit-2026-08-26.json')
const OUTPUT_JSON = path.join(ROOT, `docs/audits/excluded-recipe-parser-wave1a-validation-${DATE}.json`)
const OUTPUT_MD = path.join(ROOT, `docs/audits/excluded-recipe-parser-wave1a-validation-${DATE}.md`)

const REVIEW_BOUNDARY = /^(?:Have you cooked this\?(?: Mark as Cooked)?|COOKING NOTES|Comments?|Reviews?|Reader notes|Ratings?|.{1,80}\d+\s+years? ago)$/i
const FOOTER_BOUNDARY = /^(?:Storage(?: Suggestions?)?:\s*|(?:📊\s*)?Nutrition Estimate:|Nutrition(?:al Information)?:$)/i
const FOOTER_LINE = /^(?:Note:\s*The nutritional information\b|Recipe Source:\s*https?:\/\/\S+)/i
const PAGE_CONTROL = /^(?:Make the recipe with us|On Off)$/i
const URL_LINE = /^https?:\/\/\S+$/i

function sourceHash(ingredients, instructions) {
  return crypto.createHash('sha256')
    .update(JSON.stringify({ ingredients, instructions }))
    .digest('hex')
}

function sameArray(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

async function loadCurrentParser() {
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false },
    resolve: { alias: { '@': ROOT } },
  })
  try {
    const loadedParser = await server.ssrLoadModule('/lib/recipeContent.ts')
    return { parseRecipeContent: loadedParser.parseRecipeContent, close: () => server.close() }
  } catch (error) {
    await server.close()
    throw error
  }
}

async function loadBaselineParser() {
  const source = execFileSync('git', ['show', `${BASELINE_COMMIT}:lib/recipeContent.ts`], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const loadedParser = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`)
  return loadedParser.parseRecipeContent
}

function expectedChangedIds(baselineAudit) {
  const simulations = new Map(baselineAudit.parserRuleSimulations.map(rule => [rule.rule, rule]))
  return new Set(baselineAudit.recommendedSafeParserPackage.flatMap(rule =>
    simulations.get(rule).excludedRecipeIdsImproved,
  ))
}

function isParserClean(parsed) {
  return parsed.ingredients.length > 0 &&
    parsed.instructions.length > 0 &&
    parsed.instructions.every(line =>
      !URL_LINE.test(line) &&
      !REVIEW_BOUNDARY.test(line) &&
      !FOOTER_BOUNDARY.test(line) &&
      !FOOTER_LINE.test(line) &&
      !PAGE_CONTROL.test(line),
    )
}

function markdown(report) {
  const rows = report.excludedRecipeResults.affectedRecipes.map(row =>
    `| \`${row.recipeId}\` | ${row.beforeExclusion} | ${row.afterParseStatus} | ${row.remainingDefect || 'None'} |`,
  ).join('\n')

  return `# Excluded Recipe Parser Wave 1A Validation — ${report.validationDate}

## Executive result

**${report.executiveResult}.** The six approved zero-collateral parser rules are implemented. The live
236-recipe before/after simulation found no unexpected changes, and all 187 persisted-map recipes
retained byte-identical ingredient arrays, instruction arrays, and canonical source hashes.

## Implemented rules

- Standalone absolute HTTP(S) instruction-line filtering.
- Exact review/comment terminal boundaries, including the audited author/date footer shape.
- Exact storage/nutrition/source footer metadata handling.
- Exact known page-control filtering.
- PREP + ON THE STOVE method fallback when no ordinary instruction heading exists.
- Sequential standalone Step 1…N method fallback when no ordinary instruction heading exists.

## Corpus impact

- Total recipes: **${report.productionBaseline.sharedRecipes}**
- Persisted-map recipes: **${report.productionBaseline.mappedRecipes}**
- Previously excluded recipes: **${report.productionBaseline.excludedRecipes}**
- NO_CHANGE: **${report.allCorpusImpact.NO_CHANGE}**
- EXPECTED_EXCLUDED_REPAIR: **${report.allCorpusImpact.EXPECTED_EXCLUDED_REPAIR}**
- UNEXPECTED_CHANGE: **${report.allCorpusImpact.UNEXPECTED_CHANGE}**
- Mapped ingredient-array changes: **${report.mappedCorpusSafety.ingredientArrayChanges}**
- Mapped instruction-array changes: **${report.mappedCorpusSafety.instructionArrayChanges}**
- Mapped sourceHash changes: **${report.mappedCorpusSafety.sourceHashChanges}**
- Existing mapped hash mismatches: **${report.productionBaseline.existingMappedHashMismatches}**
- Parser-only repaired: **${report.excludedRecipeResults.parserOnlyRepaired}**
- Still excluded: **${report.excludedRecipeResults.stillExcluded}**
- Unexpected changes: **${report.allCorpusImpact.unexpectedRecipeIds.length === 0 ? 'none' : report.allCorpusImpact.unexpectedRecipeIds.join(', ')}**

## Recipe-level results

| Recipe | Before exclusion | After parse status | Remaining defect |
|---|---|---|---|
${rows}

## Rejected broad rules

Generic first-person termination, generic NOTES termination, and generic Tip termination remain
unimplemented. The baseline audit showed that NOTES and Tip would invalidate 9 and 4 mapped source
hashes respectively; first-person prose is not reliable review evidence.

## Parser version

\`recipe-content-v1\` is retained because every currently mapped recipe remains byte-identical in
canonical mapping source and sourceHash. No persisted cooking map is invalidated.

## Production mutation

- Firestore writes: **0**
- Recipe content writes: **0**
- Cooking-map writes: **0**
- AI calls: **0**
- Mapping recomputation/persistence: **0**
`
}

export async function main() {
  const baselineAudit = JSON.parse(fs.readFileSync(BASELINE_AUDIT_PATH, 'utf8'))
  const expectedIds = expectedChangedIds(baselineAudit)
  const excludedIds = new Set(baselineAudit.recipes.map(row => row.recipeId))
  const baselineRows = new Map(baselineAudit.recipes.map(row => [row.recipeId, row]))
  const parseBaseline = await loadBaselineParser()
  const currentModule = await loadCurrentParser()

  loadEnv()
  const snapshot = await getAdmin().firestore().collection('recipes').get()
  const recipes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) => a.id.localeCompare(b.id))

  try {
    const comparisons = recipes.map(recipe => {
      const before = parseBaseline(String(recipe.content || ''))
      const after = currentModule.parseRecipeContent(String(recipe.content || ''))
      const ingredientChanged = !sameArray(before.ingredients, after.ingredients)
      const instructionChanged = !sameArray(before.instructions, after.instructions)
      const changed = ingredientChanged || instructionChanged
      const expected = excludedIds.has(recipe.id) && expectedIds.has(recipe.id)
      return {
        recipeId: recipe.id,
        mapped: recipe.cookingStepIngredientMap != null,
        before,
        after,
        ingredientChanged,
        instructionChanged,
        beforeSourceHash: sourceHash(before.ingredients, before.instructions),
        afterSourceHash: sourceHash(after.ingredients, after.instructions),
        storedSourceHash: recipe.cookingStepIngredientMap?.sourceHash || null,
        classification: !changed ? 'NO_CHANGE' : expected ? 'EXPECTED_EXCLUDED_REPAIR' : 'UNEXPECTED_CHANGE',
      }
    })

    const mapped = comparisons.filter(row => row.mapped)
    const unexpected = comparisons.filter(row => row.classification === 'UNEXPECTED_CHANGE')
    const changedExpectedIds = new Set(comparisons
      .filter(row => row.classification === 'EXPECTED_EXCLUDED_REPAIR')
      .map(row => row.recipeId))
    const missingExpected = [...expectedIds].filter(id => !changedExpectedIds.has(id)).sort()
    const mappedIngredientChanges = mapped.filter(row => row.ingredientChanged)
    const mappedInstructionChanges = mapped.filter(row => row.instructionChanged)
    const mappedHashChanges = mapped.filter(row => row.beforeSourceHash !== row.afterSourceHash)
    const existingMappedHashMismatches = mapped.filter(row => row.beforeSourceHash !== row.storedSourceHash)
    const currentMappedHashMismatches = mapped.filter(row => row.afterSourceHash !== row.storedSourceHash)

    const affectedRecipes = comparisons
      .filter(row => row.classification === 'EXPECTED_EXCLUDED_REPAIR')
      .map(row => {
        const baseline = baselineRows.get(row.recipeId)
        const parserOnly = baseline.recommendedDisposition === 'PARSER_FIX_ONLY'
        const clean = isParserClean(row.after)
        return {
          recipeId: row.recipeId,
          beforeExclusion: baseline.currentExclusion,
          disposition: baseline.recommendedDisposition,
          afterParseStatus: parserOnly && clean ? 'PARSE_CLEAN' : 'IMPROVED_STILL_EXCLUDED',
          remainingDefect: parserOnly && clean ? null : baseline.defects[0].subtype,
          ingredientsBefore: row.before.ingredients.length,
          ingredientsAfter: row.after.ingredients.length,
          instructionsBefore: row.before.instructions.length,
          instructionsAfter: row.after.instructions.length,
        }
      })
      .sort((a, b) => a.recipeId.localeCompare(b.recipeId))
    const repaired = affectedRecipes.filter(row => row.afterParseStatus === 'PARSE_CLEAN')
    const parserOnlyIds = baselineAudit.recipes
      .filter(row => row.recommendedDisposition === 'PARSER_FIX_ONLY')
      .map(row => row.recipeId)
    const unrepairedParserOnly = parserOnlyIds.filter(id =>
      !affectedRecipes.some(row => row.recipeId === id && row.afterParseStatus === 'PARSE_CLEAN'),
    )

    const parserVersionMatch = fs.readFileSync(path.join(ROOT, 'lib/cookingStepMapping.ts'), 'utf8')
      .match(/COOKING_MAPPING_PARSER_VERSION\s*=\s*'([^']+)'/)
    const parserVersion = parserVersionMatch?.[1] || null
    const report = {
      validationDate: DATE,
      executiveResult: 'PASS WITH LIMITATION',
      repository: {
        branch: execFileSync('git', ['branch', '--show-current'], { cwd: ROOT, encoding: 'utf8' }).trim(),
        head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
        baselineParserCommit: BASELINE_COMMIT,
      },
      productionBaseline: {
        sharedRecipes: recipes.length,
        mappedRecipes: mapped.length,
        excludedRecipes: excludedIds.size,
        existingMappedHashMismatches: existingMappedHashMismatches.length,
      },
      allCorpusImpact: {
        NO_CHANGE: comparisons.filter(row => row.classification === 'NO_CHANGE').length,
        EXPECTED_EXCLUDED_REPAIR: changedExpectedIds.size,
        UNEXPECTED_CHANGE: unexpected.length,
        unexpectedRecipeIds: unexpected.map(row => row.recipeId),
        missingExpectedRecipeIds: missingExpected,
      },
      mappedCorpusSafety: {
        ingredientArrayChanges: mappedIngredientChanges.length,
        instructionArrayChanges: mappedInstructionChanges.length,
        sourceHashChanges: mappedHashChanges.length,
        currentStoredSourceHashMismatches: currentMappedHashMismatches.length,
        persistedMapInvalidations: currentMappedHashMismatches.length,
      },
      excludedRecipeResults: {
        previouslyExcluded: excludedIds.size,
        excludedRecipesImproved: affectedRecipes.length,
        parserOnlyRepaired: repaired.length,
        stillExcluded: excludedIds.size - repaired.length,
        affectedRecipes,
      },
      parserVersion: { value: parserVersion, retained: parserVersion === 'recipe-content-v1' },
      rejectedRulesImplemented: [],
      productionMutation: { firestoreWrites: 0, recipeWrites: 0, mapWrites: 0, aiCalls: 0 },
    }

    const failures = [
      recipes.length !== 236 && `expected 236 recipes, got ${recipes.length}`,
      mapped.length !== 187 && `expected 187 mapped recipes, got ${mapped.length}`,
      excludedIds.size !== 49 && `expected 49 exclusions, got ${excludedIds.size}`,
      unexpected.length > 0 && `unexpected parser changes: ${unexpected.map(row => row.recipeId).join(', ')}`,
      missingExpected.length > 0 && `expected recipes unchanged: ${missingExpected.join(', ')}`,
      mappedIngredientChanges.length > 0 && `mapped ingredient arrays changed: ${mappedIngredientChanges.map(row => row.recipeId).join(', ')}`,
      mappedInstructionChanges.length > 0 && `mapped instruction arrays changed: ${mappedInstructionChanges.map(row => row.recipeId).join(', ')}`,
      mappedHashChanges.length > 0 && `mapped source hashes changed: ${mappedHashChanges.map(row => row.recipeId).join(', ')}`,
      existingMappedHashMismatches.length > 0 && `baseline stored source hashes mismatch: ${existingMappedHashMismatches.map(row => row.recipeId).join(', ')}`,
      currentMappedHashMismatches.length > 0 && `current stored source hashes mismatch: ${currentMappedHashMismatches.map(row => row.recipeId).join(', ')}`,
      unrepairedParserOnly.length > 0 && `parser-only recipes not repaired: ${unrepairedParserOnly.join(', ')}`,
      parserVersion !== 'recipe-content-v1' && `unexpected parser version: ${parserVersion}`,
    ].filter(Boolean)
    if (failures.length > 0) throw new Error(failures.join('\n'))

    fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`)
    fs.writeFileSync(OUTPUT_MD, markdown(report))
    console.log(JSON.stringify({
      executiveResult: report.executiveResult,
      productionBaseline: report.productionBaseline,
      allCorpusImpact: report.allCorpusImpact,
      mappedCorpusSafety: report.mappedCorpusSafety,
      excludedRecipeResults: {
        previouslyExcluded: report.excludedRecipeResults.previouslyExcluded,
        excludedRecipesImproved: report.excludedRecipeResults.excludedRecipesImproved,
        parserOnlyRepaired: report.excludedRecipeResults.parserOnlyRepaired,
        stillExcluded: report.excludedRecipeResults.stillExcluded,
      },
      parserVersion: report.parserVersion,
      outputs: [path.relative(ROOT, OUTPUT_JSON), path.relative(ROOT, OUTPUT_MD)],
    }, null, 2))
  } finally {
    await currentModule.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error); process.exitCode = 1 })
}
