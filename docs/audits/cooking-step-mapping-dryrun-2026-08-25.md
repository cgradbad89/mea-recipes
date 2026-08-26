# Cooking-step mapping production dry run — 2026-08-25

## Executive verdict

NOT READY FOR BACKFILL

The proposed manifest is an immutable, read-only allowlist. No Firestore document was written. Every accepted AI addition was manually reviewed.

Systemic safety blockers were confirmed: deterministic false positives in the stratified sample, 11/20 material AI stability differences in the executed run (10/20 after semantic normalization of non-partial usage text), and validator-accepted incorrect AI relationships.

## Corpus summary

| Metric | Count |
|---|---:|
| Total shared documents | 236 |
| Existing persisted maps | 0 |
| Eligible | 187 |
| Parser/content excluded | 49 |
| Parser-defective | 41 |
| Empty parsed ingredient arrays | 2 |
| Empty parsed instruction arrays | 8 |
| No-instruction exclusions after no-ingredient precedence | 6 |
| Other invalid content | 0 |
| Deterministic-only | 119 |
| AI attempted (actual primary recipes) | 74 |
| AI-attempted rows still eligible after final source review | 68 |
| AI failed | 0 |
| READY | 168 |
| REVIEW | 7 |
| EXCLUDED | 61 |
| ERROR | 0 |

## Mapping improvement

| Metric | Deterministic | Hybrid |
|---|---:|---:|
| Mapped steps | 609 | 660 |
| Mapped ingredient references | 1316 | 1474 |
| AI-eligible unresolved steps | 115 | 51 |
| Prepared components | 0 | 42 |

> More mappings is not automatically better; semantic safety controls eligibility.

## AI semantic accuracy

Reviewed additions: **214** — correct **206**, ambiguous **0**, incorrect **8**.

Six recipes sent during the bounded live pass were subsequently proven source/parser-defective during semantic inspection. They remain excluded, and the finalized eligibility gate blocks them before AI; the actual 74 primary calls are still reported rather than rewritten as 68.

## AI stability

Subset: **20** recipes — exact stable **9**, semantically stable **1**, material differences **10**, errors **0**.

## Deterministic semantic spot check

Reviewed **40** of 40 selected recipes. Confirmed obvious false positives: **9**. Conservative unresolved mappings were not counted as failures.

## Failure taxonomy

- **The BEST Black Bean Chili** — prepared component mislabeled: Unspecified desired toppings are not a prepared component grounded in the ingredient list.
- **Creamy Crockpot White Chicken Chili** — prepared component mislabeled: Unspecified desired toppings are not a prepared component grounded in the ingredient list.
- **Easy Slow Cooker Turkey Chili** — prepared component mislabeled: Unspecified toppings are not a prepared component grounded in the ingredient list.
- **Pressure-Cooker Easy Pork Posole** — collective reference overreach: Canola oil was already used to brown the meat, so it is not one of the remaining ingredients added at this step.
- **Curried Red Bean Soup With Kale** — parser-contaminated instruction: The mapped text is a reader review copied into instructions, not a canonical cooking step.
- **Curried Red Bean Soup With Kale** — parser-contaminated instruction: The mapped text is a reader review copied into instructions, not a canonical cooking step.
- **Moqueca - Brazilian Fish Stew** — collective reference overreach: The word “all” modifies the fish pieces, not the salt quantity; the association carries overstated all-usage metadata.
- **Queso Chicken Chili with Roasted Corn and Jalapeño** — collective reference overreach: “Everything” refers to the bowl contents being scooped, not to using all tortilla chips; the association carries overstated all-usage metadata.

- **Butter-Soy Chicken and Asparagus Stir-Fry** — deterministic-engine false positive: Step 1 maps egg white from incidental “some egg white may float” prose after it was already introduced in the marinade.
- **Moqueca - Brazilian Fish Stew** — deterministic-engine false positive: Steps 2 and 3 map the coconut-or-olive-oil row from “coconut milk/broth”; this is an ingredient-alternative alias collision.
- **Tacos Al Pastor** — deterministic-engine false positive: Header/negative-context mappings select tomatillo before use, the wrong garlic group, and marinade pepper from “except salt and pepper.”
- **Fried Chicken Sandwich** — deterministic-engine false positive: A recipe-note sentence about “chicken seasoning” falsely maps the chicken-breast row.
- **Chicken Chow Mein** — deterministic-engine false positive: Supplemental note prose maps the chicken-breast row as if it were an active cooking-step use.
- **chicken wild rice** — deterministic-engine false positive: The shredding step falsely maps chicken broth from generic “chicken” evidence.
- **Creamy Chickpea Spinach Masala With Tadka** — deterministic-engine false positive: The tadka step falsely maps serrano chile from the distinct phrase “chile powder.”
- **Queso Chicken Chili with Roasted Corn and Jalapeño** — deterministic-engine false positive: The optional extra 1/2 cup water is mapped back to the already-consumed listed water row, overstating the source quantity context.
- **Blue Corn Green Chili Chicken Enchiladas** — deterministic-engine false positive: An unrecognized “Green Chile Sauce” ingredient header is mapped as food, and prepared sauce text remaps its raw green-chile row.

## Parser/content exclusions and errors

- **The BEST Black Bean Chili** (`151`): At least one AI addition is semantically incorrect.
- **Creamy Crockpot White Chicken Chili** (`158`): At least one AI addition is semantically incorrect.
- **Easy Slow Cooker Turkey Chili** (`159`): At least one AI addition is semantically incorrect.
- **Pressure-Cooker Easy Pork Posole** (`194`): At least one AI addition is semantically incorrect.
- **Blue Corn Green Chili Chicken Enchiladas** (`blue-corn-green-chili-chicken-enchiladas`): Deterministic semantic sample found an obvious false positive.
- **Butter-Soy Chicken and Asparagus Stir-Fry** (`buttersoy-chicken-and-asparagus-stirfry`): Deterministic semantic sample found an obvious false positive.
- **Chana Masala** (`chana-masala`): Step 9: standalone nutrition, storage, or source metadata parsed as a cooking instruction.
- **Chicken Enchiladas** (`chicken-enchiladas`): Step 4: source URL parsed as a cooking instruction.
- **Chicken Fajitas** (`chicken-fajitas`): Step 6: source URL parsed as a cooking instruction.
- **Chicken Paprikash** (`chicken-paprikash`): Step 4: source URL parsed as a cooking instruction.
- **Chicken Stew** (`chicken-stew`): Step 5: source URL parsed as a cooking instruction.
- **Chicken Tacos w/ Pineapple** (`chicken-tacos-w-pineapple`): Step 8: source URL parsed as a cooking instruction.
- **chicken wild rice** (`chicken-wild-rice`): Deterministic semantic sample found an obvious false positive.
- **Chimichurri Chicken** (`chimichurri-chicken`): Step 7: review/comment chrome parsed as a cooking instruction. Step 8: review/comment chrome parsed as a cooking instruction. Step 9: review/comment chrome parsed as a cooking instruction. Step 10: review/comment chrome parsed as a cooking instruction. Step 12: review/comment chrome parsed as a cooking instruction. Step 13: review/comment chrome parsed as a cooking instruction. Step 14: review/comment chrome parsed as a cooking instruction.
- **Chinese Chili Oil** (`chinese-chili-oil`): Step 5: standalone nutrition, storage, or source metadata parsed as a cooking instruction.
- **Chipotle Tahini Bowls** (`chipotle-tahini-bowls`): PRD-known legacy source defect: the ingredient source mixes unquantified bowl suggestions with note-only preparation content.
- **Couscous Salad With Lime Basil Vinaigrette** (`couscous-salad-with-lime-basil-vinaigrette`): Step 4: source URL parsed as a cooking instruction.
- **Crazy good Dal Adas (Spicy Red Lentil Tamarind Soup)** (`crazy-good-dal-adas-spicy-red-lentil-tamarind-soup`): Step 5: source URL parsed as a cooking instruction.
- **Creamy Cauliflower Soup With Rosemary Olive Oil** (`creamy-cauliflower-soup-with-rosemary-olive-oil`): Step 6: source URL parsed as a cooking instruction.
- **Creamy Chickpea Spinach Masala With Tadka** (`creamy-chickpea-spinach-masala-with-tadka`): Deterministic semantic sample found an obvious false positive.
- **Crisp Gnocchi With Brussels Sprouts and Brown Butter** (`crisp-gnocchi-with-brussels-sprouts-and-brown-butter`): Step 3: source URL parsed as a cooking instruction.
- **Crispy Gnocchi With Burst Tomatoes and Mozzarella** (`crispy-gnocchi-with-burst-tomatoes-and-mozzarella`): Step 4: source URL parsed as a cooking instruction.
- **Crispy Gnocchi With Sausage and Broccoli** (`crispy-gnocchi-with-sausage-and-broccoli`): Step 3: source URL parsed as a cooking instruction.
- **Crunchy Queso Wrap** (`crunchy-queso-wrap`): parseRecipeContent returned no instructions from shared content.
- **Curried Red Bean Soup With Kale** (`curried-red-bean-soup-with-kale`): Step 7: review/comment chrome parsed as a cooking instruction.
- **Curry Tomatoes and Chickpeas With Cucumber Yogurt** (`curry-tomatoes-and-chickpeas-with-cucumber-yogurt`): Step 4: source URL parsed as a cooking instruction.
- **Dad's Chili** (`dads-chili`): parseRecipeContent returned no instructions from shared content.
- **Easy Chicken Ramen** (`easy-chicken-ramen`): Step 16: standalone nutrition, storage, or source metadata parsed as a cooking instruction.
- **Filipino Brased Chicken Tocino** (`filipino-brased-chicken-tocino`): parseRecipeContent returned no instructions from shared content.
- **Fried Chicken Sandwich** (`fried-chicken-sandwich`): Deterministic semantic sample found an obvious false positive.
- **Huevos Rotos (Broken Eggs)** (`huevos-rotos-broken-eggs`): Step 4: review/comment chrome parsed as a cooking instruction. Step 5: review/comment chrome parsed as a cooking instruction. Step 6: review/comment chrome parsed as a cooking instruction. Step 7: review/comment chrome parsed as a cooking instruction. Step 8: review/comment chrome parsed as a cooking instruction. Step 10: review/comment chrome parsed as a cooking instruction.
- **Kung Pao Tofu** (`kung-pao-tofu`): Step 5: source URL parsed as a cooking instruction.
- **Lemon Herb Pasta Salad with Marinated Chickpeas** (`lemon-herb-pasta-salad-with-marinated-chickpeas`): The parsed ingredient list omits the chickpeas named by the recipe and instructions.
- **Lemongrass Chicken** (`lemongrass-chicken`): Step 6: standalone source note parsed as a cooking instruction.
- **Maple Roasted Candied Pecans** (`maple-roasted-candied-pecans`): parseRecipeContent returned no ingredients from shared content.
- **Mexican Street Corn** (`mexican-street-corn`): parseRecipeContent returned no instructions from shared content.
- **Mole Poblano** (`mole-poblano`): PRD-known legacy source defect: storage/tip prose and presentation labels are parsed as cooking instructions.
- **Moqueca - Brazilian Fish Stew** (`moqueca-brazilian-fish-stew`): At least one AI addition is semantically incorrect.
- **One-Pot Chicken and Lentil** (`onepot-chicken-and-lentil`): Step 5: source URL parsed as a cooking instruction.
- **One-Pot Chicken and Rice With Caramelized Lemon** (`onepot-chicken-and-rice-with-caramelized-lemon`): Step 5: source URL parsed as a cooking instruction.
- **One-Pot Ratatouille Pasta** (`onepot-ratatouille-pasta`): Step 3: source URL parsed as a cooking instruction.
- **Peanut Butter Oat Protein Shake** (`peanut-butter-oat-protein-shake`): Step 1: standalone nutrition, storage, or source metadata parsed as a cooking instruction.
- **Pearl Couscous With Creamy Feta and Chickpeas - meh** (`pearl-couscous-with-creamy-feta-and-chickpeas-meh`): Step 5: source URL parsed as a cooking instruction.
- **Pepper Steak** (`pepper-steak`): Step 5: source URL parsed as a cooking instruction.
- **Peruvian Chicken w/ green sauce** (`peruvian-chicken-w-green-sauce`): Step 6: standalone nutrition, storage, or source metadata parsed as a cooking instruction.
- **Peruvian Roasted Chicken With Spicy Cilantro Sauce** (`peruvian-roasted-chicken-with-spicy-cilantro-sauce`): Step 7: review/comment chrome parsed as a cooking instruction. Step 8: review/comment chrome parsed as a cooking instruction.
- **Pork Fried Rice** (`pork-fried-rice`): Step 14: source URL parsed as a cooking instruction.
- **Pozole Verde - WOWZA** (`pozole-verde-wowza`): Step 11: source URL parsed as a cooking instruction.
- **Queso Chicken Chili with Roasted Corn and Jalapeño** (`queso-chicken-chili-with-roasted-corn-and-jalape-o`): At least one AI addition is semantically incorrect.
- **Rising Sun - Mazcal** (`rising-sun-mazcal`): parseRecipeContent returned no instructions from shared content.
- **Roasted White Bean and Tomato Pasta** (`roasted-white-bean-and-tomato-pasta`): Step 7: source URL parsed as a cooking instruction.
- **Sheet-Pan Gochujang Chicken and Roasted Vegetables** (`sheetpan-gochujang-chicken-and-roasted-vegetables`): Step 4: source URL parsed as a cooking instruction.
- **Smoothies** (`smoothies`): parseRecipeContent returned no ingredients from shared content.
- **Spaghetti Carbonara** (`spaghetti-carbonara`): Step 0: unavailable/paywalled placeholder parsed as a cooking instruction.
- **Speget with fake meat meatballs** (`speget-with-fake-meat-meatballs`): parseRecipeContent returned no instructions from shared content.
- **Spicy Oven-Fried Rice With Gochujang and Fried Eggs** (`spicy-ovenfried-rice-with-gochujang-and-fried-eggs`): Step 6: review/comment chrome parsed as a cooking instruction. Step 7: review/comment chrome parsed as a cooking instruction. Step 8: review/comment chrome parsed as a cooking instruction. Step 9: review/comment chrome parsed as a cooking instruction. Step 10: review/comment chrome parsed as a cooking instruction. Step 11: review/comment chrome parsed as a cooking instruction. Step 12: review/comment chrome parsed as a cooking instruction. Step 13: review/comment chrome parsed as a cooking instruction. Step 14: review/comment chrome parsed as a cooking instruction.
- **Tacos Al Pastor** (`tacos-al-pastor`): Deterministic semantic sample found an obvious false positive.
- **Tuscan Bean Soup** (`tuscan-bean-soup`): Step 8: standalone source note parsed as a cooking instruction.
- **Vegetarian Skillet Chili** (`vegetarian-skillet-chili`): Step 4: source URL parsed as a cooking instruction.
- **Zesty Quinoa Salad** (`zesty-quinoa-salad`): Step 3: standalone nutrition, storage, or source metadata parsed as a cooking instruction.
- **Zibdiyit Gambari (Spicy Shrimp and Tomato Stew)** (`zibdiyit-gambari-spicy-shrimp-and-tomato-stew`): Step 5: source URL parsed as a cooking instruction.

## Proposed backfill scope

READY 168; REVIEW 7; EXCLUDED 61; ERROR 0. This report does not authorize or perform mutation.

## Future apply preconditions

For each READY row: the live recipe must still exist, the map field must still be absent, a fresh live source hash must equal the manifest hash, and the candidate must validate against the live shared content. Any failed precondition skips that row. A later writer must perform a `cookingStepIngredientMap`-only merge and must not rewrite recipe content or any other field.

## Manifest integrity

Path: `docs/audits/cooking-step-mapping-dryrun-2026-08-25.json`; SHA-256: `03cccba16232237f2ffb8b0c1971ec3a66732da8a0f1480717769ac5f25093ae`; rows: **236**; READY rows: **168**. Every READY candidate passed a fresh production-source validation.

## Production and AI execution

Firestore operations: read-only shared `recipes` collection queries; writes: **none**. AI requests: 74 primary/retry requests plus 20 stability/retry requests. The existing helper emitted 94 authoritative usage records totaling 106760 input, 51392 output, and 158152 tokens for vercel-ai-gateway / openai/gpt-5.6-luna. No dollar estimate is inferred.
