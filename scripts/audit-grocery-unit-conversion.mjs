#!/usr/bin/env node
/**
 * Read-only grocery unit-conversion opportunity analyzer.
 *
 * Reads only the shared `recipes` collection, applies the production
 * `parseRecipeContent`, `parseIngredient`, `normalizeNoun`, `unitCanonical`,
 * and `convertQuantity` functions, and reports:
 *   - measurement-unit / countable-unit / unitless / unknown-unit occurrence
 *     counts across the corpus;
 *   - identities (normalized noun) that appear in more than one unit across
 *     recipes, classified as same-unit-summable / newly-convertible /
 *     incompatible / unknown-or-non-numeric.
 *
 * This script performs no Firestore write, batch, update, set, or delete
 * call, and mutates no grocery/recipe/saved-item data. It is safe to re-run.
 *
 * Usage:
 *   node scripts/audit-grocery-unit-conversion.mjs > /tmp/grocery-unit-conversion.json
 *   node scripts/audit-grocery-unit-conversion.mjs --report docs/audits/grocery-unit-conversion-2026-08-23.md
 */

import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import { normalizeNoun, parseIngredient, unitCanonical, convertQuantity } from '../lib/ingredientParser.ts'
import { isExplicitUrl, isIngredientSubheader, parseRecipeContent } from '../lib/recipeContent.ts'

const require = createRequire(import.meta.url)
const { loadEnv, getAdmin } = require('./_lib.js')

loadEnv()
const snapshot = await getAdmin().firestore().collection('recipes').get()

let measurementOccurrences = 0
let countableOccurrences = 0
let unitlessOccurrences = 0
let unknownUnitOccurrences = 0
let totalIngredientOccurrences = 0

// identity (normalizeNoun) -> Set of canonical units seen, plus a few sample raw lines
const identityUnits = new Map()

function recordIdentity(identity, canonicalUnit, rawUnit, recipeID) {
  if (!identity) return
  let entry = identityUnits.get(identity)
  if (!entry) {
    entry = { units: new Map(), recipeIDs: new Set() }
    identityUnits.set(identity, entry)
  }
  entry.recipeIDs.add(recipeID)
  if (canonicalUnit) {
    if (!entry.units.has(canonicalUnit)) entry.units.set(canonicalUnit, { rawUnit, count: 0 })
    entry.units.get(canonicalUnit).count += 1
  }
}

let parseableRecipes = 0

for (const doc of snapshot.docs) {
  const recipe = doc.data()
  const recipeID = doc.id
  const content = recipe.content || ''
  if (!content) continue

  const { ingredients } = parseRecipeContent(content)
  if (!ingredients.length) continue
  parseableRecipes += 1

  for (const raw of ingredients) {
    const trimmed = raw.trim()
    if (!trimmed || isIngredientSubheader(trimmed) || isExplicitUrl(trimmed)) continue

    const parsed = parseIngredient(raw)
    const parsedName = parsed.name.trim()
    if (!parsedName || isExplicitUrl(parsedName)) continue

    totalIngredientOccurrences += 1

    if (parsed.confidence === 'low') {
      unknownUnitOccurrences += 1
      continue
    }

    const unit = parsed.unit.trim()
    if (!unit) {
      unitlessOccurrences += 1
    } else {
      const canon = unitCanonical(unit)
      if (canon === null) {
        unknownUnitOccurrences += 1
      } else if (canon.startsWith('C:')) {
        countableOccurrences += 1
      } else {
        measurementOccurrences += 1
      }
    }

    const identity = normalizeNoun(parsedName)
    const canon = unit ? unitCanonical(unit) : null
    recordIdentity(identity, canon, unit, recipeID)
  }
}

// Classify multi-unit identities. Note: identities whose ingredient lines all
// share ONE canonical unit (even across raw spellings like "cup" vs "cups")
// are deliberately excluded here — they already merge today via same-unit
// summing (Case B) and so carry no separate "unitsSeen" entry to report; this
// table exists specifically to surface identities that do NOT already merge.
const newlyConvertible = []
const incompatible = []
const countableMultiUnit = []

for (const [identity, entry] of identityUnits.entries()) {
  const canonUnits = [...entry.units.keys()]
  if (canonUnits.length < 2) continue

  const measurementCanons = canonUnits.filter(c => c.startsWith('M:'))
  const countableCanons = canonUnits.filter(c => c.startsWith('C:'))

  const row = {
    identity,
    unitsSeen: canonUnits.map(c => entry.units.get(c).rawUnit),
    recipeCount: entry.recipeIDs.size,
  }

  if (measurementCanons.length >= 2) {
    // Check pairwise convertibility using the production convertQuantity.
    const [a, b] = measurementCanons
    const rawA = entry.units.get(a).rawUnit
    const rawB = entry.units.get(b).rawUnit
    const convertible = convertQuantity(1, rawB, rawA) !== null
    if (convertible && countableCanons.length === 0) {
      newlyConvertible.push(row)
    } else {
      incompatible.push(row)
    }
  } else if (countableCanons.length >= 2 && measurementCanons.length === 0) {
    countableMultiUnit.push(row)
  } else {
    // Mixed measurement + countable, or measurement + unitless-only spread — incompatible dimension.
    incompatible.push(row)
  }
}

const artifact = {
  source: 'Firestore recipes collection; read-only',
  generatedAt: new Date().toISOString(),
  corpus: {
    recipesInspected: snapshot.size,
    parseableRecipes,
    totalIngredientOccurrences,
    measurementOccurrences,
    countableOccurrences,
    unitlessOccurrences,
    unknownUnitOccurrences,
  },
  identities: {
    totalDistinctIdentities: identityUnits.size,
    multiUnitIdentities: newlyConvertible.length + incompatible.length + countableMultiUnit.length,
    newlyConvertible,
    incompatible,
    countableMultiUnit,
  },
}

function renderReport() {
  const lines = []
  const push = (...s) => lines.push(...s)

  push(
    '# Grocery Unit Conversion — Real Corpus Analysis (2026-08-23)',
    '',
    'Read-only analysis of the shared `recipes` collection using the production',
    '`parseRecipeContent`, `parseIngredient`, `normalizeNoun`, `unitCanonical`, and',
    '`convertQuantity` functions. No Firestore write, batch, update, set, or delete',
    'call is made anywhere in this script or during this analysis.',
    '',
    '## Corpus summary',
    '',
    '| Metric | Count |',
    '|---|---:|',
    `| Recipes inspected | ${artifact.corpus.recipesInspected} |`,
    `| Parseable recipes (has an ingredient section) | ${artifact.corpus.parseableRecipes} |`,
    `| Total ingredient-line occurrences | ${artifact.corpus.totalIngredientOccurrences} |`,
    `| Measurement-unit occurrences (volume/mass) | ${artifact.corpus.measurementOccurrences} |`,
    `| Countable-unit occurrences (can, jar, clove…) | ${artifact.corpus.countableOccurrences} |`,
    `| Unitless occurrences | ${artifact.corpus.unitlessOccurrences} |`,
    `| Unknown-unit / low-confidence occurrences | ${artifact.corpus.unknownUnitOccurrences} |`,
    '',
    '## Same-identity, multi-unit opportunity',
    '',
    `${artifact.identities.totalDistinctIdentities} distinct normalized-noun identities were seen across the corpus.`,
    `${artifact.identities.multiUnitIdentities} of them appear in more than one CANONICAL unit across recipes`,
    '(identities repeated in only one canonical unit — e.g. "cup" and "cups" — already',
    'merge via same-unit summing today and are not counted here):',
    '',
    '| Classification | Count |',
    '|---|---:|',
    `| **Newly convertible** by this feature (compatible different measurement units) | ${newlyConvertible.length} |`,
    `| Incompatible (cross-dimension or mixed with countable/unitless) | ${incompatible.length} |`,
    `| Countable, multiple different countable units (never convertible) | ${countableMultiUnit.length} |`,
    '',
    '### Representative newly-convertible identities',
    '',
    '| Ingredient identity | Units seen | Recipes |',
    '|---|---|---:|',
  )
  for (const row of newlyConvertible.slice(0, 25)) {
    push(`| ${row.identity} | ${row.unitsSeen.join(', ')} | ${row.recipeCount} |`)
  }
  push(
    '',
    '### Representative incompatible identities (not converted — different dimensions)',
    '',
    '| Ingredient identity | Units seen | Recipes |',
    '|---|---|---:|',
  )
  for (const row of incompatible.slice(0, 25)) {
    push(`| ${row.identity} | ${row.unitsSeen.join(', ')} | ${row.recipeCount} |`)
  }
  push(
    '',
    '## Notes',
    '',
    '- This analysis approximates real grocery-list behavior using per-recipe parsed',
    '  ingredient lines grouped by normalized-noun identity across the whole corpus —',
    '  it is a proxy for "would these merge on the grocery list," not a simulation of',
    '  actual week-plan selections (which recipes a user actually adds together).',
    '- The 23 previously identified ingredient-parser artifacts remain deferred by',
    '  product decision; any raw line the deterministic parser marks `confidence: \'low\'`',
    '  is counted under "unknown-unit / low-confidence" above rather than guessed at.',
    '- No Firestore data was mutated. No recipe content was changed.',
    '',
  )
  return `${lines.join('\n').trimEnd()}\n`
}

const reportFlagIndex = process.argv.indexOf('--report')
if (reportFlagIndex !== -1) {
  const reportPath = process.argv[reportFlagIndex + 1]
  if (!reportPath) throw new Error('--report requires an output path')
  writeFileSync(reportPath, renderReport(), 'utf8')
}

process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`)
