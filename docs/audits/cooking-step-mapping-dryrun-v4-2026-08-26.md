# Cooking-step mapping v4 production dry run — 2026-08-26

## Executive verdict

READY FOR BACKFILL APPLY

This is a fresh full-corpus read-only validation. No historical v1, v2, or v3 candidate map was used, and no Firestore document was written.

All 187 source-eligible candidates satisfy the complete deterministic, AI semantic, stability, structural, source-hash, and absent-map gates. Accepted semantics are 134/134 correct with zero ambiguous or incorrect relationships; reviewed stability is 46 exact, 1 semantically stable, 3 safe-omission differences, and 0 unsafe material differences.

## Configuration audited

| Setting | Value |
|---|---|
| Git SHA | `abd3e82e8d64ca4dd5dde6ca754f5d4260411525` |
| Behavior fingerprint | `d0580cf952d58595b4eb8dc0c81212900357e928817f07a18fddff72d4d02ced` |
| Schema | `1` |
| Parser | `recipe-content-v1` |
| Deterministic engine | `deterministic-v4` |
| Hybrid engine | `hybrid-v4` |
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
| Existing `deterministic-v4` maps | 0 |
| Existing `hybrid-v4` maps | 0 |
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

## Deterministic-v4 results

| Metric | Count |
|---|---:|
| Instructions | 977 |
| Mapped steps | 459 |
| Unmapped steps | 518 |
| Ingredient references | 1040 |
| Ambiguous steps | 29 |
| Implicit-reference steps | 40 |
| Prepared-component steps | 76 |
| No-ingredient-use steps | 54 |
| Non-actionable steps | 17 |
| AI-eligible steps | 145 |
| Deterministic validation failures | 0 |

The exhaustive deterministic semantic review covered **187** eligible recipes: mapped references reviewed **1040**, safe mappings **1040**, safe omissions **518**, confirmed false-positive mappings **0**, confirmed false-positive recipes **0**. Exact byte-equivalent prior evidence was reused for **187** recipes; **0** recipes were freshly re-reviewed.


All nine deterministic-v2 failure recipes were included: Butter-Soy Chicken, Chicken Chow Mein, Chicken Wild Rice, Tacos Al Pastor, Sheet Pan Chicken Tinga, Chopped Thai Shrimp Salad, Singapore Mei Fun, Sesame Apricot Tofu, and Chickpea Curry. Their exact v4 results are recorded in the semantic-review artifact.

## Hybrid-v4 results

| Metric | Deterministic | Hybrid |
|---|---:|---:|
| Mapped steps | 459 | 494 |
| Mapped ingredient references | 1040 | 1085 |
| AI-eligible unresolved steps | 145 | 95 |
| Prepared components | 0 | 26 |

AI-eligible recipes: **94**; actual primary recipes called: **94**; primary requests: **94**; retries: **0**; failures: **0**; accepted ingredient additions: **45**; accepted prepared components: **26**; accepted usage qualifiers: **2**. Final mapped steps: **494**; final ingredient references: **1085**; remaining ambiguous: **23**; remaining implicit: **25**; remaining prepared-component semantics: **47**; total remaining AI-eligible: **95**.

Coverage is descriptive only. Conservative omission is preferred to an incorrect confident association.

## AI semantic accuracy

Accepted semantic relationships reviewed across primary and stability runs: **134** — correct **134**, ambiguous **0**, incorrect **0**. Primary relationships reviewed: **73**. Stability relationships reviewed: **61**. Accepted usage qualifiers reviewed: **5**. Every accepted relationship in both executed runs was reviewed.

- No ambiguous or incorrect accepted AI additions were found.

## Validator rejection evidence

Observed rejected or stripped suggestions/metadata: **758**.

| Reason | Count |
|---|---:|
| `UNCERTAIN_CONFIDENCE` | 30 |
| `INVALID_INDEX` | 0 |
| `HEADER_INDEX` | 0 |
| `DETERMINISTIC_LOCK` | 2 |
| `DUPLICATE_CONFLICT` | 4 |
| `GROUP_CONFLICT` | 0 |
| `CONTEXTUAL_OR_UNGROUNDED` | 250 |
| `NEGATIVE_OR_DEFERRED` | 122 |
| `UNBOUNDED_COLLECTIVE` | 192 |
| `UNSUPPORTED_REMAINING` | 2 |
| `UNSUPPORTED_USAGE` | 57 |
| `UNGROUNDED_QUANTITY` | 8 |
| `NON_ACTIONABLE` | 0 |
| `UNGROUNDED_PREPARED_COMPONENT` | 88 |
| `NONCANONICAL_COMPONENT_LABEL` | 3 |
| `OTHER` | 0 |

These counts are audit observations produced by replaying each model proposal through the unchanged production merger. They distinguish accepted additions from rejected suggestions and stripped metadata.

## Stability

Subset: **50** recipes — exact stable **46**, semantically stable **1**, safe-omission differences **3**, unsafe material differences **0**, errors **0**, provider retries **0**.

- **Broccoli Salad** (`broccoli-salad`) — SAFE_OMISSION_DIFFERENCE (automated comparator: UNSAFE_MATERIAL_DIFFERENCE): Primary and repeat accept the same ingredient rows at the same steps. The repeat additionally preserves the locally grounded partial-use qualifier a little for step 0 olive oil; the primary safely omits only that qualifier and remains appropriate to persist.
- **Chicken Chickpea Salad** (`chicken-chickpea-salad`) — SEMANTICALLY_STABLE (automated comparator: UNSAFE_MATERIAL_DIFFERENCE): Both runs accept the recipe single established Green Harissa dressing at step 4. dressing and green harissa dressing are two source-grounded labels for the same unique prepared component, not competing component identities.
- **Chopped Thai Shrimp Salad with Garlic Lime Dressing** (`chopped-thai-shrimp-salad-with-garlic-lime-dressing`) — SAFE_OMISSION_DIFFERENCE: Both runs accept dressing salt at step 0. The primary additionally accepts the explicitly named chopped shrimp at the assembly step; the repeat safely omits that correct relationship. The primary remains appropriate to persist.
- **Crispy Gnocchi With Tomato and Red Onion** (`crispy-gnocchi-with-tomato-and-red-onion`) — SAFE_OMISSION_DIFFERENCE (automated comparator: UNSAFE_MATERIAL_DIFFERENCE): Both runs accept the same olive-oil row at steps 0 and 2 and the same grounded 2-tablespoon qualifier at step 0. The repeat additionally preserves the locally grounded 3 to 4 tablespoons partial-use qualifier at step 2; the primary safely omits only that qualifier and remains appropriate to persist.

Historical stability comparison uses different denominators: v1 failed; v2 failed; v3 failed despite zero unsafe stability differences because deterministic precision failed; v4 deterministic remediation exhaustively reached zero false positives. The current full hybrid-v4 run is the only apply-readiness evidence.

## V1 → V2 → V3 → V4 comparison

| Measure | V2 full | V3 full | Fresh V4 full |
|---|---:|---:|---:|
| Deterministic false-positive recipes | 9 / 60 | 0 / 80 | 0 / 187 |
| Accepted AI relationships correct | 84 / 84 | 109 / 109 | 134 / 134 |
| Exact stability | 26 / 30 | 37 / 40 | 46 / 50 |
| Safe-omission stability differences | 4 / 30 | 3 / 40 | 3 / 50 |
| Unsafe stability differences | 0 / 30 | 0 / 40 | 0 / 50 |

The runs use different engines and review/stability denominators. Only commensurate precision and semantic-stability counts are compared.

## Recipe classification

| Classification | Count |
|---|---:|
| READY | 187 |
| REVIEW | 0 |
| EXCLUDED | 49 |
| ERROR | 0 |
| EXISTING_MAP | 0 |

## Remaining risks

The 49 source/parser exclusions remain outside automatic mapping, and personal override-specific mappings remain pending. These do not threaten the independently validated READY population.

## Future apply preconditions

For every READY row, a future apply must require: approved manifest SHA-256 matches the exact file AND the live recipe exists AND live `cookingStepIngredientMap` is absent AND fresh live shared-content `sourceHash === manifest.sourceHash` AND the manifest candidate validates under this exact audited v4 contract. Any failed precondition means SKIP.

A future writer may merge only `cookingStepIngredientMap`. It must not modify content, title, category, cuisine, nutrition, servings, times, image, source, metadata, or any user-owned data. No writer exists in this audit.

## Manifest integrity

Path: `docs/audits/cooking-step-mapping-dryrun-v4-2026-08-26.json`; SHA-256: `b07208384369183e70782f2e017fcea141d9436d43d7ea523133c72cd6435a88`; rows: **236**; READY **187**; REVIEW **0**; EXCLUDED **49**; ERROR **0**; EXISTING_MAP **0**. Every READY candidate passed current production validation, has a fresh source hash matching the final live reread, had no production map at audit time, and has no known semantic defect. The final live reread also matched the frozen configuration and behavior fingerprint.

## Historical manifest status

`docs/audits/cooking-step-mapping-dryrun-2026-08-25.json` (SHA-256 `03cccba16232237f2ffb8b0c1971ec3a66732da8a0f1480717769ac5f25093ae`) remains **HISTORICAL ONLY — NOT AUTHORIZED FOR APPLY**.

`docs/audits/cooking-step-mapping-dryrun-v2-2026-08-26.json` (SHA-256 `69a13a5c2a2366d372d747035a85df38bb702bbadc84df6f8a450d91ee0a73a0`) remains **HISTORICAL ONLY — NOT AUTHORIZED FOR APPLY**. Neither historical manifest supplied a candidate or classification to this run.

`docs/audits/cooking-step-mapping-dryrun-v3-2026-08-26.json` (SHA-256 `d4e381889e903016b57bd5c0ae7e6922035d3fb946858e04cfd6be15b98f396b`) remains **HISTORICAL ONLY — NOT AUTHORIZED FOR APPLY**. No historical manifest supplied a candidate or classification to this run.

## Production and AI execution

Firestore operations: read-only shared `recipes` collection queries; writes: **none**. Real Gateway requests: 144 (94 primary, 50 stability, 0 retries). The centralized helper emitted 144 usage records totaling 187408 input, 68380 output, and 255788 tokens for vercel-ai-gateway / openai/gpt-5.6-luna. No authoritative dollar cost was provided, so none is reported or estimated.
