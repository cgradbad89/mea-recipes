# Cooking Mode V10C Active-Target Analysis — 2026-08-28

## Executive result

**MORE INGREDIENT PRECISION WORK REQUIRED**

V10C remained audit-only: no production mappings, recipes, Firestore documents, routes, runtime engines, or reviewer populations were mutated. The frozen V10B baseline reproduced exactly at 748 TP / 9 FP / 85 FN, with 13/20 target false positives and 47/82 historical cases rejected.

V10C measured 669 TP / 2 FP / 164 FN, 99.70% precision, and 80.31% candidate recall.

## Quantity defect and repair

V10B normalized punctuation before quantity parsing, corrupting decimals/fractions, and attached the first quantity anywhere in an instruction to every candidate row. V10C parses raw quantity syntax and binds instruction quantities only inside the row mention clause.

| Candidate | Ingredient row | Listed | Current row-local use | Incorrect V10B state/effect | Correct V10C state | Outcome |
|---|---|---:|---:|---|---|---|
| ingredient::157::3::0 | - 1.5 lbs pork chops | 1.5 lbs |  | The instruction directly says "Lay browned pork chops over rice mixture," but the candidate row lists "1.5 lbs pork chops" while its source quantity evidence says "5 lbs"; the conflicting quantity prevents accepting this exact row. | {"listedQuantity":"1.5 lbs","priorUses":[{"instructionIndex":1,"usageKind":"UNKNOWN"}],"rowAvailability":"UNKNOWN"} | ACCEPT_LOW_RISK_BASE |
| ingredient::171::0::7 | - 3/4 tsp mustard powder | 3/4 tsp |  | Instruction 1 would use the rub ingredients, but the listed row says "3/4 tsp mustard powder" while the supplied quantity evidence records "4 tsp," so the source quantity conflicts for this exact row. | {"listedQuantity":"3/4 tsp","priorUses":[],"rowAvailability":"AVAILABLE"} | ACCEPT |
| ingredient::171::0::9 | - 1/2 tsp black pepper | 1/2 tsp |  | Instruction 1 would use the rub ingredients, but the listed row says "1/2 tsp black pepper" while the supplied quantity evidence records "2 tsp," creating an exact-row quantity conflict. | {"listedQuantity":"1/2 tsp","priorUses":[],"rowAvailability":"AVAILABLE"} | ACCEPT |
| ingredient::171::1::13 | - 1/2 cup brown sugar, packed | 1/2 cup |  | Instruction 2 would combine the BBQ-sauce ingredients, but the listed row is "1/2 cup brown sugar, packed" while the supplied quantity evidence records "2 cup," conflicting for this exact sauce row. | {"listedQuantity":"1/2 cup","priorUses":[],"rowAvailability":"AVAILABLE"} | ACCEPT |
| ingredient::crunchy-queso-wrap::2::14 | ¾ cup jarred or homemade queso | ¾ cup | 3 tablespoons | Although the instruction says “Spread with 3 tablespoons queso,” the supplied source quantity evidence conflicts with the listed queso quantity, so the exact row cannot be accepted. | {"listedQuantity":"¾ cup","priorUses":[],"currentUseQuantity":"3 tablespoons","rowAvailability":"AVAILABLE"} | ACCEPT_LOW_RISK_BASE |
| ingredient::crunchy-queso-wrap::2::16 | ¾ cup homemade or storebought pico de gallo, drained | ¾ cup | 3 tablespoons | Although the instruction says “3 tablespoons drained pico de gallo,” the supplied source quantity evidence conflicts with the listed pico de gallo quantity. | {"listedQuantity":"¾ cup","priorUses":[],"currentUseQuantity":"3 tablespoons","rowAvailability":"AVAILABLE"} | ACCEPT_LOW_RISK_BASE |
| ingredient::grilled-fish-tacos::1::1 | ½ cup sour cream or mayo or a blend | ½ cup |  | The row lists “½ cup sour cream or mayo or a blend,” while the supplied quantity evidence reports a conflicting current quantity of “2 teaspoon”; the source does not support that quantity for this exact row. | {"listedQuantity":"½ cup","priorUses":[],"rowAvailability":"AVAILABLE"} | ACCEPT_LOW_RISK_BASE |
| ingredient::grilled-fish-tacos::1::2 | 1 teaspoon chopped canned chipotle in adobo sauce | 1 teaspoon |  | The instruction says “mixing the sour cream, chipotle, and salt,” but the supplied quantity evidence conflicts with the row: listed “1 teaspoon” versus current “2 teaspoon” for the exact canned chipotle row. | {"listedQuantity":"1 teaspoon","priorUses":[],"rowAvailability":"AVAILABLE"} | ACCEPT_LOW_RISK_BASE |
| ingredient::jocn-chicken-and-tomatillo-stew::3::8 | 1 tablespoon olive oil | 1 tablespoon |  | Although the instruction says “heat the olive oil,” the listed row is 1 tablespoon while the source quantity evidence gives “2 teaspoons,” so the exact row’s quantity conflicts. | {"listedQuantity":"1 tablespoon","priorUses":[],"rowAvailability":"AVAILABLE"} | ACCEPT_LOW_RISK_BASE |

Quantity regressions repaired: 9/9. Independent semantic rejections: 0.

## Active-target, membership, and continuation contracts

- Current target: DIRECT_INGREDIENT, COMPONENT, BOTH, NEITHER, AMBIGUOUS.
- Continuing use: CONTINUING_MANIPULATION, DIVIDED_USE, RESERVED_REMAINDER, PASSIVE_COMPONENT_CARRY, FULLY_CONSUMED, UNKNOWN.
- Membership is conservative and audit-only. It exists solely to distinguish an actively targeted row from a row passively carried inside a previously established component.
- Truth fields are excluded from extraction and model input; evaluation reads truth only after decisions exist.

## Twenty V10A target false positives

| Candidate | Root cause | Quantity state | Membership | Target | Continuation | V10B | V10C |
|---|---|---|---|---|---|---|---|
| ingredient::157::4::0 | CONSUMED_ROW | {"listedQuantity":"1.5 lbs","priorUses":[{"instructionIndex":1,"usageKind":"UNKNOWN"},{"instructionIndex":3,"usageKind":"UNKNOWN"}],"rowAvailability":"UNKNOWN"} | assembled pork chop casserole, browned pork chop | AMBIGUOUS | UNKNOWN | REJECT | REJECT / PASSIVE_COMPONENT_CONSTITUENT |
| ingredient::chicken-tikka::5::15 | PROCESS_MATERIAL | {"priorUses":[{"instructionIndex":4,"usageKind":"UNKNOWN"}],"rowAvailability":"UNKNOWN"} | chicken skewer, cooked chicken skewer | NEITHER | UNKNOWN | REJECT | REJECT / FRESH_PROCESS_MATERIAL |
| ingredient::chickpea-and-fennel-ratatouille::1::7 | CONSUMED_ROW | {"listedQuantity":"1 teaspoon","priorUses":[],"rowAvailability":"AVAILABLE"} |  | AMBIGUOUS | UNKNOWN | ACCEPT | REJECT / PASSIVE_COMPONENT_CONSTITUENT |
| ingredient::chickpea-and-fennel-ratatouille::1::8 | CONSUMED_ROW | {"priorUses":[],"rowAvailability":"AVAILABLE"} |  | AMBIGUOUS | UNKNOWN | ACCEPT | REJECT / PASSIVE_COMPONENT_CONSTITUENT |
| ingredient::chickpea-and-fennel-ratatouille::1::9 | CONSUMED_ROW | {"listedQuantity":"¼ cup","priorUses":[],"rowAvailability":"AVAILABLE"} |  | AMBIGUOUS | UNKNOWN | ACCEPT | REJECT / PASSIVE_COMPONENT_CONSTITUENT |
| ingredient::chickpea-and-fennel-ratatouille::2::7 | CONTEXTUAL_MENTION | {"listedQuantity":"1 teaspoon","priorUses":[],"rowAvailability":"AVAILABLE"} |  | AMBIGUOUS | UNKNOWN | ACCEPT | ACCEPT / DIRECT_ACTIVE_TARGET |
| ingredient::chickpea-and-fennel-ratatouille::2::8 | CONTEXTUAL_MENTION | {"priorUses":[],"rowAvailability":"AVAILABLE"} |  | AMBIGUOUS | UNKNOWN | ACCEPT | ACCEPT / DIRECT_ACTIVE_TARGET |
| ingredient::crunchy-queso-wrap::2::11 | COMPONENT_LEAKAGE | {"listedQuantity":"⅔ cup","priorUses":[{"instructionIndex":1,"usageKind":"UNKNOWN"}],"rowAvailability":"UNKNOWN"} | assembly, spicy sour cream, sure the meat mixture | COMPONENT | PASSIVE_COMPONENT_CARRY | REJECT | REJECT / PASSIVE_COMPONENT_CONSTITUENT |
| ingredient::crunchy-queso-wrap::4::13 | COMPONENT_LEAKAGE | {"priorUses":[{"instructionIndex":2,"usageKind":"UNKNOWN"},{"instructionIndex":3,"usageKind":"UNKNOWN"}],"rowAvailability":"UNKNOWN"} | assembly, sure the meat mixture | AMBIGUOUS | UNKNOWN | REJECT | REJECT / PASSIVE_COMPONENT_CONSTITUENT |
| ingredient::cucumber-tomato-salad-with-red-wine-vinaigrette::2::0 | COMPONENT_LEAKAGE | {"priorUses":[{"instructionIndex":0,"usageKind":"UNKNOWN"}],"rowAvailability":"UNKNOWN"} | instruction-0-mixture | AMBIGUOUS | UNKNOWN | REJECT | REJECT / PASSIVE_COMPONENT_CONSTITUENT |
| ingredient::cucumber-tomato-salad-with-red-wine-vinaigrette::2::1 | COMPONENT_LEAKAGE | {"listedQuantity":"2 cups","priorUses":[{"instructionIndex":0,"usageKind":"UNKNOWN"}],"rowAvailability":"UNKNOWN"} | instruction-0-mixture | AMBIGUOUS | UNKNOWN | REJECT | REJECT / PASSIVE_COMPONENT_CONSTITUENT |
| ingredient::cucumber-tomato-salad-with-red-wine-vinaigrette::2::2 | COMPONENT_LEAKAGE | {"priorUses":[{"instructionIndex":0,"usageKind":"UNKNOWN"}],"rowAvailability":"UNKNOWN"} | instruction-0-mixture | AMBIGUOUS | UNKNOWN | REJECT | REJECT / PASSIVE_COMPONENT_CONSTITUENT |
| ingredient::dads-chili::6::15 | CONTEXTUAL_MENTION | {"listedQuantity":"1 TBSP","priorUses":[{"instructionIndex":0,"usageKind":"UNKNOWN"},{"instructionIndex":1,"usageKind":"PARTIAL"},{"instructionIndex":5,"usageKind":"PARTIAL"}],"rowAvailability":"PARTIALLY_USED"} | sauce, spiced chili sauce | AMBIGUOUS | UNKNOWN | ACCEPT | REJECT / PASSIVE_COMPONENT_CONSTITUENT |
| ingredient::jocn-chicken-and-tomatillo-stew::4::2 | COMPONENT_LEAKAGE | {"listedQuantity":"1 pound","priorUses":[{"instructionIndex":1,"usageKind":"ALL"},{"instructionIndex":2,"usageKind":"UNKNOWN"}],"rowAvailability":"POSSIBLY_CONSUMED"} | blistered vegetable, soup | NEITHER | FULLY_CONSUMED | REJECT | REJECT / PASSIVE_COMPONENT_CONSTITUENT |
| ingredient::jocn-chicken-and-tomatillo-stew::4::3 | COMPONENT_LEAKAGE | {"priorUses":[{"instructionIndex":1,"usageKind":"ALL"},{"instructionIndex":2,"usageKind":"UNKNOWN"}],"rowAvailability":"POSSIBLY_CONSUMED"} | blistered vegetable, soup | NEITHER | FULLY_CONSUMED | REJECT | REJECT / PASSIVE_COMPONENT_CONSTITUENT |
| ingredient::jocn-chicken-and-tomatillo-stew::4::4 | COMPONENT_LEAKAGE | {"priorUses":[{"instructionIndex":1,"usageKind":"ALL"},{"instructionIndex":2,"usageKind":"UNKNOWN"}],"rowAvailability":"POSSIBLY_CONSUMED"} | blistered vegetable, soup | NEITHER | FULLY_CONSUMED | REJECT | REJECT / PASSIVE_COMPONENT_CONSTITUENT |
| ingredient::jocn-chicken-and-tomatillo-stew::4::5 | COMPONENT_LEAKAGE | {"priorUses":[{"instructionIndex":1,"usageKind":"ALL"},{"instructionIndex":2,"usageKind":"UNKNOWN"}],"rowAvailability":"POSSIBLY_CONSUMED"} | blistered vegetable, soup | NEITHER | FULLY_CONSUMED | REJECT | REJECT / PASSIVE_COMPONENT_CONSTITUENT |
| ingredient::mole-poblano::13::19 | COMPONENT_LEAKAGE | {"listedQuantity":"⅓ Cup","priorUses":[],"rowAvailability":"AVAILABLE"} | sauce | COMPONENT | PASSIVE_COMPONENT_CARRY | REJECT | REJECT / PASSIVE_COMPONENT_CONSTITUENT |
| ingredient::sheetpan-gochujang-chicken-and-roasted-vegetables::3::9 | COMPONENT_LEAKAGE | {"listedQuantity":"1 bunch","priorUses":[{"instructionIndex":2,"usageKind":"UNKNOWN"}],"rowAvailability":"UNKNOWN"} | quick pickled scallion radish mix | COMPONENT | PASSIVE_COMPONENT_CARRY | REJECT | REJECT / PASSIVE_COMPONENT_CONSTITUENT |
| ingredient::tacos-al-pastor::4::0 | CONTEXTUAL_MENTION | {"listedQuantity":"2-3 pound","priorUses":[],"rowAvailability":"AVAILABLE"} |  | AMBIGUOUS | UNKNOWN | ACCEPT | REJECT / PASSIVE_COMPONENT_CONSTITUENT |

Target protection: 18/20 rejected. Component-membership facts prevented 3 target ingredient false positives.

The seven V10B survivors are the subset above whose V10B column is ACCEPT; V10C rejected 5/7. The remaining false-positive boundary is: Two contextual salt/pepper rows remain false accepts because generic “taste and adjust seasoning” was treated as direct row use. In the opposite direction, valid unnamed cooking/assembly continuations remain over-rejected as passive component carry; source-derived category/principal-target identity is still insufficient.

## Correct-candidate protection and strategy comparison

| Strategy | TP | FP | FN | Precision | Candidate recall | AI decisions |
|---|---:|---:|---:|---:|---:|---:|
| Reviewer union | 833 | 28 | 0 | 96.75% | 100.00% | 0 |
| Reviewer intersection | 763 | 9 | 70 | 98.83% | 91.60% | 0 |
| V10A disagreement-only | 831 | 20 | 2 | 97.65% | 99.76% | 91 |
| V10B state-aware | 748 | 9 | 85 | 98.81% | 89.80% | 477 |
| V10C active-target state | 669 | 2 | 164 | 99.70% | 80.31% | 392 |

## Historical false-positive regression

| Class | Total | Locked truth | Rejected | Accepted |
|---|---:|---:|---:|---:|
| component leakage | 10 | 0 | 10 | 0 |
| consumed rows | 16 | 0 | 15 | 1 |
| contextual mention | 11 | 0 | 9 | 2 |
| process material | 1 | 0 | 1 | 0 |
| wrong duplicate | 13 | 5 | 12 | 1 |
| wrong group | 1 | 0 | 0 | 1 |
| quantity conflict | 3 | 3 | 2 | 1 |
| finished-dish collision | 0 | 0 | 0 | 0 |
| other | 27 | 4 | 18 | 9 |

Locked truth rejected: 9/12. The remaining 70 rows are reported as SOURCE_SIGNAL_ONLY because the artifact has origins but no manual truth label.

## Transport and controls

- Logical batches: 67
- Gateway requests: 71
- Retries: 0
- Parse failures: 0
- Schema failures: 0
- Local rejections: 0
- Recipe 190: 4/4 successful
- AI tokens: 335106 total (279625 input / 55481 output)

## Prepared-component diagnostic note

Prepared-component UX mapping remains a separate subsystem. V10C does not evaluate component-label precision/recall and does not activate a component architecture.

## Production mutation and next action

Production mutation: zero. Existing persisted v4/v5 maps and runtime behavior remain unchanged.

## Repository reconciliation

- Starting local production-path state: unapproved hybrid-v9 activation in the route, publish callers, engine validator, and related tests.
- Reverted production-path files: app/api/cooking-step-map/route.ts, app/discover/page.tsx, app/queue/page.tsx, lib/aiConfig.ts, lib/cookingStepMapping.ts, lib/recipes.ts, tests/cookingStepMapRoute.test.ts, tests/cookingStepMappingPublish.test.ts, tests/recipeQueueCategories.test.tsx.
- Retained nonactive diagnostic modules: lib/cookingStepBlindReviewerAi.ts, lib/cookingStepMapArbiterAi.ts, lib/cookingStepMapConsensus.ts. Required to reproduce V9/V10 diagnostics; no production route, caller, engine validator, or runtime imports them after reconciliation.
- Intentionally left untracked: firebase-debug.log, firebase-debug 2.log, firebase-debug 3.log, firebase-debug 4.log, firestore-debug.log, app/error 2.tsx, app/global-error 2.tsx, app/loading 2.tsx, lib/admin 2.ts, lib/chunkItems 2.ts, lib/firestoreBatch 2.ts, lib/safeFetch 2.ts, tests/admin.test 2.ts, tests/firestoreBatch.test 2.ts, tests/ingredientParser.test 2.ts, tests/safeFetch.test 2.ts, .eslintrc.json.
- Production parity: Production-path files match committed HEAD exactly; deterministic-v5/hybrid-v5 remains active, persisted v4 remains compatible, and hybrid-v6 through hybrid-v10 fail closed as unsupported.
- Checkpoint: VERIFIED_AND_READY_FOR_CHECKPOINT_COMMIT.

Identify the remaining active-use versus passive-carry boundary before further production architecture work.
