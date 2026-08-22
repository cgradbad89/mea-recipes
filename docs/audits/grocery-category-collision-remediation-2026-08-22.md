# MEA Recipes — Grocery Category Collision Remediation — 2026-08-22

**Result:** PASS WITH DEFERRED COLLISIONS

**Current 9-category taxonomy:** PRESERVED

**Classifier collision remediation:** COMPLETE for Phase 1

**11-category migration:** NOT PERFORMED

**iOS compatibility constraint:** REMOVED

## Scope and safety

This phase changed only deterministic automatic grocery classification. It did not change
category strings/order, category UI, emojis, `GroceryCategory`, `GROCERY_CATEGORIES`,
`MANUAL_CATEGORIES`, `manualSection`, saved defaults, ingredient parsing, Firestore data,
rules/indexes, or infrastructure. The corpus analyzer performed one read-only query per run
against the shared `recipes` collection.

| Mutation/deployment | Result |
| --- | --- |
| Recipe writes | 0 |
| Grocery writes | 0 |
| Saved-item writes | 0 |
| Firestore mutation | 0 |
| Firebase deployment | none |
| Firestore rules/index deployment | none |
| Vercel deployment | none |
| Environment changes | none |

## Matcher before

`categorizeIngredient` lowercased the complete name, visited ordered category blocks, and
returned the first block having any `lower.includes(keyword)` match. This made category order
the only specificity mechanism and allowed ordinary alphabetic fragments such as `gin`, `tea`,
`roll`, `pea`, `corn`, and `fresh` to match inside unrelated words or preempt a more specific
purchase identity. Intentional berry/jalapeño stems depended on the same unrestricted behavior.

## Matcher after

The classifier tokenizes Unicode letters/numbers, treats punctuation and hyphens as boundaries,
applies the existing conservative singular/plural forms, and matches only contiguous whole-token
phrases. It evaluates every rule and selects the matching phrase with the most tokens; original
category/keyword order is retained only for equal-specificity ties. Berry and jalapeño stems were
replaced with explicit normalized identities. Specific processed forms (powders, dried herbs,
pepper seasonings, oils/vinegars, canned/sauce identities, broths/stocks, plant/coconut milks)
outrank their generic component nouns. Explicit nut-butter identities fall to `Other` because the
future nuts category is not part of Phase 1.

## Required regression cases

| Ingredient | Before | After |
| --- | --- | --- |
| extra-virgin olive oil | Beverages | Staples |
| black pepper | Produce | Spices & Seasonings |
| dried oregano | Produce | Spices & Seasonings |
| garlic powder | Produce | Spices & Seasonings |
| tomato paste | Produce | Canned / Jarred / Sauces |
| onion powder | Produce | Spices & Seasonings |
| vegetable oil | Produce | Staples |
| chicken broth | Meat & Seafood | Canned / Jarred / Sauces |
| cornstarch | Produce | Staples |
| red wine vinegar | Beverages | Staples |
| rolled oats | Bakery & Bread | Staples |
| peanut | Produce | Other |
| peanut butter | Produce | Other |
| peppercorn | Produce | Spices & Seasonings |
| fish sauce | Meat & Seafood | Canned / Jarred / Sauces |
| oyster sauce | Meat & Seafood | Canned / Jarred / Sauces |
| butter beans | Dairy & Eggs | Canned / Jarred / Sauces |
| almond milk | Dairy & Eggs | Beverages |
| oat milk | Dairy & Eggs | Beverages |
| coconut milk | Dairy & Eggs | Canned / Jarred / Sauces |

## Fresh / dried and pepper verification

| Ingredient | Before | After |
| --- | --- | --- |
| fresh basil | Produce | Produce |
| dried basil | Produce | Spices & Seasonings |
| fresh oregano | Produce | Produce |
| dried oregano | Produce | Spices & Seasonings |
| bell pepper | Produce | Produce |
| black pepper | Produce | Spices & Seasonings |

Additional focused cases verify fresh garlic/onion, garlic/onion powder, jalapeño, serrano,
habanero, fresh red/green chiles, white pepper, cayenne, red pepper flakes, poultry seasoning,
fish fillet/oysters/shrimp, chicken stock, chickpeas, soy milk, and plural berry/jalapeño forms.

## Corpus before / after

| Metric | Before | After | Change |
| --- | ---: | ---: | ---: |
| Recipes inspected | 216 | 216 | 0 |
| Parseable recipes | 214 | 214 | 0 |
| Raw occurrences | 3,190 | 3,190 | 0 |
| Unique normalized identities | 2,008 | 2,008 | 0 |
| Parser-low-confidence occurrences | 5 | 5 | 0 |
| Audit keyword/precedence-defect identities | 397 | 151 | -246 (-61.96%) |
| Audit keyword/precedence-defect occurrences | 691 | 175 | -516 (-74.67%) |
| High-confidence defect/gap/noise identities | 513 | 262 | -251 (-48.93%) |
| High-confidence defect/gap/noise occurrences | 835 | 311 | -524 (-62.75%) |

Of the original 397 keyword/precedence-defect identities, 248 identities / 520 occurrences no
longer remain in that defect family. The two-count difference from the aggregate 397→151 measure
is caused by a small set newly exposed by boundary matching; those residual gaps are low-frequency
and belong to the deferred taxonomy/content-hygiene work. The Phase 1 regression set has zero
remaining raw-substring collision.

## Category distribution before / after

| Category | Unique before | Occ. before | Unique after | Occ. after |
| --- | ---: | ---: | ---: | ---: |
| Produce | 989 | 1,456 | 773 | 1,012 |
| Meat & Seafood | 134 | 173 | 115 | 137 |
| Dairy & Eggs | 124 | 158 | 126 | 160 |
| Bakery & Bread | 28 | 30 | 31 | 36 |
| Canned / Jarred / Sauces | 141 | 259 | 219 | 321 |
| Beverages | 58 | 123 | 35 | 62 |
| Spices & Seasonings | 98 | 233 | 190 | 497 |
| Staples | 151 | 368 | 234 | 578 |
| Other | 285 | 390 | 285 | 387 |

## Movement review

The final diff contains 342 moved identities / 693 occurrences. Every movement was assigned one
of the required review labels using the actual before/after identity, matched keyword, raw examples,
and audit recommendation:

| Review label | Identities | Occurrences | Interpretation |
| --- | ---: | ---: | --- |
| EXPECTED_FIX | 316 | 665 | Boundary/specificity repair or required current-nine interim assignment |
| EXPECTED_FALLBACK_TO_OTHER | 19 | 21 | False substring removed; no current appropriate nuts/specialty category or the line is noise |
| AMBIGUOUS | 7 | 7 | Mixed-product or contaminated prose; recorded without classifier overfitting |
| POTENTIAL_REGRESSION | 0 | 0 | No movement remained in this class after fresh-pepper/produce follow-up fixes |

The classification is exhaustive at the identity level. The seven ambiguous identities are listed
under Potential regressions/content noise below; all are single occurrences. No high-frequency
ambiguous or unexpected movement remains.

## Top 50 movements by occurrence count

All rows are `EXPECTED_FIX` except peanut butter, which is
`EXPECTED_FALLBACK_TO_OTHER` pending the future nuts category.

| # | Occ. | Identity | Before | After | Review |
| ---: | ---: | --- | --- | --- | --- |
| 1 | 51 | olive oil | Canned / Jarred / Sauces | Staples | EXPECTED_FIX |
| 2 | 24 | black pepper | Produce | Spices & Seasonings | EXPECTED_FIX |
| 3 | 24 | extra-virgin olive oil | Beverages | Staples | EXPECTED_FIX |
| 4 | 21 | dried oregano | Produce | Spices & Seasonings | EXPECTED_FIX |
| 5 | 18 | garlic powder | Produce | Spices & Seasonings | EXPECTED_FIX |
| 6 | 17 | tomato paste | Produce | Canned / Jarred / Sauces | EXPECTED_FIX |
| 7 | 12 | onion powder | Produce | Spices & Seasonings | EXPECTED_FIX |
| 8 | 12 | vegetable oil | Produce | Staples | EXPECTED_FIX |
| 9 | 11 | freshly ground black pepper | Produce | Spices & Seasonings | EXPECTED_FIX |
| 10 | 10 | chicken broth | Meat & Seafood | Canned / Jarred / Sauces | EXPECTED_FIX |
| 11 | 10 | kosher salt and black pepper | Produce | Spices & Seasonings | EXPECTED_FIX |
| 12 | 10 | salt and black pepper | Produce | Spices & Seasonings | EXPECTED_FIX |
| 13 | 10 | salt and pepper | Produce | Spices & Seasonings | EXPECTED_FIX |
| 14 | 9 | cayenne pepper | Produce | Spices & Seasonings | EXPECTED_FIX |
| 15 | 9 | cornstarch | Produce | Staples | EXPECTED_FIX |
| 16 | 8 | dried thyme | Produce | Spices & Seasonings | EXPECTED_FIX |
| 17 | 8 | salt and pepper to taste | Produce | Spices & Seasonings | EXPECTED_FIX |
| 18 | 7 | red pepper flake | Produce | Spices & Seasonings | EXPECTED_FIX |
| 19 | 7 | red wine vinegar | Beverages | Staples | EXPECTED_FIX |
| 20 | 6 | extra virgin olive oil | Beverages | Staples | EXPECTED_FIX |
| 21 | 6 | kosher salt such as diamond crystal and black pepper | Produce | Spices & Seasonings | EXPECTED_FIX |
| 22 | 6 | pepper | Produce | Spices & Seasonings | EXPECTED_FIX |
| 23 | 5 | apple cider vinegar | Produce | Staples | EXPECTED_FIX |
| 24 | 4 | 15-ounce can chickpea drained and rinsed | Produce | Canned / Jarred / Sauces | EXPECTED_FIX |
| 25 | 4 | corn tortilla | Produce | Bakery & Bread | EXPECTED_FIX |
| 26 | 4 | dried basil | Produce | Spices & Seasonings | EXPECTED_FIX |
| 27 | 4 | extra-virgin olive oil plus more for drizzling | Beverages | Staples | EXPECTED_FIX |
| 28 | 4 | ground black pepper | Produce | Spices & Seasonings | EXPECTED_FIX |
| 29 | 4 | oil | Other | Staples | EXPECTED_FIX |
| 30 | 4 | oyster sauce | Meat & Seafood | Canned / Jarred / Sauces | EXPECTED_FIX |
| 31 | 4 | red-pepper flake | Produce | Spices & Seasonings | EXPECTED_FIX |
| 32 | 3 | 15-ounce can chickpea drained | Produce | Canned / Jarred / Sauces | EXPECTED_FIX |
| 33 | 3 | black pepper to taste | Produce | Spices & Seasonings | EXPECTED_FIX |
| 34 | 3 | fish sauce | Meat & Seafood | Canned / Jarred / Sauces | EXPECTED_FIX |
| 35 | 3 | freshly cracked black pepper | Produce | Spices & Seasonings | EXPECTED_FIX |
| 36 | 3 | gochujang | Other | Canned / Jarred / Sauces | EXPECTED_FIX |
| 37 | 3 | good olive oil | Canned / Jarred / Sauces | Staples | EXPECTED_FIX |
| 38 | 3 | mustard powder | Canned / Jarred / Sauces | Spices & Seasonings | EXPECTED_FIX |
| 39 | 3 | olive oil divided | Canned / Jarred / Sauces | Staples | EXPECTED_FIX |
| 40 | 3 | olive oil plus more for drizzling | Canned / Jarred / Sauces | Staples | EXPECTED_FIX |
| 41 | 3 | peanut butter | Produce | Other | EXPECTED_FALLBACK_TO_OTHER |
| 42 | 3 | pineapple juice | Produce | Beverages | EXPECTED_FIX |
| 43 | 3 | salt and ground black pepper to taste | Produce | Spices & Seasonings | EXPECTED_FIX |
| 44 | 2 | 14-ounce can diced tomato | Produce | Canned / Jarred / Sauces | EXPECTED_FIX |
| 45 | 2 | 14-ounce can full-fat coconut milk | Dairy & Eggs | Canned / Jarred / Sauces | EXPECTED_FIX |
| 46 | 2 | baking soda | Beverages | Staples | EXPECTED_FIX |
| 47 | 2 | black pepper plus more to taste | Produce | Spices & Seasonings | EXPECTED_FIX |
| 48 | 2 | chicken stock | Meat & Seafood | Canned / Jarred / Sauces | EXPECTED_FIX |
| 49 | 2 | crushed red pepper flake more to taste | Produce | Spices & Seasonings | EXPECTED_FIX |
| 50 | 2 | dried parsley | Produce | Spices & Seasonings | EXPECTED_FIX |

## Potential regressions and content-noise review

No `POTENTIAL_REGRESSION` remained. The seven `AMBIGUOUS` single-occurrence movements were:

1. `about bean ... butter bean` — contaminated article prose; Dairy → Canned via `butter bean`.
2. `dash of cinnamon or cocoa powder` — mixed alternative; Spices → Staples via the longer `cocoa powder` phrase.
3. Long Kung Pao explanatory prose beginning `fiery from dried chile...` — Produce → Meat due an embedded complete `chicken` word; source contamination.
4. `for chickpea` — ingredient subheader/noise; Produce → Canned via exact `chickpea`.
5. Long pozole description beginning `fresh produce and deep flavor...` — Produce → Canned via `chicken broth`; source contamination.
6. Long stir-fry technique paragraph beginning `how do chinese restaurant...` — Produce → Canned via `soy sauce`; source contamination.
7. Long fish-method paragraph beginning `traditional recipe call...` — Produce → Meat via actual fish/meat words; source contamination.

These were not encoded as negative keyword exceptions because source-content hygiene is explicitly
separate work. All have occurrence count 1; none is a high-frequency semantic regression.

## Current Other

`Other` changed from 285 identities / 390 occurrences (12.23%) to 285 / 387 (12.13%):
a net reduction of three occurrences, not a material expansion. Correct new coverage for plain oil,
gochujang, bean sprouts, pears, broccolini, lemongrass, curry leaves, and related identities offset
the intentional boundary fallbacks for peanuts/nut butters, `teaspoon` fragments, `cod` inside
`code`, and other malformed/noise text. Future-category items falling to `Other` are intentional.

## Current Staples

`Staples` remains implemented and auto-only. It increased from 151 identities / 368 occurrences to
234 / 578 because oils, vinegars, cornstarch/baking goods, oats/cornmeal, rice/pasta, and similar
current-nine interim identities no longer lose to fruit/vegetable/alcohol/bakery substrings. The
separate staple-status concept remains future work.

## Manual, saved, cleanup, and migration behavior

- `manualSection` writes changed: no. Existing manual overrides still win in `getCategory`.
- Saved `defaultCategory` writes changed: no.
- Migration performed: no.
- AI cleanup category contract/list changed: no; off-list fallback now benefits from the matcher.
- Category strings removed/added/reordered: none.

## iOS deprecation and PRD maintenance

- `lib/groceryCategories.ts`: replaced “iOS-compatible category values — must match exactly” with
  web ownership and explicit iOS deprecation.
- `PRD.md` Section 1: web is the only supported product; historical Firestore values remain valid.
- `PRD.md` Section 3: historical shared paths no longer imply an active iOS contract.
- `PRD.md` Section 5 #9: documents token/phrase matching, specificity, processed-form precedence,
  manual override authority, unchanged nine categories, and no iOS constraint.
- `PRD.md` Section 7: records Phase 1 complete and the 11-category migration as separate backlog.
- `README.md`: removed active iOS sync claims.

No iOS compatibility investigation or coordinated iOS work remains required.

## Tests and verification

Fresh baseline before editing:

- `npm test` — PASS; 24 files passed / 1 skipped, 138 passed / 1 skipped (139 total).
- Read-only audit — PASS; 216/214 recipes, 3,190 occurrences, 2,008 identities.
- `npm run typecheck` — PASS.
- `npm run lint` — PASS with 0 errors / 6 pre-existing warnings.
- `npm run build` — PASS; 26 pages generated.

Focused after implementation:

- `npx vitest run tests/groceryCategories.test.ts` — PASS; 7 tests, 0 skipped/failing.
- Read-only post audit — PASS; corpus totals unchanged and rule diagnostics agree with production.

Final full verification:

- `npm run typecheck` — PASS (exit 0).
- `npm run lint` — PASS with 0 errors / 6 unchanged pre-existing warnings (five
  `@next/next/no-img-element`, one unused eslint-disable).
- `npm run build` — PASS; Next.js 16.3.1 compiled successfully and generated 26 pages.
- `npm test` — PASS; 25 files passed / 1 skipped, 145 tests passed / 1 skipped
  (146 total). Seven tests are new; no failures.

## Deferred and next recommendation

- 11-category taxonomy migration deferred to next phase.
- Staple-status concept deferred.
- Corpus/source contamination deferred.

The corrected corpus still supports the prior 11-category recommendation. Boundary and specificity
repairs materially reduce defect noise without weakening the evidence for `Pantry & Dry Goods`,
separate `Canned & Jarred` and `Sauces & Condiments`, and `Nuts, Seeds & Nut Butters`. No change to
the recommended future taxonomy is warranted; its migration and persisted-value compatibility plan
must remain a separate reviewed phase.
