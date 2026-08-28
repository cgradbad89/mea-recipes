# Cooking Mode V10B ingredient precision analysis — 2026-08-28

## 1. Executive result

**MORE INGREDIENT PRECISION WORK REQUIRED**. The state-aware strategy produced 748 TP / 9 FP / 85 FN. It does not meet the frozen precision or recall gate.

## 2. Frozen-population verification

Verified 863 ingredient candidates: 833 correct and 30 incorrect. No reviewer rerun or discovery change occurred.

## 3. Exact V10A best-strategy reproduction

Reproduced 831 TP / 20 FP / 2 FN.

## 4. Twenty-FP provenance by reviewer vote

{"1_OF_2":10,"2_OF_2":9,"DETERMINISTIC_ONLY":1}.

## 5. Twenty-FP root-cause taxonomy

{"COMPONENT_LEAKAGE":11,"CONSUMED_ROW":4,"CONTEXTUAL_MENTION":4,"PROCESS_MATERIAL":1}.

## 6. Can 2/2 auto-accept theoretically reach zero FP?

No. 9 of the 20 false positives have 2/2 reviewer agreement, so automatic acceptance of every 2/2 candidate cannot reach zero FP.

## 7. Lifecycle fact contract

priorInstructionMentions, laterInstructionMentions, priorReviewerUses, quantityEvidence, remainingLanguage, lifecycleRisk. Facts are chronological and source-derived; truth fields included: false.

## 8. Component-containment fact contract

possibleConstituent, componentLabels, establishedInstructionIndex, currentInstructionRefersToComponent. Component proposals are conservative containment signals only and are never promoted to output.

## 9. Risk-routing coverage

477/863 candidates routed; 0 incorrect candidates missed.

## 10. Incorrect candidates routed

30/30 routed; 0/30 not routed.

## 11. Correct candidates routed

447/833 routed; 386/833 not routed.

## 12. Risk-rejection-only metrics

829 TP / 19 FP / 4 FN; precision 97.76%; candidate recall 99.52%.

## 13. State-aware arbiter metrics

748 TP / 9 FP / 85 FN; precision 98.81%; candidate recall 89.80%. False rejects by basis: {"COMPONENT_CONSTITUENT_ONLY":49,"CONTEXT_ONLY":23,"QUANTITY_CONFLICT":9,"ALREADY_CONSUMED":3,"WRONG_DUPLICATE_OR_GROUP":1}.

## 14. Twenty V10A FP outcomes

13/20 rejected; 7/20 remained accepted.

| Candidate | Vote | Root cause | Risk facts | Decision / basis | Evidence |
| --- | --- | --- | --- | --- | --- |
| ingredient::157::4::0 | 1_OF_2 | CONSUMED_ROW | {"explicit":false,"priorUses":[{"instructionIndex":1,"reviewerCount":2},{"instructionIndex":3,"reviewerCount":2}],"component":{"possibleConstituent":false,"componentLabels":[],"establishedInstructionIndex":3,"currentInstructionRefersToComponent":false},"remaining":false,"duplicateSiblings":[],"quantities":{"listedQuantity":"5 lbs"},"routeReasons":["LIFECYCLE"]} | REJECT / QUANTITY_CONFLICT | "Cover and cook on HIGH for 3.5 hours" would continue cooking the pork chops, but the candidate row lists "1.5 lbs pork chops" while its source quantity evidence says "5 lbs," creating a source quantity conflict for the exact row. |
| ingredient::chicken-tikka::5::15 | 1_OF_2 | PROCESS_MATERIAL | {"explicit":false,"priorUses":[{"instructionIndex":4,"reviewerCount":2}],"component":{"possibleConstituent":false,"componentLabels":[],"establishedInstructionIndex":4,"currentInstructionRefersToComponent":false},"remaining":false,"duplicateSiblings":[],"quantities":{},"routeReasons":["LIFECYCLE","PROCESS_MATERIAL"]} | REJECT / FRESH_PROCESS_MATERIAL | The instruction says “cook ... until chicken is charred and cooked through”; it acts on the chicken, while the wooden skewers are only supporting process material and are not separately acted on. |
| ingredient::chickpea-and-fennel-ratatouille::1::7 | 2_OF_2 | CONSUMED_ROW | {"explicit":false,"priorUses":[{"instructionIndex":0,"reviewerCount":2}],"component":{"possibleConstituent":true,"componentLabels":["sauce"],"establishedInstructionIndex":0,"currentInstructionRefersToComponent":true},"remaining":false,"duplicateSiblings":[],"quantities":{"listedQuantity":"1 teaspoon"},"routeReasons":["COMPONENT_CONTAINMENT","LIFECYCLE"]} | ACCEPT / VALID_CONTINUING_USE | The salt was already incorporated with the roasting ingredients, and the current roasting instruction continues cooking the mixture containing the listed salt. |
| ingredient::chickpea-and-fennel-ratatouille::1::8 | 2_OF_2 | CONSUMED_ROW | {"explicit":false,"priorUses":[{"instructionIndex":0,"reviewerCount":2}],"component":{"possibleConstituent":true,"componentLabels":["sauce"],"establishedInstructionIndex":0,"currentInstructionRefersToComponent":true},"remaining":false,"duplicateSiblings":[],"quantities":{},"routeReasons":["COMPONENT_CONTAINMENT","LIFECYCLE"]} | ACCEPT / VALID_CONTINUING_USE | The black pepper was already incorporated in the roasting pan; “Transfer to oven and roast, stirring occasionally” continues cooking the mixture containing it. |
| ingredient::chickpea-and-fennel-ratatouille::1::9 | 2_OF_2 | CONSUMED_ROW | {"explicit":false,"priorUses":[{"instructionIndex":0,"reviewerCount":2}],"component":{"possibleConstituent":true,"componentLabels":["sauce"],"establishedInstructionIndex":0,"currentInstructionRefersToComponent":true},"remaining":false,"duplicateSiblings":[],"quantities":{"listedQuantity":"4 cup"},"routeReasons":["COMPONENT_CONTAINMENT","LIFECYCLE"]} | ACCEPT / VALID_CONTINUING_USE | The olive oil was used to coat and combine the ingredients, and the current instruction continues the cooking process by saying “Transfer to oven and roast.” |
| ingredient::chickpea-and-fennel-ratatouille::2::7 | 2_OF_2 | CONTEXTUAL_MENTION | {"explicit":false,"priorUses":[{"instructionIndex":0,"reviewerCount":2},{"instructionIndex":1,"reviewerCount":2}],"component":{"possibleConstituent":false,"componentLabels":[],"establishedInstructionIndex":1,"currentInstructionRefersToComponent":false},"remaining":false,"duplicateSiblings":[],"quantities":{"listedQuantity":"1 teaspoon"},"routeReasons":["LIFECYCLE","CONTEXT_ONLY"]} | ACCEPT / DIRECT_ACTIVE_USE | The instruction says “Taste and adjust seasoning,” which directly authorizes adjustment of the listed salt. |
| ingredient::chickpea-and-fennel-ratatouille::2::8 | 2_OF_2 | CONTEXTUAL_MENTION | {"explicit":false,"priorUses":[{"instructionIndex":0,"reviewerCount":2},{"instructionIndex":1,"reviewerCount":2}],"component":{"possibleConstituent":false,"componentLabels":[],"establishedInstructionIndex":1,"currentInstructionRefersToComponent":false},"remaining":false,"duplicateSiblings":[],"quantities":{},"routeReasons":["LIFECYCLE","CONTEXT_ONLY"]} | ACCEPT / DIRECT_ACTIVE_USE | The instruction says “Taste and adjust seasoning,” directly using the listed black pepper as seasoning. |
| ingredient::crunchy-queso-wrap::2::11 | DETERMINISTIC_ONLY | COMPONENT_LEAKAGE | {"explicit":true,"priorUses":[{"instructionIndex":1,"reviewerCount":2}],"component":{"possibleConstituent":false,"componentLabels":["filling","spicy sour cream","mixture","cream"],"establishedInstructionIndex":1,"currentInstructionRefersToComponent":true},"remaining":false,"duplicateSiblings":[],"quantities":{"listedQuantity":"3 cup","currentInstructionQuantity":"2 cup"},"routeReasons":["LIFECYCLE","QUANTITY_CONFLICT"]} | REJECT / COMPONENT_CONSTITUENT_ONLY | The current instruction uses “the spicy sour cream,” a prepared component made in instruction 1, rather than separately acting on the listed sour cream row. |
| ingredient::crunchy-queso-wrap::4::13 | 1_OF_2 | COMPONENT_LEAKAGE | {"explicit":false,"priorUses":[{"instructionIndex":2,"reviewerCount":2},{"instructionIndex":3,"reviewerCount":2}],"component":{"possibleConstituent":true,"componentLabels":["assembled wrap","wrap"],"establishedInstructionIndex":3,"currentInstructionRefersToComponent":true},"remaining":false,"duplicateSiblings":[],"quantities":{"currentInstructionQuantity":"1 tablespoon","priorUseQuantity":"2 cup"},"routeReasons":["COMPONENT_CONTAINMENT","LIFECYCLE"]} | REJECT / COMPONENT_CONSTITUENT_ONLY | “carefully add the wrap” and “Cook until golden and crisp” act on the assembled wrap, not separately on the listed tortilla row. |
| ingredient::cucumber-tomato-salad-with-red-wine-vinaigrette::2::0 | 2_OF_2 | COMPONENT_LEAKAGE | {"explicit":false,"priorUses":[{"instructionIndex":0,"reviewerCount":2}],"component":{"possibleConstituent":true,"componentLabels":["dressing","salad"],"establishedInstructionIndex":0,"currentInstructionRefersToComponent":true},"remaining":false,"duplicateSiblings":[],"quantities":{},"routeReasons":["COMPONENT_CONTAINMENT","LIFECYCLE"]} | REJECT / COMPONENT_CONSTITUENT_ONLY | The current instruction says, "Pour the dressing over the salad and toss to combine." The cucumber row was previously used in "Combine cucumbers, cherry tomatoes, and red onion in a large bowl," so the current action is only on the prepared salad component, not separately on the cucumbers. |
| ingredient::cucumber-tomato-salad-with-red-wine-vinaigrette::2::1 | 2_OF_2 | COMPONENT_LEAKAGE | {"explicit":false,"priorUses":[{"instructionIndex":0,"reviewerCount":2}],"component":{"possibleConstituent":true,"componentLabels":["dressing","salad"],"establishedInstructionIndex":0,"currentInstructionRefersToComponent":true},"remaining":false,"duplicateSiblings":[],"quantities":{"listedQuantity":"2 cups"},"routeReasons":["COMPONENT_CONTAINMENT","LIFECYCLE"]} | REJECT / COMPONENT_CONSTITUENT_ONLY | The current instruction says, "Pour the dressing over the salad and toss to combine." The cherry tomatoes were previously incorporated by "Combine cucumbers, cherry tomatoes, and red onion in a large bowl," and are not separately acted on now. |
| ingredient::cucumber-tomato-salad-with-red-wine-vinaigrette::2::2 | 2_OF_2 | COMPONENT_LEAKAGE | {"explicit":false,"priorUses":[{"instructionIndex":0,"reviewerCount":2}],"component":{"possibleConstituent":true,"componentLabels":["dressing","salad"],"establishedInstructionIndex":0,"currentInstructionRefersToComponent":true},"remaining":false,"duplicateSiblings":[],"quantities":{},"routeReasons":["COMPONENT_CONTAINMENT","LIFECYCLE"]} | REJECT / COMPONENT_CONSTITUENT_ONLY | The current instruction says, "Pour the dressing over the salad and toss to combine." The red onion was previously incorporated into the salad by "Combine cucumbers, cherry tomatoes, and red onion in a large bowl," with no separate current action on the onion. |
| ingredient::dads-chili::6::15 | 1_OF_2 | CONTEXTUAL_MENTION | {"explicit":false,"priorUses":[{"instructionIndex":0,"reviewerCount":1}],"component":{"possibleConstituent":false,"componentLabels":[],"establishedInstructionIndex":0,"currentInstructionRefersToComponent":false},"remaining":false,"duplicateSiblings":[],"quantities":{"listedQuantity":"1 tbsp"},"routeReasons":["LIFECYCLE","CONTEXT_ONLY","COLLECTIVE_REFERENCE"]} | ACCEPT / VALID_CONTINUING_USE | The ingredient row’s Chili Sauce is included by the source’s sauce mixture in instruction 0, “In a large pot combine ... Simmer,” and the current instruction continues cooking everything in that pot: “bring a boil then turn down and simmer for a couple hours.” |
| ingredient::jocn-chicken-and-tomatillo-stew::4::2 | 1_OF_2 | COMPONENT_LEAKAGE | {"explicit":false,"priorUses":[{"instructionIndex":1,"reviewerCount":2},{"instructionIndex":2,"reviewerCount":2}],"component":{"possibleConstituent":true,"componentLabels":["pure ed broth","broth"],"establishedInstructionIndex":2,"currentInstructionRefersToComponent":true},"remaining":false,"duplicateSiblings":[],"quantities":{"listedQuantity":"1 pound"},"routeReasons":["COMPONENT_CONTAINMENT","LIFECYCLE","CONTEXT_ONLY"]} | REJECT / COMPONENT_CONSTITUENT_ONLY | The current instruction acts on “the broth” and says to “Purée the broth”; it does not separately act on the tomatillos as an exact row. |
| ingredient::jocn-chicken-and-tomatillo-stew::4::3 | 1_OF_2 | COMPONENT_LEAKAGE | {"explicit":false,"priorUses":[{"instructionIndex":1,"reviewerCount":2},{"instructionIndex":2,"reviewerCount":2}],"component":{"possibleConstituent":true,"componentLabels":["pure ed broth","broth"],"establishedInstructionIndex":2,"currentInstructionRefersToComponent":true},"remaining":false,"duplicateSiblings":[],"quantities":{},"routeReasons":["COMPONENT_CONTAINMENT","LIFECYCLE","CONTEXT_ONLY"]} | REJECT / COMPONENT_CONSTITUENT_ONLY | The current instruction acts on “the broth” and says to “Purée the broth”; it does not separately act on the green bell peppers as an exact row. |
| ingredient::jocn-chicken-and-tomatillo-stew::4::4 | 1_OF_2 | COMPONENT_LEAKAGE | {"explicit":false,"priorUses":[{"instructionIndex":1,"reviewerCount":2},{"instructionIndex":2,"reviewerCount":2}],"component":{"possibleConstituent":true,"componentLabels":["pure ed broth","broth"],"establishedInstructionIndex":2,"currentInstructionRefersToComponent":true},"remaining":false,"duplicateSiblings":[],"quantities":{},"routeReasons":["COMPONENT_CONTAINMENT","LIFECYCLE","CONTEXT_ONLY"]} | REJECT / COMPONENT_CONSTITUENT_ONLY | The current instruction acts on “the broth” and says to “Purée the broth”; it does not separately act on the sweet onion as an exact row. |
| ingredient::jocn-chicken-and-tomatillo-stew::4::5 | 1_OF_2 | COMPONENT_LEAKAGE | {"explicit":false,"priorUses":[{"instructionIndex":1,"reviewerCount":2},{"instructionIndex":2,"reviewerCount":2}],"component":{"possibleConstituent":true,"componentLabels":["pure ed broth","broth"],"establishedInstructionIndex":2,"currentInstructionRefersToComponent":true},"remaining":false,"duplicateSiblings":[],"quantities":{},"routeReasons":["COMPONENT_CONTAINMENT","LIFECYCLE","CONTEXT_ONLY"]} | REJECT / COMPONENT_CONSTITUENT_ONLY | The current instruction acts on “the broth” and says to “Purée the broth”; it does not separately act on the jalapeño as an exact row. |
| ingredient::mole-poblano::13::19 | 2_OF_2 | COMPONENT_LEAKAGE | {"explicit":false,"priorUses":[],"component":{"possibleConstituent":true,"componentLabels":["ground spice and seed mixture","ground spice mixture","mole paste","soaked pepper and chocolate mixture","sauce","mixture","broth","paste"],"currentInstructionRefersToComponent":true},"remaining":false,"duplicateSiblings":[],"quantities":{"listedQuantity":"3 cup","currentInstructionQuantity":"2 cup"},"routeReasons":["COMPONENT_CONTAINMENT","COLLECTIVE_REFERENCE"]} | REJECT / COMPONENT_CONSTITUENT_ONLY | The current instruction refers to the prepared component through “the spice mixture” and “the fried ingredients”; it does not separately act on the listed peanuts row. |
| ingredient::sheetpan-gochujang-chicken-and-roasted-vegetables::3::9 | 1_OF_2 | COMPONENT_LEAKAGE | {"explicit":false,"priorUses":[{"instructionIndex":2,"reviewerCount":2}],"component":{"possibleConstituent":true,"componentLabels":["quick pickled scallion radish mix","mix"],"establishedInstructionIndex":2,"currentInstructionRefersToComponent":true},"remaining":false,"duplicateSiblings":[],"quantities":{"listedQuantity":"1 bunch"},"routeReasons":["COMPONENT_CONTAINMENT","LIFECYCLE","CONTEXT_ONLY"]} | REJECT / COMPONENT_CONSTITUENT_ONLY | The instruction acts only on “the quick-pickled scallion-radish mix”; the listed radishes are merely a constituent of that prepared component and are not separately acted on. |
| ingredient::tacos-al-pastor::4::0 | 1_OF_2 | CONTEXTUAL_MENTION | {"explicit":false,"priorUses":[{"instructionIndex":1,"reviewerCount":1},{"instructionIndex":3,"reviewerCount":2}],"component":{"possibleConstituent":false,"componentLabels":[],"establishedInstructionIndex":3,"currentInstructionRefersToComponent":false},"remaining":false,"duplicateSiblings":[],"quantities":{"listedQuantity":"3 pound"},"routeReasons":["LIFECYCLE"]} | ACCEPT / VALID_CONTINUING_USE | Instruction 4 says “Cover with aluminum foil and refrigerate for at least 4 hours,” continuing the marinating process involving the listed “2-3 pound Pork Loin cut into thin slices”; the pork is not exhausted. |

## 15. Correct-candidate protection

Failed: 748/833 TP, 85 FN, 89.80% recall. The required floor was 829 TP and 99.5% recall.

## 16. Historical FP regression results

47/82 rejected; 35 accepted; 0 unavailable. Family labels below are source-signal taxonomies because the locked artifact has provenance but no manual family labels.

| Family | Total | Rejected | Accepted |
| --- | ---: | ---: | ---: |
| OTHER | 27 | 16 | 11 |
| CONSUMED_ROW | 16 | 4 | 12 |
| WRONG_DUPLICATE | 13 | 10 | 3 |
| CONTEXTUAL_MENTION | 11 | 8 | 3 |
| COMPONENT_LEAKAGE | 10 | 6 | 4 |
| QUANTITY_CONFLICT | 3 | 3 | 0 |
| FRESH_PROCESS_MATERIAL | 1 | 0 | 1 |
| WRONG_GROUP | 1 | 0 | 1 |

Accepted historical cases:

- ingredient::157::4::0 — CONSUMED_ROW; VALID_CONTINUING_USE; The pork chops were previously browned and then 'Lay browned pork chops over rice mixture'; the current instruction says 'Cover and cook on HIGH for 3.5 hours,' which continues cooking the exact listed pork chops.
- historical::176::6::12 — WRONG_DUPLICATE; DIRECT_ACTIVE_USE; The current instruction says “Toss asparagus with olive oil, salt, pepper; roast 20 minutes.” This directly uses the listed extra-virgin olive oil row; the prior olive-oil mention was for brushing chicken skin and does not exhaust this separate row.
- ingredient::176::6::17 — WRONG_DUPLICATE; DIRECT_ACTIVE_USE; The current instruction says “Toss asparagus with olive oil, salt, pepper; roast 20 minutes.” This directly names salt as an active ingredient for the asparagus, supporting use of the listed “1 teaspoon kosher salt” row despite the separate duplicate salt row.
- historical::blue-corn-green-chili-chicken-enchiladas::5::0 — OTHER; DIRECT_ACTIVE_USE; The ingredient row is "Green Chile Sauce!" and the current instruction explicitly says, "Spoon green chile enchilada sauce over the tortillas," which is a clear exact alias and direct use of the sauce row.
- historical::chicken-meatballs-with-peppers-and-orzo::3::3 — OTHER; DIRECT_ACTIVE_USE; The current instruction explicitly says, “Season with salt, Parmesan, and parsley.” This directly uses the listed “1/2 cup grated Parmesan” row; the quantity discrepancy in the risk metadata does not establish a source-supported conflict.
- historical::chicken-tikka::5::13 — CONSUMED_ROW; VALID_CONTINUING_USE; Instruction 4 says to "Thread marinated chicken onto skewers alternating with onion," and instruction 5 says to "cook for 12-15 minutes, turning every 3-4 minutes." The listed onion row is on the skewers and is actively cooked.
- historical::chicken-tikka::5::14 — CONSUMED_ROW; VALID_CONTINUING_USE; Instruction 4 says to "Thread marinated chicken onto skewers alternating with ... bell pepper chunks," and instruction 5 says to "cook for 12-15 minutes, turning every 3-4 minutes." The listed bell pepper row is on the skewers and is actively cooked.
- ingredient::chicken-tikka::5::15 — FRESH_PROCESS_MATERIAL; VALID_CONTINUING_USE; Instruction 4 says to "Thread marinated chicken onto skewers," and instruction 5 directs cooking while "turning every 3-4 minutes." The listed soaked wooden skewers are the active process material being used during grilling.
- historical::chicken-tikka::6::13 — CONSUMED_ROW; VALID_CONTINUING_USE; Instruction 4 says to "Thread marinated chicken onto skewers alternating with onion," and instruction 6 says to "place skewers on a baking sheet and cook for 15-18 minutes, turning once halfway through." The listed onion row continues to be cooked.
- historical::chicken-tikka::6::14 — CONSUMED_ROW; VALID_CONTINUING_USE; Instruction 4 says to "Thread marinated chicken onto skewers alternating with ... bell pepper chunks," and instruction 6 says to "place skewers on a baking sheet and cook for 15-18 minutes, turning once halfway through." The listed bell pepper row continues to be cooked.
- ingredient::chicken-tikka::9::0 — COMPONENT_LEAKAGE; VALID_CONTINUING_USE; Instruction 9 says "serve hot with naan, rice, or salad" after the chicken has been cooked and rested. The listed chicken-thigh row is the principal cooked food being served, so it remains actively used.
- ingredient::chickpea-and-fennel-ratatouille::1::7 — COMPONENT_LEAKAGE; VALID_CONTINUING_USE; The source says, "Transfer to oven and roast, stirring occasionally," continuing to cook the roasted mixture containing this salt row after it was combined in instruction 0.
- ingredient::chickpea-and-fennel-ratatouille::1::8 — COMPONENT_LEAKAGE; VALID_CONTINUING_USE; The source says, "Transfer to oven and roast, stirring occasionally," continuing to cook the roasted mixture containing this pepper row after it was combined in instruction 0.
- ingredient::chickpea-and-fennel-ratatouille::1::9 — COMPONENT_LEAKAGE; VALID_CONTINUING_USE; Instruction 0 says, "Drizzle with oil and toss to combine," and the current instruction continues, "Transfer to oven and roast, stirring occasionally," actively cooking the mixture containing this olive oil row.
- ingredient::chickpea-and-fennel-ratatouille::2::7 — CONTEXTUAL_MENTION; DIRECT_ACTIVE_USE; The current source says, "Taste and adjust seasoning," which directly calls for active adjustment of the listed salt row.
- ingredient::chickpea-and-fennel-ratatouille::2::8 — CONTEXTUAL_MENTION; DIRECT_ACTIVE_USE; The current source says, "Taste and adjust seasoning," which directly calls for active adjustment of the listed black pepper row.
- historical::dads-chili::0::29 — OTHER; DIRECT_ACTIVE_USE; The instruction says “combine ... spices ... and pepper powder,” which is a direct use of the listed Hatch powder as the pepper-powder ingredient.
- historical::dads-chili::6::29 — CONTEXTUAL_MENTION; VALID_CONTINUING_USE; The instruction says “Once everything is in the pot bring a boil then turn down and simmer for a couple hours.” Hatch powder was previously added with the spices at instruction 0, so this is continuing cooking of the same mixture, not evidence that the row is exhausted.
- historical::grilled-zucchini-and-summer-squash::2::2 — CONSUMED_ROW; VALID_CONTINUING_USE; Prior instruction says, "Toss zucchini and squash slices with olive oil..." and the current instruction says, "Grill for 3-4 minutes per side." Grilling continues cooking the zucchini and squash together with the listed olive oil.
- historical::grilled-zucchini-and-summer-squash::2::3 — CONSUMED_ROW; VALID_CONTINUING_USE; Prior instruction says, "Toss zucchini and squash slices with ... garlic..." and the current instruction says, "Grill for 3-4 minutes per side." Grilling continues cooking the zucchini with the listed minced garlic.
- historical::grilled-zucchini-and-summer-squash::2::4 — CONSUMED_ROW; VALID_CONTINUING_USE; Prior instruction says, "Toss zucchini and squash slices with ... Italian herbs..." and the current instruction says, "Grill for 3-4 minutes per side." The herbs remain on and continue cooking with the squash.
- historical::grilled-zucchini-and-summer-squash::2::5 — CONSUMED_ROW; VALID_CONTINUING_USE; Prior instruction says, "Toss zucchini and squash slices with ... salt..." and the current instruction says, "Grill for 3-4 minutes per side." The salt remains part of the seasoned squash during grilling.
- historical::grilled-zucchini-and-summer-squash::2::6 — CONSUMED_ROW; VALID_CONTINUING_USE; Prior instruction says, "Toss zucchini and squash slices with ... pepper." and the current instruction says, "Grill for 3-4 minutes per side." The pepper remains on and continues with the squash during grilling.
- historical::mexican-oaxacan-bowl::1::0 — OTHER; DIRECT_ACTIVE_USE; “Mix cumin, chipotle and salt together in a small bowl.” This instruction actively prepares the listed Spice Rub as the named spice mix component.
- historical::mexican-oaxacan-bowl::2::0 — OTHER; VALID_PARTIAL_USE; “sprinkle generously with spice mix... Use about ½ or ⅔ of the spice.” The spice mix is the exact alias of the listed Spice Rub, and the explicit partial quantity supports active use with some remaining.
- historical::mexican-oaxacan-bowl::4::0 — OTHER; VALID_CONTINUING_USE; “toss the pecans with 2 teaspoons maple syrup and 1 teaspoon of the spice mix.” This is a later, explicitly quantified continuing use of the listed Spice Rub after the earlier partial use.
- historical::mexican-oaxacan-bowl::5::12 — OTHER; VALID_CONTINUING_USE; “make the slaw. Finely chop or shred the cabbage and place in a medium bowl with the rest of the ingredients, toss.” The instruction explicitly acts on the listed Quick Cabbage Slaw, with “remaining” language supporting continuing use.
- historical::mole-poblano::3::2 — CONSUMED_ROW; DIRECT_ACTIVE_USE; The instruction explicitly says, “Have a large pot ready with simmering chicken broth or water to soak all the ingredients.” This directly uses the listed “About 8 cups of water” as the stated water alternative.
- historical::mole-poblano::6::7 — OTHER; VALID_CONTINUING_USE; The row’s mulato peppers were previously toasted and soaked, and the current instruction says to grind “all the toasted ingredients except the sesame seeds.” This is continuing manipulation of the same peppers, not a new or exhausted use.
- historical::mole-poblano::6::8 — OTHER; VALID_CONTINUING_USE; The ancho peppers were previously prepared in instructions 2 and 4; the current instruction directs grinding “all the toasted ingredients except the sesame seeds.” This validly continues processing the same ancho peppers.
- historical::mole-poblano::6::9 — OTHER; VALID_CONTINUING_USE; The pasilla peppers were previously toasted and soaked, and the current instruction says to grind “all the toasted ingredients except the sesame seeds.” That is continuing manipulation of the listed pasilla peppers.
- historical::mole-poblano::9::28 — WRONG_GROUP; DIRECT_ACTIVE_USE; The instruction explicitly states, “Every ingredient will be added to the pot with the chicken broth.” This directly uses the listed “reserved broth from the cooked chicken,” an exact alias for the chicken broth.
- historical::pad-thai::8::12 — WRONG_DUPLICATE; VALID_PARTIAL_USE; The current instruction says “a handful of extra beansprouts on the side if desired,” and the risk facts mark “remainingLanguage”: true. This supports valid remaining use of the listed stir-fry beansprouts row, rather than treating the serving mention as context only.
- ingredient::tacos-al-pastor::4::0 — CONSUMED_ROW; VALID_CONTINUING_USE; After the prior instruction says to layer the meat and marinade, the current instruction says "Cover with aluminum foil and refrigerate for at least 4 hours (overnight is best)." This is continuing handling of the listed pork loin, not a contextual mention.
- historical::tacos-al-pastor::11::22 — OTHER; DIRECT_ACTIVE_USE; The current instruction says, "Heat the tortillas with a little bit of oil." This directly uses the listed "15 Corn Tortillas" row.

## 17. Strategy comparison table

| Strategy | TP | FP | FN | Precision | Candidate recall | AI decisions |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Reviewer union | 833 | 28 | 0 | 96.75% | 100.00% | 0 |
| Reviewer intersection | 763 | 9 | 70 | 98.83% | 91.60% | 0 |
| V10A disagreement-only | 831 | 20 | 2 | 97.65% | 99.76% | 91 |
| Risk rejection only | 829 | 19 | 4 | 97.76% | 99.52% | 0 |
| Risk-routed state-aware arbiter | 748 | 9 | 85 | 98.81% | 89.80% | 477 |
| Arbiter everything (V10A experiment A) | 828 | 20 | 5 | 97.64% | 99.40% | 863 |

The smallest measured strategy remains V10A disagreement-only for recall; no strategy reaches zero FP.

## 18. Final TP / FP / FN

748 / 9 / 85.

## 19. Final precision

98.81%.

## 20. Final candidate recall

89.80%.

## 21. AI decisions, calls, and tokens

477 frozen risk decisions; 82 historical decisions; 4 candidates × 4 recipe-190 control requests. 72 Gateway requests; 294525/68997/363522 input/output/total tokens. Provider cost and model revision were not available.

## 22. Transport and retry behavior

68 logical primary+historical batches; 72 Gateway calls; 0 retries; 0 schema failures; 0 parse failures; 0 local rejections; 0 other failures.

## 23. Recipe 190 result

4/4 independent bounded control requests succeeded; 0 failed.

## 24. Prepared-component diagnostic appendix

Excluded from the primary gate. V10A accepted 66/75 correct component candidates and 97/121 incorrect component candidates (40.49% precision). Candidate-level V9 component false accepts: 27. Taxonomy: {"labelOrIdentityProblem":18,"establishmentOrUseProblem":0,"other":9}. Reviewer component proposals and conservative component nouns are used only to flag possible constituent-only ingredient relations; component labels are not promoted to user-facing output.

## 25. Production mutation

Firestore writes = 0; recipe writes = 0; map writes = 0; production code activation = 0; production files edited by V10B = none.

## 26. Tests, lint, typecheck, and build

{"lint":"PENDING","typecheck":"PENDING","build":"PENDING","tests":"PENDING","diffCheck":"PENDING","newTests":10}.

## 27. Files modified

- PRD.md — record the V10B frozen precision result and next research boundary.

## 28. Files created

- scripts/analyze-cooking-mode-v10b-ingredient-precision-core.mjs
- scripts/analyze-cooking-mode-v10b-ingredient-precision.mjs
- scripts/run-cooking-mode-v10b-ingredient-precision.mjs
- tests/cookingModeV10BIngredientPrecision.test.js
- docs/audits/cooking-mode-v10b-ingredient-precision-analysis-2026-08-28.json
- docs/audits/cooking-mode-v10b-ingredient-precision-analysis-2026-08-28.md

## 29. Commit and push

No. Prohibited by the task.

## 30. PRD update

Yes — Section 7 Cooking Mode recall remediation records the failed V10B gate, transport evidence, and next semantic boundary.

## 31. Unverifiable items

Historical regression family labels are source-signal taxonomies because the locked regression artifact stores origins but not manual family adjudications. The provider supplies token usage but no authoritative dollar cost or model-revision identifier.

## 32. Deferred work

All nine correct-candidate QUANTITY_CONFLICT rejections were driven by invalid evidence: decimal/fraction punctuation was normalized away or an unrelated quantity in the current instruction was attached to the candidate row. This must be fixed and independently tested before another arbiter experiment. No production integration, reviewer rerun, full-corpus run, component redesign, migration, commit, or push was performed.

## 33. Next action

Inseparable family: **PASSIVE_CARRIED_FORWARD_CONSTITUENT_VS_ACTIVE_CONTINUING_USE**. The prompt treated continued cooking, chilling, serving, or seasoning of a containing food as active use of both legitimate principal rows and passively carried-forward constituent rows. The source facts do not yet encode an active-target/component-membership boundary precise enough to separate those cases. Define source-derived active targets and component membership/lifecycle at row granularity, repair row-scoped quantity extraction, then test the inseparable family in a new frozen prompt experiment. Do not rerun reviewer discovery.

Identify which false-positive family remains inseparable from valid ingredient use before another arbiter experiment.
