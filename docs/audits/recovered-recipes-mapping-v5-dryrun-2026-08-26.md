# Recovered recipes cooking-step mapping v5 final dry run — 2026-08-26

## Executive result

**READY FOR MAPPING APPLY**

This read-only audit generated fresh source-bound candidates for the exact 41 recipes repaired by Waves 1A–3. Recipe writes, map writes, and Firestore mutations were all zero.

## Audited configuration

| Setting | Value |
|---|---|
| Git SHA | `52157d937b78a1cef41e95c0882285c1234150cd` |
| Behavior fingerprint | `33b4cf11faa559c8c5f7e291d152f6675031984ff8897da92c5cab30f5a7374b` |
| Schema | `1` |
| Parser | `recipe-content-v1` |
| Deterministic engine | `deterministic-v5` |
| Hybrid engine | `hybrid-v5` |
| Prompt | `v2` |
| Model | `openai/gpt-5.6-luna` |
| Temperature | `0` |

## Population and production baseline

Wave 1A **28** + Wave 2 **6** + Wave 3 **7** = **41 unique IDs**. The final eight unresolved recipes are absent. Production contained **236** shared recipes, **187** persisted maps, and **49** recipes without maps. All 41 tranche recipes were map-free and source-clean.

## Deterministic-v5

Recipes **41**; ingredients **653**; instructions **233**; mapped steps **122**; unmapped steps **111**; ingredient references **295**; ambiguous **10**; implicit **14**; prepared-component **22**; no-ingredient-use **1**; non-actionable **2**; AI-eligible steps **46**; AI-eligible recipes **26**.

Exhaustive review covered **41** recipes, **295** mapped references, and **111** fully unmapped instructions: safe mappings **295**, false-positive mappings **0**, false-positive recipes **0**.



The seven prior failures were explicitly reconfirmed clean under deterministic-v5: `couscous-salad-with-lime-basil-vinaigrette`, `dads-chili`, `easy-chicken-ramen`, `pepper-steak`, `peruvian-roasted-chicken-with-spicy-cilantro-sauce`, `tuscan-bean-soup`, `vegetarian-skillet-chili`.

## Hybrid-v5 and AI semantic review

AI-eligible recipes **26**; recipes called **26**; primary requests **26**; stability requests **26**; retries **0**; provider failures **0**; accepted ingredient additions **7**; accepted prepared components **6**; accepted usage qualifiers **1**; remaining unresolved semantics **34**. Across primary and stability runs, reviewed accepted semantics were correct **25**, ambiguous **0**, incorrect **0**.



Consumed vinaigrette salt was rejected in the primary run: **true**; rejected in the stability run: **true**.

## Stability

All **26** AI-assisted recipes were rerun: exact **23**, semantically stable **0**, safe omission difference **3**, unsafe material difference **0**. Every non-exact result was manually reviewed.

## Classification and immutable manifest

READY **41**; REVIEW **0**; EXCLUDED **0**; ERROR **0**; EXISTING_MAP **0**.

Manifest: `docs/audits/recovered-recipes-mapping-v5-dryrun-2026-08-26.json`; SHA-256: `5d4ddaa10c788f9192ae74a5887859bc2847496706461b655752d86e62741170`; rows: **41**. Semantic evidence: `docs/audits/recovered-recipes-mapping-v5-semantic-review-final-2026-08-26.json`.

## Final live preconditions and existing-map safety

Final live READY checks: **41/41** passed. Existing persisted v4 maps: **187**; source hashes matched **187**; structurally valid **187**; runtime accepted **187**; forced fallbacks **0**. The audit caused zero production changes.

## Production mutation and AI usage

Recipe writes **0**; map writes **0**; Firestore mutations **0**. Real Gateway requests **52** (26 primary and 26 stability; zero retries and failures), totaling **75596** input, **30607** output, and **106203** tokens.

## Historical v4 manifest

The old recovered-v4 manifest remains historical only and is not authorized for apply: `docs/audits/recovered-recipes-mapping-v4-dryrun-2026-08-26.json`, SHA-256 `289759234b88c4d29b18fe42a7f67f2e18473cc9285dd5df4ef9ced798ca1716`. It was not candidate input to this audit.

## Deferred work and next action

Wave 4/5 and personal override-specific mappings remain pending. Create one final immutable-manifest-SHA-locked map apply prompt for the approved recovered recipes. It must make zero AI calls and perform zero mapping recomputation.
