# MEA Recipes — Pre-Production Release Audit

**Audit date:** 2026-08-21
**Branch:** `codex/audit-pre-production-review-2026-08-21`
**Production:** `https://mea-recipes.vercel.app`
**Production deployment inspected:** `dpl_A1rr3UmTmJJzY8xRn3zfRtiA8FNQ` (`ade6e35`, Ready)
**Firebase project:** `malignant-metro`
**Release recommendation:** **NO-GO until C-01 and H-01 are remediated and verified**

## 1. Executive Summary

The application builds cleanly, all 16 tests pass, the production deployment is Ready, and Vercel returned no error-level runtime events for the preceding seven days. The active AI integration is consistently routed through Vercel AI Gateway to `openai/gpt-5.6-luna`; Firebase Admin uses modular v14 imports; active user data paths are uid-scoped; and the old Strava permission failure is no longer on the active nutrition path. Release is nevertheless blocked by an unauthenticated, production-confirmed server-side request forgery (SSRF) primitive and by authorization that lets any Firebase-authenticated account mutate the shared recipe catalog and invoke Admin-backed catalog recomputes. The priority grocery-cleanup data-loss regression was fixed in current HEAD and now has schema validation, deterministic sanitization, a user-reviewed diff, and one-survivor merge logic, but its lexical safeguard can still approve false merges such as `ground beef` with `beef tenderloin`. Live Firestore checks found 216 recipes, 135 `nutrition_prev` backups explained against a 136-entry manifest by one deleted recipe, 15 still-unparseable recipes, no standalone `Sides` records, and 51 recipes using category values outside the declared union. One contained fix was applied: the MFP cron now fails closed when `CRON_SECRET` is absent, with a regression test.

| ID | Severity | Finding | Location |
|---|---|---|---|
| C-01 | **Critical — fixed** | `/api/fetch-recipe` and authenticated URL ingest now use the shared SSRF-safe fetch primitive; fetch-recipe additionally requires Firebase authentication before URL parsing or outbound work. | `app/api/fetch-recipe/route.ts`; `app/api/ai-ingest/route.ts`; `lib/safeFetch.ts` |
| H-01 | **High** | Any Firebase-authenticated account can write/delete the shared catalog and invoke Admin-backed global nutrition apply paths; there is no admin allowlist. | `README.md:64-71`; `lib/AuthContext.tsx:83-93`; `lib/recipes.ts:84-93,132-135,222-224`; `app/api/nutrition-revalidate/route.ts:61-110`; `app/api/nutrition-canonical-dryrun/route.ts:91-165` |
| H-02 | **High — fixed** | Missing `CRON_SECRET` previously accepted the literal header `Bearer undefined`. The route now requires a non-empty secret. | `app/api/cron/sync-nutrition/route.ts:119-125`; `tests/cronAuth.test.ts:1-22` |
| M-01 | **Medium** | Category taxonomy is inconsistent: 51/216 live recipes are outside the union, `Sides` is absent from the type/filter/prompts, and AI prompts emit punctuation-stripped legacy values. | `types/recipe.ts:67-75`; `components/RecipeFilters.tsx:14-24`; `app/api/ai-ingest/route.ts:20-42`; `app/queue/page.tsx:15-19`; `lib/userdata.ts:138-157` |
| M-02 | **Medium** | Grocery cleanup is protected from the historical delete-all bug, but the deterministic merge guard drops purchase-significant modifiers and uses subset matching, allowing false merges. | `lib/groceryCleanup.ts:20-27,51-67,99-189`; `tests/groceryCleanup.test.ts:23-75` |
| M-03 | **Medium** | Plan add/remove/day/role writers use non-transactional read-modify-write and can lose concurrent updates; detail-page add failure can leave a permanent spinner. | `lib/userdata.ts:260-291,293-300,356-378`; `app/recipes/[id]/page.tsx:148-156` |
| M-04 | **Medium — residual source/readiness blockers; engine remediation closed** | Prompt 4D.1 fixed four confirmed residual resolution defects and reran the exact 13 recipes read-only: **5 ready / 0 review / 8 blocked**. Nutrition remains unapplied. Maple pecans and `smoothies` remain unchanged and deferred. | `docs/audits/m04-nutrition-final-readiness-2026-08-22.md`; `docs/audits/m04-nutrition-final-raw-2026-08-22.json`; `lib/nutritionEngine.ts` |
| M-05 | **Medium — fixed** | The four affected AI routes now enforce streaming raw-body ceilings, explicit request schemas, route-specific semantic bounds, AI/fetch short-circuiting on invalid input, and sanitized public failures. The adjacent `/api/grocery-cleanup` raw-exception follow-up is also sanitized. | `lib/apiRequest.ts`; `app/api/new-recipe-suggestions/route.ts`; `app/api/recommendations/route.ts`; `app/api/recipe-assistant/route.ts`; `app/api/ai-ingest/route.ts`; `app/api/grocery-cleanup/route.ts`; focused route tests |
| M-06 | **Medium** | Major pages often log or swallow read/write errors without a user-visible retry/error state; some loaders can remain indefinitely. | `components/AppDataProvider.tsx:62-72,84-103,110-151`; `app/recipes/[id]/page.tsx:74-77`; `app/grocery/page.tsx:144-165,245-319,350-425`; `app/queue/page.tsx:272-315`; `app/nutrition/page.tsx:119-157` |
| M-07 | **Medium — fixed** | USDA search/detail operational failures now emit safe structured `[nutrition-usda]` events with stable failure codes and operation context; valid misses/rejections remain quiet and fallback semantics are unchanged. | `lib/nutritionEngine.ts`; `tests/nutritionEngine.test.ts` |
| L-01 | **Low — fixed** | Favorites state is owner-tagged, becomes empty or hydrates the real anonymous source on sign-out, and rejects late fetches from the prior uid; filter preferences remain intact. The known pre-load toggle race remains harmless/idempotent. | `components/AppDataProvider.tsx`; `tests/favoritesAuthState.test.tsx`; `lib/userdata.ts:23-47` |
| L-02 | **Low** | Recipe search ignores one-character queries, cannot filter standalone/legacy categories, omits dietary tags, and turns recipe-load failures into “No recipes found.” | `app/recipes/page.tsx:130-194,305-319`; `components/RecipeFilters.tsx:14-24,63-95`; `components/AppDataProvider.tsx:62-72` |
| L-03 | **Low — fixed** | README now documents the daily MFP cron plus optional manual trigger, and PRD explicitly documents the authenticated/admin-gated canonical `?apply=true` path used for Batch 4. | `README.md`; `vercel.json:7-11`; `PRD.md`; `app/api/nutrition-canonical-dryrun/route.ts:91-165` |
| L-04 | **Low — fixed** | Fresh checkout verification initially reproduced six moderate transitive advisories through `firebase-admin`; a scoped `uuid@11.1.1` override removes the chain without changing `firebase-admin`, and Node/npm are now pinned to an explicit runtime contract. | `package.json:4,15-16,52-59`; `.nvmrc`; `package-lock.json`; `README.md:38-42` |
| L-05 | **Low — fixed** | Repository-wide import/export/call/test/script/route searches proved the legacy root-collection helper was unreferenced, so `lib/strava.ts` and its sole-use type were deleted. Active nutrition remains on uid-scoped health metrics. | deleted `lib/strava.ts`; `types/nutrition.ts`; `lib/healthMetrics.ts:23-46`; `app/nutrition/page.tsx:23,131-145` |
| L-06 | **Low** | There are no repository-defined App Router error/loading boundaries or Vercel Analytics/Speed Insights instrumentation. | `app/layout.tsx`; absence of `app/error.tsx`, `app/global-error.tsx`, `app/loading.tsx`; `package.json:17-32` |

## 2. Backend Audit Findings

### 2.1 API authentication and authorization

- **PASS — token verification exists on every normal application API.** All 12 normal routes call `verifyAuthToken` before meaningful work (with `verifyAdminToken` for nutrition applies); the MFP route uses `CRON_SECRET`. `verifyAuthToken` uses modular Admin Auth and cryptographically verifies the ID token (`lib/firebaseAdmin.ts:1-3,22-32`).
- **FIXED — C-01, safe authenticated URL fetch.** `/api/fetch-recipe` authenticates before URL parsing and calls `safeFetchText`, which restricts scheme, credentials, DNS/IP address class, redirect hops, timeout, and response bytes. Auth-gated AI ingest uses the same boundary.
- **FIXED — H-01 API authorization boundary.** Nutrition recompute routes allow ordinary Firebase-authenticated dry-runs but require `verifyAdminToken` for `?apply=true` global writes (`app/api/nutrition-revalidate/route.ts`; `app/api/nutrition-canonical-dryrun/route.ts`). Firestore rules remain manually managed and separately protect direct client catalog writes.
- **FIXED — H-02, cron fail-open.** The cron now reads `CRON_SECRET` into a local value and rejects when it is absent or mismatched (`app/api/cron/sync-nutrition/route.ts:119-125`). The exact missing-env attack is locked by `tests/cronAuth.test.ts:1-22`.

### 2.2 Input validation, error handling, and response shapes

- **PASS — AI outputs are structurally validated.** The shared wrapper uses AI SDK `Output.object`/`Output.array` with Zod (`lib/ai.ts:60-85`), and grocery cleanup uses a strict action schema (`app/api/grocery-cleanup/route.ts:13-27,84-103`). Nutrition and barcode endpoints defensively parse invalid JSON before validating fields.
- **FIXED — M-05, affected AI request inputs are bounded and explicitly validated.** A shared streaming boundary (`lib/apiRequest.ts`) rejects malformed/empty JSON with 400 and raw bodies above 256,000 bytes (standard AI routes) or 2,000,000 bytes (AI ingest) with 413 before JSON parsing or model work. Each affected route validates its existing client contract, ignores unknown fields, applies its specified collection/text/history/mode bounds, and avoids AI or URL-fetch work on invalid input. Focused tests cover the boundary and all four routes; the verified full suite passes 80/80.
- **FIXED — M-05 internal messages are sanitized on all four affected routes; grocery follow-up resolved.** Expected input failures have stable 400/413 responses, existing 401 auth behavior is preserved, and provider/Firebase/unexpected exception text is absent from public 500 responses. `/api/grocery-cleanup` now applies the same principle to its former raw-message catch, returning `{error:"Unable to complete the request."}` with its existing 500 status while logging a stable route name, safe mode/item-count metadata, and message-free error details. Its whole-list and `parse-line` success paths are unchanged.

### 2.3 Firebase Admin and server/client mutations

- **PASS — Firebase Admin v14 migration remains consistent.** Runtime code imports from `firebase-admin/app`, `firebase-admin/auth`, and `firebase-admin/firestore` (`lib/firebaseAdmin.ts:1-19`). Dev tooling uses the same modular subpaths behind a compatibility-shaped wrapper (`scripts/_lib.js:41-69`). No active legacy namespaced Admin import was found.
- **PASS — active per-user paths are uid-scoped.** Favorites/meta (`lib/userdata.ts:23-47,72-110`), week plans (`lib/userdata.ts:232-253`), grocery/saved items (`lib/userdata.ts:470-596`), recipe queue (`lib/queue.ts:24-47`), consumption log/goals/saved foods (`lib/consumptionLog.ts:34-44,93-123`), and health metrics (`lib/healthMetrics.ts:28-46`) all construct paths below `users/{uid}`. `sharedWeekPlans/{week}/users/{uid}` is an intentional cross-user surface (`lib/userdata.ts:425-460`); `recipes` is intentionally global.
- **PASS — MFP writes are guarded and atomic within one batch.** Both target pages are fetched and validated before mutation (`app/api/cron/sync-nutrition/route.ts:157-223`); old MFP records are deleted and deterministic-ID replacements are written in one batch (`app/api/cron/sync-nutrition/route.ts:294-342`). The route stores the target uid in each record (`:323-336`).
- **FAIL — plan write races.** Most planned-array mutations read a document and then `updateDoc` the reconstructed array (`lib/userdata.ts:260-300,356-378`). Concurrent additions of different recipes can both read the same old array and the last write wins. `moveRecipeToWeek` correctly demonstrates the transactional pattern (`lib/userdata.ts:302-335`) and should be the model for all array writers.

### 2.4 Firestore rules/index safety constraint

`firebase.json` contains emulator configuration only and no Firestore deploy target (`firebase.json:1-14`). No `firestore.rules` or `firestore.indexes.json` exists, consistent with `CLAUDE.md:39-47` and `README.md:99-101`. **No `firebase deploy` command was run, and no rule/index file was created or changed.** The exact recommended manual rule change is included in the Appendix; it must be pasted/reviewed in Firebase Console, never deployed from this repository.

## 3. Frontend Audit Findings

### 3.1 Major page loading and error states

| Surface | Loading state | Error state | Verdict and evidence |
|---|---|---|---|
| Recipes | Skeleton grid | None for catalog load | **FAIL:** provider records `recipesError` (`components/AppDataProvider.tsx:62-72`), but page renders “No recipes found” after loading (`app/recipes/page.tsx:305-319`). Cooked-recent loading also has no rejection handler (`app/recipes/page.tsx:113-128`). |
| Recipe detail | Full skeleton | Only save/delete-specific errors | **FAIL:** initial `getRecipeById(...).then(...)` has no catch, so a rejected read leaves the skeleton forever (`app/recipes/[id]/page.tsx:74-77,189-200`). Add-to-plan also lacks `try/finally` (`:148-156`). |
| Plan | Recipe spinner | Calendar-specific errors only | **FAIL:** plan subscriptions have no error callback (`lib/userdata.ts:249-253`; `app/plan/page.tsx:265-287`), shared-plan publication is fire-and-forget (`app/plan/page.tsx:273-280`), and many mutations surface failures only in the console. |
| Grocery | Initial listener spinner | None | **FAIL:** `onSnapshot` has no error callback, so permissions/network failure can leave loading true (`app/grocery/page.tsx:144-153`). Add, cleanup, cleanup-apply, and grocery-from-plan failures are console-only (`:245-319,350-425`; `app/plan/page.tsx:443-509`). |
| Nutrition | Loader and stale-MFP banner | None for primary read | **PARTIAL/FAIL:** sequence guards prevent stale day writes, but a rejected primary refresh is only logged and the page stamps the day as loaded with old/empty data (`app/nutrition/page.tsx:119-157`). Supplemental health metrics intentionally degrade to empty (`lib/healthMetrics.ts:33-46`). |
| Queue | Initial spinner | None | **FAIL:** `loadQueue` lacks `try/catch/finally`, so read failure leaves the loader (`app/queue/page.tsx:272-280`). Bookmarklet ingest logs server errors without showing the user (`:282-315`). |

No custom App Router error/loading boundary files were found, so unexpected render exceptions fall to framework defaults rather than a branded retry surface.

### 3.2 AppDataProvider

- **PASS — one-fetch context refactor is coherent.** Recipes are global and fetched once; meta, favorites, and cooking history react to the authenticated uid (`components/AppDataProvider.tsx:54-77,79-103,105-175`). Consumers use the provider; no active component uses a competing favorites subscription. The manual-refetch model is consistently applied by `toggleFavorite` (`:131-151`).
- **Known safe race remains.** A click before favorites load uses the initial empty `Set`, so an already-favorited recipe can receive an extra `setDoc`; the deterministic doc ID makes this idempotent (`components/AppDataProvider.tsx:106-151`; `lib/userdata.ts:30-47`). It does not remove data.
- **FIXED — low-severity Favorites stale state.** Favorites state now records its owning uid (or anonymous owner), so a prior uid's set is hidden synchronously when identity changes. Sign-out always installs either the parsed `mea-favorites` set or an empty set, and request identity guards prevent an older authenticated fetch from restoring stale data. Independent `mea_favorites_*` filter preferences are untouched (`components/AppDataProvider.tsx`; `tests/favoritesAuthState.test.tsx`).
- **Performance note.** The provider value is not memoized, so any slice change rerenders all context consumers. At the present 216-recipe scale this is not a release blocker.

### 3.3 Forms and user-facing failures

- Recipe note and delete paths show errors (`app/recipes/[id]/page.tsx:111-125,174-186`), and grocery manual add requires a non-empty name (`app/grocery/page.tsx:350-356`).
- Several optimistic/best-effort writes silently preserve local intent even when persistence fails: servings and shared default role (`app/recipes/[id]/page.tsx:128-170`). The UI can therefore claim a value that disappears on reload.
- Recipe card add-to-plan resets its spinner in `finally` but exposes failure only via console (`components/RecipeCard.tsx:128-145`). Recipe detail lacks even the `finally` (`app/recipes/[id]/page.tsx:148-156`).

## 4. Integrations Audit Findings

### 4.1 AI via Vercel AI Gateway

- **PASS — model/provider migration is complete in active code.** `AI_PROVIDER='vercel-ai-gateway'` and `AI_MODEL='openai/gpt-5.6-luna'` are centralized (`lib/aiConfig.ts:3-19`). All text/object/array calls use `gateway(AI_MODEL)` and attach feature/user metadata (`lib/ai.ts:49-85`). Active callers are recipe assistant, AI ingest/generation, new suggestions, plan suggestions, recommendations, grocery cleanup, and nutrition AI fallback. No Gemini package, key, model name, or direct alternate-provider call was found under `app/`, `lib/`, `.env.example`, or `package.json`.
- **PASS — output parsing is schema-first.** The current AI SDK implementation uses `generateText` plus `Output.object/array`, not free-form JSON parsing (`lib/ai.ts:60-85`). Usage tokens are logged with provider/model/prompt metadata (`:37-46`).
- **FAIL — category prompts drift.** Ingest and suggestions instruct the model to emit `Pasta Noodles & Rice`, `Soups Stews & Chili`, and `Breakfast Snacks & Sides` without the commas used by UI/type values and omit standalone `Sides` (`app/api/ai-ingest/route.ts:20-42`; `app/api/new-recipe-suggestions/route.ts:21-44`; `app/api/plan-suggestions/route.ts:71-93`). Live data contains those exact punctuation-stripped values, showing the mismatch is consequential.

### 4.2 USDA FoodData Central and canonical staples

- **PASS — key and ordering.** `USDA_API_KEY` remains server-only (`lib/nutritionEngine.ts:579-583`). Resolution is canonical table first (`:689-709`), then validated live USDA search (`:711-725`), then AI estimate (`:727-731`). Canonical hits directly use verified per-100g macros and skip fuzzy lookup.
- **PASS with clarification — table count.** The verification seed list has 123 candidates, but the generated live table contains 122 entries because `rice vinegar` failed the SR Legacy/Foundation candidate constraints (`scripts/canonical-verify-log.json:1-6,1838-1850`; `lib/canonicalStaples.ts:1-16,42+`). PRD correctly calls it “122 live-verified entries” (`PRD.md:685`). Calling it a 123-entry table is inaccurate; it is a 123-seed verification set producing a 122-entry table.
- **FIXED — M-07 failure observability.** USDA search and selected-food detail paths now emit structured `[nutrition-usda]` server events for missing configuration, non-OK HTTP responses, fetch/network failures, timeouts/aborts, malformed JSON, and structurally unusable success responses (`lib/nutritionEngine.ts`). Events carry stable codes and safe operation/status/data-type/query-preview/fdcId/fallback context without keys, credential-bearing URLs, response bodies, bearer tokens, or complete recipes. Valid zero results and semantic candidate rejection emit no failure event. The existing retry and canonical → USDA → AI behavior is unchanged and covered by focused tests (`tests/nutritionEngine.test.ts`).

### 4.3 Firebase client/auth/offline behavior

- Firebase app/auth/firestore are singleton-initialized, with guarded local emulator connections (`lib/firebase.ts:1-30`). Client API callers obtain `user.getIdToken()`, allowing the Firebase SDK to refresh an expiring token. Server verification is correct (`lib/firebaseAdmin.ts:22-32`).
- No persistent Firestore offline cache is configured (`lib/firebase.ts:14-17`). Snapshot listeners reconnect, but page behavior during sustained offline/permission failure is weak because many listeners omit error callbacks.
- The actual Firebase Console rules were not exported or modified. Rule behavior was assessed from the repository’s documented manual rules (`README.md:56-74`), so Console drift remains a manual verification item.

### 4.4 Vercel deployment and observability

- CLI access succeeded for project `prj_f5PLUXXwIhiMMddPJAa8mR2GxpbT`, linked by `.vercel/project.json:1`. Production deployment `dpl_A1rr3UmTmJJzY8xRn3zfRtiA8FNQ` is Ready and serves commit `ade6e35`.
- The historical deployment build completed successfully: Next 16.3.1 compiled, TypeScript passed, and 26 static pages were generated. Its warnings included the now-resolved open-ended Node range and six moderate npm advisories; current local verification no longer reports either L-04 condition.
- `vercel logs https://mea-recipes.vercel.app --level error --since 7d --json` returned no error events. This confirms no captured error-level runtime events in that window, not that swallowed client errors did not occur.
- No `@vercel/analytics`, Speed Insights, or custom route error boundaries are installed (`package.json:17-32`; `app/layout.tsx`). AI usage logging exists (`lib/ai.ts:37-46`).

### 4.5 L-04 dependency and runtime hardening (2026-08-22)

Fresh diagnostics from the current checkout reproduced the historical audit result: `npm audit` reported six moderate advisories, all in one production dependency chain:

`firebase-admin@14.3.0` → `@google-cloud/storage@7.22.0` → `gaxios@6.7.1` / `teeny-request@9.0.0` → `uuid@9.0.1`.

The audit tool's only whole-tree remediation was the incompatible major downgrade to `firebase-admin@10.3.0`. No compatible Firebase Admin patch was available in the registry at verification time. The repository therefore adds the narrow npm override `uuid@11.1.1`; it retains CommonJS support and the existing v3/v4/v5 API used by this transitive chain. `firebase-admin` remains `14.3.0`, and the resolved production tree reports zero vulnerabilities across all severities.

The runtime contract is now explicit: Node `>=26.0.0 <27` in `package.json`, Node `26.7.0` in `.nvmrc`, and npm `11.19.0` in `package.json`'s `packageManager` field. This matches the current `@zxing/library@0.22.0` engine requirement (`>=24`) while preventing a future Node-major jump. `npm ci --ignore-scripts`, `npm ci --ignore-scripts --dry-run`, `npm audit`, dependency-tree inspection, typecheck, lint, tests, and build all passed under Node 26.7.0/npm 11.19.0. No residual L-04 advisory remains.

### 4.6 Strava and MFP

- **Strava helper cleanup resolved.** Nutrition queries `users/{uid}/healthMetrics` (`lib/healthMetrics.ts:28-46`; `app/nutrition/page.tsx:23,131-145`). The unreferenced helper that queried root `stravaActivities` and its sole-use `StravaActivity` type were deleted after repository-wide reference checks. Historical production documents were not touched.
- **MFP runtime design and documentation are aligned.** The route checks a secret, validates both diary pages before any Firestore mutation, maps columns by header, uses deterministic IDs, and commits delete+replace atomically (`app/api/cron/sync-nutrition/route.ts:119-223,294-352`). The fail-closed secret fix is H-02. README now reflects Vercel's daily 06:00 UTC schedule and the optional authenticated manual trigger (`README.md`; `vercel.json:7-11`).

## 5. Data Integrity Findings

### 5.1 Category type versus live Firestore

The live read-only catalog query returned **216 recipes and 19 distinct category strings**. The declared `Category` union contains eight values and omits standalone `Sides` (`types/recipe.ts:67-75`); `Recipe.category` itself is only `string`, so TypeScript does not enforce the union (`types/recipe.ts:30-36`). **51/216 live recipes are outside the union.** No current recipe has category `Sides`.

| Live category | Count | In declared union? |
|---|---:|---|
| Salads & Bowls | 33 | Yes |
| Chicken & Poultry | 30 | Yes |
| Vegetarian Mains | 25 | Yes |
| Soups, Stews & Chili | 19 | Yes |
| Pasta, Noodles & Rice | 18 | Yes |
| Breakfast, Snacks & Sides | 16 | Yes |
| Seafood | 12 | Yes |
| Beef & Pork | 12 | Yes |
| Chicken | 8 | No |
| Soups Stews & Chili | 8 | No; current AI prompt value |
| Soup/Stew | 7 | No |
| Beef | 5 | No |
| Pasta Noodles & Rice | 5 | No; current AI prompt value |
| Vegetarian | 4 | No |
| Pork | 4 | No |
| Breakfast Snacks & Sides | 4 | No; current AI prompt value |
| Other | 3 | No |
| Breakfast | 2 | No |
| Non-Recipe / Notes | 1 | No |

Queue editing and role mapping include `Sides` (`app/queue/page.tsx:15-19`; `lib/userdata.ts:142-154`), but search filters, add/edit modals, type union, image fallback, and all relevant AI prompts do not (`components/RecipeFilters.tsx:14-24`; `components/AddRecipeModal.tsx:16-20`; `components/RecipeEditModal.tsx:12-16`; `components/RecipeImage.tsx:5-19`). This is still incomplete, not a first-class category implementation.

### 5.2 `nutrition_prev` 135-versus-136 discrepancy

The live read-only query returned:

- Catalog documents: **216**
- Documents with object-valued `nutrition_prev`: **135**
- Revert manifest entries: **136** (`batch4-apply-revert-manifest.json:1-6`)
- Manifest recipes missing from the live catalog: exactly one — ID `193`, **1-Hour Pressure Cooker Texas-Style Chili con Carne**
- Live `nutrition_prev` documents absent from the manifest: **0**

**Verdict: resolved/explained, not a missing backup field.** The apply report recorded 136 writes (`batch4-apply-report.md:7-20`), and the sole unmatched recipe document was subsequently deleted. No data was changed during this audit.

### 5.3 Canonical dry-run parse errors

A read-only live catalog query re-applied the exact ingredient-section rules from `parseRecipeContent` (`lib/recipeContent.ts:13-42`). The count is still **15**, unchanged from the apply report (`batch4-apply-report.md:12-20`). `computeRecipeNutrition` rejects the same empty ingredient result (`lib/nutritionEngine.ts:750-758`). Affected records:

1. Bread!
2. Chicken Chickpea Salad
3. Chicken Meatballs with Peppers and Orzo
4. Chinese Chili Oil
5. Heart-Healthy Peanut Butter Protein Bars
6. HONEY SRIRACHA ROASTED BRUSSELS SPROUTS
7. `https://pinchofyum.com/chopped-thai-shrimp-salad-with-garlic-lime-dressing`
8. Intsa Punjabi Chole
9. Maple Roasted Candied Pecans
10. Peanut Butter Oat Protein Shake
11. Rising Sun - Mazcal
12. Smoothies
13. Spaghetti Carbonara
14. Speget with fake meat meatballs
15. yogurt Dill sauce

The 2026-08-22 read-only investigation reproduced all 15 at the same boundary: `parseRecipeContent`
returns no ingredients and `computeRecipeNutrition` throws before `parseIngredientList`, quantities,
canonical matching, USDA, or AI. Root causes are 7 recipe document/content defects and 8 section-extraction
failures. Three records support narrow decorated/qualified-heading parser changes; 12 require reviewed shared
recipe-data correction, with no overlap. Remediation remains pending; see
`docs/audits/m04-ingredient-parse-investigation-2026-08-22.md`. No recipe or nutrition data was changed.

**Prompt 4A validation (2026-08-22):** the narrow parser remediation now recognizes bounded leading
pictographic decoration and one bounded ingredient-heading qualifier while retaining exact anchored
heading grammar. The same read-only 15-ID rerun now returns ingredients for exactly Heart-Healthy Peanut
Butter Protein Bars (8), Peanut Butter Oat Protein Shake (9), and Spaghetti Carbonara (6). The other 12,
including the composite `smoothies` record, still return zero ingredients for their investigated content
defects. That prospective split is superseded by the current instruction to leave `smoothies` as-is. M-04 remains open:
parser remediation is complete, recipe-data remediation and the subsequent explicit nutrition dry-run are
pending. No recipe, nutrition, `nutrition_prev`, servings, or canonical data was written.

**Prompt 4B result (2026-08-22):** exact backups preceded 9 in-place recipe-content updates and one
controlled migrate/create/delete for the malformed Thai shrimp-salad URL ID. All 10 replacements were
read back, parsed, and compared against untouched fields; nutrition remained unchanged. Maple pecans was
left untouched because no authoritative source was available. `smoothies` was also left untouched because
its three ingredient lists contain no instructions, so three complete standalone recipes cannot be produced
without invention. The dry-run-only canonical route processed the 3 Prompt 4A recoveries plus the 10 Prompt
4B repairs (13 total), returned HTTP 200 for each, and reported zero writes. USDA searches emitted operational
HTTP 400/404 events for 12 rows and multiple results have unresolved ingredients or suspicious stored-to-
proposed deltas, so none is ready for automatic apply. Nutrition has **not** been applied. M-04 remains open
for the two deferred data records and nutrition review/apply.

**Prompt 4C result (2026-08-22):** a fresh, strictly non-persistent diagnostic traced all 13 recipes
ingredient-by-ingredient and captured 59 USDA searches. It observed 23 intermittent HTML 404s and three
400s caused by unmatched `)` characters in Punjabi Chole queries. The same trace found material unresolved
ingredients and semantic mis-resolutions (including plant-based beef → real beef, edamame → teff, and
marinara → cheese ravioli). Readiness is **1 READY_FOR_APPLY / 1 REVIEW_REQUIRED / 11 BLOCKED**. The sole
allowlist entry is `honey-sriracha-roasted-brussels-sprouts`, but PATH B was selected: focused nutrition-
engine remediation and a fresh dry-run must precede any apply. Recipe and nutrition writes in Prompt 4C
were zero. See `docs/audits/m04-nutrition-apply-readiness-2026-08-22.md`.

**Prompt 4D.1 / 4E result (2026-08-22):** the nutrition-engine remediation closed the four confirmed
residual defects and the exact final readiness review classified 5 `READY_FOR_APPLY`, 0 review-required,
and 8 blocked. Prompt 4E backed up all five allowlisted documents, ran a fresh dry-run immediately before
each possible write, and applied only two recipes that still passed the safety gate:
`chicken-meatballs-with-peppers-and-orzo` and `honey-sriracha-roasted-brussels-sprouts`. Both writes were
read back and verified with unrelated fields preserved. `spaghetti-carbonara`, `chinese-chili-oil`, and
`intsa-punjabi-chole` were skipped after fresh runs exposed new material unresolved ingredients or a material
macro change. The explicit denylist comparison found zero changed non-allowlisted documents, including Maple
Pecans, `smoothies`, and all eight blocked recipes. M-04 is **resolved for the safely remediable population;
source/data-deficient recipes are explicitly deferred**. See
`docs/audits/m04-final-nutrition-apply-2026-08-22.md`.

### 5.4 Known race-condition status

- `toggleFavorite` pre-load race: **still present, safe/non-blocking** because duplicate `setDoc` uses the recipe ID (`components/AppDataProvider.tsx:110-151`; `lib/userdata.ts:30-47`).
- Plan role-default race: **still theoretically present, safe fallback** because friend-plan add looks up `recipes[recipeID]` (`app/plan/page.tsx:289-295`) while `resolveRecipeRole(undefined)` deterministically returns `main` (`lib/userdata.ts:156-175`). The actionable plan UI is rendered after the recipe-loading gate (`app/plan/page.tsx:1004-1009`), making the race unlikely.

## 6. User Flow Audits

### Flow 1 — Searching for Recipes

| Step | Verdict | Trace |
|---|---|---|
| Search input captures/clears text | **PASS** | Controlled input calls `onSearchChange` and exposes clear (`components/RecipeFilters.tsx:63-95`). |
| Catalog becomes searchable | **PASS** | `AppDataProvider` fetches global recipes once (`components/AppDataProvider.tsx:57-77`); Fuse index memoizes against the catalog (`app/recipes/page.tsx:130-139`). |
| Title matching | **PASS** for 2+ characters | `title` has weight 0.5, case-insensitive Fuse behavior, typo threshold 0.35 (`app/recipes/page.tsx:130-139`). |
| Ingredient matching | **PASS** for 2+ characters | Recipe `content`, which includes ingredients, is indexed (`app/recipes/page.tsx:130-139`; content construction `lib/queue.ts:50-72`). |
| Category matching/search | **FAIL** for full taxonomy | Category text is indexed and exact category filtering works (`app/recipes/page.tsx:134-148`), but filters omit `Sides` and all 51 legacy values (`components/RecipeFilters.tsx:14-24`). |
| Simultaneous multi-field matching | **PASS** | One Fuse query searches weighted title/cuisine/category/content together (`app/recipes/page.tsx:130-145`). |
| One-character query | **FAIL** | Search is bypassed when `search.length < 2`, so entering one character shows the unsearched catalog (`app/recipes/page.tsx:141-145`). |
| Result rendering/empty state | **PASS** for valid reads; **FAIL** on read errors | Results map to `RecipeCard` and a real zero-result state is present (`app/recipes/page.tsx:305-319`), but catalog failures use the same empty state because `recipesError` is ignored (`components/AppDataProvider.tsx:62-72`). |
| Debounce/scaling | **PASS now / future risk** | No debounce exists, but Fuse is local and the live catalog is only 216 records. All documents/content are downloaded and indexed client-side, so payload and per-keystroke work scale linearly. |

**Overall:** functional for normal 2+ character title/ingredient/category/typo searches; fails completeness and failure-reporting checks.

### Flow 2 — Adding Recipes to Plans

| Step | Verdict | Trace |
|---|---|---|
| Recipe-card action and week choice | **PASS** | Signed-in users open a five-week picker defaulted to next week (`components/RecipeCard.tsx:66-74,113-125`). |
| Recipe-detail action | **FAIL on error path** | Same next-week choice, but confirmation has no `try/catch/finally`; a failure leaves `addingToPlan=true` (`app/recipes/[id]/page.tsx:141-156`). |
| Role resolution | **PASS** | Explicit `defaultRole` wins, then category, then safe `main` fallback (`lib/userdata.ts:138-175`). `Sides` and the legacy combined category resolve to `side` (`:142-154`). |
| Firestore target | **PASS** | Write goes to `users/{uid}/pantry/root/weekPlans/{weekID}` (`lib/userdata.ts:232-246,264-291`). |
| Date/slot assignment | **PASS to current contract** | Add creates `{day:null, role}` — explicitly Unscheduled; `slot` is reserved and not written (`lib/userdata.ts:117-129,264-289`). Day is assigned later by picker/drag (`:350-378`; `app/plan/page.tsx:415-440`). |
| Duplicate handling | **PASS** | Existing recipe IDs in either legacy string or object shape cause an idempotent no-op, preserving day/role (`lib/userdata.ts:260-291`). |
| Concurrent additions | **FAIL** | Non-transactional read-modify-write can lose one of two simultaneous distinct additions (`lib/userdata.ts:270-290`). |
| Plan page reflects addition | **PASS** | `onSnapshot` subscription updates `plan`, and normalized entries render in day/Unscheduled buckets (`app/plan/page.tsx:265-270,297-318`; `lib/userdata.ts:181-229`). |
| User-visible failure | **FAIL** | Card logs failure only (`components/RecipeCard.tsx:128-145`); detail can stick; plan mutations largely have no toast/error state. |

**Overall:** the normal path passes, including idempotency and safe role fallback; concurrency and failure UX require work before broadening beyond one user/device.

### Flow 3 — Adding Ingredients to the Grocery List

#### 3(a) From a meal plan

| Step | Verdict | Trace |
|---|---|---|
| UI action | **PASS** | Per-recipe and bulk actions call the same ingredient writer; rebuild has a destructive confirmation (`app/plan/page.tsx:443-509,990-1027`). |
| Effective recipe content | **PASS** | User override wins over shared content, then `parseRecipeContent` extracts ingredients (`app/plan/page.tsx:452-457,496-499`; `lib/recipeContent.ts:13-42`). |
| Parser failure handling | **FAIL for 15 records** | Empty ingredients only produce a console warning and a successful-looking completion (`app/plan/page.tsx:453-459`). Live data has 15 such recipes. |
| Duplicate detection | **PASS, deliberately conservative** | Existing non-manual items are indexed by exact normalized noun; manual items never merge into recipe items (`lib/userdata.ts:629-656`). Normalization lowercases and strips punctuation/articles but retains modifiers (`lib/ingredientParser.ts:139-151`). |
| Case sensitivity | **PASS** | `normalizeNoun` lowercases (`lib/ingredientParser.ts:144-150`). |
| Singular/plural | **FAIL** | There is no inflection normalization; `tomato` and `tomatoes` remain separate (`lib/ingredientParser.ts:139-151`). |
| Repeated recipe | **PASS** | `sourceRecipeIDs` prevents the same recipe from contributing twice (`lib/userdata.ts:670-688`). |
| Quantity aggregation | **PASS without silent overwrite** | Compatible canonical unit groups and numeric quantities sum; incompatible/range/compound values are retained side-by-side with `+` (`lib/ingredientParser.ts:192-225`; `lib/userdata.ts:675-687`). |
| Firestore write | **PASS** | Batch updates/creates uid-scoped grocery docs and tracks recipe sources (`lib/userdata.ts:648-710`). |
| UI update/error | **PASS update / FAIL error** | Grocery snapshot reflects writes (`app/grocery/page.tsx:144-153`), but plan handlers log failures without a user-visible retry (`app/plan/page.tsx:443-509`). |

#### 3(b) Manual grocery-page entry

| Step | Verdict | Trace |
|---|---|---|
| Required input validation | **PASS** | Empty/whitespace item names cannot submit (`app/grocery/page.tsx:350-356`). |
| Parsing | **PASS with safe fallback** | Deterministic parser runs first; only low-confidence lines call the auth-gated AI single-line parser; unusable AI output preserves the typed line (`app/grocery/page.tsx:321-369`; `app/api/grocery-cleanup/route.ts:109-151`). |
| Explicit fields | **PASS** | User-entered quantity/unit override inferred values (`app/grocery/page.tsx:358-369`). |
| Duplicate detection | **PASS for exact manual nouns only** | Matching is case-insensitive through `normalizeNoun`, but intentionally never crosses into recipe-sourced items (`app/grocery/page.tsx:371-391`). |
| Singular/plural/fuzzy matching | **FAIL by design** | Exact noun comparison keeps `tomato` and `tomatoes` separate; safer than false merge but produces duplicates (`lib/ingredientParser.ts:139-151`). |
| Quantity aggregation | **PASS** | Reuses `mergeQuantities`; compatible numeric units sum and incompatible values are preserved (`app/grocery/page.tsx:380-390`; `lib/ingredientParser.ts:192-225`). |
| Firestore write | **PASS** | A uid-scoped manual item is created with timestamped ID and metadata (`app/grocery/page.tsx:393-407`). |
| UI update/error | **PASS update / FAIL error** | Snapshot closes the loop, but failures are console-only (`app/grocery/page.tsx:144-153,414-425`). |

**Overall:** neither entry path overwrites incompatible quantities, and both are uid-scoped. The deliberate manual-versus-recipe split protects rebuild semantics but permits visible cross-source duplicates; plural handling is the smallest clear dedup gap.

### Flow 4 — AI Grocery List Cleanup

| Step | Verdict | Trace |
|---|---|---|
| User action/auth | **PASS** | Client sends the full indexed list with Firebase bearer token; server rejects missing/invalid auth (`app/grocery/page.tsx:245-263`; `app/api/grocery-cleanup/route.ts:29-34`). Production unauthenticated probe returned 401. |
| Prompt authority | **PASS with narrow removal permission** | Prompt permits merge/normalize and `remove` only for clearly non-grocery instruction text such as “ON THE STOVE” (`app/api/grocery-cleanup/route.ts:47-82`). It explicitly requires one survivor and forbids its index in `mergedWith` (`:75-80`). |
| Output schema | **PASS** | Zod requires integer indices, known actions, strings, and an integer merge list; malformed/truncated output returns 500, not a partial write (`app/api/grocery-cleanup/route.ts:13-27,84-95`). |
| Sparse-response preservation | **PASS** | Route returns only changes; items absent from the AI response are untouched because the client updates/deletes only accepted rows (`app/api/grocery-cleanup/route.ts:58-60,101-103`; `app/grocery/page.tsx:269-309`). |
| Deterministic removal guard | **PASS** | Removal is accepted only when the original item matches anchored section/header patterns (`lib/groceryCleanup.ts:69-71,174-185`). Real grocery items cannot be removed merely because the model says so. |
| Deterministic merge guard | **FAIL for a residual edge** | Indices/self-links are validated and reciprocal components collapse to one survivor (`lib/groceryCleanup.ts:107-171`), but ignored words include `ground`, `dried`, `frozen`, `cooked`, `whole`, and size modifiers (`:20-27`), then subset token matching approves the merge (`:51-67`). `ground beef` vs `beef tenderloin` therefore passes the lexical guard. |
| User confirmation | **PASS** | Suggestions render as a diff, each can be rejected/restored, all can be discarded, and Apply is explicit (`app/grocery/page.tsx:703-774`). The AI response is not directly written. |
| Final write safeguard | **PASS** | Client constructs a batch, preserves all merge survivors, prevents self/reciprocal survivor deletion, and updates/deletes only accepted changes (`app/grocery/page.tsx:265-309`). |
| Failure feedback | **FAIL** | Cleanup request/apply failures are only logged (`app/grocery/page.tsx:245-263,314-318`). |

**Overall:** the reported delete-all regression is resolved in current HEAD. The remaining release-quality concern is false-positive deduplication, not silent response truncation or unconditional replacement of the list.

## 7. AI Grocery List Cleanup — Root Cause Analysis

### 7.1 What the current AI is allowed to do

The current prompt authorizes three actions (`app/api/grocery-cleanup/route.ts:47-82`):

1. **Normalize** names/quantity/unit or correct category.
2. **Merge** only items representing the same shopper purchase, returning exactly one survivor; `mergedWith` must contain only other indices.
3. **Remove** only text that is clearly not a grocery item, exemplified by an instruction/header.

The prompt is sparse: unchanged items must not be returned (`:58-60`). That design is safe only because the server/client treat output as a patch, not as the replacement list.

### 7.2 Historical regression root cause

Git history identifies the fix commit as `a9e397f`. In its parent revision:

- The prompt said, “If merging items, include all original indices in `mergedWith`” (historical `app/api/grocery-cleanup/route.ts:74-76` at `a9e397f^`). That instruction included the intended survivor and encouraged reciprocal rows.
- The historical route reconstructed a full response and accumulated every `mergedWith` index into a deletion set (historical `app/api/grocery-cleanup/route.ts:99+` at `a9e397f^`).
- The historical client blindly added every `mergedWith` index to `toDelete` (historical `app/grocery/page.tsx:265-298` at `a9e397f^`). It did not exclude the survivor or other merge-row survivors.

Together, a self-containing or reciprocal merge could mark every member—including the survivor—for deletion. This was a deterministic parsing/application bug amplified by ambiguous prompt instructions, not simply an AI deciding to remove real groceries.

### 7.3 Current safeguards

The current implementation addresses each failure mode:

- Prompt: exactly one row/survivor, never self in `mergedWith` (`app/api/grocery-cleanup/route.ts:75-80`).
- Schema: structured AI SDK output plus Zod (`app/api/grocery-cleanup/route.ts:13-27,84-95`; `lib/ai.ts:74-85`).
- Server sanitizer: validates source/peer indices, requires lexical equivalence, converts reciprocal/overlapping rows into undirected components, and chooses one survivor (`lib/groceryCleanup.ts:107-171`).
- Removal: only anchored obvious non-grocery headers survive (`lib/groceryCleanup.ts:69-71,174-180`).
- Patch semantics: unmatched items are never reconstructed or deleted (`app/grocery/page.tsx:269-309`).
- Human control: per-change rejection plus explicit Apply (`app/grocery/page.tsx:703-774`).
- Client last-line defense: merge survivors cannot delete themselves or another survivor (`app/grocery/page.tsx:272-307`).
- Tests: self-index, reciprocal merge, unrelated peer, and real-item removal cases pass (`tests/groceryCleanup.test.ts:23-75`).

There is no list-count sanity threshold, but the review step and deterministic guards are stronger than a blunt count check: valid deduplication can legitimately reduce count, while an unchanged count does not prove semantic safety.

### 7.4 Can schema/parsing silently drop items?

**No, not in current code.** A malformed or truncated model response fails structured generation and returns HTTP 500 (`app/api/grocery-cleanup/route.ts:84-95`). A valid sparse response is sanitized and only contains patches (`:97-103`). The client applies only those patches; it does not replace Firestore from the returned array (`app/grocery/page.tsx:269-309`). Invalid indices and duplicate source rows are discarded (`lib/groceryCleanup.ts:111-116`), which leaves the corresponding original Firestore item untouched.

### 7.5 Residual root cause/risk

`areLikelySameGroceryItem` strips terms that can define a distinct product—especially `ground`, `dried`, `frozen`, `cooked`, and `whole`—then accepts when the smaller remaining token set is a subset of the larger (`lib/groceryCleanup.ts:20-27,51-67`). This is intentionally tolerant of preparation wording, but it is too permissive at the shopping-form boundary. Example:

- `ground beef` → tokens `{beef}`
- `beef tenderloin` → tokens `{beef, tenderloin}`
- `{beef}` is a subset, neither side has a conflicting `FORM_WORD`, so the merge is approved.

The model can therefore propose one line with a combined quantity and the deterministic layer will allow deletion of the other distinct cut. Conversely, no singular/plural normalization means obvious duplicates such as `tomato`/`tomatoes` can be missed.

### 7.6 Recommended correction

Do not remove the human diff. Make the merge predicate use **purchase identity**, not generic descriptor stripping:

- Treat `ground`, `whole`, `dried`, `frozen`, `fresh`, `cooked`, cut names, fat percentages, and form terms as conflict-sensitive unless both sides share them.
- Apply a small food-aware singularizer before comparison (`tomatoes→tomato`, `leaves→leaf`, exception list for `fish`, `rice`, etc.).
- Require normalized token equality after safe preparation words are removed; allow subset only for a narrow set of unit/preparation suffixes.
- Add adversarial tests for `ground beef`/`beef tenderloin`, `fresh parsley`/`dried parsley`, `whole tomatoes`/`tomato sauce`, `tomato`/`tomatoes`, and `garlic clove`/`garlic cloves`.
- Add a user-visible cleanup error and retain the proposed diff on apply failure.

This is a multi-case domain-policy change, so it was reported rather than implemented under the small-fix authority.

## 8. Fixes Applied This Session

| File | Issue | Fix summary | Verification/build status |
|---|---|---|---|
| `app/api/cron/sync-nutrition/route.ts:119-125` | Missing `CRON_SECRET` made `Bearer undefined` compare equal. | Require `cronSecret` to be non-empty before accepting the Authorization header. | **PASSED.** First post-fix build attempt hit a pre-existing stale `node_modules/firebase/node_modules/@firebase/auth` missing `undici`; npm moved the lockfile-extraneous package out of resolution, and attempt 2 passed. |
| `tests/cronAuth.test.ts:1-22` | No regression coverage for missing-secret auth. | Added a test that deletes `CRON_SECRET`, sends `Bearer undefined`, and asserts 401 JSON. | **PASSED:** final build passed; 6 test files / 16 tests passed; typecheck passed. |

No schema, data-shape, Firestore rule/index, public API contract, or production data change was made. No Firebase deployment was run.

Final verification:

- `npm run build`: **PASS** (26 pages)
- `npm test`: **PASS** (6 files, 16 tests; 1 new)
- `npm run typecheck`: **PASS**
- `npm run lint`: **PASS with 6 warnings, 0 errors** (five existing `<img>` warnings and one unused eslint-disable)
- `npm audit --omit=dev`: **6 moderate, 0 high, 0 critical**

## 9. Suggested Enhancements

### Grocery list creation and deduplication

| Enhancement | Effort | Why it matters |
|---|---|---|
| Extract a shared `prepareGroceryItem` pipeline used by plan and manual entry, with explicit policy flags for `isManual` and AI fallback. | M | Today both paths share parser/quantity helpers but duplicate orchestration (`app/grocery/page.tsx:350-425`; `lib/userdata.ts:629-710`). One pipeline reduces drift without merging manual quantities into rebuild-managed recipe items. |
| Add safe singular/plural normalization with a food exception list before exact-noun matching. | S | Removes common false duplicates such as `tomato`/`tomatoes` while preserving modifiers. This is the smallest meaningful dedup improvement. |
| Add unit conversion within compatible dimensions (tsp↔tbsp↔cup, g↔kg, oz↔lb) before summing. | M | Current canonical groups recognize compatible names but sum raw numbers without conversion if canonical group matches (`lib/ingredientParser.ts:211-220`), so `1 cup + 1 tbsp` is correctly preserved rather than summed but remains fragmented. Conversion would produce a coherent total. |
| Harden AI merge identity and expand adversarial tests as described in §7.6. | S–M | Prevents distinct products/cuts/forms from being deleted after a false merge suggestion. |
| Keep the current propose/review/apply UX; add an optional “accept all safe normalizations” filter and visible errors. | S | The requested confirmation enhancement already exists (`app/grocery/page.tsx:703-774`). Removing it would reintroduce unnecessary risk. |
| Chunk Firestore batch deletes/writes at ≤450 operations. | S | Grocery clear/rebuild/cleanup use one batch and would exceed Firestore’s 500-operation limit on a very large list (`app/grocery/page.tsx:227-243,265-309`; `lib/userdata.ts:607-616`). |

### Recipe search

| Enhancement | Effort | Why it matters |
|---|---|---|
| Normalize/fix category taxonomy first, then source filter options from one shared constant. | M | Type, filters, prompts, modals, icon mapping, and live data currently disagree. Search cannot be complete until taxonomy is canonical. |
| Apply search for one character or explicitly show a “type 2 characters” hint. | S | Current silent bypass looks broken (`app/recipes/page.tsx:141-145`). |
| Include normalized `labels`/dietary tags in Fuse keys and add multi-select dietary filters after defining a controlled tag vocabulary. | S–M | Current multi-field search is good, but dietary metadata is neither indexed nor filterable (`app/recipes/page.tsx:130-139`; `types/recipe.ts:40`). |
| Debounce 100–200ms and precompute a compact search document. | S | Lowers repeated work and avoids indexing full instruction text on every client as the catalog grows. |
| Move to server/search-service pagination only when catalog payload or latency warrants it. | L | At 216 recipes, client Fuse is appropriate and typo-tolerant. Firestore alone does not provide full-text search; premature server migration would lose functionality or require a dedicated index. |

### Release-blocker hardening

| Enhancement | Effort | Why it matters |
|---|---|---|
| Preserve the shared safe-fetch helper: HTTP(S) only, DNS/IP private-range rejection, manual redirect validation, byte/content-type limits, timeout, and Firebase authentication. | M | C-01 is closed in both URL-fetching routes. Validating only the initial hostname is insufficient because of DNS rebinding and redirects. |
| Add an Admin/custom-claim allowlist for shared catalog/API mutation and manually tighten the recipe write rule. | M | Closes H-01 at both Admin API and client rule layers. |
| Add per-route request Zod schemas, body/message limits, public error codes, and request IDs. | M | Prevents avoidable 500s, excessive model cost, and internal error leakage. |
| Add a root error boundary plus Vercel Web Analytics/Speed Insights or equivalent client error telemetry. | S | Production runtime logs cannot see swallowed browser errors. |

## 10. Known-Issue Re-Verification

- [x] **Firebase Admin v14 modular imports:** **resolved/healthy** — no active legacy namespaced import (`lib/firebaseAdmin.ts:1-19`; `scripts/_lib.js:41-69`).
- [x] **Gemini → ChatGPT/Vercel AI migration:** **resolved** — active model is `openai/gpt-5.6-luna` everywhere through the shared gateway (`lib/aiConfig.ts:3-19`; `lib/ai.ts:49-85`); no active Gemini reference found.
- [ ] **Standalone `Sides` category:** **still incomplete** — present only in queue editing/role mapping, absent from type union, filters, prompts, modals, and live data (`types/recipe.ts:67-75`; `app/queue/page.tsx:15-19`; `lib/userdata.ts:142-154`; `components/RecipeFilters.tsx:14-24`).
- [x] **`nutrition_prev` 135-vs-136:** **changed/explained** — one manifest recipe (ID 193) no longer exists; every remaining backup maps to the manifest. No missing backup on a live applied document (`batch4-apply-revert-manifest.json:1-6`; `batch4-apply-report.md:7-20`).
- [ ] **Canonical dry-run parse errors:** **parser complete / recipe data partial / nutrition apply pending** — 10/12 data records were repaired and validated; maple pecans and `smoothies` remain evidence-blocked. The 13 eligible recipes completed dry-run recomputation with zero writes, but USDA operational failures and review gates prevent automatic apply. See `docs/audits/m04-recipe-data-remediation-2026-08-22.md`.
- [ ] **`toggleFavorite` pre-load race:** **still present but safe/non-blocking** — duplicate add is an idempotent doc write (`components/AppDataProvider.tsx:110-151`; `lib/userdata.ts:30-47`).
- [ ] **Recipe role-default race:** **still theoretically present but safe/non-blocking** — undefined recipe falls back to `main`; primary UI is recipe-loading gated (`app/plan/page.tsx:289-295,1004-1009`; `lib/userdata.ts:156-175`).
- [x] **Strava permission failure on every page load:** **resolved and dead helper removed** — nutrition uses uid-scoped health metrics, and no active module queries the root collection (`lib/healthMetrics.ts:28-46`; deleted `lib/strava.ts`).
- [x] **AI grocery cleanup removes all merged items:** **resolved in current HEAD** — one-survivor server sanitizer, user-reviewed diff, and client survivor defense are present (`lib/groceryCleanup.ts:99-189`; `app/grocery/page.tsx:265-309,703-774`). Residual false-merge risk remains M-02.

## 11. Appendix

### 11.1 Audit method and evidence

- Static review of all 13 API routes, central Firebase/AI/nutrition/data helpers, and major requested pages/components.
- Read-only live Firestore Admin queries through the modular helper in `scripts/_lib.js:15-69`. Queried catalog/category/backup/content fields only; no writes.
- Read-only production HTTP probes:
  - Historical pre-remediation probe: `/api/fetch-recipe?url=https://example.com` → 200, proxied HTML (the former C-01 state; superseded by the current Firebase + safe-fetch boundary).
  - unauthenticated `POST /api/grocery-cleanup` → 401 (confirms auth gate).
- Vercel CLI inspection of the active deployment, build log, and seven-day error-level runtime log.
- Git-history comparison around grocery cleanup fix `a9e397f` to identify the historical prompt/server/client interaction.
- Local verification: build, tests, typecheck, lint, and production dependency audit.

### 11.2 Principal files reviewed

- Repository/ops: `CLAUDE.md`, `README.md`, `PRD.md`, `package.json`, `package-lock.json`, `firebase.json`, `vercel.json`, `.vercel/project.json`.
- API: every `app/api/**/route.ts`, especially `ai-ingest`, `fetch-recipe`, `grocery-cleanup`, nutrition routes, calendar push, and MFP cron.
- Core data/integration: `lib/firebase.ts`, `lib/firebaseAdmin.ts`, `lib/ai.ts`, `lib/aiConfig.ts`, `lib/nutritionEngine.ts`, `lib/canonicalStaples.ts`, `lib/recipes.ts`, `lib/userdata.ts`, `lib/queue.ts`, `lib/consumptionLog.ts`, `lib/healthMetrics.ts`, deleted legacy `lib/strava.ts`, `lib/ingredientParser.ts`, `lib/groceryCleanup.ts`, `lib/recipeContent.ts`.
- Frontend: `components/AppDataProvider.tsx`, `components/RecipeCard.tsx`, `components/RecipeFilters.tsx`, `components/AddRecipeModal.tsx`, `components/RecipeEditModal.tsx`, and requested major pages under `app/recipes`, `app/plan`, `app/grocery`, `app/nutrition`, and `app/queue`.
- Evidence/tests: `tests/groceryCleanup.test.ts`, `tests/cronAuth.test.ts`, `scripts/_lib.js`, `scripts/canonical-verify-log.json`, `batch4-apply-report.md`, `batch4-apply-revert-manifest.json`.

### 11.3 Exact rule/API follow-up for H-01

Because Firestore rules are manually managed for a shared project, **do not add this to `firebase.json` and do not run `firebase deploy`**. Review sibling-app impact, then manually adapt/paste the recipe rule in Firebase Console:

```firestore
function isRecipeAdmin() {
  return request.auth != null
    && request.auth.token.email == "folstromjohn@gmail.com"
    && request.auth.token.email_verified == true;
}

match /recipes/{recipeId} {
  allow read: if true;
  allow write: if isRecipeAdmin();
}
```

This rule does **not** protect Admin SDK routes because Admin bypasses rules. The application now uses `verifyAdminToken` (admin custom claim or verified configured email) for `nutrition-revalidate` and `nutrition-canonical-dryrun` `?apply=true` operations; future global mutation routes must use the same boundary.

No new composite index was identified as required by this audit. Existing multi-field MFP and range queries were not changed; if the Console reports an index error later, capture the exact generated specification and paste it manually after sibling-app review.

### 11.4 Explicitly out of scope / unverifiable

- Authenticated production write flows were traced statically and through existing tests but were not executed against shared production data; doing so would mutate the live catalog/plan/grocery state. The local emulator is empty by default (`README.md:89-97`) and no production export was created.
- Actual Firebase Console rules/indexes were not readable from repository state and were not deployed. Documented rules were used as evidence.
- Production secret values were not exposed. The MFP route’s successful schedule execution was not forced; only build/runtime logs and code guards were reviewed.
- The 122 committed canonical entries were not re-fetched individually from USDA during this session; the committed 2026-06-14 verification log was re-checked, and live catalog parser status was independently re-counted.
- No accessibility, cross-browser/device matrix, visual regression, load test, penetration test beyond the safe SSRF proof, or third-party billing/cost audit was performed.

### 11.5 Recommended next implementation sequence

1. Keep C-01 URL-fetch security coverage (including redirect/DNS/private-IP cases) green as safe-fetch changes.
2. Retain Admin authorization for global mutation routes and manually tighten `recipes` writes after sibling-app rule review.
3. Fix the category source of truth and AI punctuation; plan a reviewed migration for 51 legacy values and the standalone `Sides` decision.
4. Harden grocery merge identity and add adversarial regression tests; keep the current review/apply UI.
5. Convert week-plan array writers to transactions and add conflict tests.
6. **M-04 nutrition:** resolved for the safely remediable population through the Prompt 4E controlled apply; two allowlisted recipes were applied and verified, while three were skipped by the finality safety gate. Leave the eight blocked recipes, maple pecans, and `smoothies` explicitly deferred.
7. Add user-visible error/retry states and client telemetry across recipes, plan, grocery, nutrition, and queue.
8. **L-04 dependency/runtime hardening:** completed in the 2026-08-22 verification above; retain the scoped `uuid` override and Node 26.x contract until a supported Firebase Admin release removes the need for the override.

---

## 12. API Security Simplification (Prompt 6 follow-up, 2026-08-22)

**Result: PASS — no manual security action required.** The product owner chose
authentication gating instead of application rate limits. All normal API routes now
verify Firebase authentication before meaningful work; nutrition `?apply=true` paths
continue to require `verifyAdminToken`, and the cron route continues to require an exact
non-empty `CRON_SECRET`.

`/api/fetch-recipe` is no longer public: it authenticates before reading its URL or
performing DNS/fetch work. Its SSRF boundary is retained unchanged: HTTP(S) only, no URL
credentials, public-IP DNS validation and address pinning on every hop, redirect
revalidation, three redirects, eight-second deadline, and a 2 MB response limit.

The Vercel Firewall SDK integration, its five SDK rule IDs, its 429/503 behavior, and
the manual-rule instructions have been removed. No normal authenticated request depends
on Firewall configuration. Platform-level Vercel DDoS mitigation remains separate;
BotID remains unnecessary.

Payload and operation controls remain: AI raw-body/schema/semantic limits, grocery
256 KB/100-item and parse-line limits, Calendar 128 KB/primary-only/≤7 operations,
nutrition bounded pagination, barcode and lookup input limits, and sanitized errors.

### Final route matrix

| Route | Auth boundary | Payload or batch bound |
|---|---|---|
| `/api/fetch-recipe` GET | Firebase | safe-fetch 2 MB / 3 redirects |
| `/api/ai-ingest` POST | Firebase | 2 MB raw body; per-mode caps |
| `/api/grocery-cleanup` POST | Firebase | 256 KB; 100 items / 1,000-char line |
| `/api/calendar/push` POST | Firebase | 128 KB; primary only; ≤7 operations |
| `/api/new-recipe-suggestions` POST | Firebase | 256 KB; 500 strings per collection |
| `/api/plan-suggestions` POST | Firebase | 256 KB; 21 planned recipes / 500 titles |
| `/api/recommendations` POST | Firebase | 256 KB; 500 bounded entries |
| `/api/recipe-assistant` POST | Firebase | 256 KB; 40 messages / 64k history / 16k context |
| `/api/nutrition-lookup` POST | Firebase | 32 KB; bounded id/name |
| `/api/barcode-lookup` POST | Firebase | 8 KB; 6–14 digit barcode |
| `/api/nutrition-revalidate` POST | Firebase; admin for apply | limit 1–50; offset 0–10,000 |
| `/api/nutrition-canonical-dryrun` POST | Firebase; admin for apply | limit 1–50; offset 0–10,000 |
| `/api/cron/sync-nutrition` GET | Exact non-empty `CRON_SECRET` | Fixed two-day diary window |

Residual risk: authenticated or stolen-token abuse is not application-rate-limited by
product decision. SSRF protections reduce direct service access, but upstream proxy or
post-connection DNS infrastructure behavior remains outside application code.
