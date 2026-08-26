# Cooking-step mapping v2 remediation validation — 2026-08-25

## Executive result

**PASS — ready for a completely new full production hybrid dry run. Not ready for backfill.**

The v2 remediation fixes every reproduced deterministic false positive, rejects every reproduced
incorrect AI/validator relationship, and meets the bounded stability target. Production recipe data
was read only. No cooking-step map was written, no apply mode was run, and no deployment occurred.

## Failure matrix and remediation

| Production evidence | Cause | Previous behavior | v2 behavior |
|---|---|---|---|
| Moqueca coconut/olive oil | `DETERMINISTIC_NORMALIZATION` | Alternative `coconut` alias matched coconut milk/broth | Shared alternative head is preserved (`coconut oil` / `olive oil`); only milk/stock rows map |
| Chicken Wild Rice broth | `DETERMINISTIC_MATCHING` | Generic chicken selected chicken broth | Protein shorthand is blocked inside broth/stock/sauce/seasoning compounds |
| Butter-Soy egg-white observation | `DETERMINISTIC_MATCHING` | “some egg white may float” mapped active use | Narrow incidental `some … may` context abstains |
| Tacos Al Pastor header, wrong garlic, except pepper | `GROUP_DISAMBIGUATION`, `NEGATIVE_CONTEXT` | Header/ordering and exception text produced mappings | Headings abstain, `except` is inactive, duplicate groups require positive scope |
| Fried Chicken / Chow Mein notes | `DETERMINISTIC_MATCHING`, `SOURCE_PARSER_DEFECT` | Chicken-seasoning and supplemental prose mapped as cooking use | Compound guard blocks chicken seasoning; obvious review/note contamination is non-actionable without rewriting source |
| Masala serrano / chile powder | `DETERMINISTIC_NORMALIZATION` | Generic chile alias selected serrano from chile powder | Spelling/plural variation normalizes safely; distinct chile identities remain separate |
| Queso additional water | `DETERMINISTIC_MATCHING` | Unlisted “another 1/2 cup” mapped to the listed water row | Explicit additional quantity abstains |
| Blue Corn sauce heading/reference | `DETERMINISTIC_MATCHING`, `VALIDATOR_COMPONENT` | Component heading and prepared sauce remapped raw chile | Heading is non-actionable; prepared sauce phrase cannot remap the raw chile row |
| Unspecified toppings (151/158/159) | `AI_PROMPT_OVERREACH`, `VALIDATOR_COMPONENT` | AI invented toppings as prepared components | v2 prompt requires abstention; canonical antecedent validator rejects them |
| Posole remaining ingredients (194) | `VALIDATOR_GROUNDING`, `VALIDATOR_USAGE` | Previously used canola oil was guessed from collective remaining | Unbounded collective remaining cannot establish an ingredient association |
| Moqueca unrelated “all pieces” | `VALIDATOR_USAGE` | Salt received `usage.kind=all` | `all` must be local to the ingredient or an explicit named group; invalid usage is dropped |
| Queso unrelated “everything” | `VALIDATOR_USAGE` | Tortilla chips received `usage.kind=all` | Unrelated collective language cannot ground usage metadata |
| Reader review copied into Curried Red Bean Soup | `SOURCE_PARSER_DEFECT` | Review prose reached AI and accepted pasta/kale | Source defect remains; mapping layer marks review/comment prose non-actionable and blocks AI |
| 10/20 prior material reruns | `AI_NONDETERMINISM` | Broad eligibility and permissive validation amplified variance | Prompt v2, temperature 0, narrower eligibility, and shared grounding reduce material differences to 1/20 |

## Deterministic v2

- Alternative normalization preserves identity-defining head nouns and modifiers.
- Chile/chili spelling and plural variants normalize, but green/ancho/guajillo/chipotle/serrano and
  chile powder do not collapse into one generic ingredient.
- Clear local negative, deferred, removal, discard, exception, incidental, and unlisted-additional
  contexts abstain. Nearby unrelated negation does not suppress a later active use.
- Duplicate rows in different groups require positive current-instruction group evidence.
- `all`, `everything`, and collective `remaining ingredients` stay unresolved without one explicit,
  unambiguous named group. No “unused rows” inference exists.
- URL, review/comment, nutrition, storage, paywall, and component-heading contamination is retained in
  source but mapped as `non-actionable` and never sent to AI.

All nine production deterministic false-positive recipes are covered by final-map regression fixtures
and now abstain or map the correct row. Positive controls for Pork Posole, Charlie Bird's Farro Salad,
Easy Spaghetti, Pesto, roasted asparagus, Taco Soup, Japanese teriyaki bowl, explicit groups,
ingredient-specific remaining, partial quantities, and grounded components remain green.

## Prompt and validator v2

- Prompt version: `v1` → `v2`.
- Model/provider: unchanged at `openai/gpt-5.6-luna` through Vercel AI Gateway.
- Cooking-step calls now request `temperature: 0`; unrelated AI features retain their defaults.
- The prompt explicitly treats abstention as correct and includes negative examples for toppings,
  generic remaining/everything, compound food words, negative/deferred language, and duplicate groups.
- AI remains additive only; deterministic references cannot be removed, replaced, or restated.
- Ingredient grounding, group conflict, collective scope, negative context, usage locality, and prepared
  component canonicalization are shared by publish-time merge and runtime persisted-map validation.
- Invalid usage is dropped when the ingredient itself is independently grounded; the association is
  rejected when it lacks independent grounding.
- Prepared components require an exact canonical group/antecedent label, or a unique generic component
  noun resolving to that label. Expanded/invented labels are rejected.

## Versions and runtime support

| Contract | v2 value |
|---|---|
| Schema | `1` |
| Parser | `recipe-content-v1` |
| Deterministic engine | `deterministic-v2` |
| Hybrid engine | `hybrid-v2` |
| AI prompt | `v2` |
| Supported runtime engines | `deterministic-v2`, `hybrid-v2` only |

Persisted v1 maps are unsupported and fail closed to a newly built deterministic-v2 map.

## Bounded live Gateway validation

The fixed allowlist contained 27 unique recipes: the prior 20-recipe stability subset, all six
still-source-eligible prior incorrect-AI recipes, and three validator controls. It read 27 exact
production documents; it did not query or rerun the full corpus. Twenty-four remained source-eligible,
three retained parser-defect exclusions, and 23 recipes needed AI under v2.

| Metric | Final gate |
|---|---:|
| Unique recipes | 27 |
| AI-needing recipes rerun | 23 |
| Gateway requests | 46 |
| Provider retries/failures | 0 / 0 |
| Primary accepted additions | 30 |
| Repeat accepted additions | 29 |
| Accepted additions reviewed | 59 (30 unique relationships) |
| Correct | 59 |
| Ambiguous persisted | 0 |
| Incorrect | 0 |

The preliminary 46-request pass found five noncanonical component labels that survived validation.
Those results were not accepted as the final gate; they produced new regressions and a stricter
canonical-label validator. Total live Gateway requests during remediation were therefore 92, with no
provider failure. The final 46-request gate above is the post-fix result.

Among the six still-eligible previously incorrect recipes, 151, 158, 159, 194, and Queso produced no
accepted AI additions in either final run. Moqueca produced only the correct stock and coconut-milk
associations in both runs, without the former oil or `all`-usage errors.

## Stability

Direct comparison on the same prior 20 recipes:

| Result | Previous | Final v2 |
|---|---:|---:|
| Exact stable | 9 | 19 |
| Semantically stable | 1 | 0 |
| Material difference | 10 | 1 |
| Errors | 0 | 0 |

The one material difference was safe omission versus the correct grounded `green harissa dressing`
component on Chicken Chickpea Salad. No incorrect or ambiguous association was involved.

## Production mutation and historical manifest

Production writes: **none**.

`docs/audits/cooking-step-mapping-dryrun-2026-08-25.json` remains historical evidence with SHA-256
`03cccba16232237f2ffb8b0c1971ec3a66732da8a0f1480717769ac5f25093ae`. It is **NOT authorized for
apply**. Its candidate maps are stale because deterministic engine behavior, hybrid validation, and
the AI prompt version changed. Its 168 historical `READY` rows must not be reinterpreted as approval.

## Next action

Run a completely new full production hybrid dry run with engine/prompt v2 and produce a new manifest
and hash. Backfill apply remains blocked until that new corpus-wide evidence passes review.
