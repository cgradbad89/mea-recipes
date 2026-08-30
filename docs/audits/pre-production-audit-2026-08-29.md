# MEA Recipes — Comprehensive Pre-Production Audit

**Audit date:** 2026-08-29

**Repository:** `/Users/johnfolstrom/Desktop/mea-web`

**Audited revision:** `c8c8e2a91d56dc545ad16c00b200c3e7fd2260cd` (`main`, equal to the local `origin/main` tracking ref at audit start)

**Work type:** Validation / discovery only

**Production mutation:** None

**Product-code changes:** None

## 1. Executive result

**Verdict: NOT READY for broader production use. DO NOT SHIP until the P0/P1 list in §17 is closed and the live prerequisites in §16 are verified.**

The app has a strong API authentication and SSRF foundation, a clean production build, a reproducible lint pass, and a large passing test body. It is not production-ready because a normal publish flow can silently overwrite a shared recipe, shared meal plans are published without an opt-in control, several multi-system/destructive workflows can strand partial or contradictory state, abuse controls and default AI deadlines are absent, local development defaults to the shared production Firebase project, and the required full test command does not pass from repository state alone.

| Severity | Count | Meaning in this audit |
| --- | ---: | --- |
| P0 | 1 | Release blocker |
| P1 | 10 | Must fix before broader production |
| P2 | 24 | Meaningful defect/risk to schedule after blockers |
| P3 | 6 | Enhancement/polish |

Evidence labels used below:

- **DIRECTLY EXERCISED:** observed with a safe local command or signed-out local browser session.
- **STRUCTURALLY VERIFIED:** complete relevant code path inspected; unsafe write/provider action was not invoked.
- **PARTIALLY VERIFIED:** safe layer verified, but an authenticated or external/live dependency remains untested.
- **UNVERIFIED CONFIGURATION:** repository evidence cannot prove the deployed console state.

## 2. Scope, method, and starting-state gate

The audit read `PRD.md` and `CLAUDE.md` completely, inventoried the current routes, data layers, authentication initialization, Firebase client/Admin initialization, request parsing, external fetches, destructive writes, dependencies, tests, and configuration, and reconciled implementation against the PRD. Searches covered markers (`TODO`, `FIXME`, `HACK`, `XXX`), logs, dangerous HTML/eval patterns, raw fetches, bearer handling, environment access, Firestore reads/writes/deletes/batches, redirects, storage use, and external URLs/images.

At audit start:

- Branch: `main`.
- `HEAD`: `c8c8e2a91d56dc545ad16c00b200c3e7fd2260cd`.
- Local `origin/main`: same SHA; ahead/behind `0/0`. No network fetch was needed or performed.
- Preserved owner work: modified `docs/audits/cooking-mode-v10f-lite-active-object-go-no-go-2026-08-28.json`; untracked `.claude/launch.json`, `.eslintrc.json`, `firebase-debug 2.log`, `firebase-debug.log`, and `firestore-debug.log`.
- No `firestore.rules` file or middleware exists, by documented repository policy.
- Actual quality commands: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, and `npm audit --audit-level=low`.

The local browser audit used the app in a signed-out state so it could safely exercise public navigation and read-only catalog behavior without writing to the shared Firebase project. Authenticated mutation paths were code-reviewed, not invoked. This is not a full WCAG conformance audit.

## 3. Running page audit matrix

| # | Page | Route | Purpose verified | Auth/authorization | Data/continuity | UI states | Responsive/a11y | Verdict |
| ---: | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Home | `/` | Redirect | Public | No data | Redirect works | N/A | PASS |
| 2 | Recipes | `/recipes` | Catalog/search/filter/sort | Public read; writes sign-in gated | Override and scale defects | Populated state observed | Mobile controls collide; nested controls | P2 |
| 3 | Recipe detail | `/recipes/[id]` | Read/edit/plan/grocery/cook | Public read; client writes depend on live rules | Partial saves, stale references, cook divergence | Populated state observed | Cooking/modal keyboard gaps | P1 |
| 4 | Discover | `/discover` | AI generation/recommendations | Correct signed-out gate; API bearer auth | Collision, stale cache, recency logic | Signed-out state observed | No blocking layout defect observed | P0 |
| 5 | Grocery | `/grocery` | Grocery list/cleanup | Correct signed-out gate; per-uid paths | Delete-first rebuild can strand partial list | Signed-out state observed | Code-reviewed modal/error paths | P1 |
| 6 | Plan | `/plan` | Weekly plan/share/calendar | Rich signed-out gate; per-uid paths plus shared mirror | Auto-share, cook-log, calendar divergence | Signed-out state observed | Dialog/focus gaps | P1 |
| 7 | Queue | `/queue` | Review/publish imported recipe | Correct signed-out gate; per-uid queue | Collision and partial publish state | Signed-out state observed | Code-reviewed | P0 |
| 8 | Mapping Review | `/mapping-review` | Admin review queue | Server admin verification present | Admin SDK paths coherent | Signed-out denial observed | Denial is a navigation dead end | P2 |
| 9 | Mapping Detail | `/mapping-review/[recipeId]` | Admin relationship review/approval | Server admin verification present | Stale-revision approval guard present | Signed-out denial observed | Denial is a navigation dead end | P2 |
| 10 | Favorites | `/favorites` | Favorite catalog | Rich signed-out gate; per-uid path | Override mismatch; cooked load failure can hang | Signed-out state observed | Same card issue as Recipes | P2 |
| 11 | History | `/history` | Cook history/heatmap/streak | Correct signed-out gate; per-uid plan data | Streak defect; stale IDs and errors misreport | Signed-out state observed | Heatmap semantics limited | P2 |
| 12 | Insights | `/insights` | Analytics/export | Correct signed-out gate; per-uid data | Raw overrides; CSV injection/escaping issue | Signed-out state observed | Charts code-reviewed | P1 |
| 13 | Nutrition | `/nutrition` | Log/goals/insights/MFP status | Correct signed-out gate; per-uid paths | Delete/error and unconstrained estimate risks | Signed-out state observed | Large empty signed-out composition | P2 |

## 4. Page findings, in audit order

### 4.1 Home — `/`

`app/page.tsx` performs the documented redirect to `/recipes`. Direct navigation was exercised locally and landed on the catalog. No page-specific defect was found.

### 4.2 Recipes — `/recipes`

`app/recipes/page.tsx`, `components/RecipeCard.tsx`, and `components/AppDataProvider.tsx` implement the catalog, persisted controls, and public recipe read. Desktop populated rendering was coherent and local direct navigation/refresh worked. The live read-only catalog returned 237 recipes during the audit.

Findings: personal metadata overrides are not consistently applied to list search/filter/sort or card title/cuisine; a card-level `Link` contains plan buttons/popover controls; plan-add failures are console-only; and all recipes are rendered at once. At mobile width, the fixed Total-time filter visually overlaps/clips the horizontally scrolling sort controls and exposes a horizontal scrollbar. These map to CONT-010, A11Y-020, UX-021, and PERF-020.

### 4.3 Recipe detail — `/recipes/[id]`

`app/recipes/[id]/page.tsx`, `components/RecipeEditModal.tsx`, `components/CookingMode.tsx`, `lib/recipes.ts`, `lib/userdata.ts`, and `lib/consumptionLog.ts` were traced through edit, default-role, servings, delete, plan, grocery, Cooking Mode, assistant, and cook logging.

The populated page was directly exercised read-only and rendered coherently on desktop and mobile. Write behavior was not invoked. Shared default-role/servings edits and deletion are browser Firestore writes, so their authorization depends on the live rules. The edit modal saves private metadata and shared servings sequentially with no transaction or robust `finally`; shared-setting failures are often swallowed while local control state appears updated. Recipe deletion has no reference cleanup for favorites, metadata, plans, grocery items, or nutrition logs. Cooking Mode lacks a focus trap/return, uses clickable non-semantic step containers, and can be dismissed with active ephemeral state. Cook logging is a cross-document operation without atomicity and zero-fills missing nutrition. Findings: CFG-010, REL-012, CONT-011, UX-021, and A11Y-020.

### 4.4 Discover — `/discover`

`app/discover/page.tsx` and its APIs match the broad PRD purpose. Signed-out state and navigation were exercised. The generation/save mutation was not invoked.

All generated recipe saves derive the document ID from `slugify(title)` and call `setDoc` without a uniqueness precondition or overwrite confirmation; this confirms DATA-001. Local-storage recommendation/suggestion caches have no TTL or catalog revision. Recommendation code treats all-time cook counts as “recent,” breaking the long-time bucket, and title-to-recipe reconciliation can accept a substring match. Nutrition/mapping enrichments are described as non-blocking but the UI awaits them for up to roughly 90 seconds after the recipe itself has already saved. Findings: DATA-001, CONT-013, and UX-022.

### 4.5 Grocery — `/grocery`

`app/grocery/page.tsx` and `lib/userdata.ts` correctly scope paths to the supplied user ID, preserve manual items during rebuild, bound AI cleanup inputs, and chunk clear operations. Signed-out gating was exercised.

`rebuildGroceryFromPlan` captures flags, commits deletion of all derived items, then re-adds recipes sequentially and reapplies flags. Any later read/write failure leaves a partial or empty derived list. Calling pages lack a complete catch/finally state recovery for rebuild. A single recipe ingredient add uses one Firestore batch and has a latent 500-operation ceiling. Findings: DATA-011 and REL-021.

### 4.6 Plan — `/plan`

`app/plan/page.tsx`, `lib/userdata.ts`, `lib/consumptionLog.ts`, and `lib/googleCalendar.ts` were traced through plan transactions, role/day changes, shared plan publication, cooked status, grocery, suggestions, and Calendar push. The signed-out state was directly exercised.

Core week-plan writers use Firestore transactions and preserve mixed legacy/current planned-entry shapes. However, every signed-in user's current plan is automatically mirrored to `sharedWeekPlans` on change; there is no opt-in/unpublish control, while the PRD calls this surface opt-in. The shared subscription returns all allowed users, not an explicit friend set. Undoing cooked status only changes the plan and does not remove the nutrition cook log. “Just mark cooked” intentionally omits nutrition. Calendar operations occur before Firestore stores resulting event IDs, allowing duplicate events after a partial failure. Local-date-to-ISO week keys can shift in positive UTC offsets. Findings: PRIV-010, REL-012, REL-013, CONT-012, and TIME-020.

### 4.7 Queue — `/queue`

`app/queue/page.tsx` and `lib/queue.ts` implement a per-user review queue and signed-out gate. Publishing was not invoked.

Publishing uses the same collision-prone title slug as Discover. The shared recipe is persisted before mapping/nutrition completion and before queue deletion; a later failure reports publish failure even though the recipe exists, leaving a repeatable partial state. The bookmarklet hardcodes the production hostname, so preview/dev use can unexpectedly target production. Findings: DATA-001, REL-014, and OPS-021.

### 4.8 Mapping Review — `/mapping-review`

The page does not read Firestore directly. `GET /api/mapping-review/queue` uses `verifyAdminToken`, then the Admin SDK. This boundary is structurally sound. Signed-out denial was directly exercised. The client nav checks a raw email rather than the server's verified-email/custom-claim rule, so it can expose a dead link to an unverified matching email or hide it from a claim-based admin. The denial view has weak navigation continuity. Findings: AUTH-021 and CFG-010.

### 4.9 Mapping Review Detail — `/mapping-review/[recipeId]`

All detail reads and mutations pass through admin-verified API routes. Approval revalidates proposal ID and recipe revision against live state before persistence, and decisions derive the actor from the verified token. Signed-out denial was exercised; authenticated review writes were not. The same client/server admin-predicate mismatch and undeployed defense-in-depth mapping rules apply. Findings: AUTH-021 and CFG-010.

### 4.10 Favorites — `/favorites`

The page has a complete sign-in prompt and uses the per-user favorites path. It inherits the RecipeCard nested-interactive issue and override inconsistency. The asynchronous cooked-history load lacks an error path, so failure can leave the page in an indefinite loading state. Findings: CONT-010, UX-020, and A11Y-020.

### 4.11 History — `/history`

The page is per-user and signed-out gated. Its streak loop resets/advances incorrectly and can report a one-week current streak across consecutive weeks. Deleted/stale recipe IDs are counted in totals but omitted from cards, and AppData errors can be rendered as a genuine empty history. Findings: ANALYTICS-020, CONT-011, and UX-020.

### 4.12 Insights — `/insights`

The page is per-user and signed-out gated. Analytics consume raw catalog fields rather than all personal overrides and inherit cook/undo contradictions. CSV quoting does not escape embedded quotes/newlines and does not neutralize spreadsheet formula prefixes in imported/generated recipe fields. Findings: SEC-011 and CONT-010.

### 4.13 Nutrition — `/nutrition`

The signed-out route was exercised; Today, insights, food entry, goal, barcode, external lookup, delete, and MFP-state code paths were reviewed. The per-user paths are coherent and consumption entries snapshot macros, which protects historic logs from later recipe changes.

Deletion is optimistic, has no confirmation, and surfaces no persistent error. Entry/goal/servings inputs lack consistent upper bounds. Health metric permission/index failures are intentionally converted into “no data.” The shared nutrition AI schema validates numeric type but not nonnegative/plausible ranges. The MFP scraper validates both target pages before its batch write, but its fetch has no deadline/body cap and its single batch can exceed Firestore's operation limit. Findings: NUT-010, UX-020, and INT-020.

## 5. API security matrix

Every actual route/method was sent an anonymous local request with a minimal safe payload/query. All 23 method endpoints returned `401` before provider work or body-dependent side effects. The cron route returned `401` without a valid configured secret. Authenticated/provider behavior is otherwise structurally reviewed.

| Route | Method | Boundary | Input/fetch controls | Audit result |
| --- | --- | --- | --- | --- |
| `/api/ai-ingest` | POST | Firebase bearer | 2 MB bounded JSON; Zod bounds; SSRF-safe URL fetch | PASS boundary; AI timeout/rate-limit gap |
| `/api/barcode-lookup` | POST | Firebase bearer | 8 KB body; barcode validation; provider deadlines | PASS boundary |
| `/api/calendar/push` | POST | Firebase bearer + client Google token | Bounded schema; max 7 ops; primary calendar only | Auth PASS; external timeout/partial-state risk |
| `/api/cooking-step-map` | POST | Firebase bearer | Bounded body/content/arrays; structured output | PASS boundary; AI deadline depends on helper call |
| `/api/cron/sync-nutrition` | GET | Exact nonempty `CRON_SECRET` | Parse guards before write | PASS auth; MFP fetch deadline/body-cap gap |
| `/api/fetch-recipe` | GET | Firebase bearer | Shared SSRF-safe fetch, URL bounds | PASS |
| `/api/grocery-cleanup` | POST | Firebase bearer | 256 KB; ≤100 items / 1,000-char line; Zod | PASS boundary; no abuse quota |
| `/api/mapping/generate` | POST | Admin token | Bounded JSON; recipe/revision validation | PASS admin boundary |
| `/api/mapping-review/queue` | GET | Admin token | Admin SDK read; bounded queue implementation | PASS admin boundary |
| `/api/mapping-review/[recipeId]` | GET | Admin token | Server-loaded recipe/proposal | PASS admin boundary |
| `/api/mapping-review/[recipeId]/decisions` | POST | Admin token | Bounded JSON; actor server-derived | PASS admin boundary |
| `/api/mapping-review/[recipeId]/relationships` | POST | Admin token | Bounded JSON; live recipe re-parsed | PASS admin boundary |
| `/api/mapping-review/[recipeId]/relationships` | DELETE | Admin token | Bounded JSON; target validation | PASS admin boundary |
| `/api/mapping-review/[recipeId]/candidates/[candidateId]/history` | GET | Admin token | Server-known IDs | PASS admin boundary |
| `/api/mapping-review/[recipeId]/attestation` | POST | Admin token | Bounded JSON; server state | PASS admin boundary |
| `/api/mapping-review/[recipeId]/approve` | POST | Admin token | Bounded JSON; live revision conflict guard | PASS admin boundary |
| `/api/new-recipe-suggestions` | POST | Firebase bearer | 256 KB; bounded collections/strings; Zod output | PASS boundary; no abuse quota/default timeout |
| `/api/nutrition-canonical-dryrun` | POST | Bearer dry-run; admin apply | Query caps ≤50; conservative apply gate | PASS boundary; apply not exercised |
| `/api/nutrition-lookup` | POST | Firebase bearer | Bounded discriminated input; provider deadlines | PASS boundary; AI fallback range/deadline gap |
| `/api/nutrition-revalidate` | POST | Bearer dry-run; admin apply | Query caps ≤50; low-confidence filter | PASS boundary; apply not exercised |
| `/api/plan-suggestions` | POST | Firebase bearer | 256 KB; bounded plans/catalog; Zod output | PASS boundary; no abuse quota/default timeout |
| `/api/recipe-assistant` | POST | Firebase bearer | 256 KB; history/context caps | PASS boundary; no abuse quota/default timeout |
| `/api/recommendations` | POST | Firebase bearer | 256 KB; ≤500-entry collections; Zod output | PASS boundary; semantic recency defect |

No normal application API was found without authentication. Authentication is checked before bounded body parsing/provider work. Error logging generally uses `safeErrorLogDetails`, avoiding raw exception messages and payloads.

## 6. Firestore / ownership matrix

Client path scoping is not authorization; the live Console rules remain authoritative for all browser operations.

| Collection/path | Intended ownership | Reader/writer | Structural result | Live-rule status |
| --- | --- | --- | --- | --- |
| `recipes/{id}` | Public read; admin write | Browser read/write helpers; Admin nutrition/mapping reads | Shared catalog boundary is explicit; write relies on rules | UNVERIFIED CONFIGURATION |
| `recipes/{id}/mappingProposals/{proposalId}` | Admin only | Admin SDK APIs | Server admin-gated | Documented rule not yet deployed |
| `.../mappingProposals/{proposalId}/candidates/{candidateId}` | Admin only | Admin SDK APIs | Server admin-gated | Documented rule not yet deployed |
| `.../mappingProposals/{proposalId}/reviewEvents/{eventId}` | Admin only | Admin SDK APIs | Actor server-derived | Documented rule not yet deployed |
| `.../mappingProposals/{proposalId}/completenessAttestations/{id}` | Admin only | Admin SDK APIs | Server admin-gated | Documented rule not yet deployed |
| `recipes/{id}/approvedMappings/{mapId}` | Admin only | Admin SDK APIs | Stale revision guarded | Documented rule not yet deployed |
| `recipes/{id}/cookingModeMappingPointer/current` | Admin only | Admin SDK APIs | Server controlled | Documented rule not yet deployed |
| `users/{uid}/recipes/root/favorites/{recipeID}` | User private | Browser | Caller consistently passes current uid | UNVERIFIED CONFIGURATION |
| `users/{uid}/recipes/root/meta/{recipeID}` | User private | Browser | Caller consistently passes current uid | UNVERIFIED CONFIGURATION |
| `users/{uid}/pantry/root/weekPlans/{weekID}` | User private | Browser transactions/listeners | Mixed-shape adapter is sound | UNVERIFIED CONFIGURATION |
| `users/{uid}/pantry/root/groceryItems/{id}` | User private | Browser batches/listeners | uid scoped; destructive sequence risk | UNVERIFIED CONFIGURATION |
| `users/{uid}/pantry/root/savedGroceryItems/{id}` | User private | Browser | uid scoped | UNVERIFIED CONFIGURATION |
| `users/{uid}/nutrition/root/log/{entryId}` | User private; cron for configured uid | Browser; Admin cron | uid scoped; cron exact secret | UNVERIFIED CONFIGURATION |
| `users/{uid}/nutrition/root/goals/daily` | User private | Browser | uid scoped | UNVERIFIED CONFIGURATION |
| `users/{uid}/nutrition/root/savedFoods/{foodId}` | User private | Browser | uid scoped | UNVERIFIED CONFIGURATION |
| `users/{uid}/healthMetrics/{date}` | User private; written by sibling app | Browser read | uid scoped; errors fail open to empty data | UNVERIFIED CONFIGURATION/index |
| `users/{uid}/recipeQueue/{id}` | User private | Browser | uid scoped | UNVERIFIED CONFIGURATION |
| `sharedWeekPlans/{weekID}/users/{uid}` | Cross-user shared | Browser | Own write; collection-wide read; no app friend ACL | UNVERIFIED CONFIGURATION; privacy behavior confirmed in code |
| `stravaActivities/{id}` | Legacy/sibling data | No active MEA path found | No active audit impact | Out of scope/live unverified |

No versioned index or rules artifact exists. That is intentional for the shared `malignant-metro` project, but it makes Console verification a hard release prerequisite.

## 7. Authentication assessment

- `verifyAuthToken` verifies Firebase ID tokens server-side. `verifyAdminToken` requires either an admin custom claim or the configured exact email with `email_verified === true`. This is a strong server boundary.
- All 23 actual API methods reject anonymous calls before provider work.
- Browser Firestore writes are not protected by UI hiding; they require correct live rules, which were not inferred or tested.
- Client-only admin visibility uses raw email equality and does not match the verified-email/custom-claim server predicate (AUTH-021).
- `AuthContext.signIn` catches/logs sign-in errors instead of propagating them to page controls, so popup/provider failures can appear inert (UX-020).
- Email/password provider enablement, authorized domains, Google provider/scopes, and account linking require Console verification.
- No signup flow is present; that matches the current single-owner intent but needs an explicit onboarding decision before “broader production.”

## 8. External integration assessment

| Integration | What was verified | Risk/status |
| --- | --- | --- |
| Firebase Auth/Firestore/Admin | Initialization and token verification inspected; anonymous API rejection exercised | Live rules/providers/domains/indexes are unverified; local dev defaults to production |
| Vercel AI Gateway | Centralized helper/model/provenance; structured Zod outputs | No app-level quota/rate limit and most calls lack a default deadline |
| USDA FoodData Central | API key boundary, 10s fetch deadlines, candidate validation, canonical table | Live key/quota/availability unverified; sequential recipe lookups can exceed client wait |
| Open Food Facts | Barcode normalization, courtesy User-Agent, 10s deadline | Live availability/data quality unverified |
| Google Calendar | Client token, primary-calendar-only, ≤7 explicit ops, no token storage/list/search | API/scope unverified; operations precede durable idempotency record |
| MyFitnessPal | Exact cron secret, pre-write two-page validation, header-name mapping, atomic batch | Fragile HTML dependency; no fetch deadline/body cap; session/cron live health unverified |
| External recipe hosts | Shared DNS/IP/redirect/body/deadline SSRF boundary | Paywalls unsupported by design; live host variance unverified |
| External image hosts | Plain browser `<img>` with fallback behavior | Arbitrary host privacy/performance; no referrer policy or image proxy/optimization |
| Vercel Analytics/Speed Insights | Packages and root integration present | Live project ingestion/dashboards unverified |
| Apple Health sibling data | Range query is user-scoped | Missing permission/index is hidden as zero supplemental data |

## 9. Security findings (P0 → P3)

Each row includes file/symbol, evidence, expected behavior, consequence, verification, remediation direction, UI impact, and owner/config needs.

| ID / severity / type | Affected surface and exact code | Evidence, expected behavior, consequence | Verification | Remediation direction / UI / owner action |
| --- | --- | --- | --- | --- |
| **DATA-001 / P0 / confirmed destructive defect** | Discover and Queue publish; `app/discover/page.tsx`, `app/queue/page.tsx`, `lib/recipes.ts::saveRecipe` | Title slug becomes the shared document ID and `setDoc` writes without create-only precondition, uniqueness check, version check, or warning. Generating/publishing the same normalized title overwrites the existing shared recipe. Expected: never silently replace a catalog item. Consequence: direct shared-data loss and downstream semantic drift. | STRUCTURALLY VERIFIED; write not invoked | Use generated immutable IDs or a server/admin create transaction with explicit collision handling/versioning and an overwrite confirmation UI. Owner must plan migration/legacy ID compatibility. |
| **SEC-010 / P1 / confirmed abuse risk** | All AI-backed APIs; `lib/ai.ts`, standard AI route handlers | A valid token can make unbounded repeated paid AI calls; no per-user/IP quota, concurrency guard, or rate limit exists. Most helper calls provide no default timeout. Expected: bounded cost and response lifetime. Consequence: compromised account/token or accidental retry can create spend and resource exhaustion. | STRUCTURALLY VERIFIED | Add centralized per-uid quotas/rate limiting, concurrency control, retry policy, and a default deadline propagated to all providers. No major design change; UI should show retry/deadline states. Owner selects limits/monitoring. |
| **SEC-011 / P1 / confirmed export injection defect** | Insights CSV; `app/insights/page.tsx` export handler | Imported/generated titles/cuisine can start with spreadsheet formulas; export neither neutralizes formula prefixes nor correctly doubles embedded quotes/newlines. Expected: standards-compliant inert CSV. Consequence: opening an export in spreadsheet software can evaluate attacker-controlled cells or corrupt rows. | STRUCTURALLY VERIFIED | RFC 4180 escaping plus formula neutralization; add hostile-field tests and brief export notice if needed. UI impact low. |
| **CFG-010 / P1 / unverified prerequisite + documentation drift** | All browser Firestore paths; PRD Firestore-rules section; `README.md` rules example; mapping subcollections | The authoritative rules are Console-only. PRD explicitly says mapping defense-in-depth rules are not deployed. README's example permits broad signed-in shared recipe writes, conflicting with the required verified-admin rule. Expected: proven least-privilege live rules for every path. Consequence: cross-user exposure or broken writes cannot be ruled out before launch. | UNVERIFIED CONFIGURATION; documentation conflict directly verified | Owner must inspect/publish one reviewed shared-project ruleset in Console and test it against the emulator or rules playground without deploying from this repo. Correct README separately. UI impact none. |
| **PRIV-010 / P1 / confirmed privacy defect** | Plan sharing; `app/plan/page.tsx` publication effect, `lib/userdata.ts::publishSharedPlan/subscribeSharedWeekPlans` | A signed-in user's week plan, name, photo, and recipe IDs are automatically mirrored on plan changes. No opt-in/unpublish control exists; readers receive every allowed user's plan rather than an explicit friend set. PRD calls sharing opt-in. Expected: informed opt-in and defined audience. Consequence: unexpected cross-user disclosure. | STRUCTURALLY VERIFIED; no write invoked | Default private, add explicit share/unshare state and audience semantics, delete existing mirror when disabled, and enforce it in rules/server design. Requires UI and owner privacy decision. |
| **OPS-010 / P1 / confirmed operational safety risk** | Local Firebase initialization; `lib/firebase.ts`, README dev setup | Normal `npm run dev` connects to shared production unless an emulator variable is set. The app logs a warning but does not fail closed. Expected: local mutation work defaults to emulator or requires explicit production acknowledgement. Consequence: accidental production data mutation during development/testing. | DIRECTLY OBSERVED in local dev logging; no writes made | Make emulator/local isolation the default and require an explicit, unmistakable override for production. Add seeded safe test data. Owner must align team workflow. |
| **SEC-020 / P2 / hardening gap** | Whole app; `next.config.js` | No repository-defined CSP, `frame-ancestors`, `X-Content-Type-Options`, referrer policy, or permissions policy. Expected: browser hardening appropriate to external images and authenticated app. Consequence: reduced defense in depth; live platform headers are unknown. | STRUCTURALLY VERIFIED / live headers unverified | Add tested headers incrementally, especially CSP compatible with Firebase/Google and image hosts. Owner verify Vercel output. |
| **SEC-021 / P2 / privacy/performance risk** | Recipe images/source links; `components/RecipeImage.tsx`, recipe/detail/queue anchors | Arbitrary external images load directly in the browser without a proxy/allowlist/referrer policy. Legacy URLs are not revalidated at display time. Expected: controlled resource/privacy boundary. Consequence: third-party tracking, mixed quality, slow hosts; unsafe legacy link schemes remain a defensive concern. | STRUCTURALLY VERIFIED | Enforce safe HTTP(S) at persistence/read boundary, set referrer policy, and choose proxy/allowlist or explicit external-image policy. UI fallback already exists. |
| **AUTH-021 / P2 / confirmed authorization-UX mismatch** | Mapping nav/banner; `components/Navigation.tsx`, `components/HubBanner.tsx`, `lib/firebaseAdmin.ts::verifyAdminToken` | Client shows admin affordances by raw email; server additionally requires verified email or permits a custom claim. Expected: UI predicate mirrors the server result without becoming the authority. Consequence: false access affordance or hidden valid access. | STRUCTURALLY VERIFIED | Expose verified claims/role to client for presentation while retaining server enforcement. UI change required. |

No credential value was printed or copied into this report. The committed Firebase web key is a normal public Firebase client config, not proof of authorization. Active server code does not use the stale Anthropic variable name found only in an ignored local environment file. Script-only `eval` occurs in two local audit scripts, not application/runtime paths.

## 10. Continuity findings

| ID / severity / type | Affected code | Evidence, expected behavior, consequence | Verification and remediation |
| --- | --- | --- | --- |
| **REL-012 / P1 / confirmed contradictory-state defect** | `lib/consumptionLog.ts::logCookEvent`, `lib/userdata.ts::markRecipeCooked`, `app/plan/page.tsx` undo/mark-only flows | Plan add/mark and nutrition-log add are separate operations. A mid-flow failure creates partial state; undo changes only plan state, leaving History/Plan uncooked while Nutrition retains a cook event. “Just mark cooked” omits nutrition by design. Expected: one explicit state contract and recoverable idempotent workflow. | STRUCTURALLY VERIFIED. Introduce an idempotency key/operation record or server transaction where possible; define undo semantics and reconcile legacy contradictions. UI must distinguish mark-only vs log-consumption. |
| **REL-013 / P1 / confirmed cross-system reliability defect** | `app/plan/page.tsx::handleCalendarPush`, `lib/googleCalendar.ts`, `lib/userdata.ts::saveCalendarEventIds` | Calendar creates/updates/deletes finish before resulting event IDs are stored. If Firestore persistence fails, external events exist without the idempotency map and the next retry can duplicate them. Expected: resumable operation with durable intent/result. | STRUCTURALLY VERIFIED. Persist operation intent first, use deterministic extended properties/idempotency and reconciliation, and surface partial success. UI/owner Google setup affected. |
| **REL-014 / P1 / confirmed partial-publish defect** | `app/queue/page.tsx::publish`; `lib/recipes.ts` enrichments | Recipe persistence precedes enrichment and queue deletion. A later queue delete/error reports failure even though the shared recipe exists, enabling repeated publish attempts and collisions. Expected: idempotent publish state machine. | STRUCTURALLY VERIFIED. Store publish attempt/target ID and distinguish “published; cleanup pending” from failure; make retries safe. UI status change required. |
| **CONT-010 / P2 / confirmed cross-page mismatch** | `components/RecipeCard.tsx`, `app/recipes/page.tsx`, `app/favorites/page.tsx`, `app/insights/page.tsx`; compare detail effective recipe | Detail applies personal title/cuisine/content/image/time overrides, but library/favorites search/filter/sort and insights/export frequently use raw catalog fields; card only applies selected fields. Expected: one effective-recipe projection everywhere. Consequence: edits appear/disappear across pages and analytics/search disagree. | STRUCTURALLY VERIFIED. Centralize `effectiveRecipe(recipe, meta)` and use it before all presentation/search/export derivations. UI behavior changes to become consistent. |
| **CONT-011 / P2 / confirmed stale-reference defect** | `lib/recipes.ts::deleteRecipe`; Favorites/Plan/History/Insights/Grocery consumers | Shared recipe delete has no cascade/tombstone/reference validation. History counts IDs that no longer render; plan/grocery silently skip missing recipes; favorites/meta remain. Expected: deliberate referential policy. | STRUCTURALLY VERIFIED. Prefer soft delete/tombstone plus background/reference cleanup and visible missing-item state. Owner retention decision + UI needed. |
| **CONT-012 / P2 / confirmed semantic mismatch** | Plan, History, Nutrition | The product has at least two meanings for cooked: plan status and nutrition consumption. Current labels/actions do not clearly distinguish them, producing legitimate divergent records even without a failure. | STRUCTURALLY VERIFIED. Define canonical domain events and name separate actions explicitly; provide reconciliation/history provenance. |
| **CONT-013 / P2 / confirmed recommendation defect** | `app/discover/page.tsx`, `app/api/recommendations/route.ts` | All-time cook counts are labeled/used as recent IDs, excluding every ever-cooked recipe from “not cooked recently”; “recentTitles” is also sourced from most-cooked data. Title substring fallback can resolve the wrong recipe. | STRUCTURALLY VERIFIED. Send dated events/true recency and IDs; eliminate substring identity fallback. User-visible recommendation quality changes. |
| **TIME-020 / P2 / latent timezone defect** | `lib/userdata.ts::weekIDFromDate` | The function mutates a local date then uses UTC `toISOString()`. In positive UTC offsets the calendar date can shift. Expected: local Monday key independent of offset. | CODE-REVIEWED latent risk. Format local year/month/day or use a timezone-safe date library/test matrix. |
| **ANALYTICS-020 / P2 / confirmed analytics defect** | `app/history/page.tsx` streak calculation | Consecutive-week iteration does not increment correctly after the first week, so the current streak can remain one. Expected: consecutive Monday-week count. | STRUCTURALLY VERIFIED. Replace with a tested consecutive-key calculation, including year boundary/timezone cases. |

## 11. Reliability / destructive-operation findings

| ID / severity / type | Affected code | Evidence, expected behavior, consequence | Verification and remediation |
| --- | --- | --- | --- |
| **DATA-011 / P1 / confirmed destructive reliability defect** | `lib/userdata.ts::rebuildGroceryFromPlan`; callers in Grocery/Plan | Deletes all nonmanual derived items in committed batches before sequential recipe reads/adds and flag reapply. Failure after deletion leaves partial/empty data. Expected: old list survives until a complete replacement is ready. | STRUCTURALLY VERIFIED; operation not invoked. Compute replacement first, then bounded atomic swap/versioned generation; preserve/recover flags; expose failure. |
| **REL-021 / P2 / latent batch/partial-state risk** | `lib/userdata.ts` grocery add/clear helpers | A large single recipe can exceed one 500-op batch; multi-batch clears can partially complete. Expected: explicit batch limits and resumable status. | CODE-REVIEWED. Reuse chunked batch helper, cap parsed items, and report partial completion. |
| **REL-022 / P2 / confirmed partial-save defect** | `components/RecipeEditModal.tsx` | Private metadata and shared servings save/reset sequentially without transaction or reliable catch/finally. Failure can leave one side updated and the modal stuck or misleading. | STRUCTURALLY VERIFIED. Separate scopes visibly or implement compensating/idempotent saves; always clear pending state and show exact partial outcome. |
| **UX-020 / P2 / confirmed failure-state defect** | `lib/AuthContext.tsx`, Favorites cooked load, History/Insights AppData errors, Nutrition delete/health state | Several errors are logged/swallowed and then shown as loading, empty, or success-like state. Expected: error is distinguishable from empty and retryable. | STRUCTURALLY VERIFIED. Standardize async state/result handling, retry affordances, and non-destructive optimistic rollback. |
| **UX-021 / P2 / confirmed misleading mutation state** | Recipe default role/servings, RecipeCard plan add, plan grocery/friend add, clipboard | Failures are console-only; some controls retain optimistic values. Expected: visible success only after persistence or clearly labeled optimistic state. | STRUCTURALLY VERIFIED. Use shared toast/inline error and rollback; add tests for permission/network failures. |
| **UX-022 / P2 / confirmed long-running-state mismatch** | Discover/Queue save flows; `lib/recipes.ts` enrichments | Mapping/nutrition are described as non-blocking, but UI waits up to ~90 seconds after recipe save. Expected: publish completes promptly and enrichment progresses independently. | STRUCTURALLY VERIFIED. Return saved state immediately, persist enrichment status, and show retry/progress separately. |
| **INT-020 / P2 / latent MFP reliability risk** | `app/api/cron/sync-nutrition/route.ts` | MFP fetch has no timeout/body cap; a single Firestore batch can exceed 500 operations; empty `foodEntryId` can collapse document IDs; “yesterday” uses `now-24h`, which is DST-sensitive. Expected: bounded, collision-safe, calendar-correct sync. | STRUCTURALLY VERIFIED; live sync not invoked. Add fetch deadline/body cap, row/operation bounds or chunk strategy preserving replace atomicity, nonempty ID validation, and timezone calendar arithmetic. |
| **NUT-010 / P2 / confirmed data-quality risk** | `lib/nutritionEngine.ts::NUTRITION_AI_SCHEMA/aiEstimateIngredient` | AI macro fields are only `z.number()`; negative or implausibly large values pass and are accumulated/stored. Expected: finite, nonnegative, plausible bounded values with calorie/macro sanity checks. | STRUCTURALLY VERIFIED. Add range/refinement schema, reject outliers to unresolved status, record provenance, and test adversarial values. Nutrition UI should display confidence/warnings. |
| **OPS-021 / P2 / confirmed environment-targeting defect** | `app/queue/page.tsx` bookmarklet generator | The generated bookmarklet hardcodes the production hostname, so a user viewing a preview or local environment is directed to production rather than the current trusted origin. Expected: environment-correct explicit target. Consequence: confusing cross-environment auth/data behavior and accidental production queue use. | STRUCTURALLY VERIFIED. Derive a reviewed allowed origin or offer explicit environment selection; label the target in setup UI and test preview/local behavior. |

The MFP flow's most important destructive guard is strong: it fetches and validates both target dates before any Firestore delete/write and commits replacement in one batch. The nutrition revalidation/canonical routes are dry-run by default and require admin verification for `apply=true`.

## 12. Dependency and release-gate findings

| ID / severity / type | Evidence | Consequence / remediation |
| --- | --- | --- |
| **GATE-010 / P1 / confirmed release-gate failure** | `npm test` exits 1: 97 files passed, 1 failed, 1 skipped; 1,308 tests passed, 1 failed, 1 skipped (1,310 total). The sole failure, `tests/cookingModeV10DPrincipalTarget.test.js`, requires missing `/tmp/cooking-step-arbiter-v10a-2026-08-28-state.json`. The rest passes when that file is excluded. | Required repository test command is not self-contained/reproducible. Check in a stable fixture or make the external artifact an explicit separately invoked audit input. The full gate must pass before release/commit. |
| **DEP-020 / P2 / documentation/config drift** | `package.json` requires Node `24.x`; `.nvmrc` and README target Node `26.7.0`/26.x; current Node 26 emits `EBADENGINE` during clean install. | Align deployment, local version file, docs, and package engine; test exactly that runtime. |
| **DEP-021 / P2 / deprecated toolchain risk** | Clean `npm ci` succeeds but warns for deprecated `whatwg-encoding`, `node-domexception`, `glob@10.5.0`, and unsupported `eslint@9.39.5`; four install scripts are not covered by npm's allow-scripts inventory. | Triage transitive replacements and document/install-script trust. No known vulnerability is currently reported. |
| **DEP-030 / P3 / local environment hygiene** | Local `node_modules` contains 403 extraneous duplicate suffixed package directories; `npm ls --depth=0` is unhealthy. A clean temporary `npm ci` succeeds. Initial typecheck failed on duplicate generated `.next/types/* 3.ts`/`* 4.ts`, then passed after build regenerated `.next`. | Recreate local dependencies/build output outside this audit. This is local contamination, not a lockfile defect. |
| **TEST-030 / P3 / coverage enhancement** | No coverage command or threshold exists. | Add targeted coverage reporting after the failing external-fixture test is made deterministic; focus on destructive/auth/continuity flows. |

Validation results:

- `npm test` — **FAILED** as detailed in GATE-010.
- `npx vitest run --exclude tests/cookingModeV10DPrincipalTarget.test.js` — **PASSED:** 97 files passed, 1 skipped; 1,293 tests passed, 1 skipped (1,294 total).
- `npm run lint` — **PASSED:** 0 errors, 6 warnings. A clean `git archive HEAD` checkout using installed dependencies produced the same result, proving the tracked `eslint.config.mjs` is sufficient; the owner's untracked `.eslintrc.json` is not required.
- `npm run typecheck` — first run failed due local duplicate `.next` generated files; after `npm run build` regenerated `.next`, **PASSED**.
- `npm run build` — **PASSED on the first attempt** with Next.js 16.3.1; 30 static pages generated and all expected page/API routes listed.
- `npm audit --audit-level=low` — **PASSED:** 0 vulnerabilities.
- Clean temporary `npm ci` from tracked package files — **PASSED:** 796 packages, 0 vulnerabilities, with warnings recorded above.

## 13. Accessibility / responsive findings

| ID / severity / type | Evidence and consequence | Remediation |
| --- | --- | --- |
| **A11Y-020 / P2 / confirmed** | `RecipeCard` nests plan buttons/popover controls inside a link. Cooking Mode step cards are clickable non-semantic containers. Several modals/sheets lack `role="dialog"`, `aria-modal`, focus trap/return, Escape consistency, and labeled icon buttons. Keyboard/screen-reader interaction is unreliable. | Refactor card action structure, use buttons for steps, adopt one accessible dialog primitive, label stateful/icon controls, and run keyboard + screen-reader smoke tests. |
| **RESP-020 / P2 / directly observed** | At mobile width on `/recipes`, the fixed Total-time control overlaps/clips the horizontal sort row and a horizontal scrollbar is visible. | Reflow filter/sort into a wrapping row or mobile sheet; verify common 320–430px widths and zoom. |
| **A11Y-030 / P3 / enhancement** | Heatmap cells rely primarily on color/title hover and are not keyboard-focusable; chart semantics are limited. | Add textual summary/table alternative and focusable accessible labels where interactive. |
| **UX-030 / P3 / enhancement** | Signed-out experiences vary: Plan/Favorites offer full auth options, most pages rely on the global banner plus text, and mapping denial is a dead end. Nutrition leaves a large empty composition. | Standardize a compact signed-out/unauthorized empty-state component with next action and preserved navigation. |
| **A11Y-031 / P3 / enhancement** | Full WCAG color contrast, screen-reader, reduced-motion, 200% zoom, and mobile soft-keyboard behavior were not measured. | Add an owner-approved accessibility test matrix and automated axe checks; do not call this audit a conformance pass. |

Desktop and mobile catalog/detail screenshots were visually inspected; signed-out states for every auth-gated page were also inspected. No browser console errors or warnings appeared on visited routes.

## 14. Performance findings

| ID / severity / type | Evidence and consequence | Remediation |
| --- | --- | --- |
| **PERF-020 / P2 / confirmed** | `AppDataProvider` at the app shell subscribes to/fetches the entire shared recipe catalog on every page; when signed in it also loads favorites, metadata, and all week plans even where unused. Routes such as signed-out Nutrition still pay catalog read/render-context cost. | Split providers/query ownership by route, lazy-load page data, and measure Firestore read counts. |
| **PERF-021 / P2 / confirmed** | `/recipes` renders all 237 observed cards at once. Images are lazy but DOM, search, and reconciliation scale linearly. | Paginate or virtualize and retain URL/persisted filter state. |
| **PERF-022 / P2 / confirmed** | Recipe nutrition resolves ingredients sequentially; the client may time out while server/provider work continues. AI enrichments can hold publish UI for ~90s. | Add bounded concurrency, cancellation/deadline propagation, persistent jobs/status, and request-cost telemetry. |
| **PERF-030 / P3 / enhancement** | Five production components use plain `<img>` and lint warns about LCP/bandwidth. External hosts make optimization policy nontrivial. | Establish image proxy/allowlist/privacy policy, then adopt optimized responsive images where safe. |

No production load test, Firestore billing trace, Web Vitals baseline, or authenticated performance profile was run.

## 15. Documentation drift

1. **Firestore rules conflict:** PRD requires verified-admin shared recipe writes; README shows a broad signed-in write example. The Console is authoritative and unverified.
2. **Mapping rules status:** PRD explicitly says mapping defense-in-depth rules are not yet deployed; this is a manual prerequisite, not a current API authorization bypass because all current mapping access is admin API/Admin SDK.
3. **Runtime version:** `package.json` says Node 24.x; `.nvmrc`/README say Node 26/26.7.0.
4. **Environment template:** `.env.example` omits Firebase Admin variables referenced by the server setup (`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`) and abbreviates Firebase client variables rather than listing the actual names.
5. **API inventory:** the PRD table omits the actual `GET /api/cron/sync-nutrition` route while describing it elsewhere.
6. **“Non-blocking” publish enrichments:** recipe is durably saved first, but Discover/Queue UI continues awaiting enrichment and can report an overall failure after partial success.
7. **Sharing semantics:** PRD describes the sole cross-user surface as opt-in; current Plan code auto-publishes it.
8. **Known slug sharp edge remains active:** the documented title-derived ID collision still exists and is classified here as DATA-001 because current code was verified, not merely because the PRD mentions it.
9. **Tracked worktree gitlinks:** `.claude/worktrees/*` are tracked gitlinks without a `.gitmodules` contract. They do not enter the Next bundle, but fresh clone/tooling behavior is unclear and should be documented or cleaned in a separate repo-hygiene job.

No PRD correction was applied because this audit is validation-only and only the audit artifact is authorized.

## 16. Manual pre-production checklist

Only owner/console/live checks that repository evidence cannot prove are listed.

| Place to verify | Exact expected state |
| --- | --- |
| Firebase Console → Firestore Database → Rules (`malignant-metro`) | Public read/admin-only write for `recipes`; `users/{uid}/...` owner isolation; `sharedWeekPlans` explicit chosen audience/own-write policy; nutrition/health/queue paths covered; mapping subcollections admin-only. Review sibling-app impact before Publish. |
| Firebase Console → Firestore → Rules playground or dedicated emulator harness | Anonymous recipe read allowed; anonymous/user non-owner writes denied; owner private paths allowed only for matching uid; nonadmin shared recipe/mapping writes denied; verified admin behavior as intended. |
| Firebase Console → Firestore → Indexes | Nutrition date-range/order and health date queries succeed for the production data shape; no hidden index errors. |
| Firebase Console → Authentication → Sign-in method | Google enabled; Email/Password enabled only if password login/linking is intended. |
| Firebase Console → Authentication → Settings → Authorized domains | Production and intended preview domains only; no obsolete domains. |
| Firebase/GCP IAM and service accounts | Firebase Admin credential has least privilege, is current, and is available only server-side; no client bundle exposure. |
| GCP Console → APIs & Services | Google Calendar API enabled for the shared project. |
| GCP OAuth consent screen/scopes | `calendar.events` approved/configured for intended users; consent/publishing status matches audience. |
| Vercel → Project → Settings → Environment Variables | Firebase Admin variables, AI Gateway/OIDC, USDA, cron/MFP variables, and `CRON_SECRET` are present in correct environments; secrets are server-only and not stale. |
| Vercel → Cron Jobs / deployment logs | `/api/cron/sync-nutrition` runs at 06:00 UTC, receives valid cron authorization, parses both dates, and has a recent success; do not manually trigger if it could rewrite live data during audit. |
| MyFitnessPal account/session | Session cookie and username are current; diary HTML still exposes recognized `meal_header` labels and nonempty food entry IDs. Validate via a safe future canary/dry-run facility before replacement writes. |
| Vercel AI Gateway dashboard | Model access/OIDC works; spending alerts and intended per-user/request limits are configured after SEC-010 implementation. |
| USDA/Open Food Facts | Key/quota/terms and live connectivity are healthy from deployment region; observe fallback/error rate without writing nutrition. |
| Production domain response headers | Confirm deployed CSP/frame protection/nosniff/referrer/permissions/HSTS behavior after SEC-020 implementation. |
| Production browser matrix | Signed-in desktop/mobile Safari/Chrome: auth transitions, popup blocking/PWA behavior, refresh, dialogs, Calendar consent, offline/permission failures, without using destructive test data. |
| Data backup/recovery | Export/backup and restore procedure exists for shared recipes and user data before enabling broader users or changing IDs/rules. |

## 17. Must-fix-before-production

Ordered by risk and dependency:

1. **DATA-001:** eliminate silent recipe overwrite and define immutable/shared recipe identity plus migration compatibility.
2. **CFG-010:** reconcile the rules documentation, review the complete shared-project ruleset, publish it in Console, and prove owner/admin/cross-user cases.
3. **PRIV-010:** make plan sharing explicit, reversible, audience-defined, and rule-enforced; review/remove unintended existing mirrors.
4. **OPS-010:** make local development fail closed to an emulator/safe project unless production access is deliberately acknowledged.
5. **DATA-011:** replace delete-first grocery rebuild with an atomic/versioned/recoverable operation.
6. **REL-012 and REL-014:** make cook logging/undo and queue publishing idempotent, resumable state machines with truthful partial-success UI.
7. **REL-013:** make Calendar push reconcilable so Firestore persistence failure cannot create duplicate external events.
8. **SEC-010:** add centralized quotas/rate limits, concurrency limits, request deadlines, and cost/timeout telemetry to AI operations.
9. **SEC-011:** make CSV export inert and standards-compliant.
10. **GATE-010:** make `npm test` self-contained and passing; align Node runtime before the final release candidate rerun.

After these are fixed, rerun the entire audit gate and complete every live check in §16. P2/P3 work should not be relabeled as a blocker unless new evidence increases its severity.

## 18. Recommended post-audit implementation sequence

Create separate future Codex jobs with narrow root causes:

1. **Recipe identity/data-loss job:** design immutable IDs, collision-safe create semantics, overwrite UX, migration and tests.
2. **Firestore authorization job:** produce a reviewed Console change plan/test matrix for all paths; do not deploy from this repo.
3. **Plan privacy job:** add explicit sharing state/audience/unpublish and cleanup tooling with owner approval.
4. **Environment safety job:** emulator-first local startup, explicit production override, seed data, secret/config docs.
5. **Grocery reliability job:** precompute/version replacement, preserve intent, make failures recoverable, add limit/fault tests.
6. **Cook event continuity job:** define event semantics, idempotency and undo/reconciliation across Plan/History/Nutrition.
7. **Queue publish state-machine job:** durable attempt ID, truthful partial success, enrichment background status/retry.
8. **Calendar reconciliation job:** durable intent, deterministic event identity, resume/reconcile UI and fault injection tests.
9. **API abuse/resilience job:** centralized quota/rate/deadline/concurrency policy and provider/cost telemetry.
10. **Export security job:** hostile CSV fixtures and compliant escaping/neutralization.
11. **Release-tooling job:** make external-state test deterministic, align Node 24/26, clean deprecations/install-script policy.
12. **Continuity job:** central effective-recipe projection, tombstones/stale-reference UI, recommendation recency/identity, streak/timezone tests.
13. **Accessibility/responsive job:** card semantics, shared dialog primitive, mobile filter reflow, keyboard/screen-reader/zoom checks.
14. **Performance/observability job:** route-scoped data, pagination/virtualization, Firestore read and Web Vitals baselines.

## 19. Improvement / enhancement backlog

| Priority | Item | Effort |
| --- | --- | --- |
| High P2 | Standardize visible async error/empty/retry states | M |
| High P2 | Centralize effective recipe projection across list/detail/analytics/export | M |
| High P2 | Add tombstone/reference cleanup policy for deleted recipes | L |
| High P2 | Correct recommendation recency and ID reconciliation | M |
| High P2 | Validate plausible nutrition ranges and display confidence/provenance | M |
| High P2 | Fix History streak and timezone-safe week keys | S |
| High P2 | Add CSP/security/referrer/permissions headers | M |
| High P2 | Bound MFP fetch/body/operations and add safe canary/dry-run visibility | M |
| High P2 | Route-scope AppData and paginate/virtualize recipe cards | L |
| High P2 | Make post-save enrichments asynchronous and observable | L |
| Medium P2 | Repair mobile filter/sort layout | S |
| Medium P2 | Standardize dialogs, focus, Escape, icon labels, nested-control semantics | L |
| Medium P2 | Add source/image URL persistence validation and privacy policy | M |
| Medium P2 | Clarify mark-cooked vs log-consumption language | S |
| Medium P2 | Align client admin affordance with verified claims | S |
| P3 | Add accessible heatmap/chart alternatives | M |
| P3 | Standardize signed-out/unauthorized composition | S |
| P3 | Add coverage reporting/thresholds for critical flows | M |
| P3 | Adopt optimized images after host policy is defined | M |
| P3 | Resolve tracked `.claude/worktrees` gitlink hygiene | S |
| P3 | Add clipboard fallback/toast and minor control polish | S |

## 20. Things that are already strong

- Every actual normal API method requires a valid Firebase bearer token; mapping routes require verified admin authorization; cron requires an exact nonempty secret.
- Authentication occurs before request-body parsing and external provider work.
- `safeFetch` is a strong SSRF boundary: HTTP(S)-only, no embedded credentials, DNS resolution and private/special IPv4/IPv6 rejection, pinned address, redirect revalidation, 8-second total deadline, 2 MB cap, and three redirects.
- API request bodies and most arrays/strings are explicitly bounded and Zod-validated.
- AI output is structured and treated as data; no AI-controlled tools or HTML execution path was found.
- Server error logging generally uses sanitized metadata rather than raw payloads or secret-bearing exception messages.
- Admin mapping review re-derives trusted source state server-side, records the verified actor, and rejects stale approvals.
- Week-plan read/write adapters preserve mixed legacy/current planned-entry shapes and use transactions for core array changes.
- Nutrition log entries snapshot macros, preserving historical values from later recipe nutrition changes.
- USDA/Open Food Facts fetches use deadlines, matching validation, and provenance/confidence metadata.
- MFP validates both target pages and column names before any destructive replacement; session/login markup fails before writes; the replacement batch is atomic when within limits.
- Nutrition revalidation/canonical tools default to dry-run and require admin authorization for apply.
- The production build, lint, typecheck after clean generation, clean install, and dependency vulnerability audit pass.
- No runtime `dangerouslySetInnerHTML`, runtime `eval`, or unauthenticated application API route was found.
- Desktop catalog/detail visuals are coherent, routes refresh directly, and no console errors appeared in audited browser states.

## 21. Unverifiable items

- The currently deployed Firestore rules and indexes, including all sibling-app interactions.
- Firebase Auth provider enablement, authorized domains, email verification state, custom admin claim, and password-linking behavior.
- Vercel/GCP environment values, secret freshness, IAM scope, deployment runtime version, live response headers, cron execution, logs, alerts, and backups.
- Google Calendar API/scope/consent readiness and live idempotency behavior.
- Vercel AI Gateway, USDA, Open Food Facts, MFP, and external host live availability/quota/terms.
- Authenticated UI behavior and Firestore permission failures, because the only local non-emulator path targets shared production and writes were prohibited.
- Production data invariants, orphan counts, duplicate slug damage, unintended shared-plan mirrors, and nutrition outliers; no production data mutation or broad Admin read was performed.
- Full accessibility conformance, screen-reader support, contrast, zoom, soft keyboard, reduced motion, offline/PWA, and cross-browser behavior.
- Load capacity, Firestore cost/read amplification at production concurrency, Web Vitals, and provider latency distribution.
- Restore/recovery procedures and production monitoring response.

## 22. Final recommendation

MEA Recipes should remain limited to its current controlled/single-owner context. It should not be considered ready for broader production until every P0/P1 item in §17 is fixed, the complete required command suite passes from a clean checkout on one documented Node version, the live authorization/configuration checklist is signed off by the owner, and a second read-only release audit verifies the fixes under emulator or isolated non-production data.

No fixes, deployments, provider calls, Calendar actions, nutrition recomputations, queue publications, grocery rebuilds, shared-recipe edits/deletes, Firestore writes, or production data mutations were performed in this audit.
