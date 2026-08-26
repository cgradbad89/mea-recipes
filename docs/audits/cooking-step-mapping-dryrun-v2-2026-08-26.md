# Cooking-step mapping v2 production dry run — 2026-08-26

## Executive verdict

NOT READY FOR BACKFILL

This is a fresh full-corpus read-only validation. No historical v1 candidate map was used, and no Firestore document was written.

Fresh corpus evidence found systemic deterministic-v2 false positives in the reviewed READY population, and the full 30-recipe stability rerun had 4/30 material safe-omission differences (13.3%), above the automatic-backfill target. Accepted AI additions were all correct, but structural validation cannot make the deterministic candidates safe.

## Configuration audited

| Setting | Value |
|---|---|
| Git SHA | `d4412bc411997ad2429eb8fc7a848462662176cc` |
| Schema | `1` |
| Parser | `recipe-content-v1` |
| Deterministic engine | `deterministic-v2` |
| Hybrid engine | `hybrid-v2` |
| Prompt | `v2` |
| Model | `openai/gpt-5.6-luna` |
| Temperature | `0` |

## Production baseline

| Metric | Count |
|---|---:|
| Total shared documents | 236 |
| Nonempty shared content | 236 |
| Existing persisted maps | 0 |
| Existing v1 maps | 0 |
| Current v2 maps | 0 |
| Source eligible | 187 |
| Source/parser excluded | 49 |
| Parser-defective | 41 |
| Empty parsed ingredient arrays | 2 |
| Empty parsed instruction arrays | 8 |

## Source/content eligibility

| Status | Count |
|---|---:|
| `ELIGIBLE` | 187 |
| `EXCLUDE_NO_INGREDIENTS` | 2 |
| `EXCLUDE_NO_INSTRUCTIONS` | 6 |
| `EXCLUDE_PARSER_DEFECT` | 41 |

- **Chana Masala** (`chana-masala`) — `EXCLUDE_PARSER_DEFECT`: Step 9: standalone nutrition, storage, or source metadata parsed as a cooking instruction.
- **Chicken Enchiladas** (`chicken-enchiladas`) — `EXCLUDE_PARSER_DEFECT`: Step 4: source URL parsed as a cooking instruction.
- **Chicken Fajitas** (`chicken-fajitas`) — `EXCLUDE_PARSER_DEFECT`: Step 6: source URL parsed as a cooking instruction.
- **Chicken Paprikash** (`chicken-paprikash`) — `EXCLUDE_PARSER_DEFECT`: Step 4: source URL parsed as a cooking instruction.
- **Chicken Stew** (`chicken-stew`) — `EXCLUDE_PARSER_DEFECT`: Step 5: source URL parsed as a cooking instruction.
- **Chicken Tacos w/ Pineapple** (`chicken-tacos-w-pineapple`) — `EXCLUDE_PARSER_DEFECT`: Step 8: source URL parsed as a cooking instruction.
- **Chimichurri Chicken** (`chimichurri-chicken`) — `EXCLUDE_PARSER_DEFECT`: Step 7: review/comment chrome parsed as a cooking instruction. Step 8: review/comment chrome parsed as a cooking instruction. Step 9: review/comment chrome parsed as a cooking instruction. Step 10: review/comment chrome parsed as a cooking instruction. Step 12: review/comment chrome parsed as a cooking instruction. Step 13: review/comment chrome parsed as a cooking instruction. Step 14: review/comment chrome parsed as a cooking instruction.
- **Chinese Chili Oil** (`chinese-chili-oil`) — `EXCLUDE_PARSER_DEFECT`: Step 5: standalone nutrition, storage, or source metadata parsed as a cooking instruction.
- **Chipotle Tahini Bowls** (`chipotle-tahini-bowls`) — `EXCLUDE_PARSER_DEFECT`: PRD-known legacy source defect: the ingredient source mixes unquantified bowl suggestions with note-only preparation content.
- **Couscous Salad With Lime Basil Vinaigrette** (`couscous-salad-with-lime-basil-vinaigrette`) — `EXCLUDE_PARSER_DEFECT`: Step 4: source URL parsed as a cooking instruction.
- **Crazy good Dal Adas (Spicy Red Lentil Tamarind Soup)** (`crazy-good-dal-adas-spicy-red-lentil-tamarind-soup`) — `EXCLUDE_PARSER_DEFECT`: Step 5: source URL parsed as a cooking instruction.
- **Creamy Cauliflower Soup With Rosemary Olive Oil** (`creamy-cauliflower-soup-with-rosemary-olive-oil`) — `EXCLUDE_PARSER_DEFECT`: Step 6: source URL parsed as a cooking instruction.
- **Crisp Gnocchi With Brussels Sprouts and Brown Butter** (`crisp-gnocchi-with-brussels-sprouts-and-brown-butter`) — `EXCLUDE_PARSER_DEFECT`: Step 3: source URL parsed as a cooking instruction.
- **Crispy Gnocchi With Burst Tomatoes and Mozzarella** (`crispy-gnocchi-with-burst-tomatoes-and-mozzarella`) — `EXCLUDE_PARSER_DEFECT`: Step 4: source URL parsed as a cooking instruction.
- **Crispy Gnocchi With Sausage and Broccoli** (`crispy-gnocchi-with-sausage-and-broccoli`) — `EXCLUDE_PARSER_DEFECT`: Step 3: source URL parsed as a cooking instruction.
- **Crunchy Queso Wrap** (`crunchy-queso-wrap`) — `EXCLUDE_NO_INSTRUCTIONS`: parseRecipeContent returned no instructions from shared content.
- **Curried Red Bean Soup With Kale** (`curried-red-bean-soup-with-kale`) — `EXCLUDE_PARSER_DEFECT`: Step 7: review/comment chrome parsed as a cooking instruction.
- **Curry Tomatoes and Chickpeas With Cucumber Yogurt** (`curry-tomatoes-and-chickpeas-with-cucumber-yogurt`) — `EXCLUDE_PARSER_DEFECT`: Step 4: source URL parsed as a cooking instruction.
- **Dad's Chili** (`dads-chili`) — `EXCLUDE_NO_INSTRUCTIONS`: parseRecipeContent returned no instructions from shared content.
- **Easy Chicken Ramen** (`easy-chicken-ramen`) — `EXCLUDE_PARSER_DEFECT`: Step 16: standalone nutrition, storage, or source metadata parsed as a cooking instruction.
- **Filipino Brased Chicken Tocino** (`filipino-brased-chicken-tocino`) — `EXCLUDE_NO_INSTRUCTIONS`: parseRecipeContent returned no instructions from shared content.
- **Huevos Rotos (Broken Eggs)** (`huevos-rotos-broken-eggs`) — `EXCLUDE_PARSER_DEFECT`: Step 4: review/comment chrome parsed as a cooking instruction. Step 5: review/comment chrome parsed as a cooking instruction. Step 6: review/comment chrome parsed as a cooking instruction. Step 7: review/comment chrome parsed as a cooking instruction. Step 8: review/comment chrome parsed as a cooking instruction. Step 10: review/comment chrome parsed as a cooking instruction.
- **Kung Pao Tofu** (`kung-pao-tofu`) — `EXCLUDE_PARSER_DEFECT`: Step 5: source URL parsed as a cooking instruction.
- **Lemon Herb Pasta Salad with Marinated Chickpeas** (`lemon-herb-pasta-salad-with-marinated-chickpeas`) — `EXCLUDE_PARSER_DEFECT`: The parsed ingredient list omits the chickpeas named by the recipe and instructions.
- **Lemongrass Chicken** (`lemongrass-chicken`) — `EXCLUDE_PARSER_DEFECT`: Step 6: standalone source note parsed as a cooking instruction.
- **Maple Roasted Candied Pecans** (`maple-roasted-candied-pecans`) — `EXCLUDE_NO_INGREDIENTS`: parseRecipeContent returned no ingredients from shared content.
- **Mexican Street Corn** (`mexican-street-corn`) — `EXCLUDE_NO_INSTRUCTIONS`: parseRecipeContent returned no instructions from shared content.
- **Mole Poblano** (`mole-poblano`) — `EXCLUDE_PARSER_DEFECT`: PRD-known legacy source defect: storage/tip prose and presentation labels are parsed as cooking instructions.
- **One-Pot Chicken and Lentil** (`onepot-chicken-and-lentil`) — `EXCLUDE_PARSER_DEFECT`: Step 5: source URL parsed as a cooking instruction.
- **One-Pot Chicken and Rice With Caramelized Lemon** (`onepot-chicken-and-rice-with-caramelized-lemon`) — `EXCLUDE_PARSER_DEFECT`: Step 5: source URL parsed as a cooking instruction.
- **One-Pot Ratatouille Pasta** (`onepot-ratatouille-pasta`) — `EXCLUDE_PARSER_DEFECT`: Step 3: source URL parsed as a cooking instruction.
- **Peanut Butter Oat Protein Shake** (`peanut-butter-oat-protein-shake`) — `EXCLUDE_PARSER_DEFECT`: Step 1: standalone nutrition, storage, or source metadata parsed as a cooking instruction.
- **Pearl Couscous With Creamy Feta and Chickpeas - meh** (`pearl-couscous-with-creamy-feta-and-chickpeas-meh`) — `EXCLUDE_PARSER_DEFECT`: Step 5: source URL parsed as a cooking instruction.
- **Pepper Steak** (`pepper-steak`) — `EXCLUDE_PARSER_DEFECT`: Step 5: source URL parsed as a cooking instruction.
- **Peruvian Chicken w/ green sauce** (`peruvian-chicken-w-green-sauce`) — `EXCLUDE_PARSER_DEFECT`: Step 6: standalone nutrition, storage, or source metadata parsed as a cooking instruction.
- **Peruvian Roasted Chicken With Spicy Cilantro Sauce** (`peruvian-roasted-chicken-with-spicy-cilantro-sauce`) — `EXCLUDE_PARSER_DEFECT`: Step 7: review/comment chrome parsed as a cooking instruction. Step 8: review/comment chrome parsed as a cooking instruction.
- **Pork Fried Rice** (`pork-fried-rice`) — `EXCLUDE_PARSER_DEFECT`: Step 14: source URL parsed as a cooking instruction.
- **Pozole Verde - WOWZA** (`pozole-verde-wowza`) — `EXCLUDE_PARSER_DEFECT`: Step 11: source URL parsed as a cooking instruction.
- **Rising Sun - Mazcal** (`rising-sun-mazcal`) — `EXCLUDE_NO_INSTRUCTIONS`: parseRecipeContent returned no instructions from shared content.
- **Roasted White Bean and Tomato Pasta** (`roasted-white-bean-and-tomato-pasta`) — `EXCLUDE_PARSER_DEFECT`: Step 7: source URL parsed as a cooking instruction.
- **Sheet-Pan Gochujang Chicken and Roasted Vegetables** (`sheetpan-gochujang-chicken-and-roasted-vegetables`) — `EXCLUDE_PARSER_DEFECT`: Step 4: source URL parsed as a cooking instruction.
- **Smoothies** (`smoothies`) — `EXCLUDE_NO_INGREDIENTS`: parseRecipeContent returned no ingredients from shared content.
- **Spaghetti Carbonara** (`spaghetti-carbonara`) — `EXCLUDE_PARSER_DEFECT`: Step 0: unavailable/paywalled placeholder parsed as a cooking instruction.
- **Speget with fake meat meatballs** (`speget-with-fake-meat-meatballs`) — `EXCLUDE_NO_INSTRUCTIONS`: parseRecipeContent returned no instructions from shared content.
- **Spicy Oven-Fried Rice With Gochujang and Fried Eggs** (`spicy-ovenfried-rice-with-gochujang-and-fried-eggs`) — `EXCLUDE_PARSER_DEFECT`: Step 6: review/comment chrome parsed as a cooking instruction. Step 7: review/comment chrome parsed as a cooking instruction. Step 8: review/comment chrome parsed as a cooking instruction. Step 9: review/comment chrome parsed as a cooking instruction. Step 10: review/comment chrome parsed as a cooking instruction. Step 11: review/comment chrome parsed as a cooking instruction. Step 12: review/comment chrome parsed as a cooking instruction. Step 13: review/comment chrome parsed as a cooking instruction. Step 14: review/comment chrome parsed as a cooking instruction.
- **Tuscan Bean Soup** (`tuscan-bean-soup`) — `EXCLUDE_PARSER_DEFECT`: Step 8: standalone source note parsed as a cooking instruction.
- **Vegetarian Skillet Chili** (`vegetarian-skillet-chili`) — `EXCLUDE_PARSER_DEFECT`: Step 4: source URL parsed as a cooking instruction.
- **Zesty Quinoa Salad** (`zesty-quinoa-salad`) — `EXCLUDE_PARSER_DEFECT`: Step 3: standalone nutrition, storage, or source metadata parsed as a cooking instruction.
- **Zibdiyit Gambari (Spicy Shrimp and Tomato Stew)** (`zibdiyit-gambari-spicy-shrimp-and-tomato-stew`) — `EXCLUDE_PARSER_DEFECT`: Step 5: source URL parsed as a cooking instruction.

These exclusions are source/parser defects, not mapper abstentions. No legacy content was repaired in this audit.

## Deterministic-v2 results

| Metric | Count |
|---|---:|
| Instructions | 977 |
| Mapped steps | 592 |
| Unmapped steps | 385 |
| Ingredient references | 1300 |
| Ambiguous steps | 33 |
| Implicit-reference steps | 40 |
| Prepared-component steps | 33 |
| No-ingredient-use steps | 48 |
| Non-actionable steps | 2 |
| AI-eligible steps | 106 |
| Deterministic validation failures | 0 |

The new deterministic semantic review covered **60** eligible recipes: confirmed false-positive recipes **9**, safe correct mappings recorded **446**, safe omissions recorded **93**.

- **Butter-Soy Chicken and Asparagus Stir-Fry** (`buttersoy-chicken-and-asparagus-stirfry`) — Step 2 maps the chicken-group 1/4 teaspoon salt row to a stir-fry pinch of salt despite a separate stir-fry salt-and-pepper row; this is a wrong-group confident association. The historical incidental egg-white false positive is fixed.
- **Chicken Chow Mein** (`chicken-chow-mein`) — Step 6 maps the chicken-breast row from a supplemental substitution note ("Apart from chicken...") rather than an active cooking use. The prior note-prose failure therefore remains represented in live v2 output.
- **chicken wild rice** (`chicken-wild-rice`) — Step 2 maps chicken from the contextual clause "When rice and chicken are done cooking" while the actionable work is making a separate butter/flour/milk mixture. The historical broth-index error is fixed, but this remains a contextual-use false positive.
- **Tacos Al Pastor** (`tacos-al-pastor`) — Step 7 maps tomatillos from a non-actionable sauce heading, and step 8 maps garlic index 3 from the marinade group instead of the separate sauce-group garlic index 17. Both are confident semantic false positives.
- **Sheet Pan Chicken Tinga Bowls** (`sheet-pan-chicken-tinga-bowls`) — The sauce-making step maps raw chicken solely from the temporal context "While the chicken and peppers bake"; chicken is not introduced or used by the actionable sauce work.
- **Chopped Thai Shrimp Salad with Garlic Lime Dressing** (`chopped-thai-shrimp-salad-with-garlic-lime-dressing`) — The shrimp-cooking step maps salt index 8 from the dressing ingredients to an unlisted "little salt" used on shrimp, crossing component scope without positive group evidence.
- **Singapore Mei Fun** (`singapore-mei-fun`) — The map selects sauce water for unlisted noodle-soaking water, repeatedly selects the bare "Oil" section label instead of the cooking-oil row (including a negative "no need" context), and maps egg from the contextual phrase "egg plate". The source also contains unrecognized ingredient headings, which remains a separate parser/content defect.
- **Sesame Apricot Tofu** (`sesame-apricot-tofu`) — The step that adds the prepared sauce maps the raw garlic row only because later prose says the sauce smells of garlic; garlic is not directly introduced at that step.
- **Chickpea Curry** (`chickpea-curry`) — The optional cucumber-salad extension calls for 2 tablespoons avocado oil, but the mapper attaches that phrase to the curry ingredient row containing 1 tablespoon avocado oil and persists mismatched partial-usage metadata.

Status of the nine historical v1 false-positive recipes: Blue Corn, Moqueca, Fried Chicken Sandwich, Creamy Chickpea Masala, and Queso no longer reproduce their prior defect; Butter-Soy fixes the egg-white defect but has a new wrong-group salt false positive; Chicken Wild Rice fixes the broth-index defect but has a new contextual-use false positive; Chicken Chow Mein still maps supplemental note prose; Tacos Al Pastor still maps a heading and wrong-group garlic.

## Hybrid-v2 results

| Metric | Deterministic | Hybrid |
|---|---:|---:|
| Mapped steps | 592 | 619 |
| Mapped ingredient references | 1300 | 1340 |
| AI-eligible unresolved steps | 106 | 75 |
| Prepared components | 0 | 15 |

AI-eligible recipes: **67**; actual primary recipes called: **67**; primary requests: **67**; retries: **0**; failures: **0**; accepted ingredient additions: **40**; accepted prepared components: **15**.

Coverage is descriptive only. Conservative omission is preferred to an incorrect confident association.

## AI semantic accuracy

Accepted additions reviewed across primary and stability runs: **84** — correct **84**, ambiguous **0**, incorrect **0**. Accepted usage qualifiers reviewed: **0**. Every accepted addition in both executed runs was reviewed.

- No ambiguous or incorrect accepted AI additions were found.

## Validator rejection evidence

Observed rejected or stripped suggestions/metadata: **591**.

| Reason | Count |
|---|---:|
| `uncertain_confidence` | 23 |
| `invalid_or_out_of_range_indexes` | 0 |
| `duplicate_conflicts` | 0 |
| `group_conflicts` | 195 |
| `negative_or_deferred_contexts` | 107 |
| `unbounded_collective_references` | 158 |
| `unsupported_remaining_semantics` | 2 |
| `unsupported_usage_metadata` | 50 |
| `ungrounded_quantity_metadata` | 5 |
| `non_actionable_steps` | 0 |
| `ungrounded_prepared_components` | 49 |
| `noncanonical_prepared_component_labels` | 2 |
| `deterministic_lock_violations` | 0 |

These counts are audit observations produced by replaying each model proposal through the unchanged production merger. They distinguish accepted additions from rejected suggestions and stripped metadata.

## Stability

Subset: **30** recipes — exact stable **26**, semantically stable **0**, material differences **4**, errors **0**.

- **Chicken Chickpea Salad** (`chicken-chickpea-salad`) — MATERIAL_DIFFERENCE: Primary safely omitted the correctly grounded green harissa dressing component; the repeat accepted it. No contradictory or unsafe relationship was accepted.
- **Grilled Chicken Salad** (`grilled-chicken-salad`) — MATERIAL_DIFFERENCE: The repeat safely omitted the correct dressing association on the component-establishing step while retaining the later dressing reference. No contradictory relationship was accepted.
- **Sheet Pan Chicken Tinga Bowls** (`sheet-pan-chicken-tinga-bowls`) — MATERIAL_DIFFERENCE: The repeat safely omitted the correctly grounded tinga sauce component accepted by the primary run. No contradictory relationship was accepted.
- **Tacos Al Pastor** (`tacos-al-pastor`) — MATERIAL_DIFFERENCE: The repeat safely omitted the correctly grounded roasted tomatillo chipotle sauce component accepted by the primary run. No contradictory relationship was accepted.

Comparison: historical v1 was 9/20 exact, 1/20 semantically stable, and 10/20 materially different after semantic normalization; bounded v2 was 19/20 exact and 1/20 materially different. Denominators differ from this full-corpus v2 subset.

## Before/after comparison

| Measure | Historical v1 | Fresh v2 |
|---|---:|---:|
| Deterministic false-positive recipes in review | 9 / 40 | 9 / 60 |
| Incorrect accepted AI additions | 8 / 214 | 0 / 84 |
| Material stability differences | 10 / 20 | 4 / 30 |
| Source/parser exclusions | 49 / 236 | 49 / 236 |
| Accepted prepared components (primary) | 42 / 187 eligible recipes | 15 / 187 eligible recipes |
| Deterministic mapped steps | 609 / 187 eligible recipes | 592 / 187 eligible recipes |
| Hybrid mapped steps | 660 / 187 eligible recipes | 619 / 187 eligible recipes |

The runs use different engine/prompt/validator versions and, for stability and semantic review, different denominators; the comparison is directional evidence rather than a like-for-like coverage score.

## Recipe classification

| Classification | Count |
|---|---:|
| READY | 176 |
| REVIEW | 2 |
| EXCLUDED | 58 |
| ERROR | 0 |
| EXISTING_MAP | 0 |

## Remaining risks

- Deterministic-v2 still admits wrong-group, heading/note, contextual-use, prepared-component leakage, and unlisted/additional-quantity false positives.
- Four of 30 hard-case reruns materially differed by safe omission versus correct association.
- Forty-nine parser/content-defective recipes remain excluded and personal override-specific maps remain pending.

## Future apply preconditions

For every READY row, a future apply must require: live recipe exists AND live `cookingStepIngredientMap` is absent AND fresh live `sourceHash === manifest.sourceHash` AND the manifest candidate validates under this exact audited v2 contract AND the manifest SHA-256 equals the approved hash. Any failed precondition means SKIP.

A future writer may merge only `cookingStepIngredientMap`. It must not modify content, title, category, cuisine, nutrition, servings, times, image, source, metadata, or any user-owned data. No writer exists in this audit.

## Manifest integrity

Path: `docs/audits/cooking-step-mapping-dryrun-v2-2026-08-26.json`; SHA-256: `69a13a5c2a2366d372d747035a85df38bb702bbadc84df6f8a450d91ee0a73a0`; rows: **236**; READY **176**; REVIEW **2**; EXCLUDED **58**; ERROR **0**; EXISTING_MAP **0**. Every READY candidate passed current production validation against the freshly read shared content.

## Historical v1 manifest status

`docs/audits/cooking-step-mapping-dryrun-2026-08-25.json` remains immutable historical evidence only and is **NOT authorized for apply**. No v1 candidate map or classification was loaded by this run.

## Production and AI execution

Firestore operations: read-only shared `recipes` collection queries; writes: **none**. Real Gateway requests: 97 (67 primary/retry + 30 stability/retry). The centralized helper emitted 97 usage records totaling 129007 input, 45761 output, and 174768 tokens for vercel-ai-gateway / openai/gpt-5.6-luna. No dollar cost is inferred.
