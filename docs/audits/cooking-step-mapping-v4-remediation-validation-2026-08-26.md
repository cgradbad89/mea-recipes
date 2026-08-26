# Cooking-step mapping v4 remediation validation — 2026-08-26

## Executive result

**PASS — ready for a completely fresh full production hybrid-v4 dry run. Backfill is not ready or authorized.**

Deterministic-v4 fixes or safely omits all five deterministic-v3 false positives. The read-only
production pass reviewed every one of the 187 current source-eligible recipes and all 1,040
deterministic associations: 1,040 were safe, zero were false positives, and all 518 fully unmapped
instructions were safe omissions. The bounded hybrid-v4 compatibility run reviewed all 28 accepted
AI additions as correct; its 20-recipe stability run had 19 exact results, one safe-omission
difference, and zero unsafe material differences. Firestore writes were zero.

This report authorizes only the next separate read-only full production hybrid-v4 audit. It does not
authorize a manifest, backfill, production write, or reuse of any v1/v2/v3 artifact.

## Audited configuration

| Setting | Value |
|---|---|
| Schema | `1` |
| Parser | `recipe-content-v1` |
| Deterministic engine | `deterministic-v4` |
| Hybrid engine | `hybrid-v4` |
| AI prompt | `v2` |
| Model | `openai/gpt-5.6-luna` |
| Temperature | `0` |

Prompt text, model, mapping temperature, structured response, and AI validator semantics were not
changed. The AI layer changed only by recognizing v4 engine output.

## Five v3 failures

| Recipe | Unsafe v3 row and instruction | Root cause | Deterministic-v4 behavior |
|---|---|---|---|
| Mexican Oaxacan Bowl | Row 14, slaw `1 tablespoon olive oil`, mapped to step 2 sheet-pan drizzle | Unlisted use; wrong purpose/group | Row 14 is omitted from step 2. The unlisted sheet-pan oil remains an omission. |
| Creamy Kale Pasta | Row 5, sauce `1 teaspoon salt`, remapped to step 3 `Season to taste...` | Bounded collective consumption followed by accidental reuse for unlisted finishing salt | Row 5 maps as `all` in step 0 and is unavailable to the later bare salt reference; step 3 retains only its prepared-component ambiguity deterministically. |
| Schmancy Hot Smoked Salmon | Row 0 salmon mapped to step 0 `container large enough to hold the salmon` | Contextual mention, not active use | Salmon is omitted from step 0 and maps when placed in brine in step 1. |
| Schmancy Hot Smoked Salmon | Row 1 measured brine water mapped to step 2 rinse under cold water | Consumed-row reuse; fresh unlisted process material | Brine water maps when the brine is made and is omitted from the fresh rinse step. |
| Chili Lime Fish | Row 16 optional fresh garnish chile mapped to step 3 sauce aromatics | Food-form, purpose/group, and garnish/component leakage | Step 3 maps rows 5–8, including sauce chile flakes; garnish row 16 is omitted and remains eligible for an actionable garnish instruction. |

The exact pre-edit reconstruction is in
`docs/audits/cooking-step-mapping-v4-failure-matrix-2026-08-26.md`.

## Deterministic-v4 rules

- Row lifecycle is private to one deterministic traversal. A confidently mapped individual row, or a
  row mapped through a bounded group collective such as `all sauce ingredients`, becomes used.
- A used row cannot satisfy a later ordinary noun or quantity match. Identity and quantity evidence
  must both be compatible with row lifecycle.
- Reuse is allowed only for uniquely grounded `remaining`, `rest of`, or `reserved` language; a
  divided row with explicit partial-use evidence; or direct continuing manipulation such as returning,
  brushing, coating, cutting, or serving the already introduced ingredient.
- No numeric inventory, mass balance, substitution, yield, evaporation, or inferred remainder is
  calculated. Uncertain availability abstains.
- Fresh or separately quantified process material, small unlisted additions, and component-purpose
  mismatches cannot borrow a similar listed row.
- Ingredient form and purpose/group context remain row evidence. Optional rows are still allowed when
  an actionable instruction addresses their correct garnish/topping purpose.
- Clause-local action is required. Context such as `to hold the salmon`, `for the salmon`, or a
  before/while clause does not create an active association by itself.

## Additional full-corpus precision findings

The exhaustive review found and remediated six additional candidate classes before the final clean
run: bare `chicken` selecting chicken base; an onion first used by `spread` and later mentioned only
as a destination; a few unlisted tablespoons of water borrowing a measured row; an extra splash of
oil borrowing a measured row; a prepared miso-butter mention leaking to raw butter; and named main-
component instructions selecting oil/salt from a sauce group. Each is covered by a final-map
regression. No recipe title or ID is hard-coded in the production mapper.

## Deterministic full-corpus metrics

Read-only shared-catalog execution covered 236 recipes: 187 source-eligible and 49 excluded by the
unchanged source/parser eligibility rules. AI calls were zero and writes were zero.

| Metric | Deterministic-v3 | Deterministic-v4 | Change |
|---|---:|---:|---:|
| Instructions | 977 | 977 | 0 |
| Mapped steps | 509 | 459 | -50 |
| Unmapped steps | 468 | 518 | +50 |
| Ingredient references | 1,134 | 1,040 | -94 |
| Ambiguous | 28 | 29 | +1 |
| Implicit references | 40 | 40 | 0 |
| Prepared components | 76 | 76 | 0 |
| No-ingredient-use | 54 | 54 | 0 |
| Non-actionable | 17 | 17 | 0 |
| AI-eligible recipes | 144 | 145 | +1 |

The coverage decrease is the intended precision-first outcome and was not optimized away.

## Exhaustive deterministic semantic review

| Measure | Result |
|---|---:|
| Source-eligible recipes | 187 |
| Recipes reviewed | 187 |
| Mapped references reviewed | 1,040 |
| Safe mappings | 1,040 |
| Safe omissions | 518 |
| False-positive mappings | 0 |
| False-positive recipes | 0 |

Review included every mapping and every fully unmapped instruction, plus targeted cross-corpus checks
for repeated rows, small/fresh/extra process materials, compound aliases, group/purpose collisions,
and prepared-component leakage. Per-recipe evidence is in
`docs/audits/cooking-step-mapping-deterministic-v4-review-2026-08-26.json`.

## Bounded hybrid-v4 compatibility validation

The read-only run included 25 unique recipes and deliberately placed all four remediated recipes first.
It made 25 primary Gateway requests. All 28 validator-accepted additions were reviewed.

| Result | Count |
|---|---:|
| Accepted additions reviewed | 28 |
| Correct | 28 |
| Ambiguous | 0 |
| Incorrect | 0 |

Accepted additions by recipe/step were: Brown Butter Lentil and Sweet Potato Salad (step 5 sweet
potatoes); Chicken Chow Mein (steps 2–4: chicken, remaining divided oil, bok choy, bean sprouts, and
sauce); Chicken Gyro Chopped Salad (step 3 dressing); Chili Lime Fish (step 4 lime juice); Chopped
Thai Shrimp Salad (step 0 salt); Creamy Chickpea Spinach Masala (step 6 tadka); Creamy Kale Pasta
(step 3 sauce); Dan Dan Noodles (step 2 sauce); Fried Chicken Sandwich (step 0 chicken); Japanese
Cold Soba Noodle Salad (step 2 dressing); Korean Bulgogi Beef Bowls (steps 1–2 marinade); Mediterranean
Grilled Salmon (step 6 salmon and salt/pepper); Pad Thai (steps 5–6 sauce); Schmancy Hot Smoked Salmon
(step 7 glaze); Sesame Apricot Tofu (step 5 apricot sauce); Sheet Pan Chicken Tinga Bowls (step 2
tinga sauce); and Singapore Mei Fun (steps 11–12 bean sprouts, bell pepper, red onion, and scallions).

## Stability

Twenty of the bounded recipes received one repeat Gateway request each.

| Classification | Count |
|---|---:|
| `EXACT_STABLE` | 19 |
| `SEMANTICALLY_STABLE` | 0 |
| `SAFE_OMISSION_DIFFERENCE` | 1 |
| `UNSAFE_MATERIAL_DIFFERENCE` | 0 |

Chili Lime Fish was the sole safe-omission difference. The primary safely accepted lime juice only;
the repeat also correctly accepted the listed sauce water and the prepared `sauce` component. Both
outputs were safe, with no incorrect relationship in either result.

## Regression validation

The v4 suite adds exact final-map coverage for all five failures and generic coverage for bounded
collective consumption, accidental consumed-row reuse, explicit divided/remaining reuse, continuing
active manipulation, unlisted sheet-pan oil, fresh/process water, small/extra process quantities,
contextual versus active protein, form-specific optional garnish, purpose/group separation, prepared-
component leakage, and all additional full-corpus findings.

All historical v1/v2/v3 fixtures remain covered, including Butter-Soy Chicken, Chicken Chow Mein,
Chicken Wild Rice, Tacos Al Pastor, Sheet Pan Chicken Tinga, Chopped Thai Shrimp Salad, Singapore Mei
Fun, Sesame Apricot Tofu, Chickpea Curry, coconut oil versus coconut milk, chicken broth versus generic
chicken, negative/deferred clauses, prepared components, headings/labels, supplemental notes,
duplicate-group abstention, chile-form distinctions, and bacon/fat context.

## Historical manifest integrity and authorization

All files remained byte-for-byte unchanged:

- v1 SHA-256 `03cccba16232237f2ffb8b0c1971ec3a66732da8a0f1480717769ac5f25093ae` — **NOT AUTHORIZED**
- v2 SHA-256 `69a13a5c2a2366d372d747035a85df38bb702bbadc84df6f8a450d91ee0a73a0` — **NOT AUTHORIZED**
- v3 SHA-256 `d4e381889e903016b57bd5c0ae7e6922035d3fb946858e04cfd6be15b98f396b` — **NOT AUTHORIZED**

No v4 manifest was generated. No apply tool was created. No production document was mutated.

## Remaining work

Run a completely fresh full production hybrid-v4 dry run from current live content in a separate
session and generate a brand-new immutable manifest/hash. Do not reuse any prior manifest. The 49
source/parser exclusions and personal override-specific mappings remain separate pending work.
