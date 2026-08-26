# Cooking-step mapping v3 production dry run — 2026-08-26

## Executive verdict

NOT READY FOR BACKFILL

This is a fresh full-corpus read-only validation. No historical v1 or v2 candidate map was used, and no Firestore document was written.

The 100-recipe deterministic-v3 precision review found five false-positive mappings across four recipes. The failures cross wrong-group reuse, fully-consumed ingredient reuse, contextual mentions, and unlisted replacement/rinse ingredients. Because these are systemic precision classes that can affect recipes outside the reviewed subset, neither unrestricted nor restricted backfill is authorized.

## Configuration audited

| Setting | Value |
|---|---|
| Git SHA | `cfdf9c245ad882a0ef422bd429aca16ec97bf196` |
| Schema | `1` |
| Parser | `recipe-content-v1` |
| Deterministic engine | `deterministic-v3` |
| Hybrid engine | `hybrid-v3` |
| Prompt | `v2` |
| Model | `openai/gpt-5.6-luna` |
| Temperature | `0` |

## Production baseline

| Metric | Count |
|---|---:|
| Total shared documents | 236 |
| Nonempty shared content | 236 |
| Existing persisted maps | 0 |
| Existing `deterministic-v1` maps | 0 |
| Existing `hybrid-v1` maps | 0 |
| Existing `deterministic-v2` maps | 0 |
| Existing `hybrid-v2` maps | 0 |
| Existing `deterministic-v3` maps | 0 |
| Existing `hybrid-v3` maps | 0 |
| Source eligible | 187 |
| Source/parser excluded | 49 |
| Empty parsed ingredient arrays | 2 |
| Empty parsed instruction arrays | 8 |

## Source/content eligibility

| Status | Count |
|---|---:|
| `ELIGIBLE` | 187 |
| `EXCLUDE_METADATA` | 8 |
| `EXCLUDE_NO_INGREDIENTS` | 2 |
| `EXCLUDE_NO_INSTRUCTIONS` | 6 |
| `EXCLUDE_PAYWALL` | 1 |
| `EXCLUDE_REVIEW_COMMENT` | 5 |
| `EXCLUDE_SOURCE_URL` | 24 |
| `EXCLUDE_STRUCTURAL_DEFECT` | 3 |

- **Chana Masala** (`chana-masala`) — `EXCLUDE_METADATA`: Step 9: standalone nutrition, storage, or source metadata parsed as a cooking instruction.
- **Chicken Enchiladas** (`chicken-enchiladas`) — `EXCLUDE_SOURCE_URL`: Step 4: source URL parsed as a cooking instruction.
- **Chicken Fajitas** (`chicken-fajitas`) — `EXCLUDE_SOURCE_URL`: Step 6: source URL parsed as a cooking instruction.
- **Chicken Paprikash** (`chicken-paprikash`) — `EXCLUDE_SOURCE_URL`: Step 4: source URL parsed as a cooking instruction.
- **Chicken Stew** (`chicken-stew`) — `EXCLUDE_SOURCE_URL`: Step 5: source URL parsed as a cooking instruction.
- **Chicken Tacos w/ Pineapple** (`chicken-tacos-w-pineapple`) — `EXCLUDE_SOURCE_URL`: Step 8: source URL parsed as a cooking instruction.
- **Chimichurri Chicken** (`chimichurri-chicken`) — `EXCLUDE_REVIEW_COMMENT`: Step 7: review/comment chrome parsed as a cooking instruction. Step 8: review/comment chrome parsed as a cooking instruction. Step 9: review/comment chrome parsed as a cooking instruction. Step 10: review/comment chrome parsed as a cooking instruction. Step 12: review/comment chrome parsed as a cooking instruction. Step 13: review/comment chrome parsed as a cooking instruction. Step 14: review/comment chrome parsed as a cooking instruction.
- **Chinese Chili Oil** (`chinese-chili-oil`) — `EXCLUDE_METADATA`: Step 5: standalone nutrition, storage, or source metadata parsed as a cooking instruction.
- **Chipotle Tahini Bowls** (`chipotle-tahini-bowls`) — `EXCLUDE_STRUCTURAL_DEFECT`: PRD-known legacy source defect: the ingredient source mixes unquantified bowl suggestions with note-only preparation content.
- **Couscous Salad With Lime Basil Vinaigrette** (`couscous-salad-with-lime-basil-vinaigrette`) — `EXCLUDE_SOURCE_URL`: Step 4: source URL parsed as a cooking instruction.
- **Crazy good Dal Adas (Spicy Red Lentil Tamarind Soup)** (`crazy-good-dal-adas-spicy-red-lentil-tamarind-soup`) — `EXCLUDE_SOURCE_URL`: Step 5: source URL parsed as a cooking instruction.
- **Creamy Cauliflower Soup With Rosemary Olive Oil** (`creamy-cauliflower-soup-with-rosemary-olive-oil`) — `EXCLUDE_SOURCE_URL`: Step 6: source URL parsed as a cooking instruction.
- **Crisp Gnocchi With Brussels Sprouts and Brown Butter** (`crisp-gnocchi-with-brussels-sprouts-and-brown-butter`) — `EXCLUDE_SOURCE_URL`: Step 3: source URL parsed as a cooking instruction.
- **Crispy Gnocchi With Burst Tomatoes and Mozzarella** (`crispy-gnocchi-with-burst-tomatoes-and-mozzarella`) — `EXCLUDE_SOURCE_URL`: Step 4: source URL parsed as a cooking instruction.
- **Crispy Gnocchi With Sausage and Broccoli** (`crispy-gnocchi-with-sausage-and-broccoli`) — `EXCLUDE_SOURCE_URL`: Step 3: source URL parsed as a cooking instruction.
- **Crunchy Queso Wrap** (`crunchy-queso-wrap`) — `EXCLUDE_NO_INSTRUCTIONS`: parseRecipeContent returned no instructions from shared content.
- **Curried Red Bean Soup With Kale** (`curried-red-bean-soup-with-kale`) — `EXCLUDE_REVIEW_COMMENT`: Step 7: review/comment chrome parsed as a cooking instruction.
- **Curry Tomatoes and Chickpeas With Cucumber Yogurt** (`curry-tomatoes-and-chickpeas-with-cucumber-yogurt`) — `EXCLUDE_SOURCE_URL`: Step 4: source URL parsed as a cooking instruction.
- **Dad's Chili** (`dads-chili`) — `EXCLUDE_NO_INSTRUCTIONS`: parseRecipeContent returned no instructions from shared content.
- **Easy Chicken Ramen** (`easy-chicken-ramen`) — `EXCLUDE_METADATA`: Step 16: standalone nutrition, storage, or source metadata parsed as a cooking instruction.
- **Filipino Brased Chicken Tocino** (`filipino-brased-chicken-tocino`) — `EXCLUDE_NO_INSTRUCTIONS`: parseRecipeContent returned no instructions from shared content.
- **Huevos Rotos (Broken Eggs)** (`huevos-rotos-broken-eggs`) — `EXCLUDE_REVIEW_COMMENT`: Step 4: review/comment chrome parsed as a cooking instruction. Step 5: review/comment chrome parsed as a cooking instruction. Step 6: review/comment chrome parsed as a cooking instruction. Step 7: review/comment chrome parsed as a cooking instruction. Step 8: review/comment chrome parsed as a cooking instruction. Step 10: review/comment chrome parsed as a cooking instruction.
- **Kung Pao Tofu** (`kung-pao-tofu`) — `EXCLUDE_SOURCE_URL`: Step 5: source URL parsed as a cooking instruction.
- **Lemon Herb Pasta Salad with Marinated Chickpeas** (`lemon-herb-pasta-salad-with-marinated-chickpeas`) — `EXCLUDE_STRUCTURAL_DEFECT`: The parsed ingredient list omits the chickpeas named by the recipe and instructions.
- **Lemongrass Chicken** (`lemongrass-chicken`) — `EXCLUDE_METADATA`: Step 6: standalone source note parsed as a cooking instruction.
- **Maple Roasted Candied Pecans** (`maple-roasted-candied-pecans`) — `EXCLUDE_NO_INGREDIENTS`: parseRecipeContent returned no ingredients from shared content.
- **Mexican Street Corn** (`mexican-street-corn`) — `EXCLUDE_NO_INSTRUCTIONS`: parseRecipeContent returned no instructions from shared content.
- **Mole Poblano** (`mole-poblano`) — `EXCLUDE_STRUCTURAL_DEFECT`: PRD-known legacy source defect: storage/tip prose and presentation labels are parsed as cooking instructions.
- **One-Pot Chicken and Lentil** (`onepot-chicken-and-lentil`) — `EXCLUDE_SOURCE_URL`: Step 5: source URL parsed as a cooking instruction.
- **One-Pot Chicken and Rice With Caramelized Lemon** (`onepot-chicken-and-rice-with-caramelized-lemon`) — `EXCLUDE_SOURCE_URL`: Step 5: source URL parsed as a cooking instruction.
- **One-Pot Ratatouille Pasta** (`onepot-ratatouille-pasta`) — `EXCLUDE_SOURCE_URL`: Step 3: source URL parsed as a cooking instruction.
- **Peanut Butter Oat Protein Shake** (`peanut-butter-oat-protein-shake`) — `EXCLUDE_METADATA`: Step 1: standalone nutrition, storage, or source metadata parsed as a cooking instruction.
- **Pearl Couscous With Creamy Feta and Chickpeas - meh** (`pearl-couscous-with-creamy-feta-and-chickpeas-meh`) — `EXCLUDE_SOURCE_URL`: Step 5: source URL parsed as a cooking instruction.
- **Pepper Steak** (`pepper-steak`) — `EXCLUDE_SOURCE_URL`: Step 5: source URL parsed as a cooking instruction.
- **Peruvian Chicken w/ green sauce** (`peruvian-chicken-w-green-sauce`) — `EXCLUDE_METADATA`: Step 6: standalone nutrition, storage, or source metadata parsed as a cooking instruction.
- **Peruvian Roasted Chicken With Spicy Cilantro Sauce** (`peruvian-roasted-chicken-with-spicy-cilantro-sauce`) — `EXCLUDE_REVIEW_COMMENT`: Step 7: review/comment chrome parsed as a cooking instruction. Step 8: review/comment chrome parsed as a cooking instruction.
- **Pork Fried Rice** (`pork-fried-rice`) — `EXCLUDE_SOURCE_URL`: Step 14: source URL parsed as a cooking instruction.
- **Pozole Verde - WOWZA** (`pozole-verde-wowza`) — `EXCLUDE_SOURCE_URL`: Step 11: source URL parsed as a cooking instruction.
- **Rising Sun - Mazcal** (`rising-sun-mazcal`) — `EXCLUDE_NO_INSTRUCTIONS`: parseRecipeContent returned no instructions from shared content.
- **Roasted White Bean and Tomato Pasta** (`roasted-white-bean-and-tomato-pasta`) — `EXCLUDE_SOURCE_URL`: Step 7: source URL parsed as a cooking instruction.
- **Sheet-Pan Gochujang Chicken and Roasted Vegetables** (`sheetpan-gochujang-chicken-and-roasted-vegetables`) — `EXCLUDE_SOURCE_URL`: Step 4: source URL parsed as a cooking instruction.
- **Smoothies** (`smoothies`) — `EXCLUDE_NO_INGREDIENTS`: parseRecipeContent returned no ingredients from shared content.
- **Spaghetti Carbonara** (`spaghetti-carbonara`) — `EXCLUDE_PAYWALL`: Step 0: unavailable/paywalled placeholder parsed as a cooking instruction.
- **Speget with fake meat meatballs** (`speget-with-fake-meat-meatballs`) — `EXCLUDE_NO_INSTRUCTIONS`: parseRecipeContent returned no instructions from shared content.
- **Spicy Oven-Fried Rice With Gochujang and Fried Eggs** (`spicy-ovenfried-rice-with-gochujang-and-fried-eggs`) — `EXCLUDE_REVIEW_COMMENT`: Step 6: review/comment chrome parsed as a cooking instruction. Step 7: review/comment chrome parsed as a cooking instruction. Step 8: review/comment chrome parsed as a cooking instruction. Step 9: review/comment chrome parsed as a cooking instruction. Step 10: review/comment chrome parsed as a cooking instruction. Step 11: review/comment chrome parsed as a cooking instruction. Step 12: review/comment chrome parsed as a cooking instruction. Step 13: review/comment chrome parsed as a cooking instruction. Step 14: review/comment chrome parsed as a cooking instruction.
- **Tuscan Bean Soup** (`tuscan-bean-soup`) — `EXCLUDE_METADATA`: Step 8: standalone source note parsed as a cooking instruction.
- **Vegetarian Skillet Chili** (`vegetarian-skillet-chili`) — `EXCLUDE_SOURCE_URL`: Step 4: source URL parsed as a cooking instruction.
- **Zesty Quinoa Salad** (`zesty-quinoa-salad`) — `EXCLUDE_METADATA`: Step 3: standalone nutrition, storage, or source metadata parsed as a cooking instruction.
- **Zibdiyit Gambari (Spicy Shrimp and Tomato Stew)** (`zibdiyit-gambari-spicy-shrimp-and-tomato-stew`) — `EXCLUDE_SOURCE_URL`: Step 5: source URL parsed as a cooking instruction.

These exclusions are source/parser defects, not mapper abstentions. No legacy content was repaired in this audit.

## Deterministic-v3 results

| Metric | Count |
|---|---:|
| Instructions | 977 |
| Mapped steps | 509 |
| Unmapped steps | 468 |
| Ingredient references | 1134 |
| Ambiguous steps | 28 |
| Implicit-reference steps | 40 |
| Prepared-component steps | 76 |
| No-ingredient-use steps | 54 |
| Non-actionable steps | 17 |
| AI-eligible steps | 144 |
| Deterministic validation failures | 0 |

The new deterministic semantic review covered **100** eligible recipes: safe correct mappings **638**, safe omissions **290**, confirmed false-positive mappings **5**, confirmed false-positive recipes **4**.

- **Mexican Oaxacan Bowl** (`mexican-oaxacan-bowl`) — FALSE POSITIVE: instruction 2 maps ingredient 14, the olive oil under Quick Cabbage Slaw, to the sheet-pan onion and sweet potato drizzle. The sheet-pan oil is unlisted; this is a wrong-component/group association.
- **Creamy Kale Pasta** (`creamy-kale-pasta`) — FALSE POSITIVE: instruction 3 maps ingredient 5, the sauce salt already consumed by instruction 0 via “all sauce ingredients,” to an additional finishing “salt and pepper” use. The finishing salt is unlisted and the mapped row belongs to the completed sauce component.
- **Schmancy Hot Smoked Salmon** (`schmancy-hot-smoked-salmon`) — FALSE POSITIVES: instruction 0 maps ingredient 0 from the contextual phrase “container large enough to hold the salmon,” before salmon is actively used; instruction 2 maps ingredient 1, the measured brine water, to fresh unlisted rinse water after the brine step.
- **Chili Lime Fish** (`chili-lime-fish`) — FALSE POSITIVE: instruction 3 maps ingredient 16, the optional garnish red chilli, to the sauce-aromatics phrase “Cook garlic, chilli and ginger.” The active sauce chile is ingredient 8 (chilli flakes); ingredient 16 is in the garnish group.

All nine deterministic-v2 failure recipes were included: Butter-Soy Chicken, Chicken Chow Mein, Chicken Wild Rice, Tacos Al Pastor, Sheet Pan Chicken Tinga, Chopped Thai Shrimp Salad, Singapore Mei Fun, Sesame Apricot Tofu, and Chickpea Curry. Their exact v3 results are recorded in the semantic-review artifact.

## Hybrid-v3 results

| Metric | Deterministic | Hybrid |
|---|---:|---:|
| Mapped steps | 509 | 537 |
| Mapped ingredient references | 1134 | 1170 |
| AI-eligible unresolved steps | 144 | 99 |
| Prepared components | 0 | 28 |

AI-eligible recipes: **95**; actual primary recipes called: **95**; primary requests: **95**; retries: **0**; failures: **0**; accepted ingredient additions: **36**; accepted prepared components: **28**. Final mapped steps: **537**; final ingredient references: **1170**; remaining ambiguous: **24**; remaining implicit: **24**; remaining prepared-component semantics: **51**.

Coverage is descriptive only. Conservative omission is preferred to an incorrect confident association.

## AI semantic accuracy

Accepted additions reviewed across primary and stability runs: **109** — correct **109**, ambiguous **0**, incorrect **0**. Primary additions reviewed: **64**. Stability additions reviewed: **45**. Accepted usage qualifiers reviewed: **5**. Every accepted addition in both executed runs was reviewed.

- No ambiguous or incorrect accepted AI additions were found.

## Validator rejection evidence

Observed rejected or stripped suggestions/metadata: **658**.

| Reason | Count |
|---|---:|
| `UNCERTAIN_CONFIDENCE` | 29 |
| `INVALID_INDEX` | 0 |
| `HEADER_INDEX` | 0 |
| `DETERMINISTIC_LOCK` | 0 |
| `DUPLICATE_CONFLICT` | 0 |
| `GROUP_CONFLICT` | 0 |
| `CONTEXTUAL_OR_UNGROUNDED` | 231 |
| `NEGATIVE_OR_DEFERRED` | 102 |
| `UNBOUNDED_COLLECTIVE` | 169 |
| `UNSUPPORTED_REMAINING` | 2 |
| `UNSUPPORTED_USAGE` | 42 |
| `UNGROUNDED_QUANTITY` | 5 |
| `NON_ACTIONABLE` | 0 |
| `UNGROUNDED_PREPARED_COMPONENT` | 77 |
| `NONCANONICAL_COMPONENT_LABEL` | 1 |
| `OTHER` | 0 |

These counts are audit observations produced by replaying each model proposal through the unchanged production merger. They distinguish accepted additions from rejected suggestions and stripped metadata.

## Stability

Subset: **40** recipes — exact stable **37**, semantically stable **0**, safe-omission differences **3**, unsafe material differences **0**, errors **0**, provider retries **0**.

- **Chili Lime Fish** (`chili-lime-fish`) — SAFE_OMISSION_DIFFERENCE: Primary accepted water (ingredient 12), lime juice (ingredient 13), and the canonical sauce component at instruction 4; the rerun accepted the same ingredient references but safely omitted the component. Every accepted relationship in both runs was reviewed correct.
- **Japanese Teriyaki Salmon Bowl** (`japanese-teriyaki-salmon-bowl`) — SAFE_OMISSION_DIFFERENCE: Primary accepted the canonical teriyaki sauce component; the rerun accepted the same component plus the correct oil row (ingredient 7). The variance is omission-only and every accepted relationship was reviewed correct.
- **Sheet Pan Chicken Tinga Bowls** (`sheet-pan-chicken-tinga-bowls`) — SAFE_OMISSION_DIFFERENCE: Primary accepted the canonical tinga sauce component at instruction 2; the rerun accepted that component at instructions 1 and 2. The additional establishing-step component is correct, no conflicting relationship appears, and the persisted candidate does not rely on an unsafe association.

Historical stability comparison (different denominators): v1 had 10/20 material differences; bounded v2 had 1/20; full v2 had 4/30 safe-omission/component differences; bounded v3 had 20/20 exact.

## V1 → V2 → V3 comparison

| Measure | V2 full | V3 remediation | Fresh V3 full |
|---|---:|---:|---:|
| Deterministic false-positive recipes | 9 / 60 | 0 / 80 | 4 / 100 |
| Accepted AI additions correct | 84 / 84 | 22 / 22 | 109 / 109 |
| Exact stability | 26 / 30 | 20 / 20 | 37 / 40 |
| Safe-omission stability differences | 4 / 30 | 0 / 20 | 3 / 40 |
| Unsafe stability differences | 0 / 30 | 0 / 20 | 0 / 40 |

The runs use different engines and review/stability denominators. Only commensurate precision and semantic-stability counts are compared.

## Recipe classification

| Classification | Count |
|---|---:|
| READY | 181 |
| REVIEW | 2 |
| EXCLUDED | 53 |
| ERROR | 0 |
| EXISTING_MAP | 0 |

## Remaining risks

- Deterministic-v3 still produces systemic false-positive relationships for wrong-group or already-consumed ingredients and contextual/unlisted-use phrases.
- Three AI stability reruns had reviewed safe-omission differences, though neither run produced an incorrect AI association.
- The 49 source/parser exclusions remain unfixed and were not moved into the eligible population.
- Personal override-specific maps remain unimplemented.

## Future apply preconditions

For every READY row, a future apply must require: approved manifest SHA-256 matches the exact file AND the live recipe exists AND live `cookingStepIngredientMap` is absent AND fresh live shared-content `sourceHash === manifest.sourceHash` AND the manifest candidate validates under this exact audited v3 contract. Any failed precondition means SKIP.

A future writer may merge only `cookingStepIngredientMap`. It must not modify content, title, category, cuisine, nutrition, servings, times, image, source, metadata, or any user-owned data. No writer exists in this audit.

## Manifest integrity

Path: `docs/audits/cooking-step-mapping-dryrun-v3-2026-08-26.json`; SHA-256: `d4e381889e903016b57bd5c0ae7e6922035d3fb946858e04cfd6be15b98f396b`; rows: **236**; READY **181**; REVIEW **2**; EXCLUDED **53**; ERROR **0**; EXISTING_MAP **0**. Every READY candidate passed current production validation, has a fresh source hash, and had no production map at audit time.

## Historical manifest status

`docs/audits/cooking-step-mapping-dryrun-2026-08-25.json` (SHA-256 `03cccba16232237f2ffb8b0c1971ec3a66732da8a0f1480717769ac5f25093ae`) remains **HISTORICAL ONLY — NOT AUTHORIZED FOR APPLY**.

`docs/audits/cooking-step-mapping-dryrun-v2-2026-08-26.json` (SHA-256 `69a13a5c2a2366d372d747035a85df38bb702bbadc84df6f8a450d91ee0a73a0`) remains **HISTORICAL ONLY — NOT AUTHORIZED FOR APPLY**. Neither historical manifest supplied a candidate or classification to this run.

## Production and AI execution

Firestore operations: read-only shared `recipes` collection queries; writes: **none**. Real Gateway requests: 135 (95 primary, 40 stability, 0 retries). The centralized helper emitted 135 usage records totaling 176592 input, 65213 output, and 241805 tokens for vercel-ai-gateway / openai/gpt-5.6-luna. No authoritative dollar cost was provided, so none is reported or estimated.
