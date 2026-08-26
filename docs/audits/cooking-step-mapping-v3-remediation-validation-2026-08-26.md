# Cooking-Step Mapping V3 Remediation Validation — 2026-08-26

## Executive result

**PASS — ready for a fresh full production hybrid-v3 dry run.** This result does not authorize
backfill. No Firestore document or cooking-step map was written, and no full hybrid corpus audit or
backfill manifest was produced.

## Configuration

| Setting | Value |
|---|---|
| Schema | `1` |
| Parser | `recipe-content-v1` |
| Deterministic engine | `deterministic-v3` |
| Hybrid engine | `hybrid-v3` |
| AI prompt | `v2` |
| Model | `openai/gpt-5.6-luna` |
| Mapping temperature | `0` |

The AI prompt, model, temperature, and hardened validator semantics were not redesigned. Audit-only
request timeout plumbing was added so a bounded validation cannot hang indefinitely; production
callers retain their existing behavior.

## Reproduced v2 failures and v3 outcome

The exact pre-change ingredient rows, groups, instructions, associations, and evidence classes are in
`cooking-step-mapping-v3-failure-matrix-2026-08-26.md`.

| Recipe | Deterministic-v2 defect | Deterministic-v3 behavior |
|---|---|---|
| Butter-Soy Chicken and Asparagus Stir-Fry | Unscoped `pinch of salt` selected chicken-group salt `[5]`. | Salt is ambiguous and omitted; asparagus remains mapped. |
| Chicken Chow Mein | A numbered substitution note mapped raw chicken `[1]`. | The explanatory note is non-actionable and has no references. |
| chicken wild rice | Chicken in a temporal clause mapped `[1]` while another mixture was made. | Chicken is omitted; butter, flour, milk, and wine remain active-use mappings. |
| Tacos Al Pastor | A roasted-salsa heading mapped tomatillo `[15]`; a sauce step selected marinade garlic `[3]`. | The heading is non-actionable; sauce-group garlic `[17]` is selected with group evidence and `[3]` is absent. |
| Sheet Pan Chicken Tinga Bowls | Chicken in a `while ... bake` context mapped `[0]` during sauce work. | Chicken is omitted from the sauce instruction; active sauce ingredients remain mapped. |
| Chopped Thai Shrimp Salad | Unlisted shrimp seasoning selected dressing salt `[8]`. | Dressing salt is omitted from the shrimp clause; shrimp remains mapped. |
| Singapore Mei Fun | Unlisted soaking water reused sauce water `[10]`; label oil `[11]`, negated oil, and `egg plate` leaked into mappings. | Unlisted water and label `[11]` never map; actual cooking oil `[12]` maps only where actively used; negated oil and contextual egg are absent. |
| Sesame Apricot Tofu | `garlic` inside/explaining prepared sauce leaked raw garlic `[9]`. | Tofu remains mapped; garlic is absent; `apricot sauce` remains eligible for validated component grounding. |
| Chickpea Curry | `2 tablespoons avocado oil` attached to nonmatching listed row `[0]` containing 1 tablespoon. | Quantity/row mismatch is unresolved; `[0]` is absent. |

## Deterministic-v3 rules validated

- Identity evidence and clause-local positive active-use evidence are both required.
- Action verbs in one clause do not activate contextual identities in another clause.
- `for`, temporal, serving, destination, prepared-component, negative, and deferred contexts are
  evaluated around the ingredient occurrence rather than as whole-step keywords.
- Duplicate/identity-equivalent rows require an explicit group/component, an exact unique quantity,
  or another unambiguous same-clause group cue. Ordering and unused-row heuristics are prohibited.
- Quantity disambiguation reuses the ingredient parser and unit conversion; it must agree with the
  selected row. Mismatches and inferred subtraction abstain.
- Prepared-component carriers take precedence over constituent substrings.
- Headings, bare section labels, and explanatory supplemental material establish no active use.
- An unlisted cooking material creates no row and cannot activate a similarly named listed row.

## Deterministic full-corpus audit

The read-only deterministic command audited 236 shared documents: 187 source-eligible and 49 retained
source/parser exclusions. It made 0 AI requests and 0 production writes.

| Metric | V2 | V3 |
|---|---:|---:|
| Instructions | 977 | 977 |
| Mapped steps | 592 | 509 |
| Unmapped steps | 385 | 468 |
| Ingredient references | 1,300 | 1,134 |
| Ambiguous steps | 33 | 28 |
| Implicit-reference steps | 40 | 40 |
| Prepared-component steps | 33 | 76 |
| No-ingredient-use steps | 48 | 54 |
| Non-actionable steps | 2 | 17 |
| AI-eligible unresolved recipes | 106 | 144 |

The lower deterministic coverage is intentional abstention, not an automatic regression.

## Expanded semantic review

The deterministic-v3 review contained all nine current failures, all historical v1 failures, positive
controls, duplicate groups, multi-component recipes, oils, salts, garlic, proteins, prepared
components, multi-clause instructions, labels, partial quantities, and negative/deferred instructions.

| Result | Count |
|---|---:|
| Recipes reviewed | 80 |
| `SAFE_MAPPING` references | 544 |
| `SAFE_OMISSION` fully unmapped instructions | 242 |
| Recipes with a confirmed `FALSE_POSITIVE` | 0 |

## Bounded Gateway compatibility and stability

Only the deterministic gate passing enabled this read-only run. The bounded set contained 25 unique
hard/affected recipes. It made 25 primary Gateway requests and 20 repeat requests, for 45 total. Every
one of the 22 accepted primary additions was manually reviewed: 22 correct, 0 ambiguous, 0 incorrect.
Validator rejections remained rejected; no validator loosening was made.

| Stability class | Recipes |
|---|---:|
| `EXACT_STABLE` | 20 |
| `SEMANTICALLY_STABLE` | 0 |
| `SAFE_OMISSION_DIFFERENCE` | 0 |
| `UNSAFE_MATERIAL_DIFFERENCE` | 0 |

## Manifest and mutation status

- Production mutations: **none**.
- V1 manifest SHA-256 `03cccba16232237f2ffb8b0c1971ec3a66732da8a0f1480717769ac5f25093ae`:
  **NOT AUTHORIZED**.
- V2 manifest SHA-256 `69a13a5c2a2366d372d747035a85df38bb702bbadc84df6f8a450d91ee0a73a0`:
  **NOT AUTHORIZED**.
- Both historical manifests are stale after the v3 engine change.
- No v3 apply manifest or apply hash was created.

## Acceptance and next action

The deterministic acceptance gate passed with zero confirmed false-positive recipes, bounded accepted
AI relationships contained zero incorrect or ambiguous additions, and repeats contained zero unsafe
semantic disagreements. The next action is a completely fresh full production hybrid-v3 dry run that
creates a new immutable manifest and hash. Backfill remains blocked pending that separate audit.
