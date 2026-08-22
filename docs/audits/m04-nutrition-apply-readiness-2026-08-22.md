# M-04 Nutrition Apply-Readiness Review — 2026-08-22

**Result:** PASS WITH DEFERRED ITEMS

**Mode:** discovery/validation only; no recipe, nutrition, canonical, or infrastructure writes

**Population:** the 13 Prompt 4B dry-run recipes only
**Raw diagnostic:** `docs/audits/m04-nutrition-diagnostic-raw-2026-08-22.json`

## 1. Executive result

```text
READY_FOR_APPLY: 1
REVIEW_REQUIRED: 1
BLOCKED: 11

M-04 recipe parser remediation: COMPLETE
M-04 recipe-data remediation: PARTIAL — maple + smoothies deferred
M-04 nutrition investigation: COMPLETE
M-04 nutrition apply: NOT PERFORMED
```

The sole readiness allowlist is `honey-sriracha-roasted-brussels-sprouts`. It is not a recommendation to apply yet: confirmed engine defects affect the wider M-04 population, so the selected next path is **PATH B — focused nutrition-engine remediation before any apply**.

| Metric | Result |
|---|---:|
| Live diagnostic USDA requests | 59 |
| USDA HTTP 400 events | 3 |
| USDA HTTP 404 events | 23 |
| Proven benign/expected 404 events (valid request recovered or only an immaterial fallback changed) | 16 |
| HTTP events caused by an engine defect | 3 |
| HTTP events materially changing the resolved nutrition tier | 4 (2 recipes) |
| Unresolved ingredients | 26 |
| Nutritionally material unresolved ingredients | 12 |
| Nutritionally immaterial unresolved ingredients | 14 |
| Confirmed nutrition-engine defect classes | 6 |

The 404s are not missing FDC detail records: recipe computation never calls the detail endpoint. They are intermittent HTML responses from the USDA edge/front end for the exact valid search URL; identical requests alternated between 404 and JSON 200. The three 400s are invalid-query events caused by unmatched `)` characters left in Punjabi Chole ingredient names after flat parenthetical stripping.

## 2. Method and evidence

The fresh diagnostic called `computeRecipeNutrition(recipeId)` directly for each exact ID, cleared only the in-memory ingredient cache between recipes, wrapped `fetch` to capture USDA request metadata/responses, and captured the existing structured `[nutrition-usda]` events. The temporary instrumentation added full per-100 g macros to the already-internal resolution trace so ingredient contributions could be calculated; it was removed after generating the raw artifact. Production selection behavior and all API response contracts are unchanged.

The artifact contains, per ingredient: original line, parsed quantity/unit, normalized name, estimated grams, canonical/USDA/AI tier, selected description/FDC ID where available, per-100 g basis, macro contribution, USDA request excluding the API key, candidates returned, failure logs, and unresolved state. It contains no credential-bearing URL, API key, token, private key, or response error body beyond a short public HTML prefix.

The diagnostic was non-persistent: it called no route, passed no apply parameter, and executed no Firestore mutation method. Prompt 4B remains the comparison snapshot; AI results and USDA edge behavior can vary, so the current rerun is reported alongside Prompt 4B rather than silently replacing it.

## 3. Population

Investigated:

1. `hearthealthy-peanut-butter-protein-bars`
2. `peanut-butter-oat-protein-shake`
3. `spaghetti-carbonara`
4. `bread`
5. `chicken-chickpea-salad`
6. `chicken-meatballs-with-peppers-and-orzo`
7. `chinese-chili-oil`
8. `honey-sriracha-roasted-brussels-sprouts`
9. `chopped-thai-shrimp-salad-with-garlic-lime-dressing`
10. `intsa-punjabi-chole`
11. `rising-sun-mazcal`
12. `speget-with-fake-meat-meatballs`
13. `yogurt-dill-sauce`

`maple-roasted-candied-pecans` and `smoothies` were explicitly excluded and left unchanged because source-data remediation remains deferred.

## 4. Recipe-level result

Nutrition format is `kcal / protein / carbs / fat / fiber / sugar` per serving. “Proposed” shows Prompt 4B, followed by the current diagnostic when it changed materially.

| Recipe | Stored nutrition | Proposed nutrition | Material unresolved | USDA issues | AI dependence | Servings basis | Classification | Reason |
|---|---|---|---|---|---|---|---|---|
| Heart-Healthy Peanut Butter Protein Bars | `609 / 30.4 / 39.5 / 39.8 / 10.6 / 7.3` | `620 / 21.6 / 41.2 / 44.3 / 7.1 / 10.3` | protein powder | 1 retry-recovered 404; almond-milk semantic mis-match | None in rerun | Stored 4; no source provenance | **BLOCKED** | Protein powder is omitted, almond milk resolves to candy, and 4 servings is not authoritative. |
| Peanut Butter Oat Protein Shake | `375 / 27.5 / 36 / 13.5 / 9 / 7` | P4B `386 / 10.8 / 48.2 / 18.5 / 10.7 / 11.8`; rerun `373 / 10.9 / 43.7 / 18.5 / 5.7 / 11.7` | protein powder; psyllium (fiber) | 3 retry-recovered 404s | None in rerun; P4B used AI | Stored 1; single-drink assumption | **BLOCKED** | Missing scoop explains the protein collapse; fiber changes with fallback availability. |
| Spaghetti Carbonara | `743 / 40.3 / 91.8 / 22.6 / 12.7 / 4.6` | P4B `904 / 42.5 / 87.5 / 41.5 / 3.6 / 3.7`; rerun `719 / 39.7 / 87.2 / 22.2 / 3.6 / 3.8` | guanciale/pancetta | 2 404s for Pecorino | Pecorino: 916 kcal whole recipe | Authoritative 4 | **BLOCKED** | A material meat line is unresolved and AI/USDA availability moves the result by 185 kcal per serving. |
| Bread! | `356 / 10.3 / 74.2 / 1.1 / 3.4 / 0.7` | P4B `344 / 9.9 / 72 / 1 / 2.7 / 0.3`; rerun `343 / 9.8 / 71.9 / 0.9 / 2.6 / 0.3` | None | None; yeast selected as yeast-extract spread (4.6 kcal whole) | None | Engine uses stored 4; source JSON-LD says 8 | **BLOCKED** | Whole-recipe total is defensible, but current per-serving values are approximately doubled by the serving-count conflict. |
| Chicken Chickpea Salad | None | P4B `575 / 14.3 / 57.3 / 33.6 / 14.7 / 11.6`; rerun `578 / 14.3 / 58 / 33.6 / 14.4 / 12.3` | cooked chicken | 2 404s | Green chiles: 25 kcal whole | Engine default 4; source corroborates 4 | **BLOCKED** | Chicken is omitted; tomatoes resolve to seasoned croutons and olives to chokecherries. |
| Chicken Meatballs with Peppers and Orzo | `695 / 45.8 / 93.4 / 15.7 / 7.7 / 9.4` | `556 / 40 / 59 / 18 / 7.3 / 5.6` | None (finishing garnish immaterial) | 3 404s; peppers fell to AI | Peppers: 66 kcal whole | Authoritative 4 | **BLOCKED** | Orzo resolves to teff and the creamy ingredient is underweighted/misparsed; the 139 kcal delta is not trustworthy. |
| Chinese Chili Oil | `103 / 1.2 / 2.6 / 10.2 / 0.7 / 0.1` | P4B `93 / 0.5 / 1.3 / 9.9 / 0.6 / 0.1`; rerun `93 / 0.6 / 0.9 / 9.9 / 0.3 / 0.1` | None | 1 retry-recovered 404 | None | Authoritative 1.5 cup = 24 tbsp | **REVIEW_REQUIRED** | Oil supplies ~80 of 93 kcal/serving, so total calories/fat are probably usable, but five low-contribution aromatics resolve semantically incorrectly. Owner must accept an oil-dominant approximation or wait for the matcher fix. |
| Honey Sriracha Roasted Brussels Sprouts | `189 / 6 / 30.7 / 7.3 / 7 / 17.5` | P4B `190 / 6 / 30.8 / 7.4 / 7 / 17.5`; rerun `190 / 6 / 30.7 / 7.4 / 7 / 17.5` | None | 2 404s for sriracha | Sriracha: 14 kcal whole | Authoritative 4 | **READY_FOR_APPLY** | All material ingredients resolve; the small AI estimate is defensible and the result reproduces stored nutrition. |
| Chopped Thai Shrimp Salad | `728 / 44.7 / 40.7 / 47.1 / 12.2 / 12.2` | `528 / 27.1 / 36.9 / 31.6 / 5.7 / 7.8` | pan oil | 2 404s for second serrano | Serrano: 2 kcal whole | Authoritative/reasonable midpoint 5 | **BLOCKED** | Edamame resolves to teff, the first serrano to lotus seeds, herbs to chamomile tea; pan oil is unquantified. |
| Intsa Punjabi Chole | `198 / 9 / 31 / 5 / 8 / 7` | P4B `287 / 13.3 / 44.5 / 7.8 / 13.1 / 7.6`; rerun `272 / 13.4 / 45 / 5.9 / 13.2 / 7.6` | ghee | 3 malformed-query 400s; 4 404s | Four spice/acid lines; 53 kcal whole | Authoritative 5 | **BLOCKED** | Invalid `)` queries are an engine defect, and the `1 cup dried chickpeas (or 2 cans)` alternative is misread as 794 g canned chickpeas. |
| Rising Sun – Mazcal | `193 / 1.3 / 41.9 / 0.3 / 2 / 34.4` | `17 / 0.3 / 5.6 / 0.1 / 0.3 / 1.1` | mezcal, grapefruit juice, maraschino | None (fails before lookup) | None | Stored/reasonable single cocktail | **BLOCKED** | U+2044 fraction slash is unsupported; only the lime line contributes nutrition. |
| Speget with fake meat meatballs | `703 / 28.5 / 79 / 29.5 / 3.2 / 50` | `629 / 36.3 / 38.2 / 36 / 2.6 / 7.8` | broccoli | 1 retry-recovered 404 | None | Authoritative midpoint 5 of 4–6 | **BLOCKED** | Plant-based beef resolves to real 80/20 beef and marinara to cheese ravioli with marinara. The old sugar is likely wrong, but the replacement is not defensible. |
| yogurt Dill sauce | `62 / 0.2 / 1.7 / 7.4 / 0.2 / 0.5` | `24 / 1.3 / 2.7 / 1 / 0.1 / 1.6` | olive-oil drizzle | 2 404s for dill | Dill: 1.5 kcal whole | Authoritative 4 | **BLOCKED** | Dairy-free yogurt resolves to dairy whole-milk yogurt and the oil is omitted; the stored source value is more plausible. |

## 5. USDA 400/404 investigation

### Failure classes

- **Class B — invalid request construction (3 events):** nested parentheses are removed with a flat `\([^)]*\)` pattern, leaving a trailing `)` in `serrano green chiles )`, `baking soda )`, and `tamarind concentrate )`. Repeated paired probes produced 400/404 for malformed names but 200/404 for the same names without `)`. A code fix is required.
- **Class D — external USDA edge inconsistency (23 events):** identical valid GET searches alternated between an HTML app-shell 404 and JSON 200. There was no redirect, stored/stale FDC ID, or food-detail lookup. One retry is implemented and recovered eight of these events.
- **No Class A detail-record failures:** recipe computation does not call `food-detail`.
- **No legitimate input-shape 400:** all observed 400s trace to the malformed trailing parenthesis.

All requests were `GET https://api.nal.usda.gov/fdc/v1/foods/search` with `pageSize=12` and `dataType=SR Legacy,Foundation`; the API key is excluded below and from the artifact.

### Event table (one row per structured event)

| Recipe | Ingredient/query | Operation | Status / attempt | Root cause | Retry/fallback | Nutrition impact |
|---|---|---|---:|---|---|---|
| Protein bars | unsweetened almond milk | ingredient-search | 404 / 1 | D — intermittent HTML edge response | Retry 200 → USDA | No operational impact; selected candidate is independently wrong. |
| PB oat shake | oat milk | ingredient-search | 404 / 1 | D | Retry 200 → USDA | None. |
| PB oat shake | flaxseed chia | ingredient-search | 404 / 1 | D | Retry 200 → USDA | None. |
| PB oat shake | psyllium husk | ingredient-search | 404 / 1 | D | Retry 200, zero candidates; AI failed | No 404 impact; legitimate no-match left fiber unresolved. |
| Carbonara | Pecorino Romano | ingredient-search | 404 / 1 | D | Retried | Material sequence; no USDA result. |
| Carbonara | Pecorino Romano | ingredient-search | 404 / 2 | D | AI fallback | **Material:** AI supplied 916 kcal/63.6 g fat whole recipe. |
| Chicken chickpea salad | green chiles | ingredient-search | 404 / 1 | D | Retried | Immaterial sequence. |
| Chicken chickpea salad | green chiles | ingredient-search | 404 / 2 | D | AI fallback | 25 kcal whole; immaterial. |
| Chicken meatballs | peppers | ingredient-search | 404 / 1 | D | Retried | Material sequence. |
| Chicken meatballs | peppers | ingredient-search | 404 / 2 | D | AI fallback | **Material:** 66 kcal whole / 16.5 per serving. |
| Chicken meatballs | uncooked orzo | ingredient-search | 404 / 1 | D | Retry 200 → USDA | No operational impact; selected teff is independently wrong. |
| Chinese chili oil | ground chili | ingredient-search | 404 / 1 | D | Retry 200 → USDA | No operational impact; selected emu is independently wrong. |
| Brussels sprouts | sriracha | ingredient-search | 404 / 1 | D | Retried | Immaterial sequence. |
| Brussels sprouts | sriracha | ingredient-search | 404 / 2 | D | AI fallback | 14 kcal whole; acceptable/immaterial. |
| Thai shrimp salad | serrano pepper | ingredient-search | 404 / 1 | D | Retried | Immaterial sequence. |
| Thai shrimp salad | serrano pepper | ingredient-search | 404 / 2 | D | AI fallback | 2 kcal whole; immaterial. |
| Punjabi chole | serrano green chiles `)` | ingredient-search | 404 / 1 | D response to malformed request | Retried | Defective request sequence. |
| Punjabi chole | serrano green chiles `)` | ingredient-search | 400 / 2 | **B — unmatched `)`** | AI fallback | 4 kcal whole; quantitatively small, defect still blocks. |
| Punjabi chole | garam masala | ingredient-search | 404 / 1 | D | Retry 200; candidate rejected; AI | 37 kcal whole; fallback caused by semantic rejection, not 404. |
| Punjabi chole | baking soda `)` | ingredient-search | 404 / 1 | D response to malformed request | Retried | Defective request sequence. |
| Punjabi chole | baking soda `)` | ingredient-search | 400 / 2 | **B — unmatched `)`** | AI fallback | Zero-calorie AI estimate; defect still blocks. |
| Punjabi chole | tamarind concentrate `)` | ingredient-search | 404 / 1 | D response to malformed request | Retried | Defective request sequence. |
| Punjabi chole | tamarind concentrate `)` | ingredient-search | 400 / 2 | **B — unmatched `)`** | AI fallback | 12 kcal whole; quantitatively small, defect still blocks. |
| Meatless meatballs | marinara sauce | ingredient-search | 404 / 1 | D | Retry 200 → USDA | No operational impact; selected ravioli is independently wrong. |
| Yogurt dill sauce | dill | ingredient-search | 404 / 1 | D | Retried | Immaterial sequence. |
| Yogurt dill sauce | dill | ingredient-search | 404 / 2 | D | AI fallback | 1.5 kcal whole; immaterial. |

### Retry/fallback assessment

Retry is appropriate for the intermittent HTML 404 behavior, but the current single 300 ms retry still exhausted for seven ingredient queries. Retrying a deterministic 400 is not appropriate; malformed input should be corrected before the request. The observability taxonomy correctly calls all of these `http_error`, but it cannot distinguish upstream HTML edge 404 from API JSON failures because bodies are intentionally not logged. The diagnostic content-type evidence makes that distinction without changing production logging.

## 6. Unresolved ingredients

Materiality is relative to whole-recipe totals and the six tracked macros.

| Recipe | Original ingredient | Normalized / quantity | Classification | Root cause | Material? | Recommended action |
|---|---|---|---|---|---|---|
| Protein bars | `2 scoops protein powder (vanilla or chocolate)` | `scoops protein powder`; grams null | PARSER_FAILURE | Scoop has no weight/default. | **Yes** | Require grams or a reviewed scoop weight. |
| Protein bars | `Dash of cinnamon or cocoa powder` | `Dash cinnamon cocoa powder`; grams null | PARSER_FAILURE | Dash/composite is unquantified. | No | Ignore or normalize to a small measured amount. |
| PB oat shake | `1 scoop protein powder` | `scoop protein powder`; grams null | PARSER_FAILURE | Scoop has no weight/default. | **Yes** | Require grams or reviewed scoop weight. |
| PB oat shake | `1 tsp psyllium husk` | 4.93 g | USDA_NO_MATCH + AI_FALLBACK_FAILURE | Retry returned a valid zero-result response; AI returned no result. | **Yes (fiber)** | Add a validated resolution or reviewed estimate. |
| PB oat shake | `Water and ice to blend` | grams null | NON_FOOD_LINE | Combined negligible liquids are not recognized as the zero class. | No | Treat as zero. |
| Carbonara | `4 ounces guanciale or pancetta, diced` | 113.4 g | USDA_NO_MATCH + AI_FALLBACK_FAILURE | Valid search returned zero candidates; AI failed. | **Yes** | Resolve guanciale/pancetta explicitly. |
| Chicken chickpea salad | `For the Green Harissa Dressing` | grams null | NON_FOOD_LINE | Unpunctuated subheader is parsed as food. | No | Treat as subheader. |
| Chicken chickpea salad | `For the Chickpeas` | grams null | NON_FOOD_LINE | Same. | No | Treat as subheader. |
| Chicken chickpea salad | `For the Salad` | grams null | NON_FOOD_LINE | Same. | No | Treat as subheader. |
| Chicken chickpea salad | `2 heaping cups boneless cooked chicken …` | `torn seasoned lightly salt`; grams null | PARSER_FAILURE | Comma-segment selection discards chicken and cannot quantify cups. | **Yes** | Preserve the leading food noun and resolve cooked chicken volume. |
| Chicken meatballs | `kosher salt, Parmesan, and parsley for finishing` | grams null | OPTIONAL_GARNISH | No amount; finishing line. | No | Exclude or measure if owner wants it counted. |
| Chinese chili oil | `1 star anise` | grams null | PARSER_FAILURE | Count default absent. | No | Optional small count default/validated spice entry. |
| Chinese chili oil | `1 piece cassia cinnamon …` | grams null | PARSER_FAILURE | Piece has no weight. | No | Ignore as infusion or add reviewed weight. |
| Chinese chili oil | `3 slices ginger` | grams null | PARSER_FAILURE | Slice has no weight. | No | Ignore as infusion or add reviewed weight. |
| Thai shrimp salad | `juice of two limes …` | grams null | PARSER_FAILURE | Quantity is not leading. | No | Support `juice of N` or normalize line. |
| Thai shrimp salad | `oil for the pan` | grams null | PARSER_FAILURE | Cooking oil has no amount. | **Yes** | Supply/approve absorbed amount. |
| Thai shrimp salad | `fresh wonton wrappers + oil for frying if you want …` | optional, skipped | OPTIONAL_GARNISH / COMPOSITE_INGREDIENT | Explicit optional composite has no quantities. | No for base recipe | Keep excluded; count only if included with amounts. |
| Punjabi chole | `2 teaspoons ghee …` | 9.37 g | USDA_SEMANTIC_REJECTION + AI_FALLBACK_FAILURE | Candidate did not validate; AI failed. | **Yes** | Resolve ghee/cooking fat explicitly. |
| Rising Sun | `1 1⁄2 oz. mezcal` | `⁄ mezcal`; grams null | PARSER_FAILURE | U+2044 fraction slash is unsupported. | **Yes** | Normalize U+2044 fractions and fluid ounces. |
| Rising Sun | `3⁄4 oz. fresh grapefruit juice` | `⁄ grapefruit juice`; grams null | PARSER_FAILURE | Same. | **Yes** | Same. |
| Rising Sun | `1⁄2 oz. maraschino` | `⁄ maraschino`; grams null | PARSER_FAILURE | Same. | **Yes** | Same. |
| Rising Sun | `Pinch of salt` | grams null | PARSER_FAILURE | Pinch syntax misses negligible matcher. | No | Treat as zero. |
| Meatless meatballs | `broccoli` | grams null | OPTIONAL_GARNISH / PARSER_FAILURE | Unquantified side line. | **Yes (fiber/energy unknown)** | Clarify amount or explicitly mark side/optional. |
| Yogurt dill sauce | `1 healthy pinch sea salt` | grams null | PARSER_FAILURE | Pinch has no grams. | No | Treat as zero. |
| Yogurt dill sauce | `1 pinch cayenne pepper` | grams null | PARSER_FAILURE | Pinch has no grams. | No | Treat as negligible. |
| Yogurt dill sauce | `1 drizzle extra virgin olive oil` | grams null | PARSER_FAILURE | Drizzle has no weight. | **Yes** | Supply/approve a measured amount or explicitly exclude. |

## 7. Disputed semantic resolutions

These lines are technically “resolved” but cannot be treated as evidence of correctness.

| Recipe | Ingredient | Selected result | Finding / impact |
|---|---|---|---|
| Protein bars | unsweetened almond milk | Candies, milk chocolate, with almonds | Wrong food; adds 171 kcal whole. |
| Chicken chickpea salad | cherry tomatoes | Croutons, seasoned | Wrong noun selected after comma parsing; adds 550 kcal whole. |
| Chicken chickpea salad | Kalamata/Castelvetrano olives | Chokecherries, raw, pitted | Shared descriptor `pitted` defeats semantic validation; materially wrong fat/carbs/fiber. |
| Chicken meatballs | uncooked orzo | Teff, uncooked | Shared descriptor `uncooked`; macros are similar enough to evade calorie checks but identity is wrong. |
| Chicken meatballs | mascarpone/cream alternative | Cream cheese, only 26.6 g | Parser chooses an alternative clause and underweights a 1/4 cup ingredient. |
| Chinese chili oil | chili flakes | Chili with beans, canned | Wrong food class/form. |
| Chinese chili oil | ground chili | Emu, ground, raw | Shared descriptor `ground`; wrong food. |
| Chinese chili oil | sesame seeds | Sesame butter/paste | Related ingredient but materially different fat density/form. |
| Chinese chili oil | black rice vinegar | Rice and black beans | Shared rice/black tokens; wrong food. |
| Chinese chili oil | Sichuan peppercorn | Commercial peppercorn dressing | Shared peppercorn token; wrong form. |
| Thai shrimp salad | first serrano pepper | Lotus seeds | Comma parser reduces name to `keeping ribs seeds…`; wrong food. |
| Thai shrimp salad | fresh herbs | Chamomile tea | Wrong form and near-zero contribution. |
| Thai shrimp salad | edamame | Teff, cooked | Comma parser reduces name to `shelled cooked`; materially understates protein. |
| Punjabi chole | pink salt | Pink beans, cooked | Wrong food; shared `pink`/`salt`. |
| Punjabi chole | amchur | Egg substitute powder | Shared `substitute`; wrong food. |
| Punjabi chole | fennel powder | Fennel bulb, raw | Wrong form/density. |
| Punjabi chole | dried chickpeas with canned alternative | 793.8 g canned chickpeas | Alternative package size overrides primary `1 cup dried`; materially inflates total. |
| Meatless meatballs | plant-based vegan ground beef | Real 80/20 ground beef | Canonical alias lacks plant-based/vegan guard; materially wrong macros. |
| Meatless meatballs | marinara sauce | Cheese ravioli with marinara sauce | Weak token overlap; adds 1,151 kcal whole. |
| Yogurt dill sauce | dairy-free yogurt | Whole-milk dairy yogurt | Canonical alias lacks dairy-free guard; stored source macros are more plausible. |

The raw artifact preserves every USDA candidate considered, including FDC ID, description, data type, and macro basis. Reproducing the entire candidate list in this report would obscure the decision-relevant evidence above.

## 8. AI fallback

| Recipe | Ingredient | Why AI was needed | Contribution (whole recipe) | Acceptable for a later apply? |
|---|---|---|---:|---|
| Carbonara | Pecorino Romano | Both USDA attempts returned 404 | 916 kcal; 75.2 P; 63.6 F | **No** — material and run-variable. |
| Chicken chickpea salad | green chiles | Both USDA attempts returned 404 | 25 kcal | Yes by itself; recipe is blocked elsewhere. |
| Chicken meatballs | sliced peppers | Both USDA attempts returned 404 | 66 kcal | **No** for this delta review; contribution is meaningful. |
| Brussels sprouts | sriracha | Both USDA attempts returned 404 | 14 kcal | **Yes** — small and plausible. |
| Thai shrimp salad | serrano pepper | Both USDA attempts returned 404 | 2 kcal | Yes by itself; recipe is blocked elsewhere. |
| Punjabi chole | serrano chiles `)` | Malformed query returned 404/400 | 4 kcal | No until parser defect fixed. |
| Punjabi chole | garam masala | Retry returned candidate but semantic validation rejected it | 37 kcal | Review after fix; moderate spice contribution. |
| Punjabi chole | baking soda `)` | Malformed query returned 404/400 | 0 kcal | No until parser defect fixed. |
| Punjabi chole | tamarind concentrate `)` | Malformed query returned 404/400 | 12 kcal | No until parser defect fixed. |
| Yogurt dill sauce | dill | Both USDA attempts returned 404 | 1.5 kcal | Yes by itself; recipe is blocked elsewhere. |

Prompt 4B showed AI provenance on additional recipes because external/AI results vary by run. That variability is material for Carbonara (904 → 719 kcal when guanciale failed AI on the current rerun) and supports blocking it.

## 9. Servings basis

Current source JSON-LD was fetched read-only where a source URL exists. No source body or recipe record was changed.

| Recipe ID | Servings | Basis | Authoritative/assumed | Readiness impact |
|---|---:|---|---|---|
| `hearthealthy-peanut-butter-protein-bars` | 4 | STORED_EXISTING_SERVINGS | No source provenance; prior nutrition tagged default servings | Blocker alongside missing protein powder. |
| `peanut-butter-oat-protein-shake` | 1 | STORED_EXISTING_SERVINGS | Reasonable single drink; no source URL | Not primary blocker. |
| `spaghetti-carbonara` | 4 | AUTHORITATIVE_RECIPE_SERVINGS | Content/source says 4 | None. |
| `bread` | 4 proposed | STORED_EXISTING_SERVINGS | **Conflicts with current source yield 8** | Blocker; per-serving result is ~2× source basis. |
| `chicken-chickpea-salad` | 4 | ASSUMED_DEFAULT, corroborated by source | Engine labels assumed; source says 4 | Serving uncertainty resolved as evidence, but doc still lacks explicit servings. |
| `chicken-meatballs-with-peppers-and-orzo` | 4 | AUTHORITATIVE_RECIPE_SERVINGS | Source says 4 | None. |
| `chinese-chili-oil` | 24 | AUTHORITATIVE_RECIPE_SERVINGS | Source yield 1.5 cup = 24 tbsp | None. |
| `honey-sriracha-roasted-brussels-sprouts` | 4 | AUTHORITATIVE_RECIPE_SERVINGS | Source says 4 | None. |
| `chopped-thai-shrimp-salad-with-garlic-lime-dressing` | 5 | AUTHORITATIVE_RECIPE_SERVINGS | Source says 4–6 / five large salads | Reasonable midpoint. |
| `intsa-punjabi-chole` | 5 | AUTHORITATIVE_RECIPE_SERVINGS | Source says 5 | None. |
| `rising-sun-mazcal` | 1 | STORED_EXISTING_SERVINGS | Single cocktail; source currently 403 | Reasonable, not primary blocker. |
| `speget-with-fake-meat-meatballs` | 5 | AUTHORITATIVE_RECIPE_SERVINGS | Content/source says 4–6; midpoint 5 | Reasonable. |
| `yogurt-dill-sauce` | 4 | AUTHORITATIVE_RECIPE_SERVINGS | Source says four ~3-tbsp servings | None. |

## 10. Major stored → proposed macro deltas

### Peanut Butter Oat Protein Shake — protein 27.5 → 10.8/10.9 g

The engine cannot assign grams to `1 scoop protein powder`, so the ingredient contributes zero. A typical protein-powder scoop accounts for approximately the missing 16–25 g protein. The result cannot be applied until an authoritative scoop weight/product is supplied. Psyllium also moved from Prompt 4B resolution to unresolved in the rerun, explaining fiber 10.7 → 5.7 g.

### Spaghetti Carbonara — fat 22.6 → 41.5 g and fiber 12.7 → 3.6 g

Prompt 4B's 904 kcal result necessarily included a large guanciale/pancetta fallback contribution; in the current run that line remained unresolved and calories/fat fell to 719/22.2. Pecorino alone contributes 916 kcal and 63.6 g fat to the whole recipe. The stable fiber drop is from canonical dry pasta: 453.6 g at 3.2 g fiber/100 g = 14.5 g total, or 3.6 g/serving. The stored 12.7 g/serving fiber is unsupported, but the proposed total remains blocked by meat/AI volatility.

### Chicken Meatballs with Peppers and Orzo — calories 695 → 556

The rerun whole-recipe contributions are approximately turkey 671, egg 72, panko 210, Parmesan 209, orzo/incorrect teff 832, peppers 66, cream-cheese alternative 93, and all other ingredients 72 kcal. The total is 2,225 kcal / 4 = 556. The 139 kcal/serving decrease is driven largely by lower carbohydrate/cream estimates, but orzo and the creamy line are not correctly identified, so neither the delta nor the new value is apply-ready.

### Thai Shrimp Salad — calories 728 → 528

The proposed whole-recipe total is dominated by dressing oil 962 kcal, cashews 540, the incorrect teff match for edamame 478, shrimp 386, carrots 130, and honey 64. Protein falls because 473 g of “edamame” contributes only 18.3 g protein after being resolved as teff; fat falls because unquantified pan/frying oil is omitted; fiber falls through the wrong edamame/herb/serrano matches and omitted optional wontons. The new value is not defensible.

### Punjabi Chole — calories 198 → 287 (rerun 272)

The parser gives the chickpea line 793.8 g because the parenthetical alternative `2 (14 oz) cans` overrides the primary `1 cup dried chickpeas`. That contributes 1,103 kcal, 56.4 g protein, 178.6 g carbs, and 50.8 g fiber whole recipe—about 221 kcal/serving before any other ingredient. Prompt 4B additionally resolved ghee/AI differently, explaining 287 vs 272. The source-site 198 kcal is better supported than the current recompute.

### Meatless Meatballs — sugar 50 → 7.8 g

The stored 50 g/serving sugar is almost certainly erroneous. However, the proposed 7.8 g is mostly 35.1 g whole-recipe sugar from a wrong cheese-ravioli/marinara match; the plant-based protein is also resolved as real 80/20 beef. “Better than stored” is insufficient for apply.

### Rising Sun — calories 193 → 17

The engine does not normalize the U+2044 fraction slash (`⁄`). Mezcal, grapefruit juice, and maraschino remain unquantified; the lime line is misread as one whole lime/67 g and supplies essentially all 17 kcal. Alcohol and liqueur are unquestionably material, so the recipe remains blocked.

### Remaining smaller deltas

- **Protein bars:** missing protein powder explains the protein decrease; almond-milk candy and canonical peanut butter inflate fat/calories. Blocked.
- **Bread:** whole-recipe totals are stable and flour-dominated, but dividing by 4 conflicts with source yield 8. Blocked until servings are corrected/reviewed.
- **Chicken chickpea salad:** no stored comparator; missing chicken and wrong tomato/olive results make the first estimate unusable.
- **Chinese chili oil:** 1 cup oil supplies ~80 kcal and 9.1 g fat per tablespoon serving; despite several wrong aromatics, 93 vs 103 is plausible. Human acceptance required.
- **Brussels sprouts:** 189 → 190 is fully explained by stable sprouts/oil/honey/lime plus a small sriracha AI estimate. Apply-ready.
- **Yogurt dill sauce:** 62 → 24 is caused by mapping dairy-free yogurt to low-fat dairy yogurt and omitting the oil drizzle. Stored source-site nutrition is more plausible.

## 11. Plausibility cross-check

The current rerun's `4P + 4C + 9F` differs from reported calories by -30 to +12 kcal per serving for 12 recipes, and by -23 kcal for Brussels sprouts; fiber inclusion in carbohydrate totals explains much of the negative difference. No arithmetic aggregation failure was found. Rising Sun's formula is only 24.5 kcal versus reported 17, but the severe problem is omitted alcohol, not rounding. Arithmetic consistency does not rescue semantically wrong ingredient matches.

## 12. Per-recipe readiness and exact remaining concern

| Recipe | Classification | Primary reason | Exact remaining concern |
|---|---|---|---|
| `hearthealthy-peanut-butter-protein-bars` | BLOCKED | Material ingredient unresolved | Supply protein-powder grams/product and authoritative servings; fix almond-milk match. |
| `peanut-butter-oat-protein-shake` | BLOCKED | Material protein/fiber omitted | Supply scoop weight and resolve psyllium. |
| `spaghetti-carbonara` | BLOCKED | Material unresolved meat and AI volatility | Resolve guanciale/pancetta and Pecorino deterministically. |
| `bread` | BLOCKED | Serving conflict | Decide/correct stored 4 versus source yield 8 before recompute/apply. |
| `chicken-chickpea-salad` | BLOCKED | Missing chicken plus semantic mis-matches | Fix comma/subheader parsing and resolve chicken/tomatoes/olives. |
| `chicken-meatballs-with-peppers-and-orzo` | BLOCKED | Wrong orzo/cream resolution | Correct ingredient normalization/matching and rerun. |
| `chinese-chili-oil` | REVIEW_REQUIRED | Oil-dominant result likely usable | Owner decides whether incorrect low-contribution aromatics are acceptable or require corrected recompute. |
| `honey-sriracha-roasted-brussels-sprouts` | READY_FOR_APPLY | Complete material resolution | None; include only after the engine-fix session confirms no regression. |
| `chopped-thai-shrimp-salad-with-garlic-lime-dressing` | BLOCKED | Material semantic errors/unquantified oil | Correct edamame/serrano/herb parsing and choose pan-oil amount. |
| `intsa-punjabi-chole` | BLOCKED | Confirmed malformed-query and alternative-size defects | Fix nested parentheses/container alternative behavior; rerun. |
| `rising-sun-mazcal` | BLOCKED | Core cocktail ingredients unresolved | Add U+2044/fluid-ounce support and rerun. |
| `speget-with-fake-meat-meatballs` | BLOCKED | Canonical and USDA matches are wrong | Guard plant-based proteins; reject ravioli for marinara; clarify broccoli. |
| `yogurt-dill-sauce` | BLOCKED | Dairy-free product and oil omitted/misresolved | Resolve correct yogurt basis and quantify/exclude oil. |

## 13. Apply allowlist

```text
honey-sriracha-roasted-brussels-sprouts
```

Do not run the apply yet. PATH B requires the focused engine remediation and a post-fix dry-run first.

## 14. Review required

- `chinese-chili-oil`: decide whether an oil-dominant `93 kcal / 9.9 g fat` tablespoon estimate is acceptable despite wrong low-contribution matches, or require corrected ingredient matching before apply. Recommendation: require the matcher fix for consistency.

## 15. Blocked

The other 11 recipes and their exact remediations are listed in §12. None should enter an apply allowlist until its blocker is removed and a fresh non-persistent recompute is reviewed.

## 16. Confirmed nutrition-engine defects

```text
Confirmed nutrition-engine defects: 6
```

| # | File/function | Root cause | Affected recipes | Proposed fix | Regression test |
|---:|---|---|---|---|---|
| 1 | `lib/nutritionEngine.ts` `parseIngredientLine` | Flat parenthetical removal leaves unmatched `)` from nested alternatives, generating USDA 400s. | Punjabi Chole | Balanced/bounded parenthetical normalization; never send unmatched delimiters. | Three exact Chole lines produce clean names and no `)` query. |
| 2 | `normalizeFractions` / quantity parser | U+2044 fraction slash forms (`1⁄2`, `3⁄4`) are unsupported. | Rising Sun | Normalize U+2044 fractions and parse `oz.` as fluid ounces for liquids. | Exact cocktail lines yield 1.5/0.75/0.5 oz gram estimates. |
| 3 | `canSizeGrams` precedence | A package size in an `or` alternative overrides the primary quantity. | Punjabi Chole | Ignore alternative parenthetical container sizing when a primary measured quantity exists. | `1 cup dried chickpeas (…or 2 cans…)` uses the cup basis. |
| 4 | `parseIngredientLine` comma segment selection | The segment with most non-descriptor words can be a prep clause, discarding the food noun. | Chicken salad; Thai salad; chicken meatballs | Preserve leading noun phrase; treat later comma clauses as preparation/alternatives. | Tomato, chicken, serrano, edamame, and mascarpone lines retain core noun. |
| 5 | `matchCanonicalStaple` guards | Alias-subset matching ignores plant-based/vegan/dairy-free contradictions. | Meatless meatballs; yogurt sauce | Add surviving-token exclusion guards or incompatible-modifier vetoes. | Vegan ground beef never → real beef; dairy-free yogurt never → dairy yogurt. |
| 6 | `pickValidated` | One shared generic token plus a broad calorie band accepts semantically unrelated food/form candidates. | Protein bars, chicken salad, chicken meatballs, chili oil, Thai salad, Chole, meatless meatballs (and minor bread yeast) | Score core food nouns/form conflicts, reject descriptor-only overlap, and add adversarial fixtures. | Reject candy for almond milk, croutons for tomato, chokecherries for olives, teff for orzo/edamame, emu for chili, ravioli for marinara. |

No production fix or failing test was committed in this discovery session. The exact cases above are the regression specification for the focused fix prompt.

## 17. Next path

**PATH B — Nutrition-engine fix required first.**

Recommended next prompt:

```text
Prompt 4D — focused nutrition-engine remediation
```

It should implement the six bounded defect fixes, add the listed regression fixtures, rerun these exact 13 recipes without persistence, and emit a new apply allowlist. It must not combine code remediation with nutrition apply.

## 18. Tests and diagnostics

- Fresh baseline `npm test`: **22 files, 118/118 tests passed**, 0 failed, 0 skipped.
- Fresh baseline `npm run typecheck`: **passed**.
- Fresh baseline `npm run lint`: **passed with 0 errors and 6 pre-existing warnings** (five `no-img-element`, one unused eslint-disable).
- Fresh baseline `npm run build`: **passed**, 26 routes/pages generated.
- Focused diagnostic: temporary Vitest harness **1/1 passed** and generated the raw artifact; temporary code/test instrumentation was removed.
- Direct USDA paired probes: malformed trailing-`)` queries returned only 400/404 across 24 requests; sanitized equivalents returned JSON 200 on 14/24 and the same intermittent HTML 404 on 10/24, proving both request defect and external 404 inconsistency.
- Final repository verification is recorded in the session output/commit summary.
- New committed tests: **0** (investigation-only; regression cases documented for Prompt 4D).

## 19. Data mutation and infrastructure

```text
Recipe writes: 0
Recipe creates: 0
Recipe deletes: 0
Smoothies changes: 0
Maple-pecan changes: 0
Nutrition writes: 0
Canonical writes: 0
Firestore mutation: 0
?apply=true calls: 0

Manual Vercel deployment: none
Firebase deployment: none
Firestore rules/index deployment: none
Environment changes: none
Dependency changes: none
```

## 20. Unverifiable items

- The original Prompt 4B console log payloads were not stored in its JSON artifact; this review reproduced fresh events rather than claiming the old per-event sequence.
- Rising Sun's source page returned 403 during the serving check; single-cocktail serving basis is supported by the stored ingredient format and existing serving value, not a fresh source read.
- The no-source protein-bar and shake records have no authoritative serving provenance in repository/live fields beyond their existing values.
- AI estimates are nondeterministic; the artifact records the exact current run and explicitly retains Prompt 4B values for comparison.

## 21. Deferred / failed

```text
Maple Roasted Candied Pecans remains deferred.
Smoothies remains deferred and unchanged.
Nutrition apply remains deferred.
```

Prompt 4C investigation is complete. The next work is Prompt 4D focused nutrition-engine remediation, followed by another non-persistent apply-readiness review; only then should an apply-only session be considered.
