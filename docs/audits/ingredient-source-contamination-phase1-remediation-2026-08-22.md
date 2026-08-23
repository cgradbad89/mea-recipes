# Ingredient Source Contamination — Phase 1 Remediation (2026-08-22)

## 1. Executive result

**PASS WITH DEFERRED CONTAMINATION**

- Content-parser safeguards: **COMPLETE** for the evidence-backed Phase 1 classes.
- Shared ingredient-header handling: **COMPLETE**.
- Grocery-boundary safeguards: **COMPLETE**.
- Ingredient-parser artifact remediation: **NOT PERFORMED**.
- Recipe-data remediation: **NOT PERFORMED**.

Phase 1 removes the confirmed metadata, copied-page control, instructional-tail, and exact section-boundary defects from current extraction while retaining structural ingredient subheaders for recipe presentation. The grocery boundary blocks all confirmed subheaders. All 173 reviewed legitimate/false-alarm occurrences remain. The remaining 140 grocery-eligible affected lines are exactly the explicitly deferred population: 115 `sasy-notes` lines, 23 ingredient-parser artifacts, and two source-data defects.

## 2. Scope and safety

The implementation changed code, tests, this report, and `PRD.md` only. The corpus comparison used one read-only `get()` of the shared Firestore `recipes` collection through the existing analyzer. No mutation method, production route, deployment, rule/index operation, data repair, dependency addition, or environment change was used.

The analyzer preserves the investigation parser as an audit-only historical snapshot, applies the current production parser separately, and joins occurrences by recipe ID plus stored content line. This keeps the reviewed 3,190-line classification set stable while measuring current behavior.

## 3. Files

Modified:

- `lib/recipeContent.ts` — authoritative pure subheader predicate plus conservative shared ingredient-span filtering.
- `lib/recipes.ts` — retains `detectIngredientHeader` as a compatibility wrapper around the shared predicate.
- `lib/userdata.ts` — narrow grocery-add defense for subheaders, empty parsed names, and explicit URLs.
- `lib/nutritionEngine.ts` — skips the same structural subheaders before nutrition parsing.
- `scripts/audit-ingredient-source-contamination.mjs` — reproducible historical/current corpus comparison and preservation gate.
- `tests/nutritionEngine.test.ts` — proves shared subheaders are excluded before nutrition parsing.
- `PRD.md` — durable Phase 1 parser, header, grocery-boundary, sharp-edge, and backlog behavior.

Created:

- `tests/recipeContentContamination.test.ts` — shared-header, parser-filter, boundary, no-quantity, composite, and cooked-ingredient regressions.
- `tests/groceryIngredientBoundary.test.ts` — closest-boundary Firestore-mocked grocery acceptance/rejection regressions.
- `docs/audits/ingredient-source-contamination-phase1-remediation-2026-08-22.md` — this result.

## 4. Shared header predicate

Before Phase 1, `detectIngredientHeader` and its keyword set lived in Firebase-client-adjacent `lib/recipes.ts`. Recipe detail and Cooking Mode used it for presentation, while grocery addition and nutrition did not. The UI recognized 62 header-like occurrences; the investigation confirmed 84 true subheaders, including 31 occurrences missed by the old logic.

The authoritative API is now:

```ts
export function isIngredientSubheader(line: string): boolean
```

It lives in Firebase-free `lib/recipeContent.ts`. It preserves the old colon-ending, full markdown-bold, and known group-keyword semantics, and adds 27 exact normalized audited labels covering the 31 missed occurrences. It intentionally has no short-line, capitalization, missing-quantity, generic `for`, word-count, or category heuristic.

Call sites:

- `lib/recipes.ts` re-exports it and wraps it with the existing `{isHeader, text}` `detectIngredientHeader` signature for recipe detail and Cooking Mode.
- `lib/userdata.ts` uses it before grocery write/merge.
- `lib/nutritionEngine.ts` uses it before nutrition ingredient parsing.
- the read-only corpus analyzer uses it to model current downstream eligibility.

`parseRecipeContent` deliberately retains subheader strings in its presentation-oriented `ingredients` array because the current flat content model has no separate structural field. Rendering therefore keeps its grouping, while every shopping/nutrition consumer consistently skips the structural line.

## 5. Subheader results

| Measure | Before | After |
|---|---:|---:|
| Confirmed true subheaders | 84 across 43 recipes | 84 retained for presentation |
| Confirmed subheaders eligible for grocery purchase | 84 | **0** |
| Historical UI predicate matches | 62 | n/a (replaced by shared predicate) |
| Shared predicate matches in reviewed baseline | n/a | 93 (84 subheaders, 7 metadata labels, 2 `sasy-notes` controls) |
| Reviewed legitimate lines matched as subheaders | 0 | **0** |

All 84 confirmed true subheaders are recognized by the one shared predicate. No reviewed legitimate/composite/taxonomy-false-signal line matches it.

## 6. Content filters

The same `filterIngredientSpan` controls both the normal ingredient+instruction path and the capped ingredient-heading-only fallback. Counts below are non-overlapping removal causes; all were checked against the 173 reviewed legitimate occurrences.

| Deterministic exclusion | Confirmed lines removed | Affected recipes | Reviewed legitimate matches |
|---|---:|---:|---:|
| Bounded exact `Rating` through later `Yield` metadata/article preamble | 16 (3 metadata counts, 13 copied content) | 4 | 0 |
| Anchored metadata labels/values: yield/scale/time/rating/nutrition/servings/units/conversion, exact time/serving/scale/rating values, byline, conversion copy | 56 | 24 | 0 |
| Exact anchored grocery/page controls (`Add … Grocery List`, Instacart, email, save, screen-dark, free guide) | 24 directly removed | 18 | 0 |
| Complete bare HTTP(S) URL | 1 | 1 | 0 |
| Exact terminal page blocks (`OUR LATEST NEWSLETTER`, `5 Secrets of Authentic Chinese Cooking`) | 10 including their tails | 4 | 0 |
| Exact standalone `Notes:` terminal block | 18 (9 metadata, 9 instructional) | 3 | 0 |
| Exact standalone `PREP` terminal boundary | 7 | 1 | 0 |
| **Total confirmed extraction removals** | **132** | — | **0** |

Two `Get the guide for FREE` controls are inside the terminal guide blocks; the table assigns them to that terminal cause rather than counting them twice. The current code also recognizes exact `ON THE STOVE` as a safe terminal marker; the affected corpus reaches `PREP` first, and a focused fixture proves the `ON THE STOVE`-only case.

The old broad `^(yield|step|total|prep|cook|rating|scale)` prefix filter was replaced. That old rule incorrectly treated legitimate `Cooked …` ingredients as metadata. Phase 1 restores 13 such corpus lines (for example cooked rice and cooked quinoa), and the net occurrence count reflects those restorations.

## 7. Section-boundary fix

One recipe contained all seven reviewed boundary-defect occurrences:

| Recipe | Exact boundary | Before | After |
|---|---|---|---|
| `filipino-brased-chicken-tocino` | `PREP` (later followed by `ON THE STOVE`) | The 20-line fallback returned 13 real ingredients plus `PREP`, five prep/method lines, and `ON THE STOVE`. | The fallback returns the same 13 real ingredients and stops before `PREP`; all 7 defects are absent. |

The affected raw tail was: `PREP`; `CRUSH and mince the garlic, set aside`; `FINE MINCE the ginger, set aside`; `SLICE the whites of the green onions, set aside`; `SLICE the greens of the green onions on a bias, set aside`; `COMBINE all marinade ingredients …`; `ON THE STOVE`.

The fallback still takes its original 20-line horizon before filtering, so filtering cannot pull formerly out-of-range content into the ingredient list.

## 8. Grocery boundary

`addRecipeIngredientsToGrocery` now evaluates the final narrow defense before any batch write or merge:

| Input condition | Result |
|---|---|
| Shared recognized header | Skipped; no write/merge. |
| Empty trimmed or parsed name | Skipped; no write/merge. |
| Complete explicit URL in the raw line or parsed name | Skipped; no write/merge. |
| Real ingredient without a quantity (`garlic`) | Accepted with empty quantity/unit. |
| Real ingredient categorized as `Other` (`brusselsprouts` fixture) | Accepted. |
| Normal `2 cups rice` | Existing quantity/unit/name behavior retained. |

The defense does not reject based on `Other`, missing quantity, word count, capitalization, punctuation, or the word `for`. Low-confidence whole-line fallback and exact normalized-noun merge behavior remain unchanged.

## 9. Preservation

| Reviewed preservation class | Tested | Retained | Accidentally removed |
|---|---:|---:|---:|
| Legitimate composite ingredients | 92 | 92 | 0 |
| Taxonomy false signals | 81 | 81 | 0 |
| **Total** | **173** | **173 (100%)** | **0** |

The analyzer enforces this as a hard failure. Representative unit regressions cover chicken or vegetable broth, pita or rice for serving, sour cream or Greek yogurt, optional real-food garnish, mixed alternatives, and eight plain no-quantity foods. The corpus-wide join supplies complete preservation evidence.

## 10. Corpus before/after

Fresh read-only command:

```bash
node scripts/audit-ingredient-source-contamination.mjs > /tmp/mea-ingredient-source-phase1-current.json
```

| Measure | Before | After |
|---|---:|---:|
| Recipes inspected | 216 | 216 |
| Parseable recipes | 214 | 214 |
| Recipes without an ingredient section | 2 | 2 |
| Raw presentation ingredient occurrences | 3,190 | 3,071 |
| Grocery-eligible ingredient occurrences | not previously guarded | 2,985 |
| Unique normalized identities | 2,008 | 1,958 |
| Confirmed affected occurrences | 358 | 226 raw / **140 grocery-eligible** |
| Reviewed legitimate preservation failures | — | **0** |

Waterfall: 3,190 baseline lines − 132 confirmed content/boundary removals + 13 restored legitimate `Cooked …` ingredients = 3,071 current raw presentation lines. The remaining difference from raw presentation to grocery eligibility is structural/non-purchase lines rejected by the final boundary.

## 11. Root-cause remainder

| Classification | Before | Raw remaining | Grocery-eligible remaining | Phase 1 result |
|---|---:|---:|---:|---|
| `STORED_CONTENT_CONTAMINATION` | 165 | 117 | 115 | 48 removed; remainder is only `sasy-notes` |
| `SECTION_BOUNDARY_EXTRACTION` | 7 | 0 | 0 | resolved |
| `INGREDIENT_SUBHEADER` | 84 | 84 | 0 | retained structurally; purchase leak resolved |
| `RECIPE_METADATA_LINE` | 68 | 0 | 0 | resolved |
| `INSTRUCTIONAL_LINE_INSIDE_INGREDIENTS` | 9 | 0 | 0 | resolved |
| `INGREDIENT_PARSER_ARTIFACT` | 23 | 23 | 23 | deferred by scope |
| `OTHER` source defects | 2 | 2 | 2 | deferred by scope |

Thus the 140 remaining grocery-eligible affected lines are 115 `sasy-notes` lines + 23 parser artifacts + 2 source-data defects. Two other `sasy-notes` lines match the shared structural-header predicate and are not grocery eligible, but the document still requires data repair as a whole.

## 12. `Other` impact

| Measure | Count |
|---|---:|
| `Other` occurrences before Phase 1 | 280 |
| `Other` raw presentation occurrences after Phase 1 | 169 |
| `Other` grocery-eligible occurrences after Phase 1 | 131 |
| Confirmed affected `Other` remaining raw | 157 |
| Confirmed affected `Other` remaining grocery-eligible | 119 |
| Reviewed legitimate `Other` remaining grocery-eligible | 12 |

The 119 confirmed grocery-eligible `Other` remainder is 115 `sasy-notes`, two parser artifacts, and the two explicit source-data defects. Phase 1 intentionally does not force `Other = 12`; that requires later parser and data-remediation phases.

## 13. Import recurrence after Phase 1

- **Prevented downstream:** known shared subheaders cannot become grocery/nutrition items; current exact metadata, URL, page-control, bounded rating/article preamble, `Notes:`, `PREP`/`ON THE STOVE`, newsletter, and guide patterns are removed by parsing in either extraction path.
- **Still reproducible:** novel/non-anchored page prose or controls can still be persisted; all quantity/range/dimension artifacts remain; malformed/vague source lines remain; a fully non-recipe document under a valid `INGREDIENTS` heading still parses.
- **Requires ingest-layer work:** semantic quarantine and user review of noisy AI ingredient arrays, plus corrected bookmarklet/paywall claims or authenticated DOM capture. Phase 1 reduces downstream impact but does not validate semantic ingredient quality before persistence.

## 14. Verification

Fresh baseline before code edits:

- `npm test` — 25 passed / 1 skipped files; 148 passed / 1 skipped tests (149 total).
- `npm run lint` — passed with 0 errors and 6 existing warnings.
- Initial `npm run typecheck` and `npm run build` were blocked by duplicate suffixed directories inside generated `node_modules/@types`; `npm ci` restored dependencies from the unchanged lockfile, after which both baseline gates passed. No dependency or environment file changed.
- Baseline analyzer — 216 recipes, 214 parseable, 3,190 lines, 531 candidates, 358 confirmed, 173 legitimate false alarms, 84 subheaders, and 280 `Other` occurrences.

Phase 1 focused verification:

- New focused tests/assertions: 22 (21 across 2 new files plus 1 nutrition-consumer regression).
- Combined recipe-content/header/grocery/nutrition run: 63 passed across 4 files.
- Corpus preservation gate: 173/173 retained; 0 failures.
- Read-only corpus rerun: passed with the counts in this report.

Final repository verification:

- `npm run typecheck` — passed.
- `npm run lint` — passed with 0 errors and the same 6 baseline warnings (five `no-img-element`, one unused eslint-disable).
- `npm run build` — passed with Next.js 16.3.1; 26 routes generated/collected.
- `npm test` — 27 passed / 1 skipped files; 170 passed / 1 skipped tests (171 total), 0 failures.

## 15. Data mutation

```text
Recipe production writes: 0
Grocery production writes: 0
Saved-item writes: 0
Firestore mutation: 0
Firebase deployment: none
Firestore rules/index deployment: none
Vercel deployment: none
Environment changes: none
```

## 16. PRD maintenance

Updated `PRD.md`:

- Section 5 #6 — shared conservative parsing controls in both paths and intentionally preserved legitimate cases.
- Section 5 #7 — authoritative shared subheader predicate, presentation retention, grocery/nutrition behavior, and excluded broad heuristics.
- Section 5 #16 — grocery boundary rejection/acceptance contract.
- Section 6 — Phase 1 remainder and recurrence sharp edge.
- Section 7 backlog — Phase 1 complete; parser artifacts, three data repairs, AI quarantine, and bookmarklet/paywall work remain.

## 17. Deferred work and recommendation

Explicitly deferred:

- 23 `INGREDIENT_PARSER_ARTIFACT` cases.
- `sasy-notes` data repair.
- `mole-poblano` data repair.
- `chipotle-tahini-bowls` data repair.
- AI-ingest semantic quarantine.
- bookmarklet/paywall behavior.

**Recommendation: A — proceed to ingredient-parser artifact remediation.** The content-boundary classes now have zero grocery-eligible leaks, preservation is 100%, and all 23 parser artifacts remain as a bounded fixture-driven code task. The three-document data cleanup should remain a separately approved write operation after the parser phase.
