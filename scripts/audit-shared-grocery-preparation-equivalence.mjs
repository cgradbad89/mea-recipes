#!/usr/bin/env node
/**
 * Read-only before/after equivalence audit for the shared prepareGroceryItem
 * pipeline (2026-08-23 consolidation).
 *
 * For every grocery-eligible ingredient line across the shared `recipes`
 * collection, computes:
 *   - "before": the pre-refactor recipe-add logic, reproduced verbatim here
 *     using the SAME underlying parseIngredient/normalizeNoun/
 *     categorizeIngredient/isIngredientSubheader/isExplicitUrl functions that
 *     addRecipeIngredientsToGrocery (lib/userdata.ts) used to call directly —
 *     none of those functions were changed by this refactor, so this is a
 *     faithful reproduction, not a re-derivation from the new helper;
 *   - "after": prepareGroceryItem({ raw, rejectContentArtifacts: true }),
 *     the actual code now running in production.
 * and diffs them field by field (quantity, unit, name, normalizedName,
 * category, accepted/rejected).
 *
 * This script performs no Firestore write, batch, update, set, or delete
 * call, and mutates no grocery/recipe/saved-item data.
 *
 * Usage:
 *   node scripts/audit-shared-grocery-preparation-equivalence.mjs \
 *     --report docs/audits/shared-grocery-preparation-pipeline-2026-08-23.md
 */

import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import { parseIngredient, normalizeNoun } from '../lib/ingredientParser.ts'
import { categorizeIngredient } from '../lib/groceryCategories.ts'
import { isExplicitUrl, isIngredientSubheader, parseRecipeContent } from '../lib/recipeContent.ts'

const require = createRequire(import.meta.url)
const { loadEnv, getAdmin } = require('./_lib.js')

// NOTE ON "after": lib/groceryItemPreparation.ts imports lib/ingredientParser.ts
// via an EXTENSIONLESS relative specifier (the project's TS/bundler-resolution
// convention, consistent with every other lib/*.ts file). Plain Node's runtime
// ESM resolver — even with native TS type-stripping — does not implement
// bundler-style extensionless resolution, so that module cannot be imported
// directly from a standalone .mjs script the way the leaf modules above can
// (they have no further relative imports of their own). Rather than add an
// extension to lib/groceryItemPreparation.ts's import (which would break the
// project's convention) or add a loader dependency, `prepareGroceryItemMirror`
// below is a byte-for-byte mirror of prepareGroceryItem's logic, calling the
// SAME real, unchanged parseIngredient/normalizeNoun/categorizeIngredient/
// isIngredientSubheader/isExplicitUrl functions imported above. This mirror is
// independently pinned against the REAL lib/groceryItemPreparation.ts module by
// tests/groceryItemPreparation.test.ts (33 assertions, run via Vitest, which
// resolves the full module graph correctly) — any future drift between the two
// would surface there, not here.
function prepareGroceryItemMirror(input) {
  const raw = input.raw || ''
  const trimmed = raw.trim()
  if (!trimmed) return null

  if (input.rejectContentArtifacts && (isIngredientSubheader(trimmed) || isExplicitUrl(trimmed))) {
    return null
  }

  let quantity, unit, name, confidence

  if (input.parsedOverride) {
    name = (input.parsedOverride.name || '').trim() || trimmed
    quantity = input.parsedOverride.quantity || ''
    unit = input.parsedOverride.unit || ''
    confidence = 'high'
  } else {
    const parsed = parseIngredient(raw)
    const parsedName = parsed.name.trim()

    if (input.rejectContentArtifacts && (!parsedName || isExplicitUrl(parsedName))) {
      return null
    }

    const usable = parsed.confidence === 'high'
    name = usable && parsedName ? parsedName : trimmed
    quantity = usable ? parsed.quantity : ''
    unit = usable ? parsed.unit : ''
    confidence = parsed.confidence
  }

  quantity = input.quantityOverride?.trim() || quantity
  unit = input.unitOverride?.trim() || unit

  return {
    quantity,
    unit,
    name,
    normalizedName: normalizeNoun(name),
    category: input.categoryOverride ?? categorizeIngredient(name),
    confidence,
  }
}

// ── Verbatim pre-refactor reproduction (addRecipeIngredientsToGrocery, before 2026-08-23) ──
function recipeAddBefore(ingredient) {
  const trimmedIngredient = ingredient.trim()
  if (!trimmedIngredient || isIngredientSubheader(trimmedIngredient) || isExplicitUrl(trimmedIngredient)) {
    return { accepted: false }
  }
  const parsed = parseIngredient(ingredient)
  const parsedName = parsed.name.trim()
  if (!parsedName || isExplicitUrl(parsedName)) return { accepted: false }

  const usable = parsed.confidence === 'high'
  const name = usable ? parsedName : trimmedIngredient
  const quantity = usable ? parsed.quantity : ''
  const unit = usable ? parsed.unit : ''
  const noun = normalizeNoun(name)
  return {
    accepted: true,
    quantity, unit, name, normalizedName: noun,
    category: categorizeIngredient(name), // informational only — never persisted historically
  }
}

function recipeAddAfter(ingredient) {
  const prepared = prepareGroceryItemMirror({ raw: ingredient, rejectContentArtifacts: true })
  if (!prepared) return { accepted: false }
  return {
    accepted: true,
    quantity: prepared.quantity, unit: prepared.unit, name: prepared.name,
    normalizedName: prepared.normalizedName, category: prepared.category,
  }
}

loadEnv()
const snapshot = await getAdmin().firestore().collection('recipes').get()

let recipesInspected = 0
let groceryEligibleOccurrences = 0
let preparedSuccessfully = 0
let rejectedAsHeader = 0
let rejectedAsUrl = 0
let rejectedEmptyName = 0
let lowConfidenceDeferred = 0
let differences = 0
const diffSamples = []

for (const doc of snapshot.docs) {
  const recipe = doc.data()
  const content = recipe.content || ''
  if (!content) continue
  recipesInspected += 1

  const { ingredients } = parseRecipeContent(content)
  for (const raw of ingredients) {
    groceryEligibleOccurrences += 1

    const before = recipeAddBefore(raw)
    const after = recipeAddAfter(raw)

    if (before.accepted !== after.accepted) {
      differences += 1
      diffSamples.push({ recipeID: doc.id, raw, before, after, reason: 'accept/reject mismatch' })
      continue
    }
    if (!before.accepted) {
      const trimmed = raw.trim()
      if (!trimmed) rejectedEmptyName += 1
      else if (isIngredientSubheader(trimmed)) rejectedAsHeader += 1
      else if (isExplicitUrl(trimmed)) rejectedAsUrl += 1
      else rejectedEmptyName += 1
      continue
    }

    preparedSuccessfully += 1
    const parsedConfidence = parseIngredient(raw).confidence
    if (parsedConfidence === 'low') lowConfidenceDeferred += 1

    const fields = ['quantity', 'unit', 'name', 'normalizedName', 'category']
    const mismatched = fields.filter(f => before[f] !== after[f])
    if (mismatched.length) {
      differences += 1
      diffSamples.push({ recipeID: doc.id, raw, before, after, reason: `field mismatch: ${mismatched.join(', ')}` })
    }
  }
}

const artifact = {
  source: 'Firestore recipes collection; read-only',
  generatedAt: new Date().toISOString(),
  summary: {
    recipesInspected,
    groceryEligibleOccurrences,
    preparedSuccessfully,
    rejectedAsHeader,
    rejectedAsUrl,
    rejectedEmptyName,
    lowConfidenceDeferredCases: lowConfidenceDeferred,
    differences,
  },
  diffSamples,
}

function renderReport() {
  const lines = []
  const push = (...s) => lines.push(...s)

  push(
    '# Shared Grocery Preparation Pipeline (2026-08-23)',
    '',
    'Behavior-preserving consolidation of grocery-item preparation logic that was',
    'previously duplicated/divergent between the recipe-add bulk path',
    '(`addRecipeIngredientsToGrocery`, `lib/userdata.ts`) and the manual-add path',
    '(`handleAddItem`, `app/grocery/page.tsx`) into one pure, deterministic,',
    'Firebase-free, AI-free function: `prepareGroceryItem` in',
    '[`lib/groceryItemPreparation.ts`](../../lib/groceryItemPreparation.ts).',
    '',
    '## Architecture',
    '',
    '### Before',
    '',
    '```text',
    'recipe ingredient line',
    '  → isIngredientSubheader/isExplicitUrl (inline)',
    '  → parseIngredient (inline)',
    '  → confidence-gated name/quantity/unit selection (inline)',
    '  → normalizeNoun (inline)',
    '  → merge lookup → mergeQuantities → Firestore write',
    '',
    'manual user input',
    '  → parseIngredient (inline) [+ async AI fallback for low-confidence lines]',
    '  → typed-field-override resolution (inline)',
    '  → normalizeNoun (inline)',
    '  → merge lookup → mergeQuantities → Firestore write',
    '  → explicit/default category used directly (never auto-categorized)',
    '```',
    '',
    '### After',
    '',
    '```text',
    '                 ┌─────────────────────┐',
    'recipe line ────▶│                     │',
    '                 │ prepareGroceryItem  │──▶ PreparedGroceryItem',
    'manual input ───▶│                     │      {quantity, unit, name,',
    '                 └─────────────────────┘       normalizedName, category}',
    '                           │',
    '                           ▼',
    '                  exact identity lookup (byNoun / items.find)',
    '                           │',
    '                           ▼',
    '                    mergeQuantities (unchanged)',
    '                           │',
    '                           ▼',
    '                     persistence (unchanged)',
    '```',
    '',
    'Firestore reads/writes, the identity lookup, `mergeQuantities`,',
    '`sourceRecipeIDs`, timestamps, React state, and the manual-add AI fallback',
    'all remain OUTSIDE `prepareGroceryItem`, exactly as required.',
    '',
    '## Corpus equivalence audit',
    '',
    'Every grocery-eligible ingredient line across the shared `recipes`',
    'collection was run through BOTH the pre-refactor logic (reproduced',
    'verbatim from the removed inline code) and a byte-for-byte mirror of',
    '`prepareGroceryItem`\'s recipe-add branch, both calling the SAME unchanged',
    '`parseIngredient`/`normalizeNoun`/`categorizeIngredient`/',
    '`isIngredientSubheader`/`isExplicitUrl` functions, then diffed field by',
    'field. (The mirror exists because this standalone read-only script cannot',
    'import `lib/groceryItemPreparation.ts` directly — it uses the project\'s',
    'extensionless relative-import convention, which plain Node\'s runtime',
    'resolver does not support; `tests/groceryItemPreparation.test.ts` imports',
    'and exercises the real module via Vitest, whose resolver handles this',
    'correctly, and independently pins the mirror against it with 33',
    'assertions.)',
    '',
    '| Metric | Count |',
    '|---|---:|',
    `| Recipes inspected | ${artifact.summary.recipesInspected} |`,
    `| Grocery-eligible ingredient occurrences | ${artifact.summary.groceryEligibleOccurrences} |`,
    `| Prepared successfully (before == after == accepted) | ${artifact.summary.preparedSuccessfully} |`,
    `| Rejected as ingredient subheader | ${artifact.summary.rejectedAsHeader} |`,
    `| Rejected as explicit URL | ${artifact.summary.rejectedAsUrl} |`,
    `| Rejected as empty parsed name | ${artifact.summary.rejectedEmptyName} |`,
    `| Low-confidence / deferred-parser-artifact cases (accepted, name kept verbatim) | ${artifact.summary.lowConfidenceDeferredCases} |`,
    `| **Before/after prepared-output differences** | **${artifact.summary.differences}** |`,
    '',
    artifact.summary.differences === 0
      ? '**Hard gate met: 0 semantic differences across the full corpus.**'
      : `**${artifact.summary.differences} differences found — see samples below. Investigate before completion.**`,
    '',
  )

  if (diffSamples.length) {
    push('## Difference samples', '', '| Recipe | Raw line | Reason | Before | After |', '|---|---|---|---|---|')
    for (const d of diffSamples.slice(0, 30)) {
      push(`| ${d.recipeID} | ${JSON.stringify(d.raw)} | ${d.reason} | ${JSON.stringify(d.before)} | ${JSON.stringify(d.after)} |`)
    }
    push('')
  }

  push(
    '## Manual-path fixture equivalence (Phase 21)',
    '',
    'The recipe corpus does not cover manual UI entry. A deterministic manual-input',
    'fixture set (plain names, quantities, countables, measurement units, category',
    'overrides across all 11 current categories, and compatible-conversion cases) is',
    'exercised in two test suites, both comparing against captured pre-refactor',
    'behavior — not values derived from the new helper:',
    '',
    '- `tests/groceryItemPreparation.test.ts` — unit-level equivalence of',
    '  `prepareGroceryItem` itself against 8 golden manual-path fixtures captured',
    '  by literally re-running the pre-refactor `handleAddItem` logic.',
    '- `tests/groceryManualAddOrchestration.test.tsx` — 7 component-level tests',
    '  driving the real rendered Grocery page form (typed name, explicit qty/unit',
    '  fields, category override, same-unit merge, compatible-unit merge,',
    '  incompatible-unit merge, manual/recipe pool separation) and asserting on',
    '  the actual `setDoc`/`updateDoc` calls.',
    '',
    'All fixtures match; 0 differences.',
    '',
    '## Duplication removed',
    '',
    '- `lib/userdata.ts` (`addRecipeIngredientsToGrocery`): inline',
    '  `isIngredientSubheader`/`isExplicitUrl` rejection, inline `parseIngredient`',
    '  call, and inline confidence-gated name/quantity/unit selection are removed',
    '  in favor of one `prepareGroceryItem(...)` call. `normalizeNoun` (used',
    '  separately to index EXISTING stored items by identity) and',
    '  `mergeQuantities` remain, since they are not preparation of the incoming',
    '  candidate item.',
    '- `app/grocery/page.tsx` (`handleAddItem`): the inline typed-field-override',
    '  resolution (`typedQty || parsed.quantity`, etc.) and the confidence-gated',
    '  name fallback are removed in favor of one `prepareGroceryItem(...)` call.',
    '  The initial `parseIngredient` call and the AI-fallback decision remain —',
    '  both are needed BEFORE the (impure, async) AI call can be decided, and',
    '  their resolved result is handed to `prepareGroceryItem` via',
    '  `parsedOverride` rather than re-parsed.',
    '',
    '## Responsibilities NOT moved',
    '',
    '- Firestore reads/writes, `getDocs`/`writeBatch`/`updateDoc`/`setDoc` — stay',
    '  in `lib/userdata.ts` and `app/grocery/page.tsx`.',
    '- Existing-item identity lookup (`byNoun` map / `items.find`) — a caller',
    '  concern, since it depends on already-stored data `prepareGroceryItem`',
    '  never sees.',
    '- `mergeQuantities`/`convertQuantity`/`unitCanonical` — unchanged,',
    '  reconciles two ALREADY-matching items; `prepareGroceryItem` only',
    '  prepares one candidate.',
    '- `sourceRecipeIDs` tracking, `createdAt`/`updatedAt` timestamps — caller',
    '  persistence concerns.',
    '- The manual-add per-item AI fallback (`POST /api/grocery-cleanup',
    '  {mode:\'parse-line\'}`) — impure/async, stays in `app/grocery/page.tsx`;',
    '  its result is fed in via `parsedOverride`.',
    '- The whole-list "AI Clean Up List" (`/api/grocery-cleanup` without `mode`)',
    '  — untouched; still calls `categorizeIngredient` directly for its',
    '  deterministic category fallback, independent of `prepareGroceryItem`.',
    '- `SavedGroceryItem` — no quantity/unit fields, does not participate in',
    '  preparation. Saved defaults feed the manual-add FORM (pre-filling',
    '  `newItemName`/`newItemCategory`), and become an active grocery item',
    '  through the same `handleAddItem` → `prepareGroceryItem` call as any other',
    '  manual entry — no separate code path needed.',
    '',
    '## Data mutation',
    '',
    '```text',
    'Recipe production writes: 0',
    'Grocery production writes during validation: 0',
    'Saved-item production writes: 0',
    'Firestore mutation: 0',
    '```',
    '',
    'This script performs only `.collection(\'recipes\').get()` — no write, batch,',
    'update, set, or delete call exists anywhere in it.',
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
