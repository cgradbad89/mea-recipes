# M-04 Ingredient Parse-Failure Investigation

**Investigation date:** 2026-08-22

**Scope:** the 15 `parse-error` recipes recorded by the final Batch 4 canonical apply

**Mode:** read-only; no parser, recipe, nutrition, canonical-table, or production-data changes

## Executive summary

All **15/15** affected recipes were identified and reproduced against the current 216-document catalog. For each document, `parseRecipeContent(content)` returned `ingredients: []`; `computeRecipeNutrition` would therefore stop at its recipe-level guard with `Recipe has no parseable ingredient list`. None reached `parseIngredientList`, quantity/unit parsing, canonical matching, USDA, or AI fallback.

| Outcome | Count |
|---|---:|
| Investigated | 15 |
| Failure reproduced | 15 |
| No longer reproducible | 0 |
| A — recipe document/content problem | 7 |
| B — recipe section extraction problem | 8 |
| C/D/E/F/G | 0 |
| Narrow code change recommended | 3 |
| Recipe-data correction recommended | 12 |
| Both code and data required | 0 |

The three code candidates use decorated or qualified section headings that can be recognized without guessing where a headerless ingredient list ends. The other twelve require reviewed recipe-data normalization: seven documents are incomplete/composite/non-recipe data, and five otherwise usable recipes omit the explicit section structure the parser deliberately requires. Those twelve corrections would eventually mutate shared global `recipes/{id}` documents, so they require an explicit production-data review/apply session. No such mutation occurred here.

## Evidence and reproduction

The final `batch4-apply-report.md` is authoritative for the apply result: 210 processed, 136 written, and 15 skipped as parse errors. It preserves the aggregate, not per-recipe error rows. The pre-production audit later recorded the 15 titles. A read-only Admin SDK query on 2026-08-22 loaded the current 216 recipe documents and ran the exact current `parseRecipeContent` implementation over `content`; it returned the same 15 titles and supplied their exact document IDs.

The diagnostic was an inline, non-writing Node command using existing `scripts/_lib.js` credentials/tooling and the production parser:

```text
loadEnv() → getAdmin().firestore().collection("recipes").get()
→ parseRecipeContent(String(doc.content || ""))
→ retain documents where ingredients.length === 0
```

Result: `catalogTotal=216`, `count=15`. The command called no route, used no `apply=true` parameter, and performed no `set`, `update`, `delete`, batch, or transaction operation.

Current execution trace for every row:

```text
recipes/{id}.content
→ lib/recipeContent.ts parseRecipeContent
→ ingredients = []
→ lib/nutritionEngine.ts computeRecipeNutrition
→ throws "Recipe has no parseable ingredient list"
```

## Per-recipe evidence

“Batch 4 evidence” below means the final apply’s 15-error aggregate, the audit’s named population, and the exact current read-only reproduction. The checked-in final apply report does not contain per-ID error rows.

| Recipe ID | Title | Batch 4 evidence | Current reproduction | Failing stage/function | Offending content/line | Root-cause category | Root cause | Code fix required? | Recipe-data fix required? | Proposed regression test | Prompt 4 treatment |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `bread` | Bread! | Named audit record; count matches final apply | Confirmed: zero ingredients; guard throws | `parseRecipeContent` section discovery | `3 cups all purpose flour` follows a URL with no `INGREDIENTS` heading | B — section extraction | Human-readable ingredient list is headerless | No; broad headerless inference is unsafe | Yes | Data-fixture test after normalization: standard header extracts four lines | Add an explicit `INGREDIENTS` heading; retain source URL |
| `chicken-chickpea-salad` | Chicken Chickpea Salad | Named audit record; count matches final apply | Confirmed: zero ingredients; guard throws | `parseRecipeContent` section discovery | `INSTRUCTIONS` occurs first; later groups begin `For the Green Harissa Dressing` with no ingredient-section marker | B — section extraction | Ingredients are stored after instructions as unrecognized group labels | No; reverse-section guessing risks treating prose as food | Yes | Normalized fixture extracts all three ingredient groups and excludes steps | Reorder/mark one reviewed `INGREDIENTS` section before `INSTRUCTIONS`, retaining subheaders |
| `chicken-meatballs-with-peppers-and-orzo` | Chicken Meatballs with Peppers and Orzo | Named audit record; count matches final apply | Confirmed: zero ingredients; guard throws | `parseRecipeContent` input/section discovery | Content is only `https://pinchofyum.com/chicken-meatballs-with-peppers-and-orzo` | A — document/content | Source URL was stored without recipe body | No | Yes | Corrected fixture must contain a marked ingredient section | Re-ingest/review the source and store complete content, or leave explicitly unavailable |
| `chinese-chili-oil` | Chinese Chili Oil | Named audit record; count matches final apply | Confirmed: zero ingredients; guard throws | `parseRecipeContent` input/section discovery | Content is only `https://redhousespice.com/chinese-chilli-oil/` | A — document/content | Source URL was stored without recipe body | No | Yes | Corrected fixture must contain a marked ingredient section | Re-ingest/review the source and store complete content, or leave explicitly unavailable |
| `hearthealthy-peanut-butter-protein-bars` | Heart-Healthy Peanut Butter Protein Bars | Named audit record; count matches final apply | Confirmed: zero ingredients; guard throws | `parseRecipeContent` heading match | `🧾 Ingredients:` and `🥣 Instructions:` | B — section extraction | Leading pictographs make otherwise standard headings fail the anchored regexes | Yes | No | Exact decorated headings extract ingredients/instructions; standard headings remain unchanged | Normalize leading pictographs only for section-label detection |
| `honey-sriracha-roasted-brussels-sprouts` | HONEY SRIRACHA ROASTED BRUSSELS SPROUTS | Named audit record; count matches final apply | Confirmed: zero ingredients; guard throws | `parseRecipeContent` section discovery | Starts `1 ½ pounds Brussels sprouts`; prose begins `Preheat oven to 400°F.` with no headings | B — section extraction | Ingredients and instructions are present but have no section boundaries | No; content-specific boundary inference is unsafe | Yes | Normalized fixture extracts six ingredients and excludes prose | Insert reviewed `INGREDIENTS` and `INSTRUCTIONS` headings |
| `httpspinchofyumcomchopped-thai-shrimp-salad-with-garlic-lime-dressing` | https://pinchofyum.com/chopped-thai-shrimp-salad-with-garlic-lime-dressing | Named audit record; count matches final apply | Confirmed: zero ingredients; guard throws | `parseRecipeContent` input/section discovery | Title is a URL; content is `INSTRUCTIONS` plus the same URL | A — document/content | Malformed ingest contains neither recipe title nor ingredients | No | Yes | Corrected fixture must have a real title and marked ingredients | Re-ingest and human-review title/content; do not auto-delete |
| `intsa-punjabi-chole` | Intsa Punjabi Chole | Named audit record; count matches final apply | Confirmed: zero ingredients; guard throws | `parseRecipeContent` input/section discovery | Content is only `https://spicecravings.com/punjabi-chole-chana-masala-chickpeas-curry` | A — document/content | Source URL was stored without recipe body | No | Yes | Corrected fixture must contain a marked ingredient section | Re-ingest/review the source and correct the title if appropriate |
| `maple-roasted-candied-pecans` | Maple Roasted Candied Pecans | Named audit record; count matches final apply | Confirmed: zero ingredients; guard throws | `parseRecipeContent` input/section discovery | Content is only `Source:` | A — document/content | Stored content is truncated/corrupt | No | Yes | Corrected fixture must contain nonempty marked ingredients | Restore from a reviewed source or explicitly archive/reclassify the record |
| `peanut-butter-oat-protein-shake` | Peanut Butter Oat Protein Shake | Named audit record; count matches final apply | Confirmed: zero ingredients; guard throws | `parseRecipeContent` heading match | `🧾 Ingredients:` and `🌀 Instructions:` | B — section extraction | Leading pictographs make otherwise standard headings fail the anchored regexes | Yes | No | Exact decorated headings extract only the ingredient block and stop at instructions | Normalize leading pictographs only for section-label detection |
| `rising-sun-mazcal` | Rising Sun - Mazcal | Named audit record; count matches final apply | Confirmed: zero ingredients; guard throws | `parseRecipeContent` section discovery | URL followed directly by `1 1⁄2 oz. mezcal` and other ingredients | B — section extraction | Human-readable ingredient list is headerless | No; broad headerless inference is unsafe | Yes | Normalized fixture extracts the six cocktail ingredients | Add an explicit `INGREDIENTS` heading; review title spelling separately |
| `smoothies` | Smoothies | Named audit record; count matches final apply | Confirmed: zero ingredients; guard throws | `parseRecipeContent` input model/section discovery | One document contains `1. Green Peanut Butter Power Shake`, `2. Green Detox Smoothie`, and `3. Carrot Cake Protein Shake`, each with `🧾 Ingredients:` | A — document/content | Three independent recipes and nutrition notes are combined in one recipe document; a single serving basis is ambiguous | No safe single-recipe parser fix | Yes | After product decision, each resulting recipe fixture parses one ingredient set | Split into three reviewed recipes or explicitly choose one canonical recipe; do not aggregate all three |
| `spaghetti-carbonara` | Spaghetti Carbonara | Named audit record; count matches final apply | Confirmed: zero ingredients; guard throws | `parseRecipeContent` heading match | `INGREDIENTS (partial — from Keep note)` | B — section extraction | A useful qualified heading is rejected by the exact anchored keyword regex | Yes | No | Qualified `INGREDIENTS (...)` extracts through standard `INSTRUCTIONS`; ordinary headings unchanged | Allow a bounded parenthetical qualifier after a recognized ingredient heading |
| `speget-with-fake-meat-meatballs` | Speget with fake meat meatballs | Named audit record; count matches final apply | Confirmed: zero ingredients; guard throws | `parseRecipeContent` section discovery | Starts `Yield:4 to 6 servings` then ingredient lines, with no section heading | B — section extraction | Human-readable ingredient list is headerless | No; broad headerless inference is unsafe | Yes | Normalized fixture excludes yield and extracts the ingredient list | Add an explicit `INGREDIENTS` heading; review title spelling separately |
| `yogurt-dill-sauce` | yogurt Dill sauce | Named audit record; count matches final apply | Confirmed: zero ingredients; guard throws | `parseRecipeContent` input/section discovery | Content is only `https://minimalistbaker.com/zesty-dill-yogurt-sauce/` | A — document/content | Source URL was stored without recipe body | No | Yes | Corrected fixture must contain a marked ingredient section | Re-ingest/review the source and store complete content, or leave explicitly unavailable |

## Function-level findings

### Decorated section headings

- **File/function:** `lib/recipeContent.ts` — `parseRecipeContent`
- **Inputs:** `🧾 Ingredients:`, `🥣 Instructions:`, and `🌀 Instructions:`
- **Current behavior:** `ingKeywords` and `instKeywords` are anchored to the raw trimmed line, so leading pictographs prevent a match.
- **Smallest safe Prompt 4 remediation:** derive a section-detection-only label that removes leading non-letter/number decoration, then apply the existing exact keyword regexes. Do not mutate returned ingredient text or broadly search for the word “ingredients” inside prose.
- **Regression coverage:** both affected recipe shapes; all existing standard keywords; decorative bullets that are actual ingredient lines; and prose containing “ingredients” that must not become a heading.
- **Risk:** low if normalization is used only for section-label comparison; higher if the whole content line is rewritten.

### Qualified ingredient heading

- **File/function:** `lib/recipeContent.ts` — `parseRecipeContent`
- **Input:** `INGREDIENTS (partial — from Keep note)`
- **Current behavior:** the anchored `ingKeywords` expression permits only an optional colon after the keyword.
- **Smallest safe Prompt 4 remediation:** permit one bounded trailing parenthetical qualifier after an otherwise exact recognized ingredient heading. Keep instruction-boundary logic unchanged.
- **Regression coverage:** the Carbonara heading, standard `INGREDIENTS`/`INGREDIENTS:`, and ingredient/prose lines containing parentheses that must not be treated as headings.
- **Risk:** low with an anchored, heading-only suffix; avoid a generic prefix match.

### Recipe-level guard is correct

- **File/function:** `lib/nutritionEngine.ts` — `computeRecipeNutrition`
- **Current behavior:** throws when section extraction yields zero ingredients.
- **Finding:** this is not an orchestration defect. Continuing would create empty or misleading nutrition, and changing the guard would conflate parse failure with USDA no-match.
- **Prompt 4 action:** retain the guard and verify that the corrected parser/data causes all intended recipes to pass it.

No evidence implicated `parseIngredientList`, `parseIngredientLine`, quantity/unit parsing, noise/sub-header handling inside the nutrition parser, canonical resolution, USDA, or AI.

## Data-only findings

Every correction below would change shared/global recipe data under `recipes/{id}` and therefore requires an explicit reviewed production write. None was applied.

| Recipe ID | Defect | Conceptual correction | Production write eventually required? |
|---|---|---|---|
| `bread` | Headerless ingredient list | Add a standard ingredient-section heading | Yes |
| `chicken-chickpea-salad` | Instructions precede unmarked ingredient groups | Normalize ordering and add one standard ingredient section while retaining reviewed group labels | Yes |
| `chicken-meatballs-with-peppers-and-orzo` | URL-only content | Re-ingest or manually restore reviewed recipe content | Yes |
| `chinese-chili-oil` | URL-only content | Re-ingest or manually restore reviewed recipe content | Yes |
| `honey-sriracha-roasted-brussels-sprouts` | No ingredient/instruction boundaries | Insert reviewed standard section headings | Yes |
| `httpspinchofyumcomchopped-thai-shrimp-salad-with-garlic-lime-dressing` | URL used as title and instruction; no recipe | Re-ingest and review both title and content | Yes |
| `intsa-punjabi-chole` | URL-only content | Re-ingest or manually restore reviewed recipe content | Yes |
| `maple-roasted-candied-pecans` | Truncated `Source:` content | Restore from a reviewed source or explicitly archive/reclassify | Yes |
| `rising-sun-mazcal` | Headerless ingredient list | Add a standard ingredient-section heading | Yes |
| `smoothies` | Three recipes combined in one document | Product owner chooses split-versus-single-record treatment, then normalizes each retained recipe | Yes |
| `speget-with-fake-meat-meatballs` | Headerless ingredient list | Add a standard ingredient-section heading | Yes |
| `yogurt-dill-sauce` | URL-only content | Re-ingest or manually restore reviewed recipe content | Yes |

The decorated-heading recipes and Carbonara do not require data edits if the narrow parser remediation is accepted.

## Recommended Prompt 4 batching

1. **Parser-only batch:** update `parseRecipeContent` for leading section-label decoration and bounded ingredient-heading qualifiers. Add targeted fixtures for the three code-fix recipes plus false-positive/standard-heading regressions. Do not add headerless inference.
2. **Read-only 15-recipe rerun:** apply the updated parser locally to the same exact IDs. Expect the decorated-heading pair and Carbonara to parse; confirm the remaining twelve still fail for known data reasons.
3. **Reviewed data-repair proposal:** prepare explicit before/after content diffs for the twelve shared recipe documents. Resolve the `smoothies` split/selection product decision and any inaccessible source pages before authorization. Do not combine this review with an automatic nutrition write.
4. **Data apply with verification:** only after explicit approval, write the reviewed content changes in a bounded/reversible session, then read back each exact document and rerun parser tests. Preserve unrelated fields and existing nutrition until recompute approval.
5. **Nutrition dry-run:** recompute the corrected population without `apply=true`; inspect ingredient extraction, unresolved lines, canonical hits, totals, confidence, and any new USDA operational logs.
6. **Production-apply gate:** obtain explicit review of the dry-run diff before any nutrition write. Use the existing authenticated/admin-gated apply path only in that separately authorized session, with rollback evidence.

## Non-mutation verification

This investigation did **not** modify recipe documents, recipe content, `nutrition`, `nutrition_prev`, servings, canonical entries, or generated canonical data. It did not invoke nutrition revalidation, canonical apply, or any route with `?apply=true`; it did not delete or overwrite production data. The only external data operation was one read-only collection read through existing Admin tooling. Automated USDA calls were not used for M-04 because all failures occur before USDA resolution.

## Evidence limitations

All current affected documents were inspected and classified. The final Batch 4 apply report stores the authoritative count and outcome totals but not the per-ID error rows; historical per-ID membership is therefore corroborated by the audit’s title list and the exact current 15-record reproduction, rather than by a checked-in final-apply row for each ID.
