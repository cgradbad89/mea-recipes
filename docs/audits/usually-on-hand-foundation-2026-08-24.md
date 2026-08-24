# Usually On Hand Foundation (2026-08-24)

**Result:** PASS

**Production preferences written:** 0 · **Firestore mutation:** 0 · **deployment:** none

## Architecture mapping

1. **Saved document ID strategy:** existing saved-item writes use a sanitized lowercased item name as the document ID. Historical IDs are therefore not guaranteed to be the normalized noun. Phase 1 preserves those IDs and resolves saved documents by exact `normalizeNoun(name)` identity.
2. **Saved identity uniqueness:** historical saved documents are not structurally unique by normalized identity. The preference reader collapses exact normalized matches deterministically, and the dedicated setter updates all exact matches so old singular/plural duplicates agree. No fuzzy or substring matching is used.
3. **Saved-item loading:** `app/grocery/page.tsx` calls `getSavedGroceryItems(uid)` once for the authenticated user and keeps the result in component state. Preference matching builds one memoized `Map<normalizedName, SavedGroceryItem>` from that loaded set; there are no per-active-item queries.
4. **Active-item loading:** `subscribeGroceryItems(uid, ...)` provides the owner-scoped active list from `users/{uid}/pantry/root/groceryItems`.
5. **Saved-default matching:** autocomplete and quick-add use the loaded saved items. Usually On Hand uses the same `normalizeNoun` grocery identity as preparation/merge logic, through `groceryIdentity` in `lib/groceryUsuallyOnHand.ts`.
6. **Write helpers:** ordinary frequency/category memory remains in `upsertSavedGroceryItem`. The narrow `setSavedGroceryItemUsuallyOnHand` helper updates only `usuallyOnHand` on existing identity documents, or creates a saved identity with the active category and `timesUsed: 0` when none exists.
7. **Rules coverage:** the repository contains no deployable rules file. `README.md` documents the recursive owner rule `match /users/{userId}/{document=**} { allow read, write: if request.auth != null && request.auth.uid == userId; }`, with no field whitelist. `CLAUDE.md` and `PRD.md` confirm Console-only shared rules management.

## Durable model and derived presentation

`SavedGroceryItem` now has the backward-compatible optional field:

```ts
usuallyOnHand?: boolean
```

Only literal `true` enables the preference; missing and `false` both mean not Usually On Hand. Ordinary saved-item upserts remain partial writes and omit the field, preserving an existing value. Preference-only creation uses `timesUsed: 0`, because choosing a preference is not a grocery use and must not inflate frequency ranking.

Active grocery documents are unchanged. `deriveGrocerySections` first applies the existing checked-item visibility, then places an exact-identity preferred item in the derived `Usually On Hand` array; otherwise it places the item in its effective real category. `GROCERY_CATEGORIES` remains the same 11 values. Manual `manualSection` overrides remain authoritative and reappear when the preference is removed.

The derived section is rendered after `Other`, hidden when empty, displays `Usually On Hand (N)`, and is collapsed by default. Checking, quantities, units, source recipe IDs, manual/recipe pool separation, and item deletion are unchanged.

## Firestore rule compatibility

**Firestore rule change required: NO**, based on the repository-documented recursive owner rule, which authorizes owner reads/writes for all descendant user documents and does not whitelist fields.

- Rules modified by agent: no
- Rules deployed: no
- Live Firebase Console rules inspected: no (shared infrastructure; repository evidence only)

## Read-only corpus frequency

The reproducible `scripts/audit-usually-on-hand-foundation.mjs` analyzer made one read-only query to the shared `recipes` collection, applied the same recipe grocery eligibility checks and exact `normalizeNoun` identity rule, and made no user-data reads or writes.

| Metric | Count |
| --- | ---: |
| Recipes analyzed | 236 |
| Grocery-eligible occurrences | 3,022 |
| Unique normalized identities | 1,821 |

All rows below are **candidate only**. No preference was inferred or written.

| Rank | Normalized identity | Recipes | Occurrences | Current category |
| ---: | --- | ---: | ---: | --- |
| 1 | salt | 76 | 81 | Spices & Seasonings |
| 2 | olive oil | 66 | 69 | Sauces & Condiments |
| 3 | black pepper | 42 | 43 | Spices & Seasonings |
| 4 | ground cumin | 38 | 40 | Spices & Seasonings |
| 5 | water | 25 | 26 | Beverages |
| 6 | extra-virgin olive oil | 24 | 24 | Sauces & Condiments |
| 7 | soy sauce | 22 | 25 | Sauces & Condiments |
| 8 | dried oregano | 22 | 22 | Spices & Seasonings |
| 9 | honey | 22 | 22 | Pantry & Dry Goods |
| 10 | kosher salt | 21 | 22 | Spices & Seasonings |
| 11 | garlic clove minced | 20 | 20 | Produce |
| 12 | garlic minced | 19 | 19 | Produce |
| 13 | garlic powder | 19 | 19 | Spices & Seasonings |
| 14 | tomato paste | 17 | 17 | Canned & Jarred |
| 15 | cumin | 15 | 15 | Spices & Seasonings |
| 16 | sesame oil | 15 | 15 | Sauces & Condiments |
| 17 | brown sugar | 14 | 14 | Pantry & Dry Goods |
| 18 | chili powder | 13 | 13 | Spices & Seasonings |
| 19 | smoked paprika | 13 | 13 | Spices & Seasonings |
| 20 | butter | 12 | 12 | Dairy & Eggs |
| 21 | freshly ground black pepper | 12 | 12 | Spices & Seasonings |
| 22 | ground turmeric | 12 | 12 | Spices & Seasonings |
| 23 | onion powder | 11 | 12 | Spices & Seasonings |
| 24 | vegetable oil | 11 | 12 | Sauces & Condiments |
| 25 | ground coriander | 11 | 11 | Spices & Seasonings |
| 26 | chicken broth | 10 | 10 | Pantry & Dry Goods |
| 27 | garlic | 10 | 10 | Produce |
| 28 | kosher salt and black pepper | 10 | 10 | Spices & Seasonings |
| 29 | lemon juice | 10 | 10 | Produce |
| 30 | salt and black pepper | 10 | 10 | Spices & Seasonings |

The distinct rows (for example `olive oil` versus `extra-virgin olive oil`) are intentional evidence that the preference must remain exact-identity scoped.

## Grocery lifecycle and Phase 2 recommendation

`rebuildGroceryFromPlan` deletes every non-manual recipe item, then recreates recipe items from the current plan. Saved ingredient preferences survive because they live outside active grocery documents. A temporary `Need This Trip` override placed only on a recipe item would be lost during rebuild.

Recommended Phase 2 design: add `needThisTrip?: boolean` to active `GroceryItem` documents, apply it to every active exact-normalized-identity match, and derive normal-category display when `usuallyOnHand === true && needThisTrip === true`. Before a plan rebuild deletes recipe items, capture the exact normalized identities with the override and reapply the flag to matching recreated items after the rebuild. Clearing/deleting the active list removes the override, so future lists return to the durable Usually On Hand preference. Do not store `needThisTrip` on `SavedGroceryItem`, because that would turn a one-trip exception into a future-list default.

## Safety

```text
Recipe production writes: 0
Grocery production writes during validation: 0
Saved-item production writes during validation: 0
Firestore mutation: 0
Firebase deployment: none
Firestore rules/index deployment: none
Vercel manual deployment: none
Environment changes: none
```
