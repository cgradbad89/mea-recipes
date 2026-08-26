# Recovered Recipe Mapping V5 Remediation Validation — 2026-08-26

## Executive result

**PASS**

The row-availability, group-scope, quantity, and AI-lifecycle defects exposed by the historical recovered-41 v4 audit are remediated under deterministic-v5/hybrid-v5. All required precision, compatibility, AI, stability, and zero-mutation gates passed. This result authorizes a fresh complete 41-recipe hybrid-v5 audit only; it does not authorize map apply and does not revive the historical v4 manifest.

## Audited configuration

| Setting | Value |
|---|---|
| Pre-commit git SHA | `6ccdb31529ad41512985db2501f9754f8a0985ce` |
| Behavior fingerprint | `33b4cf11faa559c8c5f7e291d152f6675031984ff8897da92c5cab30f5a7374b` |
| Schema | `1` |
| Parser | `recipe-content-v1` |
| Deterministic engine | `deterministic-v5` |
| Hybrid engine | `hybrid-v5` |
| AI prompt | `v2` |
| Model | `openai/gpt-5.6-luna` |
| Temperature | `0` |

Prompt v2 was retained. Direct primary-like and repeat/stability-like regression tests, followed by the bounded live run, proved that validator hardening reliably rejects the repeated Couscous salt proposal. No prompt, model, or temperature change was necessary.

## Exact failure-path disposition

| Recipe / path | deterministic-v4 or hybrid-v4 failure | Final v5 behavior |
|---|---|---|
| Couscous Salad, step 2 / vinaigrette salt row 15 | Wrong-group consumed salt mapped to sweet-potato seasoning. | Vinaigrette group is positively recognized and consumed in step 0; row 15 is unavailable and omitted from the potato step. |
| Couscous Salad, step 3 / AI salt row 15 | Prompt-v2 proposal was accepted in both primary and stability runs. | Shared AI availability validation rejects the consumed, wrong-group row in focused primary/repeat tests and both live bounded runs. |
| Dad's Chili, step 5 / Chili Sauce row 15 | Finished-dish noun `chili` collided with `Chili Sauce`. | Compound prepared-carrier modifiers are not standalone aliases; finished-dish `chili` is omitted, while direct `add chili sauce` remains mapped. |
| Easy Chicken Ramen, step 2 / soup-water row 13 | Listed soup water mapped to fresh egg-boiling water. | Unmeasured boiling/ice-bath process water cannot borrow a measured listed row; the exact `1 cup water` soup use maps later. |
| Pepper Steak, step 0 / soy row 3 | `2 ½ tablespoons` was truncated to `½ tablespoons`. | Longest mixed-number form is captured exactly; step 0 stores `2 ½ tablespoons`, and step 3 maps explicit `remaining 1 tablespoon`. |
| Peruvian Roasted Chicken, step 4 / marinade chile row 3 | Chicken-marinade chile leaked into sauce preparation. | Positive sauce scope selects sauce row 21; marinade row 3 is omitted. |
| Tuscan Bean Soup, step 2 / rosemary-oil garlic row 21 | Prepared-oil garlic leaked into soup aromatics. | The bounded rosemary-oil rows are consumed as a component; soup garlic maps row 5 and row 21 is omitted. |
| Vegetarian Skillet Chili, step 0 / chili onion row 7 | Chili onion was selected for the pickling step. | Positive pickled-onion scope selects row 2; row 7 maps only in explicit chili scope. |

The pre-change reproduction and root-cause matrix is preserved in `docs/audits/recovered-recipes-mapping-v5-failure-matrix-2026-08-26.md`.

## Deterministic-v5 rules

V5 applies one private availability model across deterministic mapping and AI validation. A row must be textually grounded, compatible with exact quantity/unit evidence, in the active component/group/purpose, and not already fully consumed. Reuse requires explicit remaining/rest/reserved evidence, divided or grounded partial sequencing, or continuing manipulation of the already-introduced material. Prepared-component reuse does not reopen raw constituent rows.

Additional general protections distinguish finished-dish names from compound sauce identities, reject unmeasured fresh boiling/ice-bath water from measured recipe rows, prefer positive bounded group scope, recognize reordered multiword component headings, preserve exact Unicode mixed-number quantities, and prevent raw words embedded in prepared oil/sauce/dressing names from leaking as constituent references. No recipe ID is consulted by mapping behavior.

## All-41 deterministic validation and semantic review

Wave 1A **28** + Wave 2 **6** + Wave 3 **7** = **41 unique recipes**; none of the unresolved eight was admitted. Fresh production reads found 236 shared recipes, 187 with maps and 49 without. All 41 repaired recipes existed, remained parser-clean, remained map-free, and retained the exact source hashes from the v4 audit.

| Metric | Result |
|---|---:|
| Recipes reviewed | 41 / 41 |
| Instructions | 233 |
| Mapped steps | 122 |
| Fully unmapped steps reviewed | 111 |
| Deterministic references reviewed | 295 |
| Safe mappings | 295 |
| Safe omissions | 111 |
| False-positive mappings | 0 |
| False-positive recipes | 0 |
| Structurally invalid candidates | 0 |

Every reference and every fully unmapped instruction is recorded in `docs/audits/recovered-recipes-mapping-v5-semantic-review-2026-08-26.json`. The 255 unchanged safe relationships were reconciled to and reconfirmed against the exhaustive v4 review under unchanged source hashes; all 40 new or corrected relationships were inspected from exact ingredient row through group, prior lifecycle, instruction, and usage qualifier.

## Existing 187-map runtime compatibility

Runtime supports persisted `deterministic-v4`, `hybrid-v4`, `deterministic-v5`, and `hybrid-v5` maps. Persisted v4 maps retain their original source-bound structural contract rather than being compared to newly changed v5 deterministic locks. Unsupported v1-v3 engines still fail closed.

| Check | Result |
|---|---:|
| Persisted maps read | 187 |
| `deterministic-v4` | 148 |
| `hybrid-v4` | 39 |
| Live sourceHash matches | 187 |
| Structurally valid | 187 |
| Runtime selected persisted map | 187 |
| V5-induced fallbacks | 0 |
| Persisted maps changed | 0 |

## Bounded live AI review

Only after the deterministic and 187-map gates passed, a fixed 26-recipe hard/AI-eligible subset received one primary and one repeat request. This was not a full 41-recipe hybrid audit.

| Metric | Result |
|---|---:|
| Recipes | 26 |
| Primary requests | 26 |
| Stability requests | 26 |
| Retries / provider failures | 0 / 0 |
| Primary accepted ingredients / components | 8 / 6 |
| Repeat accepted ingredients / components | 5 / 6 |
| Accepted usage qualifiers | 1 primary |
| Accepted relationships reviewed | 25 |
| Correct / ambiguous / incorrect | 25 / 0 / 0 |
| Input / output / total tokens | 75,596 / 31,770 / 107,366 |

The consumed vinaigrette salt was rejected in both the primary and repeat live outputs. Every accepted ingredient index, group/purpose, prior lifecycle, instruction phrase, usage qualifier, component establishment, canonical label, and target step was manually reviewed.

## Stability

All 26 bounded recipes were rerun: **23 EXACT_STABLE**, **0 SEMANTICALLY_STABLE**, **3 SAFE_OMISSION_DIFFERENCE**, **0 UNSAFE_MATERIAL_DIFFERENCE**, and **0 errors**. The three non-exact recipes were `chinese-chili-oil`, `filipino-brased-chicken-tocino`, and `roasted-white-bean-and-tomato-pasta`; each difference was manually confirmed to be omission-only, with no competing or incorrect relationship.

## Safety and historical status

- Recipe writes: **0**
- Map writes: **0**
- Firestore mutations: **0**
- Historical recovered-v4 manifest: unchanged at SHA-256 `289759234b88c4d29b18fe42a7f67f2e18473cc9285dd5df4ef9ced798ca1716`; permanently historical and not apply-authorized.
- Fresh v5 apply manifest: **not created**.
- Recovered map apply: **blocked pending the separate full 41-recipe hybrid-v5 audit**.

## Next action

Run a completely fresh full 41-recipe hybrid-v5 audit from live content, produce a new immutable manifest/hash, and do not reuse the v4 recovered-recipe manifest.
