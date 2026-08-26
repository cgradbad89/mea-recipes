# Recovered recipes cooking-step mapping v4 dry run — 2026-08-26

## Executive result

**NOT READY FOR MAPPING APPLY**

This read-only audit generated fresh source-bound candidates for the exact 41 recipes repaired by Waves 1A–3. Recipe writes, map writes, and Firestore mutations were all zero.

## Audited configuration

| Setting | Value |
|---|---|
| Git SHA | `8cee451f5a82256f302cae869cd16f6e910c8336` |
| Behavior fingerprint | `57e7f102127ac3401e976e62e94f4f9923975d6a53da34eb360d6b0bfdeb83fd` |
| Schema | `1` |
| Parser | `recipe-content-v1` |
| Deterministic engine | `deterministic-v4` |
| Hybrid engine | `hybrid-v4` |
| Prompt | `v2` |
| Model | `openai/gpt-5.6-luna` |
| Temperature | `0` |

## Population and production baseline

Wave 1A **28** + Wave 2 **6** + Wave 3 **7** = **41 unique IDs**. The final eight unresolved recipes are absent. Production contained **236** shared recipes, **187** persisted maps, and **49** recipes without maps. All 41 tranche recipes were map-free and source-clean.

## Deterministic-v4

Instructions **233**; mapped steps **119**; unmapped steps **114**; ingredient references **267**; ambiguous **10**; implicit **16**; prepared-component **22**; no-ingredient-use **1**; non-actionable **2**; AI-eligible **48**.

Exhaustive review covered **41** recipes, **267** mapped references, and **114** omissions: safe mappings **260**, false-positive mappings **7**, false-positive recipes **7**.

- **Couscous Salad With Lime Basil Vinaigrette** (`couscous-salad-with-lime-basil-vinaigrette`) — The sweet-potato step borrows the measured salt row from the Lime Basil Vinaigrette group for an unlisted sprinkle of salt.
- **Dad's Chili** (`dads-chili`) — A generic reference to the finished dish as smoother chili is incorrectly matched to the Chili Sauce ingredient row.
- **Easy Chicken Ramen** (`easy-chicken-ramen`) — The egg-boiling step incorrectly reuses the measured soup-water row for unlisted process water.
- **Pepper Steak** (`pepper-steak`) — The soy-sauce relationship is correct, but deterministic usage metadata records only 1/2 tablespoon instead of the locally grounded 2 1/2 tablespoons.
- **Peruvian Roasted Chicken With Spicy Cilantro Sauce** (`peruvian-roasted-chicken-with-spicy-cilantro-sauce`) — The sauce step selects the chicken-marinade aji amarillo row instead of the separate sauce-group row.
- **Tuscan Bean Soup** (`tuscan-bean-soup`) — The soup aromatics step selects garlic from the separate rosemary-lemon-oil component.
- **Vegetarian Skillet Chili** (`vegetarian-skillet-chili`) — The pickling step selects the main-chili onion instead of the pickled-onion group row.

These failures span wrong-group/consumed-row identity, unlisted process material, generic dish-name collision, and incorrect usage metadata. The deterministic zero-false-positive gate therefore fails systemically; no mapper change was made in this audit.

## Hybrid-v4 and AI semantic review

AI-eligible recipes **27**; recipes called **27**; primary requests **27**; stability requests **27**; accepted ingredient additions **12**; accepted prepared components **6**; accepted usage qualifiers **1**. Across primary and stability runs, reviewed accepted semantics were correct **32**, ambiguous **0**, incorrect **2**.

- **Couscous Salad With Lime Basil Vinaigrette** (`couscous-salad-with-lime-basil-vinaigrette`, primary) — The measured salt row belongs to and is consumed by the vinaigrette; final salad seasoning is unlisted additional salt.
- **Couscous Salad With Lime Basil Vinaigrette** (`couscous-salad-with-lime-basil-vinaigrette`, stability) — The repeat makes the same wrong-group, consumed-row salt association.

The two incorrect accepted relationships are the same wrong-group/consumed vinaigrette-salt association in the primary and repeat runs.

## Stability

All **27** AI-assisted recipes were rerun: exact **25**, semantically stable **0**, safe omission difference **2**, unsafe material difference **0**. Every non-exact result was manually reviewed.

## Classification and immutable manifest

READY **34**; REVIEW **0**; EXCLUDED **7**; ERROR **0**; EXISTING_MAP **0**.

Manifest: `docs/audits/recovered-recipes-mapping-v4-dryrun-2026-08-26.json`; SHA-256: `289759234b88c4d29b18fe42a7f67f2e18473cc9285dd5df4ef9ced798ca1716`; rows: **41**. Semantic evidence: `docs/audits/recovered-recipes-mapping-v4-semantic-review-2026-08-26.json`.

## Final live preconditions and existing-map safety

Final live READY checks: **34/34** passed. Existing persisted maps: **187**; sourceHash/validator matches: **187**; invalid: **0**. The audit caused zero production changes.

## Production mutation and AI usage

Recipe writes **0**; map writes **0**; Firestore mutations **0**. Real Gateway requests **54** (27 primary and 27 stability; zero retries and failures), totaling **78402** input, **30384** output, and **108786** tokens.

## Deferred work and next action

Do not apply any recovered-recipe candidate from this failed audit. Create a separate deterministic-v4/prompt-v2 remediation and validation session for the seven deterministic false positives and the repeated incorrect AI salt association, then rerun the complete 41-recipe audit from fresh live content. Wave 4/5 and personal override-specific mappings remain pending.
