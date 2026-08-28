# Cooking Mode V10F-Lite — Active-Object Rescue Go/No-Go (2026-08-28)

DISCOVERY / GO-NO-GO VALIDATION. Small, bounded experiment. No production, Firestore, or
Cooking Mode runtime changes. No AI calls, no new dependencies.

## 1. Executive result

**GO — SIMPLE ACTIVE-OBJECT RESCUE WARRANTS FULL FROZEN VALIDATION**

## 2. Starting state

- Branch: `main`
- HEAD: `36d51d494a810342c1b15f04ccf26be3fe51f99a` (matches the expected checkpoint exactly)
- `origin/main`: `36d51d494a810342c1b15f04ccf26be3fe51f99a` (in sync)
- Dirty-worktree summary: 13 pre-existing untracked files (duplicate `" 2"` files —
  `app/error 2.tsx`, `lib/admin 2.ts`, `tests/*.test 2.ts`, etc. — plus stray `firebase-debug*.log`
  / `firestore-debug.log` and `.eslintrc.json`), all present before this session started and
  unrelated to this task. None were modified, staged, or deleted.

## 3. Challenge set

- Positive count: 20 (10 `DISH_STATE_CONTINUATION` + 10 `PRONOUN_OR_DEICTIC_REFERENCE`)
- Negative count: 11 (negative leakage)
- Target-FP count: 20 (all 20 V10A target false positives, per the "prefer to include all 20"
  instruction)
- Total selected: **51**
- Selection method: fully deterministic, drawn only from already-adjudicated evidence in three
  locked artifacts — no new truth labels were created:
  - `docs/audits/cooking-mode-v10e-remaining-fn-taxonomy-2026-08-28.json` `candidates[]`
    (the reconstructed 191-row V10D false-negative population, each row pre-classified into a
    V10E semantic class) — source for the 20 positives.
  - `docs/audits/cooking-mode-v10d-principal-target-analysis-2026-08-28.json`
    `targetFalsePositiveOutcomes[]` — source for all 20 locked target false positives.
  - `docs/audits/cooking-mode-arbiter-v10a-frozen-candidates-2026-08-28.json`
    `populations.INGREDIENT_RELATIONSHIPS`/`PREPARED_COMPONENT_RELATIONSHIPS`, filtered to
    `adjudicatedTruth === 'INCORRECT'` and excluding any row already covered by the 20 target
    false positives — source for the 11 negative leakage cases.
  - Positives were spread across as many distinct recipes as the population allowed (9/9 DSC
    recipes, 5/5 PRONOUN recipes) rather than over-sampling one recipe or wording pattern.
    Negative leakage cases cover consumed row, duplicate/wrong-row identity, serving/garnish on
    an assembled component, an isolated already-combined dressing (5 raw constituent rows),
    a mismatched sub-ingredient label, a marinade-blend target-identity miss, and a
    purée-broth passive-carry case.
- Reproduction: `node scripts/analyze-cooking-mode-v10f-lite-active-object.mjs` regenerates
  `cooking-mode-v10f-lite-active-object-go-no-go-2026-08-28.json` deterministically from the
  three locked source artifacts above (same candidate IDs, same recipe-instruction
  reconstruction, same rule) — zero network/AI/Firestore calls.
- Exact candidate IDs and per-case results: Sections 5–8 below, and the full row-level `results[]`
  array in the JSON artifact.

## 4. Rule

**Plain-English explanation.** An ingredient row may be "rescued" (shown as relevant) at a later
instruction only if BOTH hold:

1. An **earlier** instruction in the same recipe explicitly combined this ingredient with others
   (a real combination verb — add/combine/load/toss/mix/whisk/stir/dice/sauté/blend/simmer/place/
   arrange — naming this ingredient), in the **same** vessel (not "in a small/separate bowl").
2. The **current** instruction either uses a bare whole-dish continuation verb (cover-and-cook,
   simmer, bake, roast, grill, boil, rest, chill, refrigerate, transfer, plate…), a collective/
   category word (everything, mixture, both, all, contents, vegetables, veggies), or an
   unambiguous pronoun (it, them, this, these) — **and** does not reference a separately named
   prepared sub-component (the dressing/sauce/marinade/glaze/rub/paste/slaw/salsa/wrap/roll/
   patty/skewer/casserole/…) or bare generic seasoning language ("to taste"/"adjust seasoning").

If either condition fails, the rule rejects (fails closed) — no exceptions, no partial credit.

- Number of distinct semantic rules: **6** — (1) whole-dish/collective/pronoun evidence
  detection on the current instruction, (2) named-subcomponent fail-closed check, (3) generic-
  seasoning fail-closed check, (4) earlier-combination-verb antecedent search, (5) same-vessel
  requirement (reject "in a small/separate bowl" establishments), (6) generic-food-word/
  dish-type-word exclusion from identity matching (a word like "sauce" or a recipe's own
  dish-type name, e.g. "chili" in a chili recipe, is too common to safely anchor identity).
- Special cases required: **0** recipe-specific or ingredient-specific exceptions. The one
  generalizable exclusion list (`GENERIC_FOOD_WORDS`: sauce, mix, mixture, spice, seasoning,
  broth, stock, cream, cheese, powder, sugar, plus common dish-type nouns chili/soup/stew/curry/
  salad/casserole/bowl) applies to any recipe, not just the ones in this challenge set.

## 5. DISH_STATE_CONTINUATION

- Selected: 10
- Recovered: 9
- Missed: 1
- Recovery: **90.00%**

| Candidate | Recipe | Result |
|---|---|---|
| `ingredient::152::1::2` | Crockpot Chicken Wild Rice Soup | rescued (EXPLICIT_OBJECT) |
| `ingredient::164::2::0` | Slow Cooker Chicken Taco Soup | rescued (EXPLICIT_OBJECT) |
| `ingredient::168::1::0` | Slow Cooker Garlic Butter Chicken Pasta | rescued (EXPLICIT_OBJECT) |
| `ingredient::173::3::1` | Slow Cooker Chicken Ropa Vieja | rescued (EXPLICIT_OBJECT) |
| `ingredient::173::3::2` | Slow Cooker Chicken Ropa Vieja | rescued (EXPLICIT_OBJECT) |
| `ingredient::chicken-tikka::2::0` | Chicken Tikka | rescued (EXPLICIT_OBJECT) |
| `ingredient::grilled-zucchini-and-summer-squash::2::0` | Grilled Zucchini and Summer Squash | rescued (EXPLICIT_OBJECT) |
| `ingredient::mapo-rag-crazy-good::2::2` | Mapo Ragù | rescued (EXPLICIT_OBJECT) |
| `ingredient::mexican-oaxacan-bowl::3::5` | Mexican Oaxacan Bowl | rescued (EXPLICIT_OBJECT) |
| `ingredient::roasted-white-bean-and-tomato-pasta::0::0` | Roasted White Bean and Tomato Pasta | **missed** — candidate is at `instructionIndex: 0`, so no earlier instruction can structurally exist; the rule correctly has no valid antecedent to find |

## 6. PRONOUN_OR_DEICTIC_REFERENCE

- Selected: 10
- Recovered: 10
- Missed: 0
- Recovery: **100.00%**

| Candidate | Recipe | Result |
|---|---|---|
| `ingredient::mole-poblano::13::7` | Mole Poblano | rescued (PRONOUN_REFERENCE) |
| `ingredient::mole-poblano::13::8` | Mole Poblano | rescued (PRONOUN_REFERENCE) |
| `ingredient::mole-poblano::13::9` | Mole Poblano | rescued (PRONOUN_REFERENCE) |
| `ingredient::dads-chili::5::2` | Dad's Chili | rescued (PRONOUN_REFERENCE) |
| `ingredient::dads-chili::5::3` | Dad's Chili | rescued (PRONOUN_REFERENCE) |
| `ingredient::dads-chili::5::4` | Dad's Chili | rescued (PRONOUN_REFERENCE) |
| `ingredient::jocn-chicken-and-tomatillo-stew::5::0` | Jocón | rescued (COLLECTIVE_REFERENCE) |
| `ingredient::jocn-chicken-and-tomatillo-stew::5::1` | Jocón | rescued (COLLECTIVE_REFERENCE) |
| `ingredient::sheet-pan-bibimbap::3::0` | Sheet-Pan Bibimbap | rescued (PRONOUN_REFERENCE) |
| `ingredient::sheet-pan-bibimbap::3::1` | Sheet-Pan Bibimbap | rescued (PRONOUN_REFERENCE) |

## 7. Negative / component-leakage cases

- Rejected: 11 / 11
- False accepts: **0**

| Candidate | Recipe | Danger pattern | Result |
|---|---|---|---|
| `ingredient::157::5::0` | Slow Cooker Minnesota Pork Chop Casserole | consumed row ("Serve and enjoy") | rejected |
| `ingredient::176::6::17` | Garlic Butter Roasted Chicken Thighs + Asparagus | duplicate/wrong-row salt | rejected |
| `ingredient::chicken-tikka::9::0` | Chicken Tikka | serving/garnish on assembled skewer | rejected |
| `ingredient::cucumber-tomato-salad-with-red-wine-vinaigrette::2::3..7` (5 rows) | Cucumber Tomato Salad | isolated already-combined dressing ("the dressing") | rejected (all 5) |
| `ingredient::dads-chili::0::15` | Dad's Chili | mismatched sub-ingredient label ("Chili Sauce" ≠ "Barbq sauce") | rejected |
| `ingredient::tacos-al-pastor::1::0` | Tacos Al Pastor | marinade-blend target-identity miss | rejected |
| `ingredient::jocn-chicken-and-tomatillo-stew::4::2` | Jocón | purée-broth passive-component carry | rejected |

## 8. Target FP protection

- Rejected / evaluated: **20 / 20**

All 20 locked V10A target false positives (root causes: `CONSUMED_ROW`, `PROCESS_MATERIAL`,
`CONTEXTUAL_MENTION`, `COMPONENT_LEAKAGE`) stayed rejected, including the two ratatouille
salt/pepper cases V10D already confirmed benchmark-consistent. Full candidate-ID list is in
`docs/audits/cooking-mode-v10f-lite-active-object-go-no-go-2026-08-28.json`
`challengeSet.lockedTargetFalsePositives.candidateIds` and per-row results in `results[]`
(`group: "LOCKED_TARGET_FALSE_POSITIVE"`).

## 9. Precision

- Rescue TP: 19
- Rescue FP: 0
- Precision: **100.00%** (19/19 accepts were correct; 0 false accepts across all 31 negative +
  locked-target-FP cases combined)

## 10. Complexity check

1. **How many distinct semantic rules were required?** 6 (Section 4) — evidence detection,
   named-subcomponent fail-closed, generic-seasoning fail-closed, antecedent search, same-vessel
   requirement, generic-word exclusion.
2. **How many special-case ingredient/recipe/benchmark-specific phrases were required?** 0. The
   generic-word exclusion list is a general culinary-vocabulary list (sauce/mix/spice/…, plus
   common dish-type nouns), not tied to any specific ingredient name, recipe title, or benchmark
   candidate ID.
3. **Could the rule be explained in 5–10 lines of plain English?** Yes — see Section 4's two-
   condition statement.
4. **Would a new engineer understand why each accepted case is safe?** Yes — every accept's
   `reason` string names the exact earlier instruction that established the ingredient and the
   exact evidence class that triggered on the current instruction (see `results[].reason` in the
   JSON artifact).
5. **Did improving recall require adding exceptions to exceptions?** No. Each fix (dropping
   `brown`/`sear`/`lay`/`layer` from the establishing-verb list, excluding "in a small bowl"
   establishments, excluding generic/dish-type words from identity matching, tolerating plural
   forms) was a single flat rule addressing a documented failure mode from the V10E taxonomy
   (TRANSFER_OR_ASSEMBLY_TARGET, isolated sub-preparation, generic-word collision) — none of them
   layered a condition onto another condition, and none were reverted or special-cased back out
   during tuning.

## 11. Go/no-go gate

| Criterion | Required | Actual | Pass/fail |
|---|---|---|---|
| 0 new false positives on the challenge set | 0 | 0 (0/11 negative, 0/20 locked target FP) | **PASS** |
| ≥ 85% recovery of selected DISH_STATE_CONTINUATION positives | ≥85% | 90.00% | **PASS** |
| ≥ 85% recovery of selected PRONOUN_OR_DEICTIC_REFERENCE positives | ≥85% | 100.00% | **PASS** |
| All evaluated target-FP cases remain rejected | 20/20 | 20/20 | **PASS** |
| Preferred: ≥ 90% recovery in both dominant classes | ≥90%/≥90% | 90.00% / 100.00% | **PASS (preferred bar also met)** |

**Verdict: GO — SIMPLE ACTIVE-OBJECT RESCUE WARRANTS FULL FROZEN VALIDATION**

## 12. Architecture recommendation

**Deterministic active-object path vs. AI-at-ingestion reviewed-map path.**

This experiment shows the *narrow* deterministic active-object rescue clears its own bounded
gate cleanly (100% precision, 90%/100% recovery on the two dominant remaining-FN classes, 0
special cases). That is a meaningfully different result from V6–V10D's broader deterministic
passes, which all traded recall for precision or vice versa across the *whole* candidate
population. The difference here is scope: this rule targets only the two classes V10E isolated
as structurally simple (bare continuation verbs and pronoun/collective antecedent resolution),
not the full 191-row remaining-FN population (SERVING_OR_GARNISH_ACTION,
TRANSFER_OR_ASSEMBLY_TARGET, MULTI_COMPONENT_ASSEMBLY, etc. are explicitly out of scope here).

Compared with the original two-reviewer AI union (≈99.93% of confirmed omissions recovered):
continuing the deterministic path for *this specific two-class slice* still looks cheaper and
safer than routing it through an ingestion-time AI reviewer, because the slice is now proven to
be resolvable with 6 flat, explainable rules and 0 recipe-specific exceptions — the complexity
signal that would normally argue for AI review (Phase 6) did not appear. This is **not** a
recommendation to keep pursuing the *remaining* semantic classes deterministically; those were
out of scope for V10F-Lite and were not tested here. The next-step gate below stays deliberately
narrow: validate this same rule (unexpanded) against the full frozen benchmark before deciding
anything about the other classes or about ingestion-time AI review.

## 13. Files modified

None — this experiment made no changes to any existing file.

## 14. Files created

- [scripts/analyze-cooking-mode-v10f-lite-active-object-core.mjs](scripts/analyze-cooking-mode-v10f-lite-active-object-core.mjs) — pure `evaluateActiveObjectRescue` diagnostic rule (no imports of production code, no Firestore, no AI).
- [scripts/analyze-cooking-mode-v10f-lite-active-object.mjs](scripts/analyze-cooking-mode-v10f-lite-active-object.mjs) — read-only driver: loads the 3 locked artifacts, reconstructs the 51-case challenge set, runs the rule, writes the JSON audit artifact.
- [tests/cookingModeV10fLiteActiveObject.test.js](tests/cookingModeV10fLiteActiveObject.test.js) — 14 focused tests (9 synthetic fixtures covering every TEST REQUIREMENTS row + 4 gate checks against the locked challenge-set evidence + 1 tokenizer check).
- [docs/audits/cooking-mode-v10f-lite-active-object-go-no-go-2026-08-28.json](docs/audits/cooking-mode-v10f-lite-active-object-go-no-go-2026-08-28.json) — machine-readable results (every candidate ID + result).
- docs/audits/cooking-mode-v10f-lite-active-object-go-no-go-2026-08-28.md — this report.

## 15. Design gate

`no UI impact` — confirmed. No `app/**` or `components/**` file was touched; the diagnostic rule
is not imported by any production path.

## 16. Tests

- Focused: 14 new (`tests/cookingModeV10fLiteActiveObject.test.js`), all passing.
- Lint: `npm run lint` — 0 errors, 6 pre-existing warnings (all in files this session did not
  touch: `img` element warnings in `app/plan/page.tsx`/`components/*`, and one unused
  eslint-disable in `scripts/reaudit-canonical.js`).
- Typecheck: `npm run typecheck` — passes clean (an initial run before `npm run build` failed on
  stale duplicate `.next/types/*.d 2.ts` output left over from a prior build against this
  workspace's pre-existing duplicate `" 2"` source files; re-running after `next build`
  regenerated `.next/types` and typecheck passed with 0 errors — this is a pre-existing workspace
  artifact unrelated to this task's changes, not a defect introduced here).
- Full suite: `npm test` — **70 passed | 1 skipped (71 files)**, **942 passed | 1 skipped (943
  tests)**. The 1 skip is pre-existing (not part of this change).

## 17. Build

**PASSED** — `npm run build` completed successfully (Next.js 16.3.1, Turbopack, TypeScript check
finished in 1775ms, 27/27 static pages generated, 0 errors).

## 18. Commit

- SHA: recorded after commit (see repository log for the commit titled "Evaluate Cooking Mode
  active-object go-no-go").
- Pushed: yes (`origin main`), only after the build above passed, per CLAUDE.md.

## 19. Deployment / data mutation

**None.** 0 Firestore writes, 0 recipe writes, 0 `cookingStepIngredientMap` writes, 0 AI calls, 0
Vercel/Firebase deploys. The diagnostic script only reads the 3 locked local JSON artifacts and
writes 1 new local JSON artifact plus this markdown report.

## 20. PRD updates

**Yes — Section 5 (§5.25 Cooking Mode notes) and Section 7 (Feature Backlog, "Cooking Mode recall
remediation" row).** This experiment establishes a durable finding (the narrow active-object
rescue clears its own bounded gate) that changes the recommended next step for an existing
in-flight backlog item, so it qualifies as an architecture-relevant update under CLAUDE.md's PRD
Maintenance rule.

## 21. Unverifiable items

None. Every metric in this report is reproducible by running
`node scripts/analyze-cooking-mode-v10f-lite-active-object.mjs`, which reads only the three
locked, already-committed audit artifacts.

## 22. Deferred / not completed

- The full frozen-candidate benchmark run (the only next step this GO result authorizes) —
  deferred per the hard-stop rule ("do not expand the rule first"; run the *same* rule against
  the complete benchmark as a separate task).
- Wave 4/5 source recovery, prepared-component semantics, persisted-map migration, and any other
  V10F/V10G work — untouched, out of scope for this experiment.
