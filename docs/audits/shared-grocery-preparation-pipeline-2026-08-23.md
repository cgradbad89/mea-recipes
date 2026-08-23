# Shared Grocery Preparation Pipeline (2026-08-23)

Behavior-preserving consolidation of grocery-item preparation logic that was
previously duplicated/divergent between the recipe-add bulk path
(`addRecipeIngredientsToGrocery`, `lib/userdata.ts`) and the manual-add path
(`handleAddItem`, `app/grocery/page.tsx`) into one pure, deterministic,
Firebase-free, AI-free function: `prepareGroceryItem` in
[`lib/groceryItemPreparation.ts`](../../lib/groceryItemPreparation.ts).

## Architecture

### Before

```text
recipe ingredient line
  → isIngredientSubheader/isExplicitUrl (inline)
  → parseIngredient (inline)
  → confidence-gated name/quantity/unit selection (inline)
  → normalizeNoun (inline)
  → merge lookup → mergeQuantities → Firestore write

manual user input
  → parseIngredient (inline) [+ async AI fallback for low-confidence lines]
  → typed-field-override resolution (inline)
  → normalizeNoun (inline)
  → merge lookup → mergeQuantities → Firestore write
  → explicit/default category used directly (never auto-categorized)
```

### After

```text
                 ┌─────────────────────┐
recipe line ────▶│                     │
                 │ prepareGroceryItem  │──▶ PreparedGroceryItem
manual input ───▶│                     │      {quantity, unit, name,
                 └─────────────────────┘       normalizedName, category}
                           │
                           ▼
                  exact identity lookup (byNoun / items.find)
                           │
                           ▼
                    mergeQuantities (unchanged)
                           │
                           ▼
                     persistence (unchanged)
```

Firestore reads/writes, the identity lookup, `mergeQuantities`,
`sourceRecipeIDs`, timestamps, React state, and the manual-add AI fallback
all remain OUTSIDE `prepareGroceryItem`, exactly as required.

## Corpus equivalence audit

Every grocery-eligible ingredient line across the shared `recipes`
collection was run through BOTH the pre-refactor logic (reproduced
verbatim from the removed inline code) and a byte-for-byte mirror of
`prepareGroceryItem`'s recipe-add branch, both calling the SAME unchanged
`parseIngredient`/`normalizeNoun`/`categorizeIngredient`/
`isIngredientSubheader`/`isExplicitUrl` functions, then diffed field by
field. (The mirror exists because this standalone read-only script cannot
import `lib/groceryItemPreparation.ts` directly — it uses the project's
extensionless relative-import convention, which plain Node's runtime
resolver does not support; `tests/groceryItemPreparation.test.ts` imports
and exercises the real module via Vitest, whose resolver handles this
correctly, and independently pins the mirror against it with 33
assertions.)

| Metric | Count |
|---|---:|
| Recipes inspected | 216 |
| Grocery-eligible ingredient occurrences | 3071 |
| Prepared successfully (before == after == accepted) | 2985 |
| Rejected as ingredient subheader | 86 |
| Rejected as explicit URL | 0 |
| Rejected as empty parsed name | 0 |
| Low-confidence / deferred-parser-artifact cases (accepted, name kept verbatim) | 5 |
| **Before/after prepared-output differences** | **0** |

**Hard gate met: 0 semantic differences across the full corpus.**

## Manual-path fixture equivalence (Phase 21)

The recipe corpus does not cover manual UI entry. A deterministic manual-input
fixture set (plain names, quantities, countables, measurement units, category
overrides across all 11 current categories, and compatible-conversion cases) is
exercised in two test suites, both comparing against captured pre-refactor
behavior — not values derived from the new helper:

- `tests/groceryItemPreparation.test.ts` — unit-level equivalence of
  `prepareGroceryItem` itself against 8 golden manual-path fixtures captured
  by literally re-running the pre-refactor `handleAddItem` logic.
- `tests/groceryManualAddOrchestration.test.tsx` — 7 component-level tests
  driving the real rendered Grocery page form (typed name, explicit qty/unit
  fields, category override, same-unit merge, compatible-unit merge,
  incompatible-unit merge, manual/recipe pool separation) and asserting on
  the actual `setDoc`/`updateDoc` calls.

All fixtures match; 0 differences.

## Duplication removed

- `lib/userdata.ts` (`addRecipeIngredientsToGrocery`): inline
  `isIngredientSubheader`/`isExplicitUrl` rejection, inline `parseIngredient`
  call, and inline confidence-gated name/quantity/unit selection are removed
  in favor of one `prepareGroceryItem(...)` call. `normalizeNoun` (used
  separately to index EXISTING stored items by identity) and
  `mergeQuantities` remain, since they are not preparation of the incoming
  candidate item.
- `app/grocery/page.tsx` (`handleAddItem`): the inline typed-field-override
  resolution (`typedQty || parsed.quantity`, etc.) and the confidence-gated
  name fallback are removed in favor of one `prepareGroceryItem(...)` call.
  The initial `parseIngredient` call and the AI-fallback decision remain —
  both are needed BEFORE the (impure, async) AI call can be decided, and
  their resolved result is handed to `prepareGroceryItem` via
  `parsedOverride` rather than re-parsed.

## Responsibilities NOT moved

- Firestore reads/writes, `getDocs`/`writeBatch`/`updateDoc`/`setDoc` — stay
  in `lib/userdata.ts` and `app/grocery/page.tsx`.
- Existing-item identity lookup (`byNoun` map / `items.find`) — a caller
  concern, since it depends on already-stored data `prepareGroceryItem`
  never sees.
- `mergeQuantities`/`convertQuantity`/`unitCanonical` — unchanged,
  reconciles two ALREADY-matching items; `prepareGroceryItem` only
  prepares one candidate.
- `sourceRecipeIDs` tracking, `createdAt`/`updatedAt` timestamps — caller
  persistence concerns.
- The manual-add per-item AI fallback (`POST /api/grocery-cleanup
  {mode:'parse-line'}`) — impure/async, stays in `app/grocery/page.tsx`;
  its result is fed in via `parsedOverride`.
- The whole-list "AI Clean Up List" (`/api/grocery-cleanup` without `mode`)
  — untouched; still calls `categorizeIngredient` directly for its
  deterministic category fallback, independent of `prepareGroceryItem`.
- `SavedGroceryItem` — no quantity/unit fields, does not participate in
  preparation. Saved defaults feed the manual-add FORM (pre-filling
  `newItemName`/`newItemCategory`), and become an active grocery item
  through the same `handleAddItem` → `prepareGroceryItem` call as any other
  manual entry — no separate code path needed.

## Data mutation

```text
Recipe production writes: 0
Grocery production writes during validation: 0
Saved-item production writes: 0
Firestore mutation: 0
```

This script performs only `.collection('recipes').get()` — no write, batch,
update, set, or delete call exists anywhere in it.
