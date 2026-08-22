# M-04 Recipe Data Remediation — 2026-08-22

**Status before apply:** review manifest complete. Production remained read-only while this manifest and the guarded apply plan were prepared.

**Authoritative population:** Prompt 4A leaves exactly the 12 records below. There is no difference from its post-fix validation table.

## Before/after remediation manifest

The exact current content is preserved in `docs/audits/m04-recipe-data-backup-2026-08-22.json`; the complete proposed content is reviewable in `scripts/remediate-m04-recipes.js`. Every repair entry contains a byte-exact current-content or SHA-256 precondition plus the complete proposed body (`content`). The check-only run verified those preconditions against production, checked the proposed canonical slug, rejected collisions, and parsed every proposed body before any write. Content SHA-256 values below bind this report to those exact proposals. The backup captures complete original document fields and Firestore Timestamp components.

| Recipe ID | Title | Current defect / current content summary | Proposed treatment | Proposed title / recipe ID | Proposed content SHA-256 | Source preserved? | Existing nutrition touched? | Existing document deleted? | Risk / uncertainty |
|---|---|---|---|---|---|---|---|---|---|
| `bread` | Bread! | Source URL plus four headerless ingredients; no stored instructions. | Retain the URL/ingredients, add explicit sections, and restore the three current-source JSON-LD instructions. | Unchanged | `3729c2e55bc5c6eb9deb51898c3ce2b53800f97312b5e9f771d2dcb32b55fad2` | Yes | No | No | Low; source URL/title match. |
| `chicken-chickpea-salad` | Chicken Chickpea Salad | Five instructions occur before three unmarked ingredient groups. | Move the exact existing ingredient groups before the exact existing instructions and add section headings. | Unchanged | `5997e333152cf13a6c6d1a353e79dcbfa91186dfde934c070794eb0d4d92ce38` | Yes | No | No | Low; only existing lines are reordered. |
| `chicken-meatballs-with-peppers-and-orzo` | Chicken Meatballs with Peppers and Orzo | Content is only the intended Pinch of Yum URL. | Restore the current source Recipe JSON-LD body under explicit sections. | Unchanged | `12b46471453b7ca57d0f65dad0abcf2fbe3b148bb7700d8885a04a2b5ccc8928` | Yes | No | No | Low; URL and canonical source title match. |
| `chinese-chili-oil` | Chinese Chili Oil | Content is only the intended Red House Spice URL. | Restore the current source Recipe JSON-LD body under explicit sections. | Unchanged | `8ae28ac1d62b9d9e5ad35422cc9158e2d2270b65dd25d660c2fa9ded1441acb6` | Yes | No | No | Low; URL is the intended chili-oil page. |
| `honey-sriracha-roasted-brussels-sprouts` | HONEY SRIRACHA ROASTED BRUSSELS SPROUTS | Six ingredients and five instructions exist without boundaries. | Insert the two headings and normalize whitespace; preserve wording/order. | Unchanged | `b9e59511da8527cb16a99a6b111ff0535da2f335ef984c55f0c1081c77a40df0` | Yes | No | No | Low. |
| `httpspinchofyumcomchopped-thai-shrimp-salad-with-garlic-lime-dressing` | URL title | URL is the title and only instruction; no ingredients. | Restore canonical source JSON-LD, create canonical-slug document, validate, then delete malformed document. | Chopped Thai Shrimp Salad with Garlic Lime Dressing / `chopped-thai-shrimp-salad-with-garlic-lime-dressing` | `6d2ece000d47d7a80ccc29e52e189be58721f04f38f6541688a1f9e5913ebc7b` | Yes | No | Yes, after replacement validation | Low-to-medium; controlled ID migration. Collision check passed. |
| `intsa-punjabi-chole` | Intsa Punjabi Chole | Content is only the intended Spice Cravings URL. | Restore current source Recipe JSON-LD; retain legacy title/ID to avoid unrelated reference migration. | Unchanged | `253aa9ecaf7b53228862b6bf8e409291c83c771dfa308e12977d551c0193acf9` | Yes | No | No | Low; source page exactly matches Punjabi chole. |
| `maple-roasted-candied-pecans` | Maple Roasted Candied Pecans | Content is exactly `Source:`; no sourceURL/sourceFile body, queue item, backup, or checked-in source exists. | **DEFER.** Leave unchanged. | Unchanged | Not applicable | Yes (unchanged) | No | No | **Blocked:** authoritative recipe unavailable. |
| `rising-sun-mazcal` | Rising Sun - Mazcal | Source URL plus six headerless cocktail ingredients; no stored instructions. | Add one ingredient heading; retain all content and spelling. | Unchanged | `24c4d85d68a71659a68a0e6077516a6c5ddd9fe1d1637b13131ab896d09135ed` | Yes | No | No | Low; authoritative stored recipe genuinely has no separate instructions. |
| `smoothies` | Smoothies | Three named recipes and ingredient lists are combined; none contains instructions or source provenance. | **DEFER the split.** Leave combined document unchanged. | Proposed IDs would be `green-peanut-butter-power-shake`, `green-detox-smoothie`, and `carrot-cake-protein-shake`, but no writes are safe. | Not applicable | Yes (unchanged) | No | No | **Blocked:** three complete recipes cannot be produced without inventing instructions. |
| `speget-with-fake-meat-meatballs` | Speget with fake meat meatballs | Yield, 15 headerless ingredient/source lines; no stored instructions. | Add one ingredient heading; retain every stored line and legacy spelling. | Unchanged | `b59789773aaa5b4bc4ba1e56922dc4b1b6371d0a026e98319a26cbd38d54c67d` | Yes | No | No | Low; authoritative stored recipe genuinely has no separate instructions. |
| `yogurt-dill-sauce` | yogurt Dill sauce | Content is only the intended Minimalist Baker URL. | Restore current source Recipe JSON-LD under explicit sections. | Unchanged | `a1cbf5fa92407e13704dbdcde1fd4c9424f519bbed5e2f409c9812e4a3f22cad` | Yes | No | No | Low; source page exactly matches. |

## Source recovery evidence

The URL pages were fetched through the repository's existing `/api/fetch-recipe` route, which uses `safeFetchText` (public HTTP(S), DNS/IP validation, bounded redirects, deadline, and byte cap). Recipe fields were extracted deterministically from embedded `application/ld+json`; no AI generation or general web search was used.

| Recipe | Source used | Result |
|---|---|---|
| `bread` | Stored Pinch of Yum URL | Exact intended no-knead bread; instructions recovered. |
| `chicken-meatballs-with-peppers-and-orzo` | Stored Pinch of Yum URL | Exact title match; complete recipe recovered. |
| `chinese-chili-oil` | Stored Red House Spice URL | Intended Chinese chili-oil page; complete recipe recovered. |
| malformed Thai shrimp salad ID | Stored Pinch of Yum URL | Exact canonical title/body recovered. |
| `intsa-punjabi-chole` | Stored Spice Cravings URL | Intended Punjabi chole recipe recovered. |
| `yogurt-dill-sauce` | Stored Minimalist Baker URL | Intended dill-yogurt sauce recovered. |
| `maple-roasted-candied-pecans` | None available | Deferred; no attributable source. |

## Apply and read-back validation

The guarded script re-read all exact preconditions, checked the Thai-salad target for collision, parsed every proposal, and created the backup before its first write. It then performed 9 content-only updates and one controlled migration. Every target was immediately read back and compared with its original; only the declared fields differ. The malformed Thai-salad document was deleted only after the replacement passed parse, nutrition, and untouched-field checks.

| Old recipe ID | Root problem | Action | New recipe ID | Write result | Parse result |
|---|---|---|---|---|---|
| `bread` | Headerless/incomplete stored body | Restored source instructions; added sections | `bread` | Updated + verified | 4 ingredients / 3 instructions |
| `chicken-chickpea-salad` | Instructions precede ingredients | Reordered existing lines; added sections | `chicken-chickpea-salad` | Updated + verified | 23 / 5 |
| `chicken-meatballs-with-peppers-and-orzo` | URL-only | Restored source JSON-LD | Same | Updated + verified | 13 / 5 |
| `chinese-chili-oil` | URL-only | Restored source JSON-LD | Same | Updated + verified | 14 / 7 |
| `honey-sriracha-roasted-brussels-sprouts` | No boundaries | Added section headings | Same | Updated + verified | 6 / 5 |
| malformed Thai shrimp-salad ID | URL title/content | Restored source; canonical-ID migration | `chopped-thai-shrimp-salad-with-garlic-lime-dressing` | Created/read back/verified; old deleted | 18 / 4 |
| `intsa-punjabi-chole` | URL-only | Restored source JSON-LD | Same | Updated + verified | 20 / 10 |
| `maple-roasted-candied-pecans` | Truncated, no source | Deferred | Same | Untouched | 0 / 0 (blocked) |
| `rising-sun-mazcal` | Headerless ingredients | Added ingredient heading | Same | Updated + verified | 6 / 0 (source has no separate instructions) |
| `smoothies` | Three incomplete recipes | Deferred | Same | Untouched | 0 / 0 composite (blocked) |
| `speget-with-fake-meat-meatballs` | Headerless ingredients | Added ingredient heading | Same | Updated + verified | 15 / 0 (source has no separate instructions) |
| `yogurt-dill-sauce` | URL-only | Restored source JSON-LD | Same | Updated + verified | 7 / 4 |

### Backup

- Mechanism: exact Admin-SDK snapshots serialized before mutation; Firestore Timestamps retain seconds and nanoseconds.
- Location: `docs/audits/m04-recipe-data-backup-2026-08-22.json`.
- Documents: 10 (every modified/deleted original).
- Disposition: committed with the remediation because these are non-sensitive shared catalog records.
- Credentials/secrets: absent (explicit scan passed).

### Smoothies split (superseded/deferred)

The composite source identifies `Green Peanut Butter Power Shake`, `Green Detox Smoothie (Savory-Lite)`, and `Carrot Cake Protein Shake`, with prospective slugs `green-peanut-butter-power-shake`, `green-detox-smoothie`, and `carrot-cake-protein-shake`. It provides ingredient lists (approximately 8, 9, and 8 lines respectively) but **zero instructions for all three** and no attributable external source. The current product-owner instruction supersedes the earlier prospective split: leave the existing `smoothies` record as-is. No collision checks, creates, split, delete, or nutrition copy occurred.

### Field-preservation check

For the nine in-place records, only `content` changed. For the Thai-salad migration, only `id`, `recipeID`, `title`, and `content` changed; every other field was copied exactly before the old document was deleted. Read-back comparison confirmed preservation of `category`, `cuisine`, `imageURL`, `sourceURL`, `sourceFile`, `labels`, `hasImage`, `created`, `modified`, `addedBy`, `prepTime`, `cookTime`, `servings`, `nutrition`, `nutritionStatus`, and any otherwise unlisted field. Nutrition writes were zero.

### Production mutation totals

```text
Recipe updates: 9
Recipe creates: 1
Recipe deletes: 1
Nutrition writes: 0
Canonical writes: 0
Other production writes: 0
```

## Nutrition dry-run review

The local authenticated route `/api/nutrition-canonical-dryrun?recipeId=<id>` processed the 3 Prompt 4A recoveries and 10 successful Prompt 4B repairs. The request never included `apply=true`; all 13 responses reported `dryRun:true`, `writesPerformed:0`, and HTTP 200. Raw response evidence is in `docs/audits/m04-nutrition-dry-run-raw-2026-08-22.json`.

“Resolved” is the exposed ingredient count minus the route's unresolved count. The engine does not expose USDA-hit or AI-fallback counts through this route, so they are not invented; `AI?` records only whether proposed `source` includes `+ai`. Twelve rows emitted structured USDA operational HTTP 400/404 events before fallback. Those events prevent `READY_FOR_APPLY` classification even where macros look reasonable.

| Recipe ID | Ingredients | Resolved / unresolved | Canonical hits | AI? | Proposed source / confidence / servings | Proposed per-serving Cals / P / C / F / Fiber / Sugar | Warnings | Classification |
|---|---:|---:|---:|---|---|---|---|---|
| `hearthealthy-peanut-butter-protein-bars` | 8 | 6 / 2 | 2 | No | `usda+canonical` / medium / 4 | 620 / 21.6 / 41.2 / 44.3 / 7.1 / 10.3 | USDA HTTP errors; protein powder and dash unresolved | REVIEW_REQUIRED |
| `peanut-butter-oat-protein-shake` | 9 | 7 / 2 | 3 | Yes | `usda+canonical+ai` / medium / 1 | 386 / 10.8 / 48.2 / 18.5 / 10.7 / 11.8 | USDA HTTP errors; protein powder and water/ice unresolved | REVIEW_REQUIRED |
| `spaghetti-carbonara` | 6 | 6 / 0 | 2 | Yes | `usda+canonical+ai` / medium / 4 | 904 / 42.5 / 87.5 / 41.5 / 3.6 / 3.7 | USDA HTTP errors; calories/fat materially higher than stored | REVIEW_REQUIRED |
| `bread` | 4 | 4 / 0 | 1 | Yes | `usda+canonical+ai` / medium / 4 | 344 / 9.9 / 72 / 1 / 2.7 / 0.3 | USDA HTTP errors | REVIEW_REQUIRED |
| `chicken-chickpea-salad` | 23 | 19 / 4 | 12 | Yes | `usda+canonical+ai+default_servings` / low / 4 | 575 / 14.3 / 57.3 / 33.6 / 14.7 / 11.6 | USDA HTTP errors; assumed servings; three subgroup labels and chicken line unresolved | REVIEW_REQUIRED |
| `chicken-meatballs-with-peppers-and-orzo` | 13 | 12 / 1 | 8 | Yes | `usda+canonical+ai` / medium / 4 | 556 / 40 / 59 / 18 / 7.3 / 5.6 | USDA HTTP errors; finishing line unresolved; calories materially lower | REVIEW_REQUIRED |
| `chinese-chili-oil` | 14 | 11 / 3 | 2 | Yes | `usda+canonical+ai` / medium / 24 | 93 / 0.5 / 1.3 / 9.9 / 0.6 / 0.1 | USDA HTTP errors; star anise, cinnamon, ginger unresolved | REVIEW_REQUIRED |
| `honey-sriracha-roasted-brussels-sprouts` | 6 | 6 / 0 | 3 | Yes | `usda+canonical+ai` / medium / 4 | 190 / 6 / 30.8 / 7.4 / 7 / 17.5 | USDA HTTP errors; macros otherwise nearly identical | REVIEW_REQUIRED |
| `chopped-thai-shrimp-salad-with-garlic-lime-dressing` | 18 | 15 / 3 | 8 | Yes | `usda+canonical+ai` / medium / 5 | 528 / 27.1 / 36.9 / 31.6 / 5.7 / 7.8 | USDA HTTP errors; lime/oil/wonton lines unresolved; calories materially lower | REVIEW_REQUIRED |
| `intsa-punjabi-chole` | 20 | 20 / 0 | 8 | Yes | `usda+canonical+ai` / medium / 5 | 287 / 13.3 / 44.5 / 7.8 / 13.1 / 7.6 | USDA HTTP errors; stored high → proposed medium; calories materially higher | REVIEW_REQUIRED |
| `rising-sun-mazcal` | 6 | 2 / 4 | 1 | No | `usda+canonical` / medium / 1 | 17 / 0.3 / 5.6 / 0.1 / 0.3 / 1.1 | Mezcal, grapefruit juice, maraschino, salt unresolved; 17 kcal is implausible | **BLOCKED** |
| `speget-with-fake-meat-meatballs` | 15 | 14 / 1 | 7 | No | `usda+canonical` / medium / 5 | 629 / 36.3 / 38.2 / 36 / 2.6 / 7.8 | USDA HTTP errors; broccoli unresolved; large sugar delta | REVIEW_REQUIRED |
| `yogurt-dill-sauce` | 7 | 4 / 3 | 3 | Yes | `usda+canonical+ai` / medium / 4 | 24 / 1.3 / 2.7 / 1 / 0.1 / 1.6 | USDA HTTP errors; pinches/drizzle unresolved; high → medium; calories materially lower | REVIEW_REQUIRED |

### Stored → proposed per-serving nutrition

Format is `servings; calories / protein / carbs / fat / fiber / sugar; confidence; source`.

| Recipe ID | Stored | Proposed |
|---|---|---|
| `hearthealthy-peanut-butter-protein-bars` | 4; 609 / 30.4 / 39.5 / 39.8 / 10.6 / 7.3; low; `usda+ai+default_servings` | 4; 620 / 21.6 / 41.2 / 44.3 / 7.1 / 10.3; medium; `usda+canonical` |
| `peanut-butter-oat-protein-shake` | 1; 375 / 27.5 / 36 / 13.5 / 9 / 7; medium; `source_site` | 1; 386 / 10.8 / 48.2 / 18.5 / 10.7 / 11.8; medium; `usda+canonical+ai` |
| `spaghetti-carbonara` | 4; 743 / 40.3 / 91.8 / 22.6 / 12.7 / 4.6; medium; `usda+ai` | 4; 904 / 42.5 / 87.5 / 41.5 / 3.6 / 3.7; medium; `usda+canonical+ai` |
| `bread` | 4; 356 / 10.3 / 74.2 / 1.1 / 3.4 / 0.7; low; `usda+default_servings` | 4; 344 / 9.9 / 72 / 1 / 2.7 / 0.3; medium; `usda+canonical+ai` |
| `chicken-chickpea-salad` | None | 4; 575 / 14.3 / 57.3 / 33.6 / 14.7 / 11.6; low; `usda+canonical+ai+default_servings` |
| `chicken-meatballs-with-peppers-and-orzo` | 4; 695 / 45.8 / 93.4 / 15.7 / 7.7 / 9.4; medium; `usda+ai+recovered_servings` | 4; 556 / 40 / 59 / 18 / 7.3 / 5.6; medium; `usda+canonical+ai` |
| `chinese-chili-oil` | 24; 103 / 1.2 / 2.6 / 10.2 / 0.7 / 0.1; medium; `usda+ai+recovered_servings` | 24; 93 / 0.5 / 1.3 / 9.9 / 0.6 / 0.1; medium; `usda+canonical+ai` |
| `honey-sriracha-roasted-brussels-sprouts` | 4; 189 / 6 / 30.7 / 7.3 / 7 / 17.5; medium; `usda+recovered_servings` | 4; 190 / 6 / 30.8 / 7.4 / 7 / 17.5; medium; `usda+canonical+ai` |
| `chopped-thai-shrimp-salad-with-garlic-lime-dressing` | 5; 728 / 44.7 / 40.7 / 47.1 / 12.2 / 12.2; medium; `usda+ai+recovered_servings` | 5; 528 / 27.1 / 36.9 / 31.6 / 5.7 / 7.8; medium; `usda+canonical+ai` |
| `intsa-punjabi-chole` | 5; 198 / 9 / 31 / 5 / 8 / 7; high; `source_site` | 5; 287 / 13.3 / 44.5 / 7.8 / 13.1 / 7.6; medium; `usda+canonical+ai` |
| `rising-sun-mazcal` | 1; 193 / 1.3 / 41.9 / 0.3 / 2 / 34.4; medium; `usda+ai+recovered_servings` | 1; 17 / 0.3 / 5.6 / 0.1 / 0.3 / 1.1; medium; `usda+canonical` |
| `speget-with-fake-meat-meatballs` | 5; 703 / 28.5 / 79 / 29.5 / 3.2 / 50; medium; `usda` | 5; 629 / 36.3 / 38.2 / 36 / 2.6 / 7.8; medium; `usda+canonical` |
| `yogurt-dill-sauce` | 4; 62 / 0.2 / 1.7 / 7.4 / 0.2 / 0.5; high; `source_site` | 4; 24 / 1.3 / 2.7 / 1 / 0.1 / 1.6; medium; `usda+canonical+ai` |

### Prompt 4C readiness

- `READY_FOR_APPLY`: none.
- `REVIEW_REQUIRED`: Heart-Healthy Peanut Butter Protein Bars; Peanut Butter Oat Protein Shake; Spaghetti Carbonara; Bread!; Chicken Chickpea Salad; Chicken Meatballs with Peppers and Orzo; Chinese Chili Oil; Honey Sriracha Roasted Brussels Sprouts; Chopped Thai Shrimp Salad with Garlic Lime Dressing; Intsa Punjabi Chole; Speget with fake meat meatballs; yogurt Dill sauce.
- `BLOCKED`: Rising Sun - Mazcal nutrition (core ingredients unresolved and proposed calories implausible); Maple Roasted Candied Pecans data/source; Smoothies split/data.

Nutrition apply is deferred to Prompt 4C. No nutrition, `nutrition_prev`, canonical, serving, or status value was written.

## Final verification

- Fresh pre-change baseline: `npm test` — 21 files, 114/114 tests passed.
- Focused parser/remediation: `npx vitest run tests/recipeContent.test.ts tests/nutritionEngine.test.ts tests/m04Remediation.test.ts` — 3 files, 34/34 passed (4 new tests).
- Catalog-wide live parse check after writes: 216 documents; exactly 2 failures, the explicitly deferred `maple-roasted-candied-pecans` and `smoothies` records. All 201 formerly valid recipes, the 3 Prompt 4A recoveries, and the 10 Prompt 4B repairs parse with ingredients.
- `npm run typecheck` — passed.
- `npm run lint` — passed with 0 errors and the same 6 pre-existing warnings.
- `npm run build` — passed; 26 pages generated.
- Final `npm test` — 22 files, 118/118 tests passed; 0 failed, 0 skipped.
- Secret scan of the backup and raw dry-run artifacts — no credential names, private keys, bearer tokens, or API keys found.

## M-04 status

Parser remediation is **complete**. Recipe-data remediation is **partial**: 10/12 records are repaired; maple pecans remains source-blocked and `smoothies` is explicitly deferred/unchanged by product-owner instruction. Prompt 4C completed the 13-recipe apply-readiness investigation with **1 ready / 1 review / 11 blocked** and confirmed nutrition-engine defects that require a focused fix before apply. Nutrition apply was **not performed**. See `docs/audits/m04-nutrition-apply-readiness-2026-08-22.md` and its raw diagnostic artifact.
