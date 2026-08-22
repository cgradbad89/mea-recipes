# MEA Recipes — Grocery Category Taxonomy Migration — 2026-08-22

**Result:** PASS

**11-category taxonomy:** COMPLETE

**Staples category:** RETIRED

**Legacy read compatibility:** VERIFIED

**Firestore migration:** NOT PERFORMED

## Scope and safety

Phase 2 migrated the web-owned grocery classifier, display order, emoji map, manual category
pickers, saved-item reuse, and AI cleanup contract to the approved 11 store-oriented categories.
It preserved the Phase 1 Unicode token/phrase matcher, longest-specific-phrase behavior, and
equal-specificity rule-order tie breaking. It did not change grocery merge/delete semantics,
recipe content, source parsing, Firestore rules/indexes, infrastructure, or production data.

| Mutation/deployment | Result |
| --- | --- |
| Recipe writes | 0 |
| Grocery production writes | 0 |
| Saved-item production writes | 0 |
| Firestore mutation | 0 |
| Migration script run | no |
| Firebase deployment | none |
| Firestore rules/index deployment | none |
| Vercel manual deployment | none |
| Environment changes | none |

The corpus analyzer made one read-only query to the shared `recipes` collection per recorded run.
No user grocery, saved-item, or week-plan collection was inventoried.

## Final category contract

1. Produce
2. Meat & Seafood
3. Dairy & Eggs
4. Bakery & Bread
5. Pantry & Dry Goods
6. Canned & Jarred
7. Sauces & Condiments
8. Spices & Seasonings
9. Nuts, Seeds & Nut Butters
10. Beverages
11. Other

`GROCERY_CATEGORIES` is the single ordered source for classification, grocery rendering, the
manual picker, and the AI cleanup prompt/validation contract. `MANUAL_CATEGORIES` exposes all 11
current values and no retired value.

## Retired values and read compatibility

The only recognized historical values are:

- `Staples`
- `Canned / Jarred / Sauces`

`normalizePersistedGroceryCategory(value, itemName)` is the single pure compatibility boundary.
A current category is preserved exactly, including a current manual override that differs from
automatic classification. A retired or arbitrary invalid value is reclassified from `itemName`
with the current deterministic classifier. `subscribeGroceryItems` applies this only when a stored
`manualSection` exists; `getSavedGroceryItems` applies it to `defaultCategory`. Neither reader
writes the normalized result back.

| Stored value | Item name | Read result |
| --- | --- | --- |
| Staples | olive oil | Sauces & Condiments |
| Staples | rice | Pantry & Dry Goods |
| Staples | black pepper | Spices & Seasonings |
| Canned / Jarred / Sauces | tomato paste | Canned & Jarred |
| Canned / Jarred / Sauces | soy sauce | Sauces & Condiments |
| Dairy & Eggs | oat milk | Dairy & Eggs (current manual override preserved) |
| arbitrary stored value | rice | Pantry & Dry Goods |

New manual and saved-item writes remain typed as `GroceryCategory`, so only current values can be
stored by current application paths. No background or bulk migration is required.

## Classifier semantics and representative mappings

| Category | Representative current mappings |
| --- | --- |
| Produce | onion; garlic cloves; bell pepper; jalapeño; spinach; cilantro; fresh basil; tomato; avocado; tofu |
| Meat & Seafood | chicken breast; ground beef; pork; bacon; salmon; shrimp; cod; oysters |
| Dairy & Eggs | milk; cream; butter; cheddar; yogurt; eggs |
| Bakery & Bread | bread; baguette; bun; pita; naan; focaccia; tortilla |
| Pantry & Dry Goods | rice; pasta; orzo; couscous; rolled oats; dry lentils; flour; cornstarch; baking soda; chicken broth |
| Canned & Jarred | canned chickpeas; canned beans; tomato paste; crushed tomatoes; coconut milk; jarred roasted peppers; olives; capers |
| Sauces & Condiments | olive oil; red wine vinegar; soy sauce; fish sauce; sriracha; ketchup; mustard; marinara; pesto; harissa; miso |
| Spices & Seasonings | salt; black pepper; cayenne; paprika; cumin; dried oregano; garlic powder; poultry seasoning |
| Nuts, Seeds & Nut Butters | almonds; peanuts; walnuts; cashews; sesame seeds; chia seeds; peanut butter; tahini |
| Beverages | coffee; tea; juice; soda; wine; beer; almond milk; oat milk; soy milk |
| Other | unmatched true exceptions, page/source contamination, and unresolved lines |

The adversarial Phase 1 controls remain covered: alphabetic fragments do not match inside larger
tokens; processed phrases outrank generic components; fresh herbs/peppers remain distinct from
dried seasonings; plant/coconut milk do not fall into dairy; and nut-butter identities are not
preempted by `pea` or `butter`.

## Required high-value cases

| Ingredient | Final category |
| --- | --- |
| olive oil | Sauces & Condiments |
| extra-virgin olive oil | Sauces & Condiments |
| vegetable oil | Sauces & Condiments |
| red wine vinegar | Sauces & Condiments |
| fish sauce | Sauces & Condiments |
| oyster sauce | Sauces & Condiments |
| soy sauce | Sauces & Condiments |
| sriracha | Sauces & Condiments |
| black pepper | Spices & Seasonings |
| dried oregano | Spices & Seasonings |
| garlic powder | Spices & Seasonings |
| onion powder | Spices & Seasonings |
| cornstarch | Pantry & Dry Goods |
| rice | Pantry & Dry Goods |
| pasta | Pantry & Dry Goods |
| rolled oats | Pantry & Dry Goods |
| chicken broth | Pantry & Dry Goods |
| chicken stock | Pantry & Dry Goods |
| tomato paste | Canned & Jarred |
| canned chickpeas | Canned & Jarred |
| coconut milk | Canned & Jarred |
| sesame seeds | Nuts, Seeds & Nut Butters |
| peanut butter | Nuts, Seeds & Nut Butters |
| tahini | Nuts, Seeds & Nut Butters |
| almond milk | Beverages |
| oat milk | Beverages |
| fresh basil | Produce |
| bell pepper | Produce |
| chicken breast | Meat & Seafood |
| milk | Dairy & Eggs |
| bread | Bakery & Bread |

## UI and AI cleanup

- Grocery section rendering iterates `GROCERY_CATEGORIES`; no second display order exists.
- New emoji entries are `Pantry & Dry Goods → 🍚`, `Canned & Jarred → 🥫`,
  `Sauces & Condiments → 🫙`, and `Nuts, Seeds & Nut Butters → 🥜`.
- Both category pickers expose exactly the current 11 values.
- Persisted legacy values normalize before grouping, emoji lookup, autocomplete, quick-add, or a
  picker control, so no legacy orphan section is visible.
- The cleanup prompt derives its list from `GROCERY_CATEGORIES` and contains current shopping
  guidance. It does not duplicate a category array.
- AI output is accepted only when `isGroceryCategory` confirms a current value. Both retired values
  and arbitrary off-list output fall back to deterministic local categorization.
- Merge, normalization, removal, and apply behavior is unchanged.

## Fresh corpus result

| Metric | Phase 1 corrected baseline | Phase 2 final | Change |
| --- | ---: | ---: | ---: |
| Recipes inspected | 216 | 216 | 0 |
| Parseable recipes | 214 | 214 | 0 |
| Raw ingredient occurrences | 3,190 | 3,190 | 0 |
| Unique normalized identities | 2,008 | 2,008 | 0 |
| Parser-low-confidence occurrences | 5 | 5 | 0 |

## Final category distribution

| Category | Unique identities | Occurrences | Occurrence share | Candidate reference | Delta |
| --- | ---: | ---: | ---: | ---: | ---: |
| Produce | 757 | 995 | 31.19% | 941 | +54 |
| Meat & Seafood | 110 | 131 | 4.11% | 122 | +9 |
| Dairy & Eggs | 127 | 161 | 5.05% | 153 | +8 |
| Bakery & Bread | 28 | 33 | 1.03% | 26 | +7 |
| Pantry & Dry Goods | 176 | 272 | 8.53% | 255 | +17 |
| Canned & Jarred | 93 | 118 | 3.70% | 114 | +4 |
| Sauces & Condiments | 217 | 430 | 13.48% | 449 | -19 |
| Spices & Seasonings | 236 | 660 | 20.69% | 646 | +14 |
| Nuts, Seeds & Nut Butters | 39 | 51 | 1.60% | 53 | -2 |
| Beverages | 31 | 59 | 1.85% | 51 | +8 |
| Other | 194 | 280 | 8.78% | 380 | -100 |
| **Total** | **2,008** | **3,190** | **100%** | **3,190** | **0** |

The candidate reference was generated before Phase 1 corrected the production matcher and is not
an acceptance threshold. The largest difference is `Other`: the Phase 1 baseline was 387
occurrences, then Phase 2 intentionally moved 111 occurrences out through audit-supported coverage
(nuts/seeds, tofu/produce, sauces/condiments, pantry goods, beverages, dairy, bakery, and spices)
while only 4 occurrences moved into `Other`, producing 280. The other deltas reflect the exact
token/phrase engine, explicit canned-form variants, and task-approved semantics such as olives and
capers in `Canned & Jarred`. No count was forced to match the stale simulation.

## Phase 1 corrected → Phase 2 movement matrix

| Phase 1 category | Phase 2 category | Unique identities | Occurrences |
| --- | --- | ---: | ---: |
| Produce | Produce | 740 | 976 |
| Produce | Canned & Jarred | 18 | 18 |
| Produce | Sauces & Condiments | 4 | 5 |
| Produce | Spices & Seasonings | 4 | 5 |
| Produce | Nuts, Seeds & Nut Butters | 3 | 3 |
| Produce | Beverages | 4 | 5 |
| Meat & Seafood | Meat & Seafood | 110 | 131 |
| Meat & Seafood | Pantry & Dry Goods | 4 | 5 |
| Meat & Seafood | Produce | 1 | 1 |
| Dairy & Eggs | Dairy & Eggs | 124 | 158 |
| Dairy & Eggs | Sauces & Condiments | 2 | 2 |
| Bakery & Bread | Bakery & Bread | 26 | 31 |
| Bakery & Bread | Pantry & Dry Goods | 4 | 4 |
| Bakery & Bread | Other | 1 | 1 |
| Canned / Jarred / Sauces | Canned & Jarred | 72 | 97 |
| Canned / Jarred / Sauces | Sauces & Condiments | 88 | 145 |
| Canned / Jarred / Sauces | Pantry & Dry Goods | 49 | 67 |
| Canned / Jarred / Sauces | Spices & Seasonings | 3 | 3 |
| Canned / Jarred / Sauces | Nuts, Seeds & Nut Butters | 3 | 4 |
| Canned / Jarred / Sauces | Produce | 2 | 2 |
| Canned / Jarred / Sauces | Other | 2 | 3 |
| Beverages | Beverages | 23 | 50 |
| Beverages | Pantry & Dry Goods | 8 | 8 |
| Beverages | Sauces & Condiments | 3 | 3 |
| Beverages | Produce | 1 | 1 |
| Spices & Seasonings | Spices & Seasonings | 181 | 488 |
| Spices & Seasonings | Canned & Jarred | 2 | 2 |
| Spices & Seasonings | Pantry & Dry Goods | 2 | 2 |
| Spices & Seasonings | Sauces & Condiments | 5 | 5 |
| Staples | Pantry & Dry Goods | 101 | 176 |
| Staples | Sauces & Condiments | 93 | 246 |
| Staples | Spices & Seasonings | 40 | 156 |
| Other | Other | 191 | 276 |
| Other | Produce | 13 | 15 |
| Other | Dairy & Eggs | 3 | 3 |
| Other | Bakery & Bread | 2 | 2 |
| Other | Pantry & Dry Goods | 8 | 10 |
| Other | Canned & Jarred | 1 | 1 |
| Other | Sauces & Condiments | 22 | 24 |
| Other | Spices & Seasonings | 8 | 8 |
| Other | Nuts, Seeds & Nut Butters | 33 | 44 |
| Other | Beverages | 4 | 4 |

The final diff contains 613 moved identities / 1,080 occurrences. Of those, 234 identities / 578
occurrences retire `Staples`; 219 / 321 split the combined canned/sauce section; 94 / 111 add
audit-supported coverage from `Other`; and the remaining 66 / 70 are store-semantic rule movements
among retained categories. The other 1,395 identities / 2,110 occurrences are unchanged.

## Top 50 movements by occurrence count

Review labels: `STAPLES_RETIREMENT`, `COMBINED_SPLIT`, `NEW_COVERAGE`, and
`KNOWN_SOURCE_NOISE`. Every row is intentional or explained.

| # | Occ. | Identity | Phase 1 | Phase 2 | Review |
| ---: | ---: | --- | --- | --- | --- |
| 1 | 62 | salt | Staples | Spices & Seasonings | STAPLES_RETIREMENT |
| 2 | 51 | olive oil | Staples | Sauces & Condiments | STAPLES_RETIREMENT |
| 3 | 25 | soy sauce | Canned / Jarred / Sauces | Sauces & Condiments | COMBINED_SPLIT |
| 4 | 24 | extra-virgin olive oil | Staples | Sauces & Condiments | STAPLES_RETIREMENT |
| 5 | 22 | kosher salt | Staples | Spices & Seasonings | STAPLES_RETIREMENT |
| 6 | 18 | honey | Staples | Pantry & Dry Goods | STAPLES_RETIREMENT |
| 7 | 17 | tomato paste | Canned / Jarred / Sauces | Canned & Jarred | COMBINED_SPLIT |
| 8 | 15 | sesame oil | Staples | Sauces & Condiments | STAPLES_RETIREMENT |
| 9 | 13 | brown sugar | Staples | Pantry & Dry Goods | STAPLES_RETIREMENT |
| 10 | 12 | vegetable oil | Staples | Sauces & Condiments | STAPLES_RETIREMENT |
| 11 | 10 | chicken broth | Canned / Jarred / Sauces | Pantry & Dry Goods | COMBINED_SPLIT |
| 12 | 10 | salt to taste | Staples | Spices & Seasonings | STAPLES_RETIREMENT |
| 13 | 9 | cornstarch | Staples | Pantry & Dry Goods | STAPLES_RETIREMENT |
| 14 | 9 | rice vinegar | Staples | Sauces & Condiments | STAPLES_RETIREMENT |
| 15 | 8 | sesame seed | Other | Nuts, Seeds & Nut Butters | NEW_COVERAGE |
| 16 | 7 | baking powder | Staples | Pantry & Dry Goods | STAPLES_RETIREMENT |
| 17 | 7 | red wine vinegar | Staples | Sauces & Condiments | STAPLES_RETIREMENT |
| 18 | 6 | canola oil | Staples | Sauces & Condiments | STAPLES_RETIREMENT |
| 19 | 6 | extra virgin olive oil | Staples | Sauces & Condiments | STAPLES_RETIREMENT |
| 20 | 6 | fine sea salt | Staples | Spices & Seasonings | STAPLES_RETIREMENT |
| 21 | 6 | kosher salt such as diamond crystal | Staples | Spices & Seasonings | STAPLES_RETIREMENT |
| 22 | 6 | maple syrup | Staples | Pantry & Dry Goods | STAPLES_RETIREMENT |
| 23 | 6 | sugar | Staples | Pantry & Dry Goods | STAPLES_RETIREMENT |
| 24 | 5 | all-purpose flour | Staples | Pantry & Dry Goods | STAPLES_RETIREMENT |
| 25 | 5 | apple cider vinegar | Staples | Sauces & Condiments | STAPLES_RETIREMENT |
| 26 | 5 | dijon mustard | Canned / Jarred / Sauces | Sauces & Condiments | COMBINED_SPLIT |
| 27 | 5 | flour | Staples | Pantry & Dry Goods | STAPLES_RETIREMENT |
| 28 | 5 | neutral oil | Staples | Sauces & Condiments | STAPLES_RETIREMENT |
| 29 | 5 | quinoa | Staples | Pantry & Dry Goods | STAPLES_RETIREMENT |
| 30 | 5 | red lentil rinsed | Canned / Jarred / Sauces | Pantry & Dry Goods | COMBINED_SPLIT |
| 31 | 4 | 15-ounce can chickpea drained and rinsed | Canned / Jarred / Sauces | Canned & Jarred | COMBINED_SPLIT |
| 32 | 4 | extra-virgin olive oil plus more for drizzling | Staples | Sauces & Condiments | STAPLES_RETIREMENT |
| 33 | 4 | for sauce | Canned / Jarred / Sauces | Sauces & Condiments | KNOWN_SOURCE_NOISE |
| 34 | 4 | oil | Staples | Sauces & Condiments | STAPLES_RETIREMENT |
| 35 | 4 | oyster sauce | Canned / Jarred / Sauces | Sauces & Condiments | COMBINED_SPLIT |
| 36 | 4 | salt more to taste | Staples | Spices & Seasonings | STAPLES_RETIREMENT |
| 37 | 4 | sea salt | Staples | Spices & Seasonings | STAPLES_RETIREMENT |
| 38 | 4 | worcestershire sauce | Canned / Jarred / Sauces | Sauces & Condiments | COMBINED_SPLIT |
| 39 | 3 | 15-ounce can chickpea drained | Canned / Jarred / Sauces | Canned & Jarred | COMBINED_SPLIT |
| 40 | 3 | all purpose flour | Staples | Pantry & Dry Goods | STAPLES_RETIREMENT |
| 41 | 3 | cooking oil | Staples | Sauces & Condiments | STAPLES_RETIREMENT |
| 42 | 3 | farro | Other | Pantry & Dry Goods | NEW_COVERAGE |
| 43 | 3 | fish sauce | Canned / Jarred / Sauces | Sauces & Condiments | COMBINED_SPLIT |
| 44 | 3 | gochujang | Canned / Jarred / Sauces | Sauces & Condiments | COMBINED_SPLIT |
| 45 | 3 | good olive oil | Staples | Sauces & Condiments | STAPLES_RETIREMENT |
| 46 | 3 | granulated sugar | Staples | Pantry & Dry Goods | STAPLES_RETIREMENT |
| 47 | 3 | ketchup | Canned / Jarred / Sauces | Sauces & Condiments | COMBINED_SPLIT |
| 48 | 3 | light soy sauce | Canned / Jarred / Sauces | Sauces & Condiments | COMBINED_SPLIT |
| 49 | 3 | low sodium soy sauce | Canned / Jarred / Sauces | Sauces & Condiments | COMBINED_SPLIT |
| 50 | 3 | noodle | Staples | Pantry & Dry Goods | STAPLES_RETIREMENT |

## Unexpected movement and ambiguity review

No unexplained high-frequency movement remains. Four moved identities with at least two
occurrences differ from the older candidate simulation:

| Occ. | Identity | Final | Review |
| ---: | --- | --- | --- |
| 4 | for sauce | Sauces & Condiments | Existing contaminated ingredient subheader; source cleanup is deferred, and taxonomy rules were not turned into a content filter. |
| 2 | crushed red pepper | Spices & Seasonings | Correct task-approved seasoning identity; the candidate regex covered flakes but omitted this safe variant. |
| 2 | kalamata olive | Canned & Jarred | Correct task-approved `olives` placement; the candidate simulation had placed olives with condiments. |
| 2 | salt pepper olive oil to finish | Sauces & Condiments | Mixed purchase line; longest phrase `olive oil` wins deterministically. No single category can represent all three identities. |

All remaining final-vs-candidate differences are single-occurrence identities. Review found only
mixed-product lines, source/page contamination, spelling/form variants, or deliberate Phase 2
semantics. None warranted a broad exception or a taxonomy change.

## Section fragmentation

| Metric | Phase 1 corrected current proxy | Candidate 11 proxy | Phase 2 final proxy |
| --- | ---: | ---: | ---: |
| Minimum sections per parseable recipe | 1 | 2 | 1 |
| Median sections | 5 | 6 | 6 |
| Average sections | 5.40 | 5.79 | 5.69 |
| Maximum sections | 8 | 9 | 9 |
| Singleton category sections | 429 | 563 | 546 |
| Singleton-section share | 37.14% | 45.40% | 44.83% |
| Recipes with at least one singleton category | not recorded by Phase 1 artifact | not recorded | 206 |

This is a per-recipe proxy; no production week plan was read. The actual final taxonomy is slightly
less fragmented than the older candidate simulation and remains below the rejected 13-category
test (average 6.00, 626 singleton sections, 48.75% singleton share). No usability evidence supports
adding separate Baking or Frozen sections.

## Tests and verification

Fresh pre-change baseline:

- `npm test` — PASS; 25 files passed / 1 skipped, 145 passed / 1 skipped (146 total).
- Read-only corpus — PASS; 216/214 recipes, 3,190 occurrences, 2,008 identities.

Focused implementation verification:

- `tests/groceryCategories.test.ts`, `tests/groceryCleanup.test.ts`, and
  `tests/groceryCleanupRoute.test.ts` — PASS; 19 tests, 0 skipped/failing.
- `npm run typecheck` — PASS.
- Read-only final corpus — PASS; totals unchanged and production rule introspection agreed with
  `categorizeIngredient` for all 2,008 identities.

Final full verification:

- `npm run typecheck` — PASS (exit 0).
- `npm run lint` — PASS with 0 errors / 6 unchanged pre-existing warnings (five
  `@next/next/no-img-element`, one unused eslint-disable).
- `npm run build` — PASS; Next.js 16.3.1 compiled successfully and generated 26 pages.
- `npm test` — PASS; 25 files passed / 1 skipped, 148 tests passed / 1 skipped
  (149 total). Three test cases are new; no failures.

## PRD and backlog

`PRD.md` now records the exact 11-value contract, store-location vs future usually-on-hand status,
the retained token/phrase matcher, all-category manual overrides, legacy read normalization for
`manualSection` and `SavedGroceryItem.defaultCategory`, and centralized AI cleanup validation. The
11-category migration is marked Done. Staple status, corpus/source contamination cleanup, the
shared `prepareGroceryItem` pipeline, unit conversion, and dietary tags/filtering remain separate
backlog work.

## Assessment

Grocery category taxonomy migration: COMPLETE

Production data migration required: NO

Next recommended grocery work: clean source-content contamination before expanding taxonomy or
adding classifier exceptions; then design staple status as a separate usually-on-hand preference.
