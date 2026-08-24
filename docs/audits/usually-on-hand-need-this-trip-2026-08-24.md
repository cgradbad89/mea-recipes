# Usually On Hand — Need This Trip (2026-08-24)

**Result:** PASS

**Production preferences written:** 0 · **production grocery writes:** 0 · **Firestore mutation:** 0 · **deployment:** none

## Lifecycle before and after

Before Phase 2, `SavedGroceryItem.usuallyOnHand === true` always derived an active exact-identity
ingredient into the collapsed `Usually On Hand` section. Active grocery documents carried no
per-trip exception. A plan rebuild deleted every non-manual recipe item and recreated recipe items
from the current plan; manual items survived in place.

Phase 2 adds optional `GroceryItem.needThisTrip`. The narrow
`setGroceryItemNeedThisTrip(uid, itemId, value)` helper partially updates only that field and
`updatedAt` on the owner-scoped active document. Missing and false both mean no override. Clearing
checked items, clearing all items, or deleting an individual item deletes its transient flag with
the active document; nothing copies it into a future list.

## Persistent and temporary models

- `SavedGroceryItem.usuallyOnHand?: boolean` remains the durable, exact-identity preference.
- `GroceryItem.needThisTrip?: boolean` is a temporary exception for the current active list.

The trip action never writes the saved-item collection. Marking an item Usually On Hand clears the
active trip marker first so the explicit preference action moves it to Usually On Hand. Removing
the durable preference writes the saved preference first, then clears any now-inert trip marker;
if that cleanup write fails, `usuallyOnHand === false` still keeps the item in its correct visible
normal category.

## Display derivation and UI

`lib/groceryUsuallyOnHand.ts` remains the single pure derivation boundary:

```text
SavedGroceryItem.usuallyOnHand === true
AND GroceryItem.needThisTrip !== true
→ Usually On Hand

otherwise
→ effectiveGroceryCategory(item)
```

The effective category is the stored valid `manualSection` when present, otherwise the existing
automatic classifier. `Need This Trip` moves a preferred active item into that category;
`Usually Have This` reverses the temporary exception. The derived count uses only the resulting
Usually On Hand array, and the section stays hidden when that array is empty. Neither action
changes `isChecked`.

## Merge preservation

Recipe and manual exact-identity merge writes retain literal `needThisTrip: true` while using the
unchanged `mergeQuantities` behavior. No change was made to parsing, normalization, conversion,
quantity formatting, source-ID unioning, or the manual/recipe pool boundary. The regression case
`1 cup chicken broth + 8 tbsp chicken broth` remains `1.5 cup` and retains the trip override.

## Plan rebuild preservation

Before deletion, `rebuildGroceryFromPlan` collects a set of `normalizeNoun(name)` identities only
from non-manual, non-legacy items with literal `needThisTrip === true`. It then performs the existing
delete and recipe-add lifecycle. After recreation, it reads the active list and partially reapplies
the flag only to non-manual items whose exact normalized identity is in that captured set.

- Manual items survive in place, including their active metadata.
- An overridden identity absent after rebuild is not recreated.
- `olive oil` never transfers to `extra-virgin olive oil` through fuzzy or substring matching.
- Quantity, unit, category, checked state, and source-recipe behavior remain unchanged.

## Firestore rule compatibility

**Firestore rule change required: NO**, based on repository evidence. `README.md` documents the
recursive owner rule for `users/{userId}/{document=**}` without a field whitelist. `CLAUDE.md` and
`PRD.md` confirm that shared rules are Console-managed and must never be deployed from this repo.

- Rules modified by agent: no
- Rules deployed: no
- Live Firebase Console rules inspected: no (repository evidence only)

## Test evidence

Focused validation covers the four preference/override combinations, historical absence, count and
empty-section behavior, automatic and manual-category restoration, forward/reverse UI actions,
persistent-preference independence, checked-state independence, narrow partial writes, recipe and
manual compatible-unit merge preservation, exact rebuild survival, missing-item expiry, fuzzy-match
rejection, manual-item survival, and clear-list expiry.

```text
Focused suites: 46 passed / 46
New tests: 19
Full suite: 272 passed / 1 skipped (273 discovered)
Typecheck: passed
Lint: 0 errors (6 pre-existing warnings)
Production build: passed
```

## Safety

```text
Recipe production writes: 0
Grocery production writes during validation: 0
Saved-item production writes during validation: 0
Firestore production mutation: 0
Firebase deployment: none
Firestore rules/index deployment: none
Vercel manual deployment: none
Environment changes: none
```
