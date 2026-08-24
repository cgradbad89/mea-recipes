# Recipe Time Audit and Production Remediation — 2026-08-24

## Outcome

The complete `malignant-metro` shared `recipes` catalog was audited against each recipe's stored
content. Production remediation completed successfully on 2026-08-24.

- Catalog documents audited: **236**
- Usable recipes: **234**
- Usable recipes with both expected fields after apply: **234/234**
- Recipes changed: **107**
  - Missing-time backfills: **98**
  - Conservative corrections to existing values: **9**
- Fields changed: **90 `prepTime`**, **106 `cookTime`**
- Explicit no-cook values (`cookTime: '0 min'`): **12**
- Persisted `totalTime` fields before/after: **0**
- Nutrition, content, metadata, user collections, rules, indexes, and infrastructure changed: **0**

Totals in the dry-run/apply reports are calculated from the proposed `prepTime + cookTime` using
the same parsing/formatting semantics as `lib/recipes.ts`; they are reported only and are not stored.

## Review method

Every document was included in the coverage gate. Missing values were reviewed against explicit
Prep/Cook/Total labels when present and against actual timed steps otherwise. Existing values were
retained unless the stored content made them clearly wrong. Ranges were normalized only where a new
value was needed or where application parsing made the existing value misleading.

Four pressure-cooker backfills required special handling: Chicken Tinga Tacos, Easy Instant Pot
Vegetable Biryani, Instant Pot Boiled Potatoes, and Instant Pot Pineapple Chicken. Their source
“cook” labels represented only pressure settings and did not add up to the source total. Pressure
build/release and finishing overhead was assigned to `cookTime`, making the app's derived total match
the stated elapsed total.

Twelve assembly-only recipes now use `cookTime: '0 min'`. This is an intentional stored value:
`parseTimeToMinutes('0 min')` returns zero, while `getTotalTime` still derives the positive total from
prep time.

## Incomplete recipes left untouched

Two documents were not usable enough to support an evidence-based time estimate. Their reviewed
content hashes are pinned in the remediation manifest so they cannot remain excluded after a content
change without a fresh review.

- `maple-roasted-candied-pecans` — content is only `Source:`; no ingredients or method.
- `spaghetti-carbonara` — partial ingredient list whose content explicitly says instructions are
  unavailable.

These are the only production recipes still missing `prepTime` and `cookTime`.

## Conservative corrections

| Recipe | Before | After | Clear content contradiction |
|---|---:|---:|---|
| Chicken Tikka | Prep 20 min plus 2–6 hr marinating; Cook 15–18 min | Prep 20 min; Cook 15–18 min | Old prep string parsed as 6 hr 20 min; passive marination remains in content |
| chicken wild rice | Prep 10 min; Cook 6 hr | Prep 10 min; Cook 8 hr | Method says low for 7–8 hr |
| Filipino Brased Chicken Tocino | Prep 15 min; Cook 30 min | Prep 15 min; Cook 1 hr | Method requires a 1 hr simmer before reduction/searing |
| Honey Sriracha Roasted Brussels Sprouts | Prep 5 min; Cook 25 min | Prep 5 min; Cook 40 min | Method says roast 35–40 min |
| Mexican Roasted Zucchini | Prep 5 min; Cook 20 min | Prep 5 min; Cook 25 min | Method says roast 25 min |
| Original Texas Chili Con Carne | Prep 20 min; Cook 2 hr | Prep 20 min; Cook 3 hr | Method says simmer about 3 hr |
| Pulled pork | Prep 15 min; Cook 4 hr | Prep 15 min; Cook 8 hr | Method says low for 6–8 hr |
| Slow Cooker Creamy Tomato Lentil Soup | Prep 10 min; Cook 8 hr | Prep 10 min; Cook 4 hr | Method says high for 4 hr |
| Traditional Southern Butter Beans | Prep 10 min; Cook 30 min | Prep 10 min; Cook 3 hr | Method says simmer about 3 hr |

All other previously populated values were preserved.

## Dry-run and write gates

`update-recipe-times.js` was replaced with a manifest-driven tool using the current modular Admin SDK
path in `scripts/_lib.js`. It is dry-run by default and fails closed unless all of these conditions hold:

1. The credential project and manifest project are exactly `malignant-metro`.
2. Manifest entries are unique and contain only reviewed before/after prep/cook values.
3. Every proposed value is compatible with application time parsing (`0 min` is explicitly allowed).
4. Every reviewed production before-value still matches.
5. Every non-excluded catalog recipe will have both fields after the proposed set.
6. Excluded content still matches its reviewed SHA-256 hash.
7. Apply receives the exact project and update-count confirmations.
8. Apply consumes a passed dry-run report with matching catalog and update fingerprints.
9. The single atomic batch uses each document's `lastUpdateTime` precondition.
10. Post-apply read-back matches both time fields and the pre-apply non-time-field fingerprint.

The production apply passed every gate. All **107** documents were read back successfully, and every
non-time fingerprint was unchanged.

## Artifacts and recovery data

- Reviewed manifest: `scripts/recipe-time-remediation-data.json`
- Dry-run evidence: `docs/audits/recipe-time-dry-run-2026-08-24.json`
- Apply/read-back evidence and before-value backup: `docs/audits/recipe-time-apply-2026-08-24.json`

The apply report's `backup` section records every changed document's prior prep/cook state and update
time. No rollback was needed.
