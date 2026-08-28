# MEA Recipes — Product Requirements & Technical Reference (PRD)

> Single source of truth for domain knowledge, data model, business logic, and backlog.
> Bootstrapped from the codebase. Keep in sync with implementation changes.

---

## Section 1 — App Overview

**Purpose:** Personal recipe manager web app, part of the MEA ecosystem. MEA Recipes web
is the only supported product. The former iOS client is deprecated and is not a product,
schema, or grocery-category compatibility constraint. Historical Firestore values created
while both clients existed remain valid data for the web app.

**Intended user:** A single authenticated user (`folstromjohn@gmail.com`). The data model
is per-user isolated, but in practice the app is used by one person. Friends' published
week plans can be viewed via the `sharedWeekPlans` collection.

**Hosting:** Vercel · **Auth:** Firebase Auth — Google sign-in, plus an optional email/password
credential **linked to the same account** (Batch 7; same uid/data, no separate accounts) ·
**Database:** Firebase Firestore

### Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js (App Router) | 16.3.1 |
| Language | TypeScript | ^5 |
| Runtime | React / React DOM | 19.2.8 |
| Styling | Tailwind CSS | ^3.4.1 |
| Client SDK | firebase | 12.18.0 |
| Server SDK | firebase-admin | 14.3.0 |
| Search | fuse.js | ^7.3.0 |
| Icons | lucide-react | 0.475.0 |
| Charts | recharts | ^2.12.0 |
| Utility | clsx | ^2.1.1 |
| AI | Vercel AI Gateway (`openai/gpt-5.6-luna`) | Vercel AI SDK + `@ai-sdk/gateway` |
| Client telemetry | Vercel Analytics + Speed Insights | `@vercel/analytics` 2.x + `@vercel/speed-insights` 2.x |

### Project Identifiers

| Item | Value |
|---|---|
| GitHub repo | github.com/cgradbad89/mea-recipes |
| Firebase project ID | `malignant-metro` (from `lib/firebase.ts`) |
| Firebase auth domain | `malignant-metro.firebaseapp.com` |
| Firebase storage bucket | `malignant-metro.firebasestorage.app` |
| Vercel project ID | `prj_f5PLUXXwIhiMMddPJAa8mR2GxpbT` |
| Vercel team ID | `folstromjohn-1883s-projects` |
| Production URL | mea-recipes.vercel.app |

`vercel.json` only contains framework/build/dev/install command config — no project or team ID.

---

## Section 2 — Page Inventory

All routes live under `app/`. Every route except `/api/*` and `/` renders a client page
wrapped in a per-route `layout.tsx`.

| Page | Route | Status | Summary |
|---|---|---|---|
| Home (redirect) | `/` (`app/page.tsx`) | Done | Redirects to `/recipes`; no landing page |
| Recipe list | `/recipes` (`app/recipes/page.tsx`) | Done | Searchable/filterable grid; live count; filter persistence |
| Recipe detail | `/recipes/[id]` (`app/recipes/[id]/page.tsx`) | Done | Full recipe, parsed ingredients/instructions, notes + rating, edit, **meal-plan default main/side control**, **bulk "Add all to grocery"** (reuses `addRecipeIngredientsToGrocery`, same path as plan rebuild), full-screen Cooking Mode (`components/CookingMode.tsx`, with **tap-to-start step timers** and validated persisted `cookingStepIngredientMap` → safe deterministic fallback) |
| Discover | `/discover` (`app/discover/page.tsx`) | Done | AI recipe generator (free-text), recommendations, new-recipe suggestions |
| Grocery | `/grocery` (`app/grocery/page.tsx`) | Done | Live grocery list, category grouping, AI cleanup, persistent Usually On Hand preferences, and per-list Need This Trip overrides |
| Plan | `/plan` (`app/plan/page.tsx`) | Done | Weekly meal planner (Mon-start weeks), **day-based grid (7-col desktop / stacked mobile + Unscheduled bucket)** with auto-defaulted **main/side** role per recipe (**color-accented tiles, name below image; tap a tile → action sheet with all actions**), **desktop drag-and-drop day assignment + in-sheet day picker**, cooked tracking, AI plan suggestions, shared plans, **push week to Google Calendar (one idempotent event per planned day)** |
| Queue | `/queue` (`app/queue/page.tsx`) | Done | Review queue for AI-parsed recipes before publishing; bookmarklet setup |
| Favorites | `/favorites` (`app/favorites/page.tsx`) | Done | Grid of favorited recipes; sign-in gated; same search/filter/sort controls as `/recipes`, scoped to favorites |
| History | `/history` (`app/history/page.tsx`) | Done | Cooking history: 52-week heatmap, streaks, recent cooked weeks |
| Insights | `/insights` (`app/insights/page.tsx`) | Done | Analytics: cooked totals, avg rating, cuisine breakdown, CSV export |
| Nutrition | `/nutrition` (`app/nutrition/page.tsx`) | Done | Two tabs: **Today** (six countdown goal rings w/ floor/ceiling colour logic, meal-grouped log w/ inline edit-servings + delete, **day navigation** — back/forward arrows + "Today" jump on a `viewedDate`; back unbounded, forward past today allowed; logging while viewing another day writes to THAT day (noon-anchored via `LogFoodSheet` `logDate`); pace markers apply only to the actual current day (past=fully elapsed, future=not started); unknown/missing `meal` renders in a distinct **Uncategorized** section, never filed under Dinner) and **Insights** (`components/InsightsTab.tsx` — range selector week/month/YTD/custom, compounding goal attainment pro-rated to elapsed days via reused `GoalRing`, recharts macro-composition donut + persistent six-nutrient list, **two independent multi-select filters** (`selectedMacros: Set<'protein_g'|'carbs_g'|'fat_g'|'fiber_g'|'sugar_g'>` via donut slice / nutrient row, `selectedMeals: Set<Meal>` via Breakfast/Lunch/Dinner/Snack chips; both reset on period change, cleared together by "Clear filters") — meal selection RECOMPUTES the donut, centre calories, grams and %-of-calories from matching entries only; macro selection is highlight-only there. **Sortable all-entries table** below the chart (Name/Meal/Date + six macros) HARD-FILTERS on both: meals OR'd within the set, macros AND'd across selections (row must carry every selected macro > 0g); default sort date-desc, or sum-of-selected-macros desc while any macro is selected; all selected macro columns highlight; distinct "no entries match the selected filters" state; inline row expand w/ recipe link, 50-row pages via Show more — derived from the already-fetched `entries`, no new query. Top-level goal rings stay on the FULL period regardless of filters. **Nutrient-trend stacked bar chart** between the composition tile and the table (recharts `BarChart`): sums from the meal-filtered entries — `selectedMacros` picks the SERIES, never the entries, so the macro AND-filter does NOT apply here (deliberately unlike the table); Mode A (no macro selected) stacks protein/carbs/fat as kcal, Mode B stacks only the selected macros as grams in canonical order; bucket size from the range's actual span (≤14d daily, 15–90d weekly Mon-start, >90d monthly), every bucket in range rendered including empty ones; separate `CHART_COLORS` map (fiber lime, sugar violet) kept out of `MACRO_COLORS` because that map doubles as the energy-macro test in the nutrient list. Empty/sparse states). Dismissible **MFP-sync-stale banner** when no `source:'mfp'` entry in the last 2 days. Header hosts persistent "＋ Log food" (`LogFoodSheet`) + "Goals" (`GoalsModal`). Hand-built SVG rings (`components/GoalRing.tsx`); recharts powers the Insights donut |

### API Routes (`app/api/`)

| Route | Method | Auth | Summary |
|---|---|---|---|
| `/api/ai-ingest` | POST | Bearer token (required) | Parse a recipe from exactly one of URL/HTML/text, **or** generate a full recipe from a dish name (`generate` mode). The route validates known fields, caps the raw JSON body at 2,000,000 bytes, applies per-mode text/metadata bounds, and returns sanitized failures. URL imports still use the shared SSRF-safe fetch boundary (public HTTP(S), per-hop DNS/IP validation, 3 redirects, 8s deadline, 2 MB fetched-content cap). Calls the centrally configured Vercel AI Gateway model. |
| `/api/fetch-recipe` | GET | Bearer token (required) | Server-side fetch of a page's raw HTML + `<title>` (CORS workaround for URL import), restricted to authenticated users and the shared SSRF-safe public-URL boundary. |
| `/api/grocery-cleanup` | POST | Bearer token (required) | AI dedup/normalize/categorize a grocery list, plus the existing manual-add `parse-line` fallback. The raw body is capped at 256 KB; cleanup has ≤100 bounded items and `parse-line` is ≤1,000 characters; failures are sanitized. |
| `/api/calendar/push` | POST | Bearer token (required) | **Google Calendar push executor (Batch 6).** Body carries a **client-obtained** Google OAuth access token (`calendar.events` scope) + explicit per-day `create`/`update`/`delete` operations; it is restricted to the user's **primary** calendar and at most seven operations (one weekly plan), has no list/search capability, and never stores the token. |
| `/api/cooking-step-map` | POST | Bearer token (required) | Publish-time hybrid cooking-step mapping for exact final `{content}`. Auth and bounded parsing precede work; parsed source is capped at 64,000 content characters, 200 ingredients, 150 instructions, and 4,000 characters/line. Fully deterministic recipes make no AI call; eligible unresolved semantics make at most one centralized Gateway call. AI failure returns HTTP 200 with the valid deterministic map and sanitized status. |
| `/api/new-recipe-suggestions` | POST | Bearer token (required) | AI suggests 6 new recipes from the validated `{topCuisines,topCategories,recentTitles}` taste profile. Raw JSON is capped at 256,000 bytes; each collection is capped at 500 strings and each string at 2,000 characters; internal failures are sanitized. |
| `/api/plan-suggestions` | POST | Bearer token (required) | FlavorGraph-informed AI suggestions for a week plan. Raw JSON is capped at 256 KB; request content is bounded to ≤21 planned recipes and ≤500 existing titles. |
| `/api/recommendations` | POST | Bearer token (required) | AI 3-bucket recommendations from validated recipe, cook-count, rating, and favorite collections. Raw JSON is capped at 256,000 bytes; each collection/map is capped at 500 entries and client recipe text at 2,000 characters; scoring/bucket semantics are unchanged and internal failures are sanitized. |
| `/api/recipe-assistant` | POST | Bearer token (required) | Conversational cooking assistant for a validated single-recipe context (substitutions, scaling, dietary swaps, technique). Stateless; conversation history is passed per request and capped at 40 messages, 8,000 characters/message, and 64,000 aggregate characters; recipe context is capped at 16,000 characters and raw JSON at 256,000 bytes. Calls the centrally configured Vercel AI Gateway model and returns sanitized failures. |
| `/api/nutrition-lookup` | POST | Bearer token (required) | Shared nutrition engine (`lib/nutritionEngine.ts`). `{type:"recipe",recipeId}` computes a full `nutrition` object from the recipe's ingredients (parser → **canonical staples table (Batch 4)** → USDA with match validation → AI Gateway fallback); `{type:"food",name}` resolves a bounded food name via USDA/AI. Read-only. |
| `/api/nutrition-revalidate` | POST | Bearer token (required; admin for apply) | Re-validate low-confidence recipe nutrition by re-running the shared engine (`computeRecipeNutrition`). **DRY-RUN by default** — diffs old vs proposed per-serving/total macros, matched tier, new confidence, **without** writing; `?apply=true` requires `verifyAdminToken` and persists. Filters recipes whose estimate is low-confidence / AI-derived / assumed-servings (`servingsAssumed` OR source contains `ai`). Apply persists **only** recomputes that are no longer `low` confidence (still-low → left untouched). Bounded batches: `?limit` (default 25, max 50) + `?offset`. Engine-reuse only — no parallel estimator. |
| `/api/nutrition-canonical-dryrun` | POST | Bearer token (required; admin for apply) | Canonical-staples recompute is dry-run by default, not dry-run-only. Explicit `?apply=true` requires `verifyAdminToken` and uses the conservative canonical-hit/material-change/no-confidence-downgrade write gate, preserving `nutrition_prev`; this apply path was used for the documented Batch 4 apply. `?scope=low` restricts to `confidence==='low'`; `?recipeId=<id>` targets one; bounded `?limit`(≤50)/`?offset`. |
| `/api/barcode-lookup` | POST | Bearer token (required) | Packaged-product nutrition by barcode. `{barcode:"<UPC/EAN>"}` → cascade Open Food Facts (`source:"openfoodfacts"`, confidence medium\|low) → USDA branded by GTIN (`source:"usda_branded"`, confidence medium) → miss. Hit returns `{found,name,nutrition,serving_size,serving_grams?,servings_per_container?,source,confidence,basis}` where `basis` is `per_serving`\|`per_100g` (OFF often gives per-100g). `serving_grams?` (numeric grams in one declared serving) and `servings_per_container?` (≈ servings/pack, derived from OFF `product_quantity`/`serving_quantity` or USDA `packageWeight`) are present when derivable — they drive the servings/grams toggle and the serving-context lines in Scan. Server-side fetch sets OFF's courtesy User-Agent. Read-only. Fed by the **Scan** mode in `LogFoodSheet.tsx` (camera → BarcodeDetector or zxing fallback). |

---

## Section 3 — Data Model

Firestore collections (paths defined in `lib/userdata.ts`, `lib/queue.ts`, `lib/recipes.ts`).
All user data is keyed under `users/{uid}/…`. Some paths originated when an iOS client
shared this Firestore project, but MEA Recipes web now owns the supported data behavior.

### `recipes/{id}` — shared recipe catalog (`lib/recipes.ts`)
Doc ID = slugified title. Fields (see `types/recipe.ts` → `Recipe`):
`recipeID, title, content, category, cuisine, imageURL, sourceURL, sourceFile, labels,
hasImage, created, modified, addedBy?, prepTime?, cookTime?, cookingStepIngredientMap?, servings?, nutrition?, nutritionStatus?, defaultRole?`.
- `prepTime` and `cookTime` are the only canonical recipe-time fields. `totalTime` is never
  persisted; `getTotalTime` derives it at read time (§5.8). The 2026-08-24 catalog audit populated
  both fields for all 234 usable production recipes (including explicit `cookTime: '0 min'` for
  true no-cook recipes). Two incomplete documents remain intentionally unfilled because one is only
  a `Source:` placeholder and the other explicitly has no instructions; see
  `docs/audits/recipe-time-audit-2026-08-24.md`.
- `content` is a single freeform string; ingredients/instructions are **parsed at runtime**
  (`parseRecipeContent`), not stored as arrays.
- `cookingStepIngredientMap?` is the embedded schema-v1 publish-time map for newly created recipes
  and, where eligible, the approved existing production corpus.
  It stores parser/engine versions, the SHA-256 `sourceHash`, one result per instruction, high-confidence
  ingredient references (`ingredientIndex`, `confidence`, `provenance`, optional textual usage), and
  optional AI-validated prepared-component labels. Deterministic provenance is `deterministic`; validated
  AI provenance is `ai`. The hash binds the map to the exact ordered ingredient/instruction arrays parsed
  from the same stored `content`; it is not a substitute for the flat canonical content. `docToRecipe`
  explicitly whitelists the field. On 2026-08-26 the exact SHA-locked v4 backfill persisted this
  field on 187 originally source-eligible recipes, and the later exact SHA-locked recovered-v5 apply
  persisted approved source-bound v5 candidates on all 41 recipes repaired through Waves 1A–3.
  Production therefore contains 228 mapped recipes: the original 187 retain their reviewed v4 maps,
  the recovered 41 use deterministic-v5/hybrid-v5 maps, and the remaining eight unresolved Wave 4/5
  documents remain valid without a persisted map and use the runtime fallback.
- `category` has one canonical ordered 12-value write contract (`RECIPE_CATEGORIES` in
  `lib/recipeCategories.ts`): `Chicken & Poultry`, `Beef & Pork`, `Seafood`,
  `Vegetarian Mains`, `Pasta, Noodles & Rice`, `Salads & Bowls`, `Soups, Stews & Chili`,
  `Breakfast`, `Snacks`, `Drinks`, `Sauces & Condiments`, `Sides`. Every new shared
  recipe write must use one of these exact values. The approved 2026-08-25 exact-manifest
  migration normalized 66 records; all 236/236 production shared documents now store a
  canonical value. Readers retain deterministic aliases plus a small exact-recipe-ID map as
  defensive historical compatibility and never write normalization back.
- `addedBy` = uid of the web user who added it (used by the "Added by me" filter).
- `defaultRole?` (`'main' | 'side'`, Batch 5.1) is the recipe's explicit meal-plan role, shared on
  the dish doc. Set from the recipe-detail "Meal-plan default" control via `setRecipeDefaultRole`
  (single-field merge). On add-to-plan, `resolveRecipeRole` (`lib/userdata.ts`) resolves
  `defaultRole ?? deriveRoleFromCategory(category)`. `docToRecipe` whitelists it (else it would be
  dropped). Editing it never rewrites existing plan entries (§5.20).
- Read with an in-memory module cache (`_recipesCache`), invalidated on save/delete.
- `nutrition` (written by the nutrition backfill; see `nutrition-tracker-spec.md`) is an embedded
  object: per-serving macros `calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g`, plus
  `serving_size, servings, total{…}, source, confidence, computed_at`. `total` (whole-recipe) is
  the durable basis; per-serving = `total / servings`. Editing the **shared default** servings
  re-derives per-serving via `updateRecipeServings` (`lib/recipes.ts`) — a **deep-merge** write
  that never alters `total`. A **per-user** servings override (`meta.overrides.servings`) instead
  derives per-serving live at render as `total ÷ effectiveServings` (`effectiveServings` =
  override ?? `nutrition.servings`) **without** writing the shared doc (§5.17). `docToRecipe` must
  explicitly pass `nutrition`/`servings` through (it whitelists fields).

### `users/{uid}/recipes/root/favorites/{recipeID}` — favorites
Doc per favorited recipe; body `{ updatedAt }`. Existence = favorited.

### `users/{uid}/recipes/root/meta/{recipeID}` — notes, ratings, overrides (`RecipeMeta`)
Fields: `recipeID, note?, rating?, updatedAt?, overrides?`. `overrides` may contain
`title, cuisine, category, content, imageURL, prepTime, cookTime` (strings) and
`servings` (number) — per-user edits that shadow the shared catalog recipe without
mutating it. Doc ID is sanitized (`/`→`_`, spaces→`-`). **`overrides.servings`** is the
per-user servings override (Batch 3): when set, this user's per-serving macros derive from
the shared `nutrition.total ÷ servings`; written/cleared by `setServingsOverride` via a
deep-merge that touches only that nested field (other overrides + the shared doc untouched).
See §5.17.
Historical `overrides.category` strings remain tolerated and are canonicalized at read time
after override precedence is applied. The approved 2026-08-25 migration removed only the nested
category field from 24 redundant/legacy overrides, preserving all sibling metadata. The sole
remaining production category override is the intentional recipe `182` classification
(`Salads & Bowls` over shared `Vegetarian Mains`).

### `users/{uid}/pantry/root/weekPlans/{weekID}` — meal plans (`WeekPlan`)
`weekID` = ISO date of the **Monday** of the week (`weekIDFromDate`). Per-user (keyed per uid).
Fields: `weekID, weekStartISO, plannedRecipeIDs[], cookedRecipeIDs[], calendarEventIds?, updatedAt?`.
**`plannedRecipeIDs[]` element shape (Batch 5):** each element is a `PlannedEntry`
`{ recipeID, day: string | null, role: 'main' | 'side', slot?: string | null }`. `day` is an ISO
date inside the week, or `null` = **Unscheduled**; `role` is auto-defaulted from the recipe's
category on add and user-overridable per entry (see §5.20); `slot` is **reserved** (dinners-only —
never written today, present so a future meal-slot dimension needs no second migration). **A day may
hold multiple recipes** (e.g. a main + a side); a `recipeID` is unique within a week.
**Read-time migration (lossless, no bulk wipe):** legacy docs stored `plannedRecipeIDs` as a bare
`string[]`. `normalizePlanned`/`normalizePlannedEntry` (`lib/userdata.ts`) coerce any element — legacy
string OR object — to a full `PlannedEntry`; a legacy string becomes `{ recipeID, day: null, role: <derived
from category> }`. Old docs keep loading; each entry upgrades to the object form only when a writer
touches *that* recipe (untouched elements are left exactly as stored). **Writers are read-modify-write**
(`arrayUnion`/`arrayRemove` no longer work on object elements): `addRecipeToWeekPlan(uid,week,recipeID,role?)`,
`removeRecipeFromWeekPlan`, `moveRecipeToWeek(...,fallbackRole?)` (resets `day→null` in the target week),
`markRecipeCooked` (touches only `cookedRecipeIDs[]`), plus new `assignRecipeToDay(uid,week,recipeID,day,fallbackRole?)`
and `setPlannedRecipeRole(uid,week,recipeID,role)`. `cookedRecipeIDs[]` stays a plain `string[]` (cooked
items need neither day nor role).
**`calendarEventIds?` (Batch 6):** optional `{ [dayISO: string]: googleEventId }` map — the Google
Calendar event the app created for each pushed day. Drives idempotent re-push (present → UPDATE that
event, absent → CREATE, a stored key whose day has no recipes → DELETE then drop the key). Written
ONLY by `saveCalendarEventIds` (`lib/userdata.ts`, an `updateDoc` that replaces the whole field so
removed day-keys disappear) after an **explicit** push; the app only ever updates/deletes IDs stored
here — never a calendar search. Survives reads because WeekPlan is read as raw `snap.data()` (no field
whitelist; `normalizePlanned` only touches `plannedRecipeIDs[]`). See §5.21.

### `users/{uid}/pantry/root/groceryItems/{docId}` — grocery list (`GroceryItem`)
Fields: `id, name, quantity, unit, isChecked, isManual, sourceRecipeIDs[], manualSection?, needThisTrip?,
createdAt?, updatedAt?`. Per-user isolated (explicit comment in `userdata.ts`). `quantity`/`unit`/
`name` are populated by the shared parser at add time (see §5.16) — `name` holds the bare noun
phrase, not the whole line. Auto-added (recipe) items are keyed `sanitize(normalizedNoun)` so the
same ingredient across recipes lands on one doc (legacy `sanitize(recipeID-ingredient)` ids are
still read/merged); manual items keyed `sanitize(name)-<timestamp>`. Existing items are never
re-parsed — parsing is additive, on the add path only. New `manualSection` writes use only the
current 11-category grocery contract. Historical `Staples` and `Canned / Jarred / Sauces` values
may remain in stored documents; they are deterministically reclassified from `name` at read time
without writing the normalized category back.

### `users/{uid}/pantry/root/savedGroceryItems/{itemId}` — remembered grocery items (`SavedGroceryItem`)
Fields: `id, name, defaultCategory, timesUsed, lastUsed, usuallyOnHand?`. Frequency-ranked memory of
manually-added items + their chosen category, for faster re-entry, plus the optional persistent
per-grocery-identity `usuallyOnHand` preference. Missing/false means not usually on hand; no
backfill is required. New writes use only the current 11-category contract. Legacy `Staples` and
`Canned / Jarred / Sauces` defaults normalize from the saved item name on read and are not
automatically migrated in Firestore.

### `users/{uid}/nutrition/root/log/{entryId}` — consumption log (`ConsumptionEntry`, `lib/consumptionLog.ts`)
One doc per consumed item (auto-ID; MFP-synced docs use deterministic `mfp-{date}-{foodEntryId}` IDs). Fields: `date (Timestamp eaten), meal('breakfast'|'lunch'|'snack'|'dinner'), type('recipe'|'quick_food'|'manual'), is_cook_event, recipe_id|null, name, servings_eaten, amount_label?, nutrition{6 macros — SNAPSHOT totals = per-serving × servings_eaten}, source('recipe'|'usda'|'ai_estimate'|'manual'|'openfoodfacts'|'usda_branded'|'mfp'), created_at, userId`.
`servings_eaten` is always the multiplier on the per-basis nutrition (per serving, or per 100 g for grams-entered items); `amount_label?` (optional) records the human-readable amount as entered — e.g. `"45 g"` or `"1.5 servings"` — for the Today view. The recursive console rule `users/{uid}/nutrition/{document=**}` already covers it (no rules change).
Snapshot semantics: editing a recipe later never rewrites past entries. `is_cook_event: true`
entries (written only via `logCookEvent` — Cooking Mode finish or plan checkmark) are the only
ones tied to the plan; leftover/quick logs are `false` and never touch the plan.
Note: the spec drafted this as a top-level `consumption_log` collection; implementation follows
the existing `users/{uid}/{area}/root/*` convention instead.

### `users/{uid}/nutrition/root/goals/daily` — daily nutrition goals (`NutritionGoals`)
Single doc: the six macro targets, optional user-entered `calorie_baseline` (natural
calories burned per day before active movement), and `updated_at`. (Spec drafted
`goals/{userId}`; same convention-following relocation as the log.)

### `users/{uid}/healthMetrics/{YYYY-MM-DD}` — Apple Health daily metrics (`HealthMetric`)
Read by the nutrition app and written by the Training app/iOS sync. The nutrition app
uses the optional `move_calories` field as user-owned active calories burned; `date` is
the local-calendar `YYYY-MM-DD` key and `syncedAt` records the source sync time. The
nutrition app treats missing `move_calories` as unavailable rather than as confirmed
zero and does not write this collection.

### `users/{uid}/nutrition/root/savedFoods/{foodId}` — starred quick-foods (`SavedFood`)
Doc ID = sanitized lowercased name. Fields: `id, name, nutrition{6 macros per serving},
source('usda'|'ai_estimate'|'manual'), created_at`.

### `users/{uid}/recipeQueue/{id}` — AI parse queue (`QueuedRecipe`, `lib/queue.ts`)
Staging area for AI-parsed/generated recipes before publishing into `recipes`. Fields:
`title, cuisine, category, ingredients[], instructions[], imageURL, sourceURL, description,
servings, prepTime, cookTime, status('pending'|'published'), createdAt?`.
`buildRecipeContent()` serializes the structured fields back into the flat `content` format.
Queue category strings intentionally remain tolerant (`blank`/legacy/invalid) because this is
the review boundary, but publishing to `recipes/{id}` requires an explicit canonical category.
**`createdAt` must be a real Firestore Timestamp** (`serverTimestamp()`): `getQueue` reads with
`orderBy('createdAt', 'desc')`, so a doc written with a string — or with the field omitted — sorts
wrong or is **invisible in the queue UI entirely**. Bulk writers may add an extra `generatedBatch`
tag (a string the app ignores) so a batch can be found and deleted as a unit; see
`scripts/write-sides-batch.js`, which wrote the `sides-american-veg-2026-08` batch of 24 side dishes.

### `sharedWeekPlans/{weekID}/users/{uid}` — friends' published plans (`SharedPlanEntry`)
Fields: `uid, displayName, photoURL, plannedRecipeIDs[], updatedAt?`. The Plan page can
publish the current user's week and subscribe to other users' entries for the same week.
**`plannedRecipeIDs[]` here stays a flat `string[]`** (Batch 5): `publishSharedPlan` maps the
owner's `PlannedEntry[]` down to bare IDs via `plannedRecipeIDList`, so friends see *which* recipes
were planned but never the owner's private day/role assignments. The publish/Friends' feature is
otherwise unchanged.

### `stravaActivities/{id}` — historical/legacy synced Strava activities
One doc per Strava activity, historically synced by an external process/webhook.
Fields: `id, name, type, start_date_local (Timestamp), calories, moving_time_s`.
This root collection is not queried by active MEA Recipes code. Nutrition Today and Insights use
owner-scoped `users/{uid}/healthMetrics/{YYYY-MM-DD}.move_calories`; legacy production documents are
retained as historical data and are not modified or deleted by this app.

---

## Section 4 — Domain Invariants

1. **Shared recipe-admin identity.** `lib/admin.ts` owns `ADMIN_EMAIL` and accepts either an
   `admin === true` custom claim or the configured email with `email_verified === true`.
   `verifyAdminToken` enforces that policy on Admin-SDK global writes; the recipe-detail delete
   affordance mirrors it client-side. `HubBanner` reuses the same email constant for navigation.
2. **API authentication required.** Every normal application API route requires a valid Firebase
   Bearer token before meaningful work. Nutrition dry-runs require ordinary auth; their `apply=true`
   global-write paths require `verifyAdminToken`. Cron routes require their exact non-empty
   `CRON_SECRET`. Client Firestore writes always pass `user.uid` from `useAuth()`.
3. **Shared recipe writes require a manual Console rule.** Firestore rules are managed manually in
   the shared `malignant-metro` Firebase Console (never deployed from this repo). The required
   `recipes/{recipeId}` rule restricts writes to the verified admin email; see **Firestore rules**
   below. Admin-SDK routes bypass rules and are therefore protected separately in application code.
4. **Week identity = Monday ISO date.** All meal-plan logic keys weeks by the Monday of the
   week as `YYYY-MM-DD` (`weekIDFromDate` in `lib/userdata.ts`).
5. **Per-user data isolation.** Grocery, favorites, meta, week plans, saved items, and the
   recipe queue are all scoped to `users/{uid}/…`; users never read each other's subcollections
   (the sole cross-user surface is the opt-in `sharedWeekPlans`).
6. **Shared catalog, private edits.** Recipe documents in `recipes` are shared/global; a user's
   personal changes live in `meta.overrides` and shadow the catalog at render time — the catalog
   doc is never mutated by an override. As of Batch 3 this includes **servings**: the recipe-detail
   "Your serving size" control writes `meta.overrides.servings` (per-user), while the edit modal's
   "Recipe default servings · shared" still corrects the shared `recipes/{id}.nutrition` for
   everyone (the only servings write that crosses users — kept deliberate + clearly labelled).
7. **Password login is account LINKING, never a second account (Batch 7).** A user signs in with
   Google first; "Set up password login" (`PasswordLoginSettings`, in the `AuthButton` account area)
   calls `linkWithCredential` with an `EmailAuthProvider` credential built from the user's **own
   existing email** — attaching password sign-in to the **same uid**. There is **no**
   `createUserWithEmailAndPassword` anywhere and no signup screen, so a password can only ever exist
   on an already-authorized Google account; all per-uid data (nutrition, plans, meta, favorites,
   `addedBy`, `calendarEventIds`) is preserved untouched. The login screen's email/password form does
   `signInWithEmailAndPassword` only. The "already linked" check is `user.providerData` containing the
   `'password'` provider (surfaced as `AuthContext.hasPassword`). `auth/requires-recent-login` on
   linking/changing is handled by a Google `reauthenticateWithPopup` + one retry. **Console
   prerequisite:** the Email/Password provider must be enabled in Firebase Auth or these calls throw
   `auth/operation-not-allowed` (see §6, §8).
8. **Authenticated AI request boundaries are bounded and fail closed.** `/api/ai-ingest`,
   `/api/new-recipe-suggestions`, `/api/recommendations`, and `/api/recipe-assistant` authenticate
   with the existing Firebase Bearer-token helper, enforce a streaming raw-body byte ceiling before
   JSON parsing, validate their known request fields and route-specific semantic limits before any AI
   or URL-fetch work, and ignore unknown metadata. Malformed/invalid input returns a controlled 400,
   an oversized raw body returns 413, and arbitrary Firebase, AI Gateway, provider, credential, or
   internal exception messages are never returned to clients. Server logs use stable route identifiers
   plus safe counts/lengths rather than bearer tokens or complete request content.
9. **Canonical recipe categories on new shared writes.** All new `recipes/{id}` writes use the
   single ordered 12-category contract in `lib/recipeCategories.ts`. Legacy stored recipe and
   personal-override strings are compatibility inputs only, never valid new shared outputs;
   missing, combined, arbitrary, or unknown values fail before the Firestore write.

---

## Section 5 — Key Calculations & Business Logic

1. **Recipe list filtering & live count** — `app/recipes/page.tsx`. A `filtered` `useMemo`
   recomputes on cuisine, category, min-rating, source, time filter, sort, and a 150 ms debounced
   search term; the input itself remains immediate. Search uses fuse.js starting at one character.
   Recipes and Favorites expose the same exact 12 canonical category filters. Category matching
   applies the already-loaded personal override before the shared value, then uses
   `normalizeRecipeCategory(raw, recipeID)`, so deterministic legacy aliases and mixed legacy
   recipe IDs land under their canonical filter without N+1 reads. Unknown values remain unresolved.
2. **Filter persistence** — `app/recipes/page.tsx` writes filter state to `localStorage` keys:
   `mea_recipes_search`, `mea_recipes_cuisine`, `mea_recipes_category`, `mea_recipes_minRating`,
   `mea_recipes_source`, `mea_recipes_sort`, `mea_recipes_filter`, `mea_recipes_timeFilter`.
   `app/favorites/page.tsx` mirrors the same controls with parallel `mea_favorites_*` keys so
   the two pages persist independently. Favorites does **not** apply the default "Added by me"
   source filter.
3. **Default recipe source filter** — defaults to `all`; the user's explicit source selection
   persists in `mea_recipes_source`. Sign-in does not auto-switch the list to "Added by me".
4. **AI recipe generation flow** — Discover page: free-text dish name → `POST /api/ai-ingest`
   with `{ generate }` → AI Gateway returns schema-validated structured data → user reviews/edits → `saveRecipe`
   into `recipes`. Generation is **FlavorGraph-informed**: `getComplementaryIngredients` seeds
   the prompt with scientifically complementary ingredients (`lib/flavorPairings.ts` +
   `lib/flavor-pairings.json`).
   All recipe-category-producing AI prompts are built from `RECIPE_CATEGORIES`, and generated
   category fields use a Zod enum derived from that same tuple. Noncanonical output fails the
   route's existing safe validation/error path; it is never replaced with the first category.
5. **AI recipe import flow** — Add modal / Queue: URL or pasted text → `POST /api/ai-ingest`
   → structured recipe → saved to `recipeQueue` (`status: 'pending'`) → reviewed in `/queue`
   → published into `recipes`. Client-provided `imageURL`/`prepTime`/`cookTime` (e.g. from the
   bookmarklet) take precedence over AI-parsed values.
6. **Ingredient/instruction parsing** — `parseRecipeContent` (`lib/recipeContent.ts`, re-exported by
   `lib/recipes.ts`) splits the flat `content` string into ingredients/instructions by exact,
   case-insensitive header keywords (`INGREDIENTS`, `INSTRUCTIONS`, etc.) and strips `Step N`
   prefixes. Instructions apply six evidence-bound Wave 1A controls: complete standalone absolute
   HTTP(S) lines are filtered; exact review/comment chrome and the audited bounded author/date shape
   terminate the method; exact storage/nutrition footer labels terminate while the exact nutritional-
   information note and `Recipe Source: <absolute URL>` line are filtered; exact known page controls
   (`Make the recipe with us`, `On Off`) are filtered; an exact `PREP` section followed by `ON THE
   STOVE` can start a method only when no ordinary instruction heading exists and both phases contain
   method content; and a no-heading fallback accepts an exact standalone `Step 1` only when followed by
   at least `Step 2` in a complete sequential run, taking the single content line after each standalone
   step label. Ordinary instruction headings always take precedence. `Prep: 20 minutes`, isolated Step
   text, embedded/actionable URL prose, and broad human-language inference do not activate these rules.
   Generic NOTES termination, generic Tip termination, and generic first-person termination are
   prohibited: the corpus audit showed that NOTES and Tip would remove useful mapped cooking guidance
   and invalidate 9 and 4 persisted source hashes, while first-person prose is not reliable review
   evidence. Both the normal two-heading path and the capped ingredient-heading-only fallback apply
   the same conservative content controls: anchored audited metadata values/labels, bare HTTP(S)
   URLs, exact page controls, bounded rating-to-yield preambles, and exact terminal blocks (`Notes:`,
   `PREP`, `ON THE STOVE`, and the audited newsletter/guide markers). These are deliberately not a
   generic prose filter; no-quantity ingredients, category `Other`, alternatives, and optional foods
   remain valid. For section-label comparison only, a heading may have up to four
   leading pictographic decorations; the original content line is not rewritten. Ingredient headings
   may carry one nonempty, non-nested parenthetical qualifier of at most 80 characters, optionally
   followed by a colon. Multiple top-level ingredient sections are rejected as ambiguous under the
   single-recipe content model; arbitrary prose containing heading words is not accepted.
7. **Ingredient sub-header detection** — `isIngredientSubheader(line): boolean` in the pure,
   Firebase-free `lib/recipeContent.ts` module is authoritative for ingredient-group identity. It
   preserves colon-ending, markdown-bold, and known group-keyword semantics and adds only the 27
   exact audited labels covering the 31 formerly missed occurrences. `detectIngredientHeader`
   remains a compatibility wrapper for recipe detail/Cooking Mode presentation; subheaders remain
   in the presentation-oriented ingredient array so grouping is preserved. Grocery addition and
   nutrition parsing use the same predicate and skip recognized subheaders, so all 84 audited true
   subheaders are structural labels rather than purchase or nutrition inputs. Broad short-line,
   capitalization, missing-quantity, and generic `for` heuristics are intentionally excluded.
8. **Cook/prep time normalization** — `parseTimeToMinutes` parses ISO-8601 (`PT30M`), `1 hr 15 min`,
   `1h30m`, and bare numbers into minutes; `formatMinutes` renders back; `getTotalTime` sums
   prep + cook. Drives the time filter and time badges. No-cook recipes may store the explicit,
   parse-compatible string `0 min`; a positive prep value still gives them a meaningful derived
   total. Because there is no independent total field, imported pressure-cooker times must account
   for pressure build/release and similar elapsed overhead within prep or cook when a source's
   displayed prep + pressure setting would otherwise contradict its stated total.
9. **Grocery categorization** — `categorizeIngredient` (`lib/groceryCategories.ts`) maps an
   ingredient name to the web-owned, store-oriented 11-category contract, in display order:
   `Produce`, `Meat & Seafood`, `Dairy & Eggs`, `Bakery & Bread`, `Pantry & Dry Goods`,
   `Canned & Jarred`, `Sauces & Condiments`, `Spices & Seasonings`,
   `Nuts, Seeds & Nut Butters`, `Beverages`, `Other`. Matching is deterministic and
   token/phrase-aware: punctuation and hyphens form boundaries, ordinary alphabetic keywords
   never match inside a larger word, and the longest matching purchase-identity phrase wins
   before the original ordered-rule tie-breaker. Explicit processed forms (for example garlic
   powder, dried herbs, tomato paste, plant/coconut milk, fish/oyster sauce, and broth/stock)
   therefore outrank generic produce, dairy, or protein component words. All 11 categories are
   manually selectable, and a current `GroceryItem.manualSection` remains authoritative over
   automatic classification. `Staples` is retired because usually-on-hand status is independent
   from store location; a future staple-status feature must model that separately. The single
   `normalizePersistedGroceryCategory` boundary preserves valid current values and reclassifies
   either retired value (`Staples`, `Canned / Jarred / Sauces`) or an invalid stored string from
   the item name. Grocery-item and saved-default readers use that boundary without a Firestore
   write or background migration. The deprecated iOS client is not a compatibility constraint.
10. **AI grocery cleanup** — `POST /api/grocery-cleanup` sends the list through AI Gateway, which
    returns per-item actions (`keep` / `merge` / `normalize` / `remove`) with `mergedWith`
    indices and a category. The route imports `GROCERY_CATEGORIES` (no hand-duplicated list)
    and validates each returned `category`; an off-list value falls back to the local
    `categorizeIngredient` match. Retired category strings are therefore rejected as new AI
    output, while legacy input context is normalized before entering the prompt. Model merge
    suggestions are deletion-safe only when purchase
    identity matches: normalized token sets must be equal except for a narrow count/container-unit
    allowance, while freshness/state, form, meat cut, and fat-percentage terms must match exactly.
    Apply operations are committed in sequential chunks of at most 450 writes. Last-run tracked in
    `localStorage` `mea-grocery-last-cleaned`.
11. **Rebuild grocery from plan** — `rebuildGroceryFromPlan` (`lib/userdata.ts`) captures exact
    normalized identities of non-manual items whose temporary `needThisTrip` flag is true, deletes
    non-manual/non-legacy items, then re-adds parsed ingredients from each planned recipe via
    `addRecipeIngredientsToGrocery`, which merges by normalized noun and unions `sourceRecipeIDs`
    (see §5.16). It finally reapplies the flag only to recreated non-manual exact-identity matches;
    unmatched overrides expire and fuzzy/substring reassignment is never attempted. Manual items
    survive in place with their active metadata unchanged. Idempotent: re-adding a recipe already
    in `sourceRecipeIDs` is a no-op, and the
    delete-then-re-add means quantities never double-count across rebuilds. Rebuild deletes and
    clear operations are committed in sequential chunks of at most 450 writes.
12. **Flavor pairing scoring** — `getComplementaryIngredients` normalizes input ingredients
    (strips quantities/units/prep words), looks up pairings (exact → suffix → last word), and
    scores candidates by rank-weighted frequency, returning the top N not already present.
13. **AI recommendations / suggestions** — `/api/recommendations` (3 buckets from cook counts +
    ratings), `/api/new-recipe-suggestions` (6 new recipes from taste profile),
    `/api/plan-suggestions` (complete a week plan). All cached in `localStorage`
    (`mea-recommendations-cache`, `mea-new-suggestions-cache`) and triggered by an explicit
    button to avoid unnecessary API charges.
14. **Week navigation memory** — Plan page remembers the last-viewed week in `sessionStorage`
    `mea_plan_last_week`; defaults toward the upcoming week when the current is empty.
15. **Auto-nutrition on publish** — `computeAndStoreNutrition(recipeId, token, timeoutMs)`
    (`lib/recipes.ts`) runs right after `saveRecipe()` at every recipe-create site (queue
    publish + Discover direct-save). It POSTs `{type:"recipe",recipeId}` to `/api/nutrition-lookup`,
    then merges the returned `nutrition` (stamping a fresh `computed_at` Timestamp) onto the doc and
    sets `nutritionStatus:'computed'`. The call is wrapped in `AbortSignal.timeout` (~20s at publish,
    45s for the manual retry) and **never throws** — on slowness/error it flags
    `nutritionStatus:'needs_calc'` and returns null so the recipe still saves. Servings defaulting
    (→4, `+default_servings`, low confidence, durable `total`) happens inside the engine. The
    detail-page empty state offers a "Calculate nutrition" retry for flagged/uncomputed recipes.
16. **Unit-aware grocery ingredient parsing & add-merge** — `lib/ingredientParser.ts` is the
    pure, deterministic, firebase-free **single source** of measurement/unit vocabulary and the
    parser used at the grocery-ADD boundary (recipe storage is untouched). `parseIngredient(line)`
    → `{quantity, unit, name, confidence}`: it reads a leading quantity (integers, decimals,
    `1/2`, unicode fractions `½`, mixed `1 1/2`, ranges `1-2`/`1 to 2`), then a unit word, then the
    noun phrase. **MEASUREMENT** units (cup, tbsp, g, lb…) are distinguished from **COUNTABLE**
    units (can, jar, bunch, head, clove, ear…) so `"1 can black beans"` keeps `can` as the unit
    (never renders `"1 black beans"`) and `"4 ears shucked corn"` keeps `ears`. It returns
    `confidence:'low'` only on genuinely ambiguous structure (a doubled quantity like
    `"6 4 ears…"`); otherwise plain noun phrases are stored verbatim with no AI call. On the
    **manual-add** path only, a low-confidence line triggers a per-item AI fallback
    (`POST /api/grocery-cleanup {mode:'parse-line'}`, unit validated against the shared vocab,
    falls back to whole-line `name` if junk). **Add-merge** (decision: conservative): a new item
    merges into an existing one only on an **exact normalized-noun** match (`normalizeNoun` =
    lowercase + strip punctuation/articles + conservative food singularization with uncountable
    exceptions, so `"tomatoes"` = `"tomato"` but `"red onion"` ≠ `"onion"`). **Compatible-unit
    quantity merge** (2026-08-23): exact normalized grocery identities may combine numeric
    quantities across explicitly compatible measurement units, not only identical ones. Every
    measurement unit belongs to an explicit dimension — **volume** (teaspoon, tablespoon, cup,
    milliliter, liter, pint, quart, gallon) or **mass** (milligram, gram, kilogram, ounce,
    pound) — modeled internally in `ingredientParser.ts` as one base-unit conversion factor per
    dimension (mL for volume, g for mass; no pairwise table). `mergeQuantities(existing, incoming)`:
    (a) same canonical unit (or both unitless) + both numeric → **sum**, unchanged from before
    (`"2 cups"+"1 cup"="3 cups"`); (b) different but same-dimension measurement units + both
    numeric → the pure helper `convertQuantity(qty, fromUnit, toUnit)` converts the **incoming**
    quantity into the **existing item's unit**, then sums (`"1 cup"+"8 tbsp"="1.5 cups"`,
    `"1 kg"+"500 g"="1.5 kg"`) — intentionally **directional/asymmetric**: `"8 tbsp"+"1 cup"="24
    tbsp"` is the same pair merged in the other order, because the existing item's unit is always
    authoritative (keeps the list stable instead of reformatting on every add); (c) anything else
    (cross-dimension — weight↔volume, volume↔count, weight↔count; different countable units;
    ranges; non-numeric quantities) → **unchanged conservative behavior**, both listed side by side
    without dropping either (`"1 cup + 200 g"`, `"1 can + 8 oz"`, `"1–2 cups + 1 cup"`). Countable
    units (can, jar, bag, box, package, bunch, head, clove, ear, stalk, slice, piece, sprig, stick,
    bottle, loaf) only ever sum on an exact same-unit match — never converted, even to another
    countable unit. No food-density conversion exists or is planned (weight↔volume is not
    computable without it). US↔metric volume uses the exact US customary constants (1 US cup =
    236.5882365 mL, etc.), not a `1 cup ≈ 250 mL` approximation. `formatNumber` rounds once, at
    the final formatted-quantity step, to at most 2 decimals (`1.50000000000002` never reaches the
    UI). This merge upgrade required no change to `normalizeNoun`/grocery-identity matching — unit
    compatibility only affects how an already-identity-matched pair's quantities combine. Manual
    adds merge only into manual items and recipe adds only into recipe items (the pools stay
    separate to preserve the rebuild invariant in §5.11); both paths call the same
    `mergeQuantities`, so this upgrade applies identically to both. `SavedGroceryItem` has no
    quantity/unit fields and does not participate in quantity merging. The whole-list "AI Clean Up
    List" button (§5.10) computes its own free-text "combined quantity" via the AI prompt,
    independent of `mergeQuantities`/`convertQuantity` — deterministic conversion is authoritative
    only at the add-merge boundary described here; the AI cleanup path was not changed. Existing
    Firestore grocery documents (including any historic `"1 cup + 8 tbsp"`-style compound
    quantities from before this change) are **not migrated or re-parsed** — this merge behavior
    only applies to future additions. As a final recipe-add defense, recognized shared subheaders,
    empty parsed names, and complete explicit HTTP(S) URLs are skipped before a write/merge.
    Missing quantity and category `Other` are not rejection criteria; plain real-food noun phrases
    remain accepted. **Shared preparation pipeline** (2026-08-23, behavior-preserving
    consolidation): recipe-derived and manually entered grocery candidates pass through one shared
    deterministic grocery-item preparation pipeline, `prepareGroceryItem` in
    `lib/groceryItemPreparation.ts`, before identity lookup, quantity merging, and persistence. It
    is pure/Firebase-free/AI-free and owns: calling `parseIngredient`, resolving the surface name
    (with the historic confidence-gated raw-text fallback), computing `normalizedName` via
    `normalizeNoun`, and assigning `category` (default `categorizeIngredient(name)`, or an explicit
    `categoryOverride` when supplied — always authoritative). It does **not** own Firestore reads/
    writes, the existing-item identity lookup, `mergeQuantities`/`convertQuantity`, `sourceRecipeIDs`,
    timestamps, UI, or AI calls. `addRecipeIngredientsToGrocery` calls it with
    `rejectContentArtifacts: true` (reproducing the subheader/URL/empty-name rejection exactly);
    its computed `category` is intentionally unused there — recipe items still never store
    `manualSection` at write time. `handleAddItem` (manual add) calls it with the caller's own
    parse result passed via `parsedOverride` (so the async per-item AI fallback for an ambiguous
    line, which must stay outside a pure function, is never re-parsed) plus the typed
    quantity/unit/category fields as overrides — `rejectContentArtifacts` stays unset, preserving
    manual add's historic behavior of never rejecting a typed line on subheader/URL/empty-name
    grounds (a manually typed line is not scraped recipe content). Saved-item defaults
    (`SavedGroceryItem`) become an active grocery item through this same `handleAddItem` call —
    no separate preparation path. Verified behavior-preserving via a corpus equivalence audit
    (0 differences across 3,071 grocery-eligible occurrences in 216 recipes) and manual-fixture/
    component regression tests; see `docs/audits/shared-grocery-preparation-pipeline-2026-08-23.md`.
17. **Per-user servings override & effective-servings derivation** (Batch 3) — each viewer can set
    their own serving size on the recipe detail page (`NutritionSection` stepper/input), stored at
    `meta.overrides.servings` via `setServingsOverride` (`lib/userdata.ts`). Per-serving macros are
    **recomputed live** as shared `nutrition.total ÷ effectiveServings`, where
    `effectiveServings = override ?? nutrition.servings` (`effectiveServings`/`perServingForViewer`
    in `lib/nutrition.ts`). The shared `nutrition.total`/`servings` are **never** mutated by an
    override — it is pure render-time derivation. The "servings were assumed" caveat is suppressed
    once a viewer sets their own count. Override-aware cooked-capture: both `logCookEvent` call
    sites (recipe detail Cooking Mode + plan-page checkmark) snapshot `perServingForViewer(...)` so
    a logged cook reflects the macros the user actually saw. The **edit modal** keeps a separate
    "Recipe default servings · shared" control that writes the shared doc via `updateRecipeServings`
    (correcting a genuinely-wrong default for everyone) and preserves `overrides.servings` on save.
18. **Low-confidence macro gating (display-only)** (Batch 3) — `nutrition.confidence` is
    **per-recipe** (`high|medium|low`), not per-field, so gating is section-level: when
    `confidence === 'low'` **and** the viewer has not set a personal servings override,
    `NutritionSection` dims the whole macro grid (`opacity-50`) and shows one caution caption
    ("Low-confidence estimate — may be inaccurate."). Values are never hidden or replaced with "—".
    For recipe nutrition, `low` is produced by the engine **only** when servings were defaulted, so
    a viewer-supplied serving count clears the dim. Reuses the existing `trustBadge`/`servingsAssumed`
    helpers — no parallel confidence concept. Display-only: stored nutrition + engine are untouched.
19. **Low-confidence nutrition re-validation** (Batch 3) — `/api/nutrition-revalidate` re-runs the
    shared engine on the low-confidence population to repair bad estimates. **Dry-run by default**
    (diff only); `?apply=true` persists, and only for recompiles that are no longer `low`
    confidence. Servings are recovered from the stored `nutrition.servings` on re-run, so
    assumed-servings recipes lift `low → medium/high` legitimately. Caveat (see §6): the engine's
    confidence reflects servings + AI usage + kcal-band validation, **not** macro plausibility, so a
    USDA semantic mis-match (e.g. Easy Spaghetti's high sugar) lifts in confidence without the macro
    changing — review the dry-run diff before applying.
20. **Day-based meal plan + main/side role** (Batch 5) — planned recipes carry a `day` (ISO date in
    the week, or `null` = Unscheduled) and a `role` (`main`/`side`). **Role defaulting** is auto-derived
    from the recipe's category via `deriveRoleFromCategory` (`lib/userdata.ts`), after read-time
    normalization: canonical **Sides** and **Sauces & Condiments** → `side`; every other canonical
    category (including Breakfast, Snacks, and Drinks) → `main`; unknown/empty → `main` (a missing
    side is less wrong than a missing main). Recipe-specific legacy compatibility is used when the
    recipe ID is already available. Cook-event adds pass the caller's already-resolved role and add
    no Firestore read.
    The role used on `addRecipeToWeekPlan` is `resolveRecipeRole(recipe)` at every add site (recipe
    detail, RecipeCard, Discover, Friends' "add to my plan"). A user can override per entry via the
    card's Main/Side toggle (`setPlannedRecipeRole`); the override is **persisted on the entry**, so the
    read-time derivation never clobbers a manual choice. The Plan UI groups cards by day (7-col grid on
    `lg`, stacked sections on mobile) with a shared **Unscheduled** area and **mains sorted before sides**
    within each day. Day/role are display/organization only — they **never** affect grocery
    (`rebuildGroceryFromPlan` pulls all planned recipes regardless) or cooked tracking, and `logCookEvent`
    is unchanged.
    **Add-time role precedence (Batch 5.1):** per-week entry override (`setPlannedRecipeRole`) >
    recipe `defaultRole` > category-derived (`resolveRecipeRole` = `defaultRole ?? deriveRoleFromCategory`).
    Setting a recipe's `defaultRole` (recipe-detail control, §3) applies to **future adds only** — it
    **never** rewrites the stored role on entries already in any week plan; existing object entries keep
    their stored role and legacy-string entries stay category-derived (frozen, independent of `defaultRole`).
    **Day assignment (Batch 5.1):** in addition to the tap **day-picker** (`Calendar` button → day
    dropdown, the reliable path and the sole mobile path), the desktop grid supports native HTML5
    **drag-and-drop** — tiles are `draggable`, day columns and the Unscheduled area are drop targets with
    an amber ring highlight; both paths call the same `assignRecipeToDay`. Desktop-only by design (the grid
    is `hidden lg:grid`; HTML5 drag doesn't fire on touch), so mobile is unaffected — no DnD library added.
    **Role color accent (Batch 5.1):** each plan tile gets a subtle inset left-edge accent —
    `amber (#E8A838)` = main, `muted (#A89880)` = side (existing theme tokens) — paired with the on-tile
    Main/Side text label so color is never the only signal (colorblind-safe). Applied to plan tiles only,
    identical on desktop and mobile; no Mains/Sides sub-headers.
    **Tile → action sheet (Batch 5.2):** plan tiles were redesigned for legibility — image on top,
    recipe **name below** (up to 2 lines, `line-clamp-2`), the role label + color accent kept, and **no
    inline action buttons**. Tapping a tile opens a single **action sheet** (bottom sheet on mobile,
    centered modal on desktop — mirrors the `LogFoodSheet` shell) whose header shows the recipe
    thumbnail + name and whose body holds every action that used to be inline, each calling its existing
    writer: **View recipe** (link, first), **Assign to day** (`assignRecipeToDay`, closes), **Main/Side**
    (`setPlannedRecipeRole`, stays open), **Add to grocery** (`addRecipeIngredientsToGrocery`, stays open
    w/ feedback), **Mark cooked** (closes → `handleMarkCooked` servings/rating flow), **Move to week**
    (`moveRecipeToWeek`, closes), **Remove** (de-emphasized red, separated; closes → reuses the existing
    confirm-remove modal). **Tap vs drag:** the tile is both `onClick` (→ sheet) and HTML5 `draggable`
    (→ `assignRecipeToDay` via day-column drop); the browser suppresses `click` after a drag and HTML5
    drag never fires on touch, so a tap opens the sheet and a drag moves the tile with no conflict —
    touch is tap-only (the day picker lives in the sheet). Drag-and-drop and the day picker are unchanged
    behaviorally; only the picker's location moved (tile dropdown → sheet).
21. **Push meal plan to Google Calendar** (Batch 6) — a manual **"Add this week to Calendar"** button on
    the Plan page (controls row, next to *Rebuild grocery list*) opens a confirm/time step (time picker
    defaulting to **6:30 PM each open**, a count of day-events to create/update, and any emptied-day events
    to remove); confirm runs the push and shows a summary toast (*Created N · Updated M · Removed K*, plus
    *Failed: <days>* on partial failure). **One event per DAY** that has ≥1 day-assigned recipe (cooked
    included — a cooked meal still happened that day; Unscheduled `day=null`/out-of-week entries are never
    pushed). Title `🍽 Dinner: <first main, else first side>`; description groups main-then-side, each line
    `Name — <recipeUrl(id)>` (`lib/recipes.ts` `recipeUrl` reuses the `/recipes/[id]` route + the recipe's
    slug id — never re-slugified), with a group header only when non-empty. Default start 6:30 PM local,
    **60-min** duration; the picked time applies to all days in that push. **Idempotency** lives in
    `weekPlans.calendarEventIds` (§3): client builds explicit per-day ops from the stored map —
    `calendarEventIds[day]` present → `update` that event id, absent → `create`; a stored key whose day no
    longer has recipes → `delete` then drop the key — and `saveCalendarEventIds` persists the recomputed map
    after the push. **Auth (Option B, no server Google creds):** the client mints a `calendar.events` OAuth
    access token via a Firebase Google **re-auth popup** (`lib/googleCalendar.ts`, scope requested only here,
    never on normal sign-in) and passes it to the auth-gated `/api/calendar/push` executor (§2), which calls
    the Calendar REST API. **Safety:** all writes happen ONLY on the button press (no effect triggers one);
    the route has no list/search, so the app can only ever update/delete IDs it stored — never a
    search-and-delete; partial failures keep prior truth (failed create never recorded, failed update/delete
    keeps its old id) and report the failed days. Day/role/cooked semantics, grocery, and nutrition are
    untouched. Requires the Calendar API enabled + the scope on the OAuth consent screen (see §6).
22. **Canonical staples ingredient resolution** (Batch 4) — a curated, **live-verified** lookup
    (`lib/canonicalStaples.ts`, 122 entries) maps common cooking staples → the exact correct USDA
    FoodData Central entry (fdcId + description + dataType + per-100g macros, SR Legacy/Foundation
    plain base forms; generated + verified by `scripts/verify-canonical-staples.js`). It is the **new
    first tier** of ingredient resolution in `computeRecipeNutrition`: **canonical table → existing
    USDA search+validation → AI estimate**. On a canonical hit the engine uses the verified per-100g
    macros directly and skips the fuzzy matcher (the kcal-band check still runs as a *signal* — logged,
    not rejected). On no hit it falls through to the **existing matcher, unchanged** for non-staples.
    **USDA operational observability (M-07):** search and selected-food detail failures emit structured
    server logs with the stable `[nutrition-usda]` prefix, an operation, and a bounded failure code
    (`http_error`, `network_error`, `timeout`, `invalid_json`, or `invalid_response`) plus safe context such
    as status, data type, a ≤120-character query preview, or fdcId. A missing server key is distinguished as
    `invalid_response` with `MissingUsdaApiKey`. Logs never contain the USDA key, a credential-bearing URL,
    response body, bearer token, complete recipe, or ingredient array. A valid zero-result response and a
    semantic candidate rejection remain normal no-match outcomes and produce no failure event. Resolution
    order, retry behavior, confidence, and canonical → USDA → AI fallback semantics are unchanged.
    **Matching rule (conservative, in `matchCanonicalStaple`):** tokenize the name with `keyTokens`;
    an entry matches when one of its aliases' tokens are a subset of the ingredient's tokens; the
    most-specific (most-tokens) entry wins; **ties between different entries → no match (fall through)**;
    per-entry `guard` regexes veto homographs (e.g. "butter beans"/"butternut" never → dairy butter,
    "sugar snap peas" never → granulated sugar). A *missed* canonical match is just status-quo; a
    *wrong* one is the thing avoided. Recipes resolved via the table carry a `+canonical` source suffix
    (still `startsWith('usda')`, so `sourceLabel`/`servingsAssumed`/revalidation predicates are
    unaffected). **Recompute tool:** `/api/nutrition-canonical-dryrun` — **DRY-RUN by default**;
    `?apply=true` persists (auth-gated, batched). The Batch-4 dry-run (`batch4-canonical-dryrun.md`)
    was reviewed before any write; **Batch 4-apply has now written the corrections** (see below).
    **Batch 4-fix (matcher hardening):** an independent re-audit (`batch4-canonical-reaudit.md`) found
    the table data sound but the alias layer had a systemic flaw — aliases/guards whose distinguishing
    word is a stripped `DESCRIPTOR_WORD` (e.g. "minced beef"→`{beef}`, "half and half"→`{half}`,
    "whole peeled tomatoes"→`{tomato}`; guards on `fresh`/`whole`) collapse to a bare catch-all and
    hijacked ~16 recipes (whole beef/pork cuts → ground meat; "…cut in half" → cream; cream-of-mushroom
    soup → raw mushroom). Fix: dropped the degenerate aliases, removed the `half and half` entry,
    re-based guards on **surviving** tokens (`wheat` not `whole wheat`; added `mushroom`/`oats`/`banana`
    guards), and added a **generator lint** in `scripts/verify-canonical-staples.js` that fails on any
    alias collapsing to a bare token or any guard term that is a `DESCRIPTOR_WORD`. Re-verified by a v2
    dry-run (`batch4-canonical-dryrun-v2.md`): all 16 regressions gone, **zero new regressions**, Easy
    Spaghetti preserved.
    **Batch 4-apply (data WRITTEN):** ran `?apply=true` on Vercel (full three-tier engine, **AI on**) so
    the persisted values are real, not the local AI-off dry-run numbers. **136 recipes written**, under a
    conservative gate: write only when the change is **attributable to the canonical table** (proposed vs
    canonical-off baseline is material — not mere engine drift), the result differs from stored, confidence
    is **not downgraded** (`rank(new) ≥ rank(old)`), and the recompute is valid. Skipped: 49 would-downgrade
    (kept as-is), 15 parse-error, 7 no-canonical-effect, 3 no-canonical. Easy Spaghetti stored sugar
    **73.2→14.8 g** total (per-serving 18.3→3.7), confidence low→high. **Revert:** every written doc has a
    `nutrition_prev` field = its exact pre-apply nutrition (read-only to the app — `docToRecipe` drops it),
    plus a backup manifest `batch4-apply-revert-manifest.json` (136 entries). See `batch4-apply-report.md`.
    **M-04 remediation (partial; engine fix required before nutrition apply):** the narrow heading-recognition repair is
    complete. Prompt 4B repaired 10 data-defective recipes (9 in-place updates plus one canonical-ID
    migration) with exact backups and read-back validation, then completed a non-persistent nutrition
    dry-run for those 10 plus the three code-only recoveries. `maple-roasted-candied-pecans` remains
    blocked because its stored body is only `Source:` and no attributable source exists. The legacy
    `smoothies` composite also remains: its three named ingredient lists contain no instructions, and the
    current product-owner decision is to leave that record as-is—do not split, replace, or delete it.
    Prompt 4C traced all 13 eligible recipes ingredient-by-ingredient and classified **1 ready / 1 review /
    11 blocked**. Prompt 4D fixed broad parser/query/canonical defects. Prompt 4D.1 fixed four residual
    defects: USDA candidates must contain every food-identity token (with known contradiction guards),
    dried chickpeas cannot use the canned canonical record, quantity qualifiers before units are parsed,
    and comma-separated seasoning clauses cannot replace the food noun. The exact 13-recipe read-only
    rerun classified **5 ready / 0 review / 8 blocked**. Prompt 4E then backed up the exact five-ID
    allowlist and safely applied two recipes with read-back verification; three were skipped when fresh
    pre-write gates exposed new material unresolved ingredients or a material macro change. M-04 is
    resolved for the safely remediable population; source/data-deficient recipes are explicitly deferred.
    See `docs/audits/m04-final-nutrition-apply-2026-08-22.md`.

23. **Usually On Hand grocery preference (Phase 1)** — `SavedGroceryItem.usuallyOnHand?` is a
    durable, owner-scoped preference for one exact `normalizeNoun` grocery identity. It is
    independent of category: an active preferred item renders in the separate derived
    `Usually On Hand` section while retaining its effective shopping category and any authoritative
    `manualSection` override. The section is after the 11 normal shopping sections, hidden when
    empty, shows a count, and is collapsed by default. Mark/unmark updates only saved identity
    memory; it never changes/recreates/deletes the active grocery document, checks an item, or
    changes quantity/unit/source-recipe data. Missing/false is the historical-compatible default,
    there are no automatic staple defaults, and matching is exact normalized identity only (no
    fuzzy/substrings). Recipe/manual additions and quantity merging are unchanged; they inherit the
    preference at render time after the active item exists. Phase 1 intentionally has no temporary
    `Need This Trip` override. See
    `docs/audits/usually-on-hand-foundation-2026-08-24.md`.

24. **Need This Trip temporary override (Usually On Hand Phase 2)** —
    `GroceryItem.needThisTrip?: boolean` is transient active-list metadata and is never copied to
    `SavedGroceryItem`. Historical absence and false are equivalent. The authoritative display rule
    in `deriveGrocerySections` is `usuallyOnHand === true && needThisTrip !== true` → derived
    `Usually On Hand`; every other combination → the item's effective normal category (including an
    authoritative `manualSection`). Preferred items expose **Need This Trip**; overridden items expose
    **Usually Have This** to clear the exception. The toggle changes no category, identity, quantity,
    unit, sources, persistent preference, or checked state. Recipe and manual quantity merges retain a
    true override. Plan rebuild preserves it only for recreated exact `normalizeNoun` identities as
    described in §5.11; clearing/deleting the active item expires it naturally. Marking an ordinary
    item Usually On Hand explicitly clears trip intent before enabling the preference. Removing the
    durable preference clears the now-inert trip marker after the preference write, so partial cleanup
    failure cannot place the item in the wrong visible section. No migration or production backfill is
    required. See `docs/audits/usually-on-hand-need-this-trip-2026-08-24.md`.

25. **Deterministic cooking-step ingredient mapping foundation** —
    `lib/cookingStepMapping.ts` defines the pure first tier of the planned Cooking Mode mapping
    architecture. Flat recipe `content` remains canonical; the engine receives its effective parsed
    `ingredients[]` and `instructions[]`, preserves original ingredient indexes and explicit
    subheader/group context, and emits only high-confidence deterministic references. It matches
    normalized food phrases and a bounded set of safe semantic forms, never the legacy final-token
    heuristic. Distinct food identities remain distinct, duplicate evidence is unresolved rather
    than guessed, and explicit group language is required to disambiguate grouped duplicates.
    Explicit `half`/partial quantities and `remaining`/`rest` qualifiers are preserved as source
    metadata without quantity arithmetic. V5 requires both safely grounded identity and positive
    evidence that the ingredient is actively used now. Action grounding is clause-local: contextual
    nouns (`sauce for the chicken`), negative/deferred clauses, headings/labels, and explanatory
    supplemental notes do not become ingredient references merely because another clause contains an
    action. V4 preserves shared head nouns in alternatives, keeps
    identity-defining modifiers, normalizes chile/chili spelling without collapsing distinct chile
    ingredients, and suppresses clear local negative/deferred/removal/incidental/additional-quantity
    contexts. Duplicate or identity-equivalent rows require row-specific positive evidence: an explicit
    group/component, an exact uniquely matching quantity, or an unambiguous group cue in the same
    bounded clause. Quantity evidence is compared with the selected row using the existing ingredient
    quantity/unit parser; mismatches abstain and no remaining-quantity arithmetic is inferred. Prepared-
    component phrases take precedence over constituent words, so `garlic sauce` cannot independently
    map raw garlic. Unscoped collective references and prepared components remain unresolved; obvious URL/review/nutrition/storage/paywall
    contamination is retained in source but classified `non-actionable` and never sent to mapping AI.
    Steps confidently requiring no ingredient may be classified separately.
    The governing safety invariant is **a missing mapping is preferable to an incorrect confident
    mapping**.

    `canonicalizeCookingMappingSource` losslessly serializes only the exact ingredient and
    instruction arrays (including order, text, and subheaders), and
    `computeCookingMappingSourceHash` produces their lowercase SHA-256 fingerprint. A future stored
    mapping is valid only when that fingerprint matches the current effective parsed source. The
    contract is schema v1 with parser `recipe-content-v1`; newly generated deterministic-only results
    use engine `deterministic-v5`, while a result containing accepted AI associations uses `hybrid-v5`.
    Runtime continues to accept the 187 already-audited source-bound `deterministic-v4`/`hybrid-v4`
    maps as well as v5 maps; persisted v1/v2/v3 maps fail closed to deterministic-v5 fallback.

    **Deterministic-v5 listed-row availability and lifecycle:** during one deterministic step traversal, each
    confidently mapped row is marked used, including rows resolved through a bounded collective such
    as `all sauce ingredients`. A used row cannot satisfy a later ordinary noun or quantity match.
    Reuse requires uniquely grounded `remaining`/`rest`/`reserved` language, an explicitly divided row
    with grounded partial-use evidence, or genuine direct continuing manipulation of the already
    introduced ingredient. Identity or quantity evidence never overrides an incompatible lifecycle.
    The engine does not calculate inventory, remainder arithmetic, mass balance, substitutions, or
    yield; uncertainty abstains. Fresh or separately quantified process material and other unlisted
    uses cannot borrow a similar listed row. Ingredient form, group, and purpose markers such as `for
    garnish`, `for topping`, `for the sauce`, and `for the slaw` remain row evidence rather than being
    stripped into a global identity. Optional ingredients are not excluded when an actionable
    instruction addresses their correct purpose. V5 additionally requires positive current component/
    group/purpose compatibility, protects compound ingredient names from finished-dish noun collisions,
    rejects measured recipe rows for unmeasured fresh boiling/ice-bath process material, preserves the
    complete grounded mixed-number quantity, and prevents prepared oil/sauce/dressing constituent words
    from escaping their component. Context such as `to hold the salmon`, `for the
    salmon`, or a before/while clause remains non-active unless its local clause directs action on the
    row.

    **Prompt 2 publish-time hybrid pipeline:** Queue publish and both Discover creation/save flows
    finalize the exact flat content, parse and hash it locally, and persist
    `cookingStepIngredientMap` in the same initial recipe write. Fully deterministic recipes skip the
    mapping API. Only steps unresolved as `ambiguous`, `implicit-reference`, or
    `prepared-component` are eligible for one server-side structured Gateway call; `no-ingredient-use`
    and `non-actionable` are never eligible. Cooking mapping prompt `v2` lives in `lib/aiConfig.ts`, uses
    the unchanged centrally configured `openai/gpt-5.6-luna` Gateway model, and requests temperature 0
    only for this feature. Its precision-first contract treats abstention as correct. Shared pure
    validation rejects noneligible/out-of-range/header indexes, uncertain associations, unsupported
    duplicate groups, unbounded collective expansion, negative context, nonlocal usage metadata, and
    noncanonical prepared labels while preserving every deterministic reference. Invalid usage is
    dropped only when the base association is independently grounded; otherwise the association is
    rejected. Hybrid-v5 invokes the same row-availability gate with all prior accepted deterministic/AI
    steps, so high-confidence AI cannot reopen a consumed row, cross group/purpose, borrow fresh process
    material, or override quantity incompatibility. Prepared components require an exact canonical ingredient-group or earlier actionable
    antecedent. AI timeout, provider failure, invalid
    response, or source-hash mismatch falls back to the local deterministic map, so recipe publishing
    proceeds. Prompt 2 changes new-recipe persistence only: it does not backfill existing recipes.

    **Local whole-recipe completeness v6 candidate (2026-08-27; not release-authorized):** A dedicated
    server-only completeness layer and independently versioned prompt `v1` were implemented in the
    working tree as deterministic-v5 → targeted AI v2 when eligible → blind whole-recipe completeness
    AI on every valid map creation → additive deterministic safety validation → `hybrid-v6`. The blind
    request contains only numbered ingredients, group/header metadata, and numbered instructions; it
    never receives candidate or persisted mappings. Existing candidate associations are not removed.
    Normal requests make at most two model calls. A complete successful review stamps `hybrid-v6` even
    when it adds nothing; completeness failure retains the pre-review `deterministic-v5`/`hybrid-v5`
    candidate and never falsely stamps v6. The shared publish helper always calls the route, while
    runtime remains AI-free and v4/v5 compatible. This code must not be released or pushed until the
    focused precision and CRITICAL-recall gates pass; the 2026-08-27 focused validation below failed.

    **Local source-grounded semantic-map v7 candidate (2026-08-27; failed and not release-authorized):**
    The failed v6 list contract was replaced locally with one blind whole-recipe structured call that
    receives only title, numbered ingredients/group headers, and numbered instructions. Prompt
    `cookingStepSemanticMapPromptVersion = v1` returns typed ingredient actions with exact source
    evidence plus a first-class prepared-component graph (unique IDs, establishment step, constituent
    indexes, evidence, and later component uses). Deterministic-v5 remains the immutable additive
    baseline and safety layer; accepted plans stamp `hybrid-v7`, while provider, transport, coverage,
    or structure failure returns deterministic-v5. The normal candidate pipeline makes exactly one
    model call and never invokes targeted mapping AI. Runtime remains AI-free and locally recognizes
    v4, v5, and v7; the never-persisted hybrid-v6 engine remains unsupported. The shared publish helper
    requests semantic review for every valid recipe, including deterministic-looking recipes. This
    implementation fixed all six named omissions but failed every focused release gate and therefore
    must remain uncommitted/unpushed and cannot replace production behavior. See the focused evidence
    described in §6.

    **Local exhaustive ingredient×step matrix v8 candidate (2026-08-27; failed and not
    release-authorized):** A dedicated server-only prompt `cookingStepUsageMatrixPromptVersion = v1`
    forces exactly one `USE_NOW` / `NOT_THIS_STEP` / `UNCERTAIN` decision for every non-header
    ingredient row in every instruction. A structural gate rejects the whole response for any missing,
    duplicate, header, invalid, or ungrounded-use cell before a separate semantic gate validates only
    `USE_NOW`, usage metadata, component establishment, and component use. Components require an exact
    source header/instruction label and expose a generic tail alias only when unique. The candidate path
    is deterministic-v5 → one blind matrix call → additive validated merge → `hybrid-v8`; failure keeps
    deterministic-v5. It does not invoke targeted-v2, completeness-v6, or semantic-v7 generation, and
    the publish helper still requests review for every valid recipe. Runtime remains AI-free and the
    local v8 validator accepts persisted v4/v5/v8 while never-persisted v6/v7 fail closed. The exact
    394-row v8 design input preserves all v7 169 raw misses, 52 correct validator rejections, nine
    accepted ingredient false positives, 148 component failures, and all 16 v6 false positives. The
    focused run failed, so this architecture remains local/uncommitted and production stays on v4/v5.

    **Local dual-blind consensus v9 candidate (2026-08-28; failed and not release-authorized):** V9
    reproduced the successful audit's two identical candidate-blind whole-recipe reviews, unioned both
    complete expected maps with deterministic-v5, and sent every candidate relationship to one
    source-grounded binary arbiter before a narrow hard-safety pass. A complete success requires exactly
    three ingestion calls (Reviewer A, Reviewer B, Arbiter), stamps `hybrid-v9`, and falls back as a whole
    to `deterministic-v5` on any review/arbitration failure; Cooking Mode runtime remains AI-free. The same
    36-recipe focused benchmark completed with matching source hashes, but failed. Reviewer union found
    833/868 expected relationships (95.97%; 35 missed by both), below the required 99.5%. One recipe's
    arbiter repeatedly failed structured output and correctly fell back to deterministic-v5. Across the
    candidate pool, the arbiter accepted 721/833 correct candidates (86.55%), rejected 108 correct
    candidates, left four unavailable with the failed response, and accepted nine incorrect candidates.
    The hard-safety layer then retained 656 correct accepts, rejected 65 correct accepts (9.02%), and
    blocked none of the nine incorrect accepts. Final output was TP 657 / FP 9 / FN 211, 98.65% precision,
    75.69% recall, 85.80% explicit-active-use recall, 83.69% CRITICAL recall, 68.55% HIGH recall, 74.55%
    seasoning/herb recall, and 31.52% prepared-component recall with 16
    component false positives. All six named UI omissions passed, but only 66/72 unique historical
    ingredient false-positive cases were rejected and only 44/52 formerly over-rejected correct V7
    relationships were both arbiter-accepted and safety-retained. Per the hard gate, stability/full 228,
    migration manifest/SHA/prompt, activation, commit, and push were not run. Production remains on the
    committed v4/v5 architecture.

    **Frozen-candidate arbiter V10A experiment (2026-08-28; failed and audit-only):** V10A reconstructed
    the exact V9 arbiter population without new reviewer calls: 863 ingredient relationships (833
    adjudicated correct, 30 incorrect), including two deterministic-only false candidates and four
    correct recipe-190 candidates whose V9 decisions were unavailable. This resolves the historical
    shorthand discrepancy: 833/28 described reviewer union, not the deterministic-augmented arbiter
    pool. A flat candidate-centric binary arbiter used maximum-15 micro-batches, exact candidate-ID
    coverage, one bounded retry, provenance as context, and no hard-safety layer in its primary metric.
    All 107 logical ingredient/component batches succeeded with zero parse/schema failures; recipe 190
    independently succeeded 4/4. The ingredient arbiter recovered 107/108 prior correct rejections and
    accepted 828/833 correct candidates (99.40%), but also accepted 20/30 incorrect candidates (66.67%)
    and rejected 0/9 prior V9 false accepts. Disagreement-only arbitration was the best measured F1/call
    tradeoff (831 TP / 20 FP / 2 candidate FN; 91 candidates arbitrated), but it did not meet zero false
    acceptance. Exact current-hard-safety execution reduced the result to 755 correct accepts while
    retaining all 20 incorrect accepts. Exact-canonical component arbitration remained a separate failure
    (66/75 correct accepted, 97/121 incorrect accepted; 40.49% precision). Verdict: **MORE ARBITER WORK
    REQUIRED**. No V10 production architecture, reviewer rerun, full-228 run, migration, production write,
    commit, or push was performed. See `docs/audits/cooking-mode-arbiter-v10a-analysis-2026-08-28.md`.

    **Frozen-candidate ingredient precision V10B experiment (2026-08-28; failed and audit-only):**
    V10B preserved the same 863 ingredient candidates and reproduced the 831 TP / 20 FP / 2 FN V10A
    disagreement-only result. The remaining 20 false accepts comprise nine 2/2 reviewer votes, ten 1/2
    votes, and one deterministic-only candidate, so automatic 2/2 acceptance cannot reach zero FP. A
    truth-blind source-risk extractor routed all 30 incorrect candidates plus 447/833 correct candidates;
    deterministic process-material rejection alone measured 829 TP / 19 FP / 4 FN. The bounded
    state-aware arbiter then measured 748 TP / 9 FP / 85 FN, rejected only 13/20 target false accepts,
    and rejected 47/82 locked historical adversarial cases. Transport was reliable: 68 primary+historical
    logical batches and four recipe-190 controls produced 72/72 successful Gateway calls with zero
    retries, parse/schema failures, or local rejections. The unresolved semantic boundary is passive
    carried-forward constituents versus rows actively targeted by continuing cooking/manipulation; the
    prompt used `VALID_CONTINUING_USE` on both sides of that boundary. The experiment also exposed a
    source-fact defect: decimal/fraction punctuation loss and unscoped instruction quantities generated
    nine invalid `QUANTITY_CONFLICT` false rejections. Verdict: **MORE INGREDIENT PRECISION WORK
    REQUIRED**. Repair row-scoped quantity extraction and define active-target/component-membership state
    before another arbiter experiment. Do not rerun reviewers, run the full corpus, activate production
    behavior, or begin prepared-component output modeling yet. See
    `docs/audits/cooking-mode-v10b-ingredient-precision-analysis-2026-08-28.md`.

    **Frozen-candidate active-target V10C experiment (2026-08-28; failed and audit-only):** V10C first
    reproduced the exact V10B 748 TP / 9 FP / 85 FN baseline, then repaired the audit-only quantity
    extractor at row scope. Raw decimal, ASCII fraction, Unicode fraction, adjacent Unicode mixed-number,
    mixed-number, and range syntax is preserved; current quantities bind only inside the candidate row's
    local mention clause. All nine V10B quantity-conflict false rejections became positive regressions
    (9/9 repaired, zero independent semantic rejections). Truth-blind state then distinguished
    `DIRECT_INGREDIENT`, `COMPONENT`, `BOTH`, `NEITHER`, and `AMBIGUOUS` targets; conservative audit-only
    component membership; and continuing manipulation, divided/reserved use, passive carry, possible
    consumption, and unknown lifecycle. The corrected bounded run used 392 frozen risk candidates plus
    all 82 historical cases. Its 67 logical batches and four recipe-190 controls completed as 71/71
    successful Gateway calls with zero retries, parse/schema failures, local rejections, or unrecovered
    transport failures. V10C rejected 18/20 V10A target false accepts and 5/7 false accepts that survived
    V10B, but finished at 669 TP / 2 FP / 164 FN, 99.70% precision, and 80.31% candidate recall; only 9/12
    historical `LOCKED_TRUTH` cases were rejected. The two remaining false accepts are the ratatouille salt
    and pepper rows under generic “taste and adjust seasoning.” Conversely, the arbiter rejected 116 valid
    candidates as passive constituents, showing that unnamed principal/category continuations remain
    under-specified. Verdict: **MORE INGREDIENT PRECISION WORK REQUIRED**. No production map, recipe,
    Firestore, route, reviewer, or full-corpus mutation occurred. See
    `docs/audits/cooking-mode-v10c-active-target-analysis-2026-08-28.md`.

    **V6–V10 repository checkpoint (2026-08-28; evidence only):** Durable audit evidence, frozen
    benchmarks, diagnostic runners, pure evaluation helpers, and regression tests are preserved in the
    repository. Failed hybrid-v9 activation was removed from the route, Queue/Discover callers,
    `lib/recipes.ts`, engine validation, and active production tests. Those production-path files match the
    approved committed state: deterministic-v5/hybrid-v5 creates new maps, persisted v4 remains compatible,
    and hybrid-v6 through hybrid-v10 fail closed as unsupported. V9/V10 helper modules retained for audit
    reproduction have no production route/runtime import. This checkpoint does not mutate or repair any
    persisted Cooking Mode map.

    **Frozen-candidate principal-target/generic-seasoning V10D experiment (2026-08-28; failed and
    audit-only):** V10D reproduced the exact V10C 669 TP / 2 FP / 164 FN baseline (18/20 target
    rejections, 9/9 quantity repairs), then investigated the two remaining semantic classes named in
    the V10C boundary. Source inspection of the ratatouille salt/pepper case showed V10C's two false
    accepts were themselves benchmark-consistent, not a labeling error: salt/pepper's sole `CORRECT`
    link is the instruction where they are first combined, and the later generic “taste and adjust
    seasoning” correctly does not re-trigger them even though the row itself reads “more to taste.”
    Every bare generic-seasoning instruction in the frozen population (only two exist) was checked;
    verdict **BENCHMARK REVIEW NOT REQUIRED**. V10D added a truth-blind principal-target extractor
    (source-evidence-gated: title match or two-plus actively-manipulated mentions), conservative
    category aliases, an active-object timeline, and a generic-seasoning-eligibility contract that
    requires a seasoning row have no earlier established use. An unguarded first pass over-accepted
    four new false positives via principal continuation — all four already had a pre-existing
    established component membership (e.g. pork chops laid over an established rice mixture before
    “cover and cook”) — so continuation eligibility was tightened to require zero prior component
    membership, which repaired all four with no new regressions. The corrected bounded run (392 risk
    candidates plus 82 historical, 71/71 successful Gateway calls across both passes, zero retries or
    failures) reached 642 TP / 0 FP / 191 FN, 100% precision, 77.07% candidate recall, and 20/20
    target-FP protection (better than V10C's 18/20), but historical `LOCKED_TRUTH` protection fell to
    4/12 (from V10C's 9/12) and candidate recall remained far below the 99.5% gate. The 164-FN
    taxonomy shows why: only 11 were `PRINCIPAL_TARGET_CONTINUATION` and 3 `DIVIDED_OR_RESERVED_USE`;
    the bulk (49 `COLLECTIVE_CONTINUATION`, 87 `OTHER`, 13 misclassified passive-carry) sit outside
    this phase's two named categories. Verdict: **MORE INGREDIENT PRECISION WORK REQUIRED**. No
    production map, recipe, Firestore, route, reviewer, or full-corpus mutation occurred. See
    `docs/audits/cooking-mode-v10d-principal-target-analysis-2026-08-28.md`.

    **V10E remaining-FN semantic taxonomy discovery (2026-08-28; read-only, no new experiment):**
    Reconstructed all 191 V10D false negatives (`finalErrors.falseRejects` joined against the V10A
    frozen-candidate evidence by `candidateId`, zero misses) and replaced the broad
    `COLLECTIVE_CONTINUATION`/`OTHER` buckets with a 10-class source-grounded taxonomy (plus two
    empty fallback classes). Every row classified; none required the `OTHER_SPECIFIC` or
    `SOURCE_PARSER_ADJUDICATION_EDGE` fallback. Dominant classes: `DISH_STATE_CONTINUATION` (58/191,
    30%, e.g. "Cover and cook on low for 6 hours" after a slow-cooker "load X, Y, Z" step),
    `PRONOUN_OR_DEICTIC_REFERENCE` (55/191, 29%, concentrated in 5 pronoun-heavy recipes), and
    `SERVING_OR_GARNISH_ACTION` (20/191, 10%). Key finding: 31/58 (53%) of the dominant class already
    carry non-empty V10C `componentMembership` at the moment V10D rejected them, and 14 componentKey
    labels (e.g. "sauce", "chicken skewer", "slaw", "spice mix") recur on **both** the FN population
    (should stay active) and the locked `historicalRegression` false-positive-risk population (should
    not) — so V10D's implemented "continuation requires zero prior component membership" gate
    over-corrected: component-membership *existence* is not the discriminator; component-membership
    *kind* (generic bulk/mixture tag vs. a truly isolated, separately-manipulated sub-component) is.
    Benchmark truth itself is consistent (an ingredient stays active through whole-dish continuation
    until isolated into a named sub-component or consumed) — the inconsistency is in V10D's detection
    heuristic, not the benchmark. Verdict **REMAINING_SEMANTIC_CLASS_ISOLATED**; recommended next
    subsystem is a per-recipe-instance active-object graph (not a broader collective-reference
    resolver, not a benchmark correction). Zero production/Firestore/map/mapping-code mutation; zero
    AI calls (fully deterministic/source-grounded). See
    `docs/audits/cooking-mode-v10e-remaining-fn-taxonomy-2026-08-28.md`.

    **V10F-Lite active-object rescue go/no-go (2026-08-28; small bounded experiment, audit-only):**
    Tested the smallest possible version of V10E's recommended active-object concept — not the full
    graph, a single narrow rule: an ingredient combined into a shared vessel by an earlier
    same-recipe instruction may be rescued at a later instruction that continues manipulating that
    object (a bare whole-dish verb, a collective/category word, or an unambiguous pronoun), unless
    the later instruction names a separately established sub-component (e.g. "the dressing") or is
    bare generic seasoning language. Against a deterministic 51-case challenge set (20 positives —
    10 `DISH_STATE_CONTINUATION` + 10 `PRONOUN_OR_DEICTIC_REFERENCE` from the V10E population; 11
    negative leakage cases; 20 locked V10A target false positives) drawn entirely from
    already-adjudicated evidence: 90.00% DISH_STATE_CONTINUATION recovery, 100.00%
    PRONOUN_OR_DEICTIC_REFERENCE recovery, 100% precision (0/31 false accepts across negative +
    locked-target-FP cases), all 20/20 target false positives stayed rejected. Verdict **GO — SIMPLE
    ACTIVE-OBJECT RESCUE WARRANTS FULL FROZEN VALIDATION**. The rule needed 6 flat, generalizable
    signal checks and 0 recipe/ingredient-specific exceptions (Phase 6 complexity check passed
    cleanly). Diagnostic-only: no production import, no runtime integration, no Firestore access, no
    AI calls, zero production/Firestore/map mutation. The only authorized next step is running this
    same unexpanded rule against the complete existing frozen candidate benchmark — not expanding the
    rule and not starting V10G. See §6,
    `docs/audits/cooking-mode-v10f-lite-active-object-go-no-go-2026-08-28.md`.

    **V10G full frozen-benchmark validation (2026-08-28; final, audit-only):** Ran the exact,
    byte-identical V10F-Lite rule (SHA-256 verified unchanged before/after) rescue-only against all
    863 frozen ingredient candidates, reconstructing the V10D baseline (642 TP / 0 FP / 191 FN,
    100% precision, 77.07% recall) directly from V10D's own recorded outcomes with no recomputation.
    Full-population result: 773 TP / 0 FP / 60 FN — 100% precision held, recall rose to 92.80% (+15.7
    points), 0 new false positives across all 30 frozen incorrect candidates (not just the 20 curated
    in the V10F-Lite challenge set), 20/20 target-FP protection, 9/9 quantity regressions still
    repaired, ratatouille generic-seasoning policy held. `DISH_STATE_CONTINUATION` recovered 96.55%
    (56/58, exceeding the 90% preferred bar) but `PRONOUN_OR_DEICTIC_REFERENCE` recovered only 83.64%
    (46/55) on the full population versus 100% on the 10-case challenge subset — the narrow
    challenge set did not generalize on this dominant class. Root cause (diagnosed, not fixed): the
    rule's establishing-instruction check requires an earlier instruction to literally name the
    ingredient's own key token, which fails when a recipe collapses several distinct ingredients
    under one generic collective word (e.g. an instruction says "spices" without naming cumin/basil/
    thyme/oregano individually) — a genuine limitation of literal-token matching, not a
    benchmark-labeling or reconstruction defect. Per the pre-committed gate (both dominant classes
    must clear 85%), verdict **FAIL — ACTIVE-OBJECT RESCUE DOES NOT GENERALIZE**; architecture
    recommendation **STOP ACTIVE-OBJECT DETERMINISTIC REFINEMENT — REASSESS AI-AT-INGESTION
    ARCHITECTURE**. The rule was not modified, expanded, or tuned to the full benchmark at any point
    (SHA-256 identical throughout). Zero production/Firestore/AI/mapping-code mutation. Production
    remains approved v4/v5. See §6,
    `docs/audits/cooking-mode-v10g-active-object-full-frozen-validation-2026-08-28.md`.

    **2026-08-28 mapping architecture reassessment (decision; no implementation):** The selected
    future architecture is **AI-at-ingestion with review**: two independent blind whole-recipe
    reviewers produce a high-recall candidate union; a narrow, versioned deterministic support layer
    attaches source/lifecycle/component/quantity risk evidence and may auto-accept only a separately
    frozen zero-FP subset; every disagreement, risk flag, component relation, or unsupported semantic
    class receives human review; and only an immutable, source-hash-bound approved map becomes
    canonical. Reviewer agreement is a routing signal, not truth: the frozen intersection still had
    9 FP, and the recomputed full-228 intersection had 19 FP. Broad deterministic vetoes remain
    prohibited because V9–V10D repeatedly removed correct relationships. V10G remains useful as
    safe-accept/review-prioritization evidence, not as authorization for another deterministic mapper
    subsystem; its 773-accept frontier is not yet a standalone deterministic router because the V10D
    baseline included bounded arbiter decisions. Existing-corpus remediation should use stricter
    complete human review, then an immutable-manifest/SHA-locked, zero-AI, zero-recomputation apply.
    Cooking Mode runtime remains 0-AI and production stays on approved v4/v5 until a separate
    implementation passes the final precision/recall gates. The only next task is **DESIGN
    REVIEW-ROUTING CONTRACT**. See
    `docs/audits/cooking-mode-mapping-architecture-reassessment-2026-08-28.md`.

    **Prompt 3 Cooking Mode consumption:** runtime precedence is the effective recipe content
    (`meta.overrides.content || recipe.content`) → parse the exact displayed ingredients and
    instructions → synchronously build the conservative deterministic mapping → compute the
    canonical source hash and validate any persisted map's schema, parser version, supported engine,
    exact source hash, and complete structure → use the persisted deterministic/hybrid map only when
    every check passes; otherwise keep the deterministic mapping. A persisted map is never displayed
    before asynchronous hashing completes, and stale async results are source/object guarded. Missing,
    stale, unsupported, or malformed maps fail closed as a whole without technical fallback UI.
    Cooking Mode performs no mapping API/AI request and no mapping write.

    **2026-08-25 mapping remediation:** The production-audit deterministic/AI/validator failures are
    fixed in deterministic-v2/hybrid-v2/prompt-v2 and locked by corpus-derived final-map regressions.
    A bounded read-only 27-recipe live validation reviewed 59 accepted relationships across two final
    passes: 59 correct, 0 ambiguous, 0 incorrect; the prior stability subset improved from 10/20 to
    1/20 material differences (safe omission versus a correct association). This authorizes a fresh
    full production dry run only. It does not authorize backfill. See
    `docs/audits/cooking-step-mapping-remediation-validation-2026-08-25.md`.

    **2026-08-26 deterministic-v3 active-use remediation:** All nine deterministic-v2 false-positive
    recipes were reproduced from the semantic evidence and fixed or safely unresolved. A read-only
    deterministic-v3 audit covered all 236 shared recipes (187 source-eligible, 49 source/parser
    exclusions), and an expanded 80-recipe review classified 544 references as safe mappings, 242
    fully unmapped instructions as safe omissions, and 0 recipes with a confirmed false positive.
    A bounded read-only 25-recipe prompt-v2 compatibility run reviewed all 22 accepted additions as
    correct (0 ambiguous, 0 incorrect); its 20-recipe repeat was 20 `EXACT_STABLE` with zero unsafe
    disagreement. Prompt v2, `openai/gpt-5.6-luna`, and temperature 0 are unchanged. This passes the
    gate for a completely fresh full production hybrid-v3 dry run only; it does not authorize either
    historical manifest or any backfill. See
    `docs/audits/cooking-step-mapping-v3-remediation-validation-2026-08-26.md`.

    **2026-08-26 deterministic-v4 precision remediation:** The subsequent fresh full hybrid-v3 audit
    found five deterministic false positives in four recipes: Mexican Oaxacan Bowl, Creamy Kale
    Pasta, Schmancy Hot Smoked Salmon (two independent failures), and Chili Lime Fish. The v3
    manifest is therefore historical evidence and is not apply-authorized. Deterministic-v4 fixes
    consumed-row reuse, unlisted/fresh-process material borrowing, contextual use, and purpose/form/
    garnish leakage. A new read-only deterministic pass covered all 236 shared recipes and an
    exhaustive review adjudicated every one of the 187 source-eligible recipes and all 1,040 mapped
    references: 1,040 safe, 0 false positives; all 518 unmapped instructions were safe omissions. A
    bounded 25-recipe prompt-v2 compatibility run reviewed 28/28 accepted additions as correct (0
    ambiguous, 0 incorrect), with 19/20 exact stability, one safe-omission difference, and zero unsafe
    material differences. Prompt v2, `openai/gpt-5.6-luna`, temperature 0, and validator semantics are
    unchanged. This authorizes only a separate completely fresh full production hybrid-v4 dry run; it
    does not authorize backfill. See
    `docs/audits/cooking-step-mapping-v4-remediation-validation-2026-08-26.md` and
    `docs/audits/cooking-step-mapping-deterministic-v4-review-2026-08-26.json`.

    **2026-08-26 immutable-manifest production backfill:** The apply workflow accepted only
    `docs/audits/cooking-step-mapping-dryrun-v4-2026-08-26.json` at exact SHA-256
    `b07208384369183e70782f2e017fcea141d9436d43d7ea523133c72cd6435a88`. A complete live dry run
    classified all 187 READY rows as READY_TO_WRITE with zero skips or unexpected errors. One
    update-time-preconditioned Firestore batch then committed 187 field-only
    `cookingStepIngredientMap` updates. Full readback proved 187/187 exact manifest candidates,
    source-hash matches, and validator passes; raw document comparison excluding only the map found
    zero other field differences, and all 49 EXCLUDED recipes were unchanged. A separate post-apply
    dry run produced zero write candidates and 187 `MAP_ALREADY_PRESENT` skips. The apply made zero
    AI calls, invoked neither deterministic nor hybrid mapping generation, and made zero candidate
    substitutions. See `docs/audits/cooking-step-mapping-v4-apply-2026-08-26.md`.

    **2026-08-26 recovered-recipe deterministic-v5 remediation:** The recovered-41 hybrid-v4 audit
    exposed seven deterministic false positives and one repeated AI relationship: consumed/wrong-group
    salt, chile, garlic, and onion rows; fresh egg-boiling water; a finished-dish `chili` collision;
    truncated mixed-number usage; and AI reuse of consumed vinaigrette salt. V5 centralizes exact-row
    availability across deterministic and AI validation without recipe-ID exceptions. A fresh live
    read-only pass reviewed all 41 repaired recipes, all 295 deterministic references, and all 111
    fully unmapped instructions: 295 safe mappings, 111 safe omissions, 0 false positives, and 0
    invalid candidates. All 187 persisted v4 maps retained matching hashes, structural validity, and
    runtime selection with zero fallbacks. A fixed 26-recipe bounded prompt-v2 run reviewed all 25
    accepted primary/repeat relationships as correct (0 ambiguous/incorrect); stability was 23 exact,
    3 safe-omission differences, and 0 unsafe differences. Prompt v2, model, and temperature remain
    unchanged. Recipe/map/Firestore writes were zero. This passes remediation and authorizes only a
    completely fresh 41-recipe hybrid-v5 audit; it does not authorize apply. See
    `docs/audits/recovered-recipes-mapping-v5-remediation-validation-2026-08-26.md` and
    `docs/audits/recovered-recipes-mapping-v5-semantic-review-2026-08-26.json`.

    **2026-08-26 recovered-v5 immutable-manifest production apply:** The recovered-specific writer
    accepted only `docs/audits/recovered-recipes-mapping-v5-dryrun-2026-08-26.json` at SHA-256
    `5d4ddaa10c788f9192ae74a5887859bc2847496706461b655752d86e62741170`. Its complete production
    dry run evaluated 41 READY rows as 41 READY_TO_WRITE with zero skips/errors. One update-time-
    preconditioned Firestore batch committed 41 field-only `cookingStepIngredientMap` updates using
    the exact manifest candidates. Readback proved 41/41 exact candidate matches, source hashes, and
    validator passes with zero raw non-map differences. The original 187 v4-map documents and eight
    unresolved documents were unchanged; the unresolved eight remain map-free. A separate dry run
    then returned zero write candidates and 41 `MAP_ALREADY_PRESENT` skips. AI calls, deterministic/
    hybrid mapping generations, and candidate substitutions were all zero. Production now has 228
    mapped and eight unmapped recipes, with reviewed v4 and v5 maps intentionally coexisting. See
    `docs/audits/recovered-recipes-mapping-v5-apply-2026-08-26.md`.

    Personal content overrides are mapped from their effective parsed source. A changed ingredient,
    instruction, or ordering normally invalidates the shared stored map and uses the deterministic
    fallback; a canonically source-equivalent override may safely retain it. Override-specific maps
    are not persisted. Validated persisted prepared components render as subordinate, non-checkable
    `Prepared: …` context and never enter All Ingredients. `remaining` and explicit partial
    `quantityText` usage render as subtle qualifiers without changing raw ingredient text or doing
    quantity arithmetic. Ingredient check state is keyed by original ingredient index, so duplicate
    identical rows remain distinct while the step and All Ingredients views share state.

---

## Section 6 — Known Sharp Edges

- **Recipe total time is derived, so source labels cannot be copied blindly.** Firestore stores only
  `prepTime` and `cookTime`; `getTotalTime` sums whatever `parseTimeToMinutes` extracts. Range/prose
  strings can therefore produce surprising values — for example the former Chicken Tikka
  `20 minutes (plus 2-6 hours marinating)` prep string parsed as 6 hr 20 min — and pressure-cooker
  sources often omit pressure build/release from their displayed “cook time” even when it is included
  in their total. Store parser-compatible expected elapsed values, keep passive caveats in recipe
  content, and verify the resulting derived total. The manifest-driven `update-recipe-times.js` is
  dry-run by default, requires live preconditions/fingerprints for apply, and can write only
  `prepTime`/`cookTime`; see `docs/audits/recipe-time-audit-2026-08-24.md`.

- **Firebase Storage is not provisioned for `malignant-metro`.** `lib/firebase.ts` declares
  `storageBucket: "malignant-metro.firebasestorage.app"`, but as of 2026-08-21 that bucket does
  not exist (`bucket.exists()` via the Admin SDK returns `false`), and neither does the legacy
  `malignant-metro.appspot.com` naming. No code in the repo has ever successfully uploaded to
  Storage — grep for `getStorage`/`getDownloadURL` turns up only `scripts/_lib.js`'s unused
  `storage()` accessor (added for the AI-photo-generation script below) and its own existence
  check. Enabling Storage requires a console/project-level step (Firebase Console → Storage →
  Get started) and may have billing implications on this project, which is **shared across
  multiple apps** — do not enable it from a script or CLI without the user's explicit go-ahead.
  `scripts/generate-photos.js` (AI-generated fallback photos for the 18 recipes with no good
  real-photo match — see the imageURL sharp edge above) is written and ready but has never been
  run because of this.

- **Firestore rules are console-only — do not version them here.** A `firestore.rules` file was
  briefly committed with the auto-nutrition-on-publish work and then removed: the `malignant-metro`
  database is **shared across multiple apps**, so a `firebase deploy` of rules from this repo would
  overwrite the other apps' rulesets. The authoritative ruleset lives exclusively in the Firebase
  console for `malignant-metro` (it includes the `users/{uid}/nutrition/{document=**}` rule added
  after the earlier silent-write incident). See **Firestore rules** below; when adding a collection,
  update the rule in the console, not in this repo.
- **`weekPlans.plannedRecipeIDs[]` holds mixed shapes — always normalize, never `arrayUnion`.**
  After Batch 5 elements are `PlannedEntry` objects, but legacy docs still hold bare `string`s until a
  writer upgrades them. Any reader MUST go through `normalizePlanned`/`plannedRecipeIDList`
  (`lib/userdata.ts`) — a raw `.includes(recipeID)` or `.map(id => …)` over the array will break on
  object elements. Writers must be read-modify-write: `arrayUnion`/`arrayRemove` compare by deep value
  and silently fail to dedupe/remove object elements. `cookedRecipeIDs[]` is unaffected (still `string[]`).
- **AI is centrally configured.** All AI routes call the helpers in `lib/ai.ts`; provider,
  model, prompt version, cache version, and provenance live in `lib/aiConfig.ts`. Production
  uses Vercel AI Gateway authentication (`AI_GATEWAY_API_KEY`, with Vercel OIDC supported by
  the provider). There is no direct-provider fallback.
- **Firebase web config is hardcoded** in `lib/firebase.ts` (apiKey, project, appId). This is
  normal for Firebase web apps but means the client config is committed, not env-driven.
- **MFP nutrition sync is HTML scraping, not an API — validate before wiping.** `app/api/cron/sync-nutrition`
  fetches the classic diary page and parses it with `cheerio`; food rows are selected by
  `a[data-food-entry-id]`, nutrients by **header name, never position**: MFP's diary columns are
  **user-configurable** (the stock default has Sodium where this account shows Fiber), so the route
  reads the first `tr.meal_header` row's label cells and maps columns to the six macro fields by
  case-insensitive name (`resolveColumnMapping`). A macro whose column is absent writes **0** (values
  are never shifted sideways); an unrecognisable header row **hard-aborts the sync** (502, no
  positional fallback, nothing written); the resolved per-date mapping is echoed in the response
  (`columnMapping`) so a manual trigger shows what matched. It is inherently fragile to MFP markup
  changes. Guard rail: an expired session redirects to login (a page with **no `tr.meal_header`**),
  so the route treats "zero meal_header rows" as a hard error and returns **before** the Firestore
  wipe-and-replace — a broken fetch must never look like an empty day. Both target dates are fetched +
  validated before any delete. The old v2-JSON-API path and `MFP_CSRF_TOKEN`/`mfp-client-id` header
  were the wrong endpoint (registered-partner OAuth API) and are gone. Client-side staleness signal:
  the Nutrition page shows a dismissible banner when no `source:'mfp'` entry exists in the last
  `MFP_STALE_AFTER_DAYS` (2) days — derived from the Today view's own range fetch, no extra query,
  nothing stored.
- **Password login needs the Email/Password provider enabled in the Firebase console (Batch 7).**
  The linking flow, the login-screen email/password sign-in, and password reset all throw
  `auth/operation-not-allowed` until **Authentication → Sign-in method → Email/Password** is enabled
  for `malignant-metro`. This is a one-time manual console step — it cannot be done from code. The
  re-auth needed for `auth/requires-recent-login` (and the calendar push, Batch 6) uses
  `reauthenticateWithPopup`, so like the calendar push it can be blocked in popup-blocked /
  standalone-PWA contexts; setting up a password from a desktop browser avoids this. Password reset
  only does anything for accounts that actually linked a password — a Google-only account has nothing
  to reset, which the neutral "if an account with a password exists…" confirmation covers without
  leaking which emails are registered.
- **URL import can't reach paywalled sites.** `/api/ai-ingest` server-fetches the page with a
  generic User-Agent; paywalled/login-walled sites (e.g. NYT Cooking) return blocked content.
  Despite the current setup copy, the **bookmarklet** at `/queue#bookmarklet` sends the URL plus
  image/time metadata; it does **not** send captured page DOM from the logged-in browser. AI ingest
  therefore still server-fetches the blocked URL. Pasting recipe text directly is the current
  reliable fallback. Authenticated DOM capture or corrected UI claims remain backlog work.
- **Ingredient source-contamination cleanup is only at Phase 1.** The content parser now removes
  the evidence-backed metadata/control/boundary classes and shared subheaders cannot become grocery
  or nutrition inputs, while all 173 reviewed legitimate occurrences remain. The read-only Phase 1
  corpus still contains 23 ingredient-parser artifacts plus the explicitly deferred `sasy-notes`,
  `mole-poblano`, and `chipotle-tahini-bowls` source-data defects. AI-ingest semantic quarantine and
  authenticated bookmarklet DOM capture are also not implemented; parser defenses reduce downstream
  impact but do not make noisy persisted input impossible.
- **Image display precedence.** Cards and detail prefer `meta.overrides.imageURL` over the
  catalog `recipe.imageURL` (`RecipeCard.tsx`, `RecipeEditModal.tsx`). A stale override will
  win over a corrected catalog image.
- **"Add to Plan" popover** on `RecipeCard` lets you pick a week (current +0…+4), writes via
  `addRecipeToWeekPlan`, shows an "Added!" confirmation, and auto-closes after ~1.5s. It is
  rendered at `z-[100]`; the recipes-page time-filter dropdown is `z-50` — keep popover layers
  above page chrome to avoid the historical z-index overlap.
- **Recipe doc IDs are slugified titles.** Two recipes with the same title collide on the same
  `recipes/{slug}` document; `saveRecipe` overwrites by slug.
- **Some `imageURL`s are hotlinked to external hosts, not Firebase Storage.** The Aug 2026 photo
  backfill (`scripts/audit-missing-photos.js` + `scripts/apply-photo-matches.js`) filled 13 recipes'
  missing `imageURL` with Wikimedia Commons/Openverse URLs (`upload.wikimedia.org`,
  `live.staticflickr.com`) written as-is — no re-upload to Storage. If the source file is ever moved
  or deleted, that recipe's image breaks with no local fallback. 18 recipes were left with no
  `imageURL` at all (audit found 34 missing; 3 non-recipe/malformed docs — `sasy-notes`, `smoothies`,
  a URL-titled doc — were skipped by request; of the remaining 31, only 13 had a candidate that was
  both correctly licensed and, on actual visual inspection, depicted the right dish — text-only
  Commons/Openverse search alone had a high false-positive rate, e.g. matching tandoori chicken for a
  Lebanese chicken recipe or an unrelated museum-artifact photo for "beans, greens and grains").
- **`docToRecipe` whitelists fields.** `lib/recipes.ts` maps an explicit field list — any new
  recipe-doc field (e.g. `nutrition`, `servings`) is silently dropped on read until added to the
  mapper. Backfilled data won't reach the UI otherwise.
- **Two servings controls — know which writes where (Batch 3).** The recipe-detail "Your serving
  size" stepper (`NutritionSection`) writes the **per-user** `meta.overrides.servings` and only
  changes that viewer's per-serving derivation (`total ÷ effectiveServings`, computed live — §5.17).
  The edit modal's "Recipe default servings · shared" input still mutates the **shared**
  `recipes/{id}.nutrition` for everyone via `updateRecipeServings` (it corrects a genuinely-wrong
  stored default; `nutrition.total` only lives on the shared doc). This shared write is the **one**
  servings path that crosses users — keep its label explicit. The edit modal preserves
  `overrides.servings` when saving other edits so a personal serving size isn't clobbered.
- **Confidence ≠ macro plausibility (re-validation gotcha, Batch 3).** The engine's
  `nutrition.confidence` is driven by servings-defaulting, AI-tier usage, and kcal-band validation —
  **not** by whether a macro is realistic. A USDA match that passes the kcal band but is
  semantically wrong (e.g. a sweet sauce inflating "Easy Spaghetti" sugar) reads as `medium`/`high`.
  `/api/nutrition-revalidate` re-running the same engine recovers servings and can lift such a
  recipe `low → high` **without** changing the bad macro — so always review the dry-run diff (it
  shows confidence jumping while the macro is unchanged) before `?apply=true`. A real fix is an
  engine-level ingredient-resolution correction (canonical staples), not the re-run tool — **Batch 4
  builds exactly that** (§5 #22, `lib/canonicalStaples.ts`). Its DRY-RUN diff
  (`batch4-canonical-dryrun.md`) showed the true root cause of Easy Spaghetti: the line "spaghetti,
  pappardelle or other long pasta" was fuzzy-matched to **"Frozen yogurts, flavors other than
  chocolate"** (19.9 g sugar/100 g); the canonical table routes it to "Pasta, dry, enriched", dropping
  per-serving sugar **18.3 → 3.7 g**. Those corrected macros were **applied** in Batch 4-apply (136
  recipes written on Vercel with the full AI-on engine; revert via each doc's `nutrition_prev` field
  + `batch4-apply-revert-manifest.json`). Easy Spaghetti is now stored at per-serving sugar 3.7 g.
- **Canonical staples table is AUTO-GENERATED — don't hand-edit (Batch 4).** `lib/canonicalStaples.ts`
  is emitted by `scripts/verify-canonical-staples.js` (curated seeds → live USDA search → detail-endpoint
  per-100g macros → kcal-band check). To change/add an entry, edit the **seed list in the script** and
  re-run it (it re-verifies every entry live and overwrites the file), not the `.ts` directly. The
  generated entries are SR Legacy/Foundation only; `rice vinegar` is intentionally **excluded** (no plain
  USDA entry) and falls through to the fuzzy matcher. The script also runs a **lint** (Batch 4-fix) that
  fails generation if any alias collapses to a bare single token (a catch-all — the "minced beef"→`{beef}`
  / "half and half"→`{half}` class) or any `guard` term is itself a `DESCRIPTOR_WORD` (stripped before the
  guard runs → defanged). When adding a seed: never let an alias's only distinguishing word be a descriptor
  (`minced`, `fresh`, `whole`, `and`, `peeled`…), and guard on a token that survives `keyTokens`. The dry-run tool runs locally **without
  AI Gateway authentication**, so it computes baseline (canonical-off) and proposed (canonical-on) in the same
  AI-less runtime — the `canonicalΔ` is exact, but absolute totals for AI-dependent recipes read lower
  than the stored `old`, and the high/medium confidence split is a local lower bound. **The locally generated
  Batch-4 diff is review-only and performs no writes. The route's explicit authenticated/admin-gated
  `?apply=true` path is the separate apply step; it conservatively writes only canonical-attributable,
  material, non-confidence-downgrade results and was used for the documented Batch 4 apply.**
- **Legacy recipe category compatibility is now defensive historical support.** The 2026-08-25
  exact-manifest transaction normalized 66 shared categories and removed 24 redundant/legacy
  `overrides.category` fields; post-apply verification found 236/236 shared values canonical and
  only the intentional recipe `182` override (`Salads & Bowls`) remaining. Keep the deterministic
  aliases and exact recipe-ID compatibility in `lib/recipeCategories.ts` for historical inputs and
  restored/old data; they do not indicate a current production normalization dependency and still
  never infer unknown records or persist read-time normalization.
- **Cooking Mode wake lock is best-effort.** `components/CookingMode.tsx` uses the Screen Wake
  Lock API (`navigator.wakeLock.request('screen')`), re-acquiring on `visibilitychange`. Browsers
  without the API (notably iOS Safari historically) silently no-op — the screen may still sleep.
  The takeover is `fixed inset-0 z-[100]`, sharing the same layer as the Add-to-Plan popover; it
  covers the `z-50` HubBanner. Its checked-ingredient / current-step / timer state is in-memory only
  and resets on each launch (no persistence). **Step timers (Batch 9)** are tap-to-start only and
  parsed conservatively from step text (ranges → longer bound; cadence like "every 2 minutes" and
  temps/quantities excluded). Remaining time is computed from a stored target timestamp, so it stays
  correct across tab backgrounding (not a naive `setInterval` decrement). The finish alert — short
  Web-Audio beep + `navigator.vibrate` — is best-effort and feature-detected: it may be blocked while
  the tab is backgrounded/locked, but the visual "Done!" flash and the correct remaining-time-on-return
  always work (the wake lock above keeps the screen on while in Cooking Mode).
- **Cooking-step mapping still has override and recall limitations.** Production Cooking Mode rejects
  stale/unsupported/malformed persisted maps and uses the conservative deterministic engine; the legacy
  terminal-token mapper has no production use. The shared corpus now has persisted maps on 228/236
  recipes (187 v4 plus 41 v5). Personal content overrides do not persist override-specific maps, so a
  source-hash-changing override falls back to deterministic-v5 even when the shared recipe has a valid
  hybrid map. Parser-defective legacy recipe content remains outside mapping correctness and must be
  remediated separately. The full completeness audit below proves that a valid persisted map is not by
  itself evidence of adequate recall.
- **The 2026-08-25 existing-corpus hybrid dry run is not safe to backfill.** The read-only audit
  inspected all 236 shared recipes (zero persisted maps), classified 187 as source-eligible and 49
  as parser/content exclusions, and reviewed every one of 214 validator-accepted AI additions.
  Eight AI additions were semantically incorrect, including prepared-component labels for unspecified
  toppings, a previously used oil selected by "remaining ingredients," associations derived from
  copied reader-review prose, and overreaching `all` usage metadata. The stratified 20-recipe repeat
  pass was only 9 exact / 1 semantically stable / 10 materially different. Separately, the 40-recipe
  deterministic review found obvious false positives in 9 recipes: alternative aliases matched
  `coconut milk/broth` to an oil row, generic `chicken` selected chicken broth, negative/header context
  selected wrong ingredient groups, and distinct chile forms collided. The immutable manifest contains
  168 `READY`, 7 `REVIEW`, 61 `EXCLUDED`, and 0 `ERROR` rows, but its executive verdict is
  **NOT READY FOR BACKFILL** because these are systemic engine/prompt/validator limitations. No recipe
  was mutated and production still has zero persisted maps. See
  `docs/audits/cooking-step-mapping-dryrun-2026-08-25.md`.
- **The historical 2026-08-25 cooking-step manifest is permanently invalid for apply after v2
  remediation.** Deterministic-v2 preserves alternative head nouns/modifiers, guards negative and
  non-actionable context, and requires bounded collective/group scope. Hybrid-v2 shares stricter local
  ingredient/usage/component grounding between merge and runtime validation; prompt-v2 is
  precision-first and temperature 0. The bounded 27-recipe final validation found 59/59 accepted
  relationships correct and improved the prior stability subset to 19 exact / 0 semantically stable /
  1 material omission difference / 0 errors. This remediates the known mapping failures but does not
  make the old 168 `READY` rows current: every old candidate was produced by stale engine/prompt/
  validator semantics. A fresh full production hybrid dry run and new immutable manifest/hash are
  required before backfill can be reconsidered. See
  `docs/audits/cooking-step-mapping-remediation-validation-2026-08-25.md`.
- **The fresh 2026-08-26 full production v2 dry run is NOT READY FOR BACKFILL.** The read-only
  run independently regenerated all 236 current shared recipes from live `content` under schema 1,
  parser `recipe-content-v1`, deterministic-v2/hybrid-v2, prompt v2, `openai/gpt-5.6-luna`, and
  temperature 0. Production still had zero persisted cooking-step maps; 187 recipes were source-
  eligible and 49 retained source/parser exclusions. All 84 accepted AI relationships across the
  primary and 30-recipe stability runs were reviewed as correct (0 ambiguous, 0 incorrect), and the
  hardened validator rejected or stripped 591 unsafe/unsupported suggestions or metadata. However,
  the 60-recipe deterministic review found confident false positives in 9 recipes: wrong-group
  salt/garlic, instruction-heading and supplemental-note matches, contextual rather than active use,
  prepared-component leakage to a raw ingredient, unlisted water reuse, a bare ingredient-section
  label treated as food, and mismatched partial-use quantity metadata. The stability rerun was 26/30
  exact and 4/30 materially different (all safe omission versus correct association), exceeding the
  5% automatic-backfill target. The immutable v2 manifest contains 176 `READY`, 2 `REVIEW`, 58
  `EXCLUDED`, 0 `ERROR`, and 0 `EXISTING_MAP` rows, with SHA-256
  `69a13a5c2a2366d372d747035a85df38bb702bbadc84df6f8a450d91ee0a73a0`, but its corpus verdict
  blocks every apply because the deterministic defects are systemic. No existing recipe was
  backfilled. See `docs/audits/cooking-step-mapping-dryrun-v2-2026-08-26.md`.
- **Deterministic-v3 remediates the v2 active-use precision failures but does not authorize
  backfill.** The v2 false positives were identity mentions without sufficient evidence of active use:
  contextual protein nouns, wrong duplicate salt/garlic/oil rows, mismatched quantity evidence,
  prepared-component constituent leakage, headings/labels, supplemental prose, and clause-local
  negative/deferred or incidental material context. Deterministic-v3 now requires clause-local action
  binding and row-specific evidence, and safely abstains when that evidence is absent. Its read-only
  full-corpus metrics are 509 mapped / 468 unmapped instructions and 1,134 ingredient references across
  187 source-eligible recipes, compared with v2's 592 / 385 and 1,300; reduced coverage is the intended
  precision tradeoff. The expanded 80-recipe review found 0 confirmed false-positive recipes, and the
  bounded prompt-v2 compatibility check found 22/22 accepted additions correct with 20/20 exact-stable
  repeats. Both the v1 manifest (SHA-256
  `03cccba16232237f2ffb8b0c1971ec3a66732da8a0f1480717769ac5f25093ae`) and v2 manifest (SHA-256
  `69a13a5c2a2366d372d747035a85df38bb702bbadc84df6f8a450d91ee0a73a0`) are historical, stale under
  v3, and **NOT AUTHORIZED**. A fresh full hybrid-v3 dry run must generate a new immutable manifest and
  hash before backfill can be reconsidered. Production writes remained zero. See
  `docs/audits/cooking-step-mapping-v3-remediation-validation-2026-08-26.md`.
- **The fresh 2026-08-26 full production hybrid-v3 dry run is NOT READY FOR BACKFILL.** The
  read-only audit regenerated all 236 current shared recipes from live `content` at audited SHA
  `cfdf9c245ad882a0ef422bd429aca16ec97bf196` under schema 1, parser `recipe-content-v1`,
  deterministic-v3/hybrid-v3, prompt v2, `openai/gpt-5.6-luna`, and temperature 0. Production
  still had zero persisted cooking-step maps; 187 recipes were source-eligible and the same 49
  current source/parser defects remained excluded (they were not repaired). The full deterministic
  baseline remained 509 mapped / 468 unmapped instructions and 1,134 ingredient references. All
  109 accepted AI relationships across the primary and 40-recipe stability runs were reviewed as
  correct (0 ambiguous, 0 incorrect), while the unchanged validator rejected or stripped 658
  suggestions or metadata. Stability was 37/40 exact, 3/40 reviewed safe-omission differences, and
  0 unsafe material differences. However, the expanded 100-recipe deterministic review found five
  confident false positives in four recipes: a slaw oil mapped into a sheet-pan component, consumed
  sauce salt reused as unlisted finishing salt, a contextual salmon mention plus measured brine water
  reused as fresh rinse water, and a garnish chile selected for a sauce instruction. These span
  systemic wrong-group, consumed-row, contextual-use, and unlisted-use precision classes, so neither
  unrestricted nor restricted apply is authorized. The immutable v3 manifest contains 181 `READY`,
  2 `REVIEW`, 53 `EXCLUDED`, 0 `ERROR`, and 0 `EXISTING_MAP` rows, with SHA-256
  `d4e381889e903016b57bd5c0ae7e6922035d3fb946858e04cfd6be15b98f396b`; it is evidence for
  remediation, not authorization to apply. Production writes remained zero. See
  `docs/audits/cooking-step-mapping-dryrun-v3-2026-08-26.md`.
- **Deterministic-v4 passes its exhaustive precision gate, but backfill remains blocked.** The five
  hybrid-v3 audit failures were lifecycle and row-identity defects: unlisted sheet-pan oil borrowed a
  slaw row, consumed sauce salt was reused for unlisted finishing salt, a contextual salmon mention
  was treated as use, measured brine water was reused as fresh rinse water, and optional fresh garnish
  chile leaked into sauce aromatics. V4 tracks private per-build row use, requires explicit grounded
  reuse, preserves purpose/form/group evidence, and abstains for unlisted/fresh process material. Its
  read-only production baseline is intentionally more conservative than v3: 459 mapped / 518 unmapped
  instructions and 1,040 ingredient references across the same 187 eligible recipes. Every eligible
  recipe, all 1,040 references, and all 518 safe omissions were reviewed; false-positive mappings and
  recipes were both zero. Bounded unchanged prompt-v2 validation found 28/28 accepted additions
  correct, with 19 exact repeats, one safe-omission difference, and zero unsafe differences. Runtime
  now accepts only deterministic-v4/hybrid-v4 maps; v1/v2/v3 maps fail closed. All three historical
  manifests are **NOT AUTHORIZED**. No v4 manifest exists, and the next full hybrid-v4 audit remains a
  separate read-only session. See
  `docs/audits/cooking-step-mapping-v4-remediation-validation-2026-08-26.md`.
- **The fresh 2026-08-26 full production hybrid-v4 dry run is READY FOR BACKFILL APPLY, but no
  backfill occurred.** The immutable read-only audit ran at Git SHA
  `abd3e82e8d64ca4dd5dde6ca754f5d4260411525` with behavior fingerprint
  `d0580cf952d58595b4eb8dc0c81212900357e928817f07a18fddff72d4d02ced`, schema 1, parser
  `recipe-content-v1`, deterministic-v4/hybrid-v4, prompt v2, `openai/gpt-5.6-luna`, and
  temperature 0. A final live reread confirmed the same source hashes and frozen behavior.
  Production still contained 236 shared recipes, zero persisted cooking-step maps, 187 eligible
  recipes, and the same 49 source/parser exclusions. Exact byte-equivalent exhaustive v4 evidence
  remained valid for all 187 eligible recipes and all 1,040 deterministic references: 1,040 safe
  mappings, 518 safe omissions, and zero false-positive mappings or recipes. The full primary pass
  made 94 Gateway requests (zero retries/failures), accepting 45 ingredient associations, 26
  prepared components, and 2 usage qualifiers. Across the primary pass and 50 stability reruns,
  all 134 accepted semantic relationships were manually reviewed: 134 correct, zero ambiguous,
  zero incorrect. Reviewed stability was 46 exact, 1 semantically stable, 3 safe-omission
  differences whose primary candidates were explicitly approved, zero unsafe material differences,
  and zero errors. Final classification is 187 READY / 0 REVIEW / 49 EXCLUDED / 0 ERROR / 0
  EXISTING_MAP. The immutable manifest is
  `docs/audits/cooking-step-mapping-dryrun-v4-2026-08-26.json`, SHA-256
  `b07208384369183e70782f2e017fcea141d9436d43d7ea523133c72cd6435a88`.
  This audit authorizes only creation of a separate manifest-SHA-locked apply workflow. That future
  workflow must make zero AI calls, perform zero mapping recomputation, fail closed on live
  existence/map-absence/source-hash/validator preconditions, and write only the exact approved
  `cookingStepIngredientMap` candidate. Firestore remained read-only throughout this audit. See
  `docs/audits/cooking-step-mapping-dryrun-v4-2026-08-26.md` and
  `docs/audits/cooking-step-mapping-semantic-review-v4-2026-08-26.json`.
- **The exact v4 existing-corpus backfill was applied on 2026-08-26; maps remain source-bound.** The
  immutable manifest SHA-256 was
  `b07208384369183e70782f2e017fcea141d9436d43d7ea523133c72cd6435a88`; 187 maps were written and
  zero READY rows were skipped. The 49 source/parser-excluded recipes received no writes and remain
  deterministic-v4 runtime fallback only. Any later effective content change that alters the parsed
  source hash invalidates a persisted map at runtime. Personal content overrides likewise keep the
  shared persisted map only when canonically source-equivalent and otherwise safely fall back to
  deterministic-v4; override-specific maps remain pending. See
  `docs/audits/cooking-step-mapping-v4-apply-2026-08-26.md`.
- **Wave 1A repaired the zero-collateral parser subset; remaining source/data defects are still
  excluded.** The 2026-08-26 implementation was simulated against all 236 live recipes by comparing
  the immutable pre-change parser with the new parser on one production snapshot: 200 `NO_CHANGE`, 36
  expected excluded-recipe improvements, and 0 unexpected changes. All 187 persisted-map recipes kept
  byte-identical ingredient arrays, instruction arrays, and canonical source hashes, with 0 stored-hash
  mismatches or map invalidations; `recipe-content-v1` therefore remains valid. The 28 parser-only rows
  are parse-clean. Twenty-one recipes remain excluded: the six mixed parser/data rows, seven data-only
  rows, five reimports, Maple Pecans manual-source recovery, and two product decisions. No recipe or map
  was written, and newly parse-clean recipes still require fresh sourceHash-bound mapping generation,
  semantic review, and a later separately authorized apply. Generic NOTES, Tip, and first-person
  terminators remain prohibited. See
  `docs/audits/excluded-recipe-parser-wave1a-validation-2026-08-26.md`.
- **Wave 2 repaired all six mixed parser/data recipes with content-only, source-derived writes.**
  `chicken-enchiladas`, `chicken-stew`, `couscous-salad-with-lime-basil-vinaigrette`,
  `creamy-cauliflower-soup-with-rosemary-olive-oil`, `pepper-steak`, and `pork-fried-rice` were
  reserialized from their exact existing production text after a 6 READY / 0 SKIP immutable dry run
  (manifest SHA-256 `04108a7264db428862c7d5c52da0c3191f005ad138edb5bf290dba7ec292b151`).
  Audit-proven chrome/metadata was removed, useful storage/tip/note text was moved outside the
  Cooking Mode ingredient/instruction spans, and no ingredient, quantity, method, or other recipe
  fact was invented. One preconditioned batch updated only `recipes/{id}.content`; exact readback
  confirmed 6/6 content and parse matches, zero non-content field changes, zero persisted-map
  changes, zero mapped-recipe changes, and zero writes outside the six authorized IDs. All six still
  have no `cookingStepIngredientMap`, and the post-apply planner returned zero write candidates.
  Fifteen recipes remain source/data-excluded. Fresh mapping generation, semantic review, and apply
  remain explicitly deferred to the later consolidated mapping tranche. See
  `docs/audits/excluded-recipe-wave2-apply-2026-08-26.md`.
- **Wave 3 repaired all seven recoverable data-only recipes from stored evidence only.**
  `chana-masala`, `dads-chili`, `easy-chicken-ramen`,
  `lemon-herb-pasta-salad-with-marinated-chickpeas`, `lemongrass-chicken`, `mole-poblano`,
  and `tuscan-bean-soup` were mechanically reserialized after a 7 READY / 0 SKIP immutable
  dry run (manifest SHA-256 `7e3cfeef142e9d42d4e751b5f3c7051ec920e28d44ba61b6665fa57ecce61c0b`).
  Every substantive proposed line has line-level provenance to exact live source fragments; no
  ingredient, quantity, instruction, or other recipe fact was invented. The pasta salad's exact
  existing `one 14 ounce can chickpeas, drained and rinsed (DeLallo)` line was restored to the
  ingredient span. One update-time-preconditioned batch changed only `recipes/{id}.content`.
  Readback confirmed 7/7 exact content and parse matches, zero non-content changes, zero unexpected
  maps, and zero writes outside the authorized set. All 187 previously mapped recipes retained
  identical ingredient arrays, instruction arrays, source hashes, and persisted maps. No AI or
  cooking-map generation/persistence ran, and the post-apply immutable planner returned zero write
  candidates. Eight recipes remain excluded: five reimports, Maple Pecans manual-source recovery,
  and two product decisions. The 41 recipes made clean by Waves 1A–3 require one later consolidated,
  fresh-live-source mapping audit/review/apply tranche. See
  `docs/audits/excluded-recipe-wave3-apply-2026-08-26.md`.
- **The recovered 41-recipe hybrid-v4 mapping dry run is NOT READY FOR MAPPING APPLY.** The
  read-only 2026-08-26 audit used exact live content for the 28 Wave 1A, six Wave 2, and seven
  Wave 3 repairs at Git SHA `8cee451f5a82256f302cae869cd16f6e910c8336` and behavior fingerprint
  `57e7f102127ac3401e976e62e94f4f9923975d6a53da34eb360d6b0bfdeb83fd`. All 41 sources
  matched their completed repair evidence, were map-free, and produced structurally valid fresh
  source-bound candidates. Exhaustive review of 267 deterministic references and 114 omissions
  found 260 safe mappings but seven false positives in seven recipes: wrong-group or consumed-row
  salt/chile/garlic/onion reuse, unlisted egg-boiling water, a generic finished-dish `chili`
  collision, and incorrect soy-sauce partial-use text. The 27 AI-eligible recipes received one
  primary prompt-v2 request and one stability rerun each. Of 34 accepted relationships across both
  runs, 32 were correct and two were incorrect: both selected the already-consumed vinaigrette salt
  for final salad seasoning. Stability was 25 exact, two manually approved safe-omission
  differences, and zero unsafe material differences. The immutable 41-row manifest contains 34
  `READY`, seven `EXCLUDED`, and zero `REVIEW`/`ERROR`/`EXISTING_MAP` rows, SHA-256
  `289759234b88c4d29b18fe42a7f67f2e18473cc9285dd5df4ef9ced798ca1716`; its executive
  verdict blocks every apply because the deterministic and AI semantic gates failed systemically.
  A final live reread passed 34/34 structural/sourceHash preconditions for the independently safe
  rows, and all 187 existing persisted maps remained valid and unchanged. Recipe writes, map writes,
  and Firestore mutations were zero. Remediate and revalidate mapping behavior separately, then rerun
  the complete 41-recipe audit from fresh live content; do not use this manifest for apply. See
  `docs/audits/recovered-recipes-mapping-v4-dryrun-2026-08-26.md` and
  `docs/audits/recovered-recipes-mapping-v4-semantic-review-2026-08-26.json`.
- **Recovered-recipe mapping v5 remediation passed, but apply remains blocked pending a fresh full
  audit.** The seven deterministic failures and repeated AI vinaigrette-salt failure were reproduced
  before editing and resolved with general row-availability, group/component, process-material,
  compound-name, and exact mixed-quantity rules. The final fresh live deterministic-v5 pass reviewed
  41/41 recipes, 295/295 references, and 111/111 fully unmapped instructions with zero false-positive
  mappings or recipes. The authoritative hybrid-v5 validator rejected consumed vinaigrette salt in
  focused primary/repeat tests and both bounded live runs. The 26-recipe prompt-v2 validation reviewed
  25 accepted relationships as correct, with 23 exact stability, three safe omission differences, and
  zero unsafe differences. All 187 persisted v4 maps still match live hashes, validate structurally,
  and resolve as persisted with zero fallback; they were not rewritten or migrated. The historical
  recovered-v4 manifest remains failed evidence only. No new manifest was created and recipe, map, and
  Firestore writes were zero. See
  `docs/audits/recovered-recipes-mapping-v5-remediation-validation-2026-08-26.md`.
- **Recovered 41-recipe mapping v5 dry run is done and READY FOR MAPPING APPLY.** The final
  read-only audit regenerated every candidate from fresh live content at Git SHA
  `52157d937b78a1cef41e95c0882285c1234150cd` and behavior fingerprint
  `33b4cf11faa559c8c5f7e291d152f6675031984ff8897da92c5cab30f5a7374b`. All 41 Wave
  1A–3 recipes were source-clean, map-free, and source-bound. Exhaustive deterministic-v5 review
  confirmed 295/295 mappings and 111/111 fully unmapped instructions safe, including all seven
  former failures, with zero false positives. All 26 AI-eligible recipes received one fresh
  prompt-v2 primary request and one complete stability rerun; 25/25 accepted relationships across
  both runs were correct, the consumed vinaigrette-salt relationship was rejected twice, and
  stability was 23 exact plus three manually confirmed safe-omission differences with zero unsafe
  differences. Final live reread passed 41/41 candidates. The immutable sorted 41-READY-row v5
  manifest is `docs/audits/recovered-recipes-mapping-v5-dryrun-2026-08-26.json`, SHA-256
  `5d4ddaa10c788f9192ae74a5887859bc2847496706461b655752d86e62741170`; its semantic evidence is
  `docs/audits/recovered-recipes-mapping-v5-semantic-review-final-2026-08-26.json`. All 187 persisted
  v4 maps still match live hashes, validate, and resolve without fallback. Recipe writes, map writes,
  and Firestore mutations were zero. Recovered map apply is ready only through a separate immutable-
  manifest-SHA-locked, zero-AI, zero-recomputation workflow; the failed recovered-v4 manifest remains
  historical and unauthorized.
- **Recovered 41-recipe v5 map apply is complete.** The exact manifest SHA
  `5d4ddaa10c788f9192ae74a5887859bc2847496706461b655752d86e62741170` wrote all 41 candidates
  in one field-only batch. Readback found 41 exact maps, 41 matching source hashes, 41 validator
  passes, zero non-map differences, zero changes to the original 187 v4-map documents, and zero
  changes to the eight unresolved recipes. The post-apply dry run planned zero writes and classified
  all 41 rows as `MAP_ALREADY_PRESENT`. Production intentionally contains 187 reviewed v4 maps plus
  41 reviewed v5 maps; runtime supports both, and the remaining eight recipes have no persisted map.
  No AI or mapping generation ran. See
  `docs/audits/recovered-recipes-mapping-v5-apply-2026-08-26.md`.
- **The full 228-recipe Cooking Mode completeness audit requires recall remediation.** Prior mapping
  audits exhaustively protected precision of accepted references and reviewed "safe omissions," but
  they did not independently construct a per-step expected map and therefore did not adequately measure
  recall. The 2026-08-26 read-only audit reproduced the exact effective runtime path (shared recipe +
  owner content override -> canonical parser -> runtime persisted-map validation/fallback -> rendered
  ingredient indexes), browser-verified the three reported recipes, ran two independent blind
  `openai/gpt-5.6-luna` reviews for every mapped recipe, and adjudicated every discrepancy. All 228
  recipes had at least one discrepancy, so the no-discrepancy control population was empty and all 228
  instead received full adjudication. Results: **TP 1,375 / FP 12 / FN 2,677; precision 99.13%; recall
  33.93%; F1 50.56%**. Explicit-active-use recall is 1,355/3,528 (38.41%); CRITICAL-ingredient recall
  244/980 (24.90%); seasoning/herb recall 529/1,445 (36.61%); prepared-component recall 27/663
  (4.07%). Every mapped recipe has a confirmed omission; 736 missing associations are CRITICAL and 801
  HIGH. The reported failures reproduce exactly: Steak Bites Step 1 omits potatoes and Step 2 omits
  steak; Caprese Step 1 omits mozzarella; Grilled Zucchini/Squash Step 2 omits Italian herbs and pepper
  (and also yellow summer squash). Persisted v4 runtime rows measured TP 1,051 / FP 9 / FN 2,019
  (99.15% precision, 34.23% recall); persisted v5 rows TP 298 / FP 1 / FN 624 (99.67%, 32.32%); four
  override-driven deterministic-v5 fallbacks TP 26 / FP 2 / FN 34 (92.86%, 43.33%). Of the 2,677
  omissions, 1,965 were on steps not eligible for the current AI pass; current deterministic-v5 would
  recover only 23 and still miss 2,654. Dominant causes are persisted-map false negatives (2,643),
  deterministic steps classified resolved too early / AI never eligible (1,965 each), active-use misses
  (464), seasoning misses (372), prepared-component overrestriction (320), and group-scope
  overrestriction (227). Either blind reviewer found 2,675/2,677 confirmed omissions and both found
  2,575, supporting a future whole-recipe AI completeness pass followed by deterministic safety
  validation; regeneration/manual cleanup alone is insufficient. Firestore, recipe, map, parser, and UI
  mutations were zero. See `docs/audits/cooking-mode-completeness-audit-2026-08-26.md`, the per-recipe
  JSON evidence, and the review-only remediation candidates.
- **The 2026-08-27 whole-recipe completeness v6 focused validation failed the release gate.** The live
  read-only corpus had advanced to 237 shared / 229 mapped / eight unmapped recipes (187 v4 plus 42 v5);
  the post-audit `5-ingredient-hot-honey-chicken` map was excluded from the 228-recipe adjudicated
  benchmark rather than assigned invented truth. A source-hash-matching 36-recipe sample exercised four
  bounded one-call completeness prompt/validator variants. The final candidate measured TP 729 / FP 16 /
  FN 139, 97.85% precision, 83.99% recall, 94.60% explicit-active-use recall, 89.36% CRITICAL recall,
  77.42% HIGH recall, 82.18% seasoning/herb recall, and 1.82% prepared-component recall. All six named
  regression associations were present, but every release gate failed; 116 remaining omissions were AI
  misses and 23 were correct proposals rejected by validation. Across all bounded iterations, 246 model
  calls used 556,278 tokens. Therefore the full 228-recipe run, immutable manifest, migration prompt,
  production activation, commit, and push were not authorized. Production mutations were zero. See
  `docs/audits/cooking-mode-completeness-v6-focused-validation-2026-08-27.md`.
- **The 2026-08-27 source-grounded semantic-map v7 focused validation also failed the release gate.**
  The exact same 36-recipe, source-hash-matching focus population was reconstructed from the
  authoritative adjudicated benchmark, and every v6 FP/FN/validator rejection/component miss was
  preserved in `docs/audits/cooking-mode-v7-focused-failure-matrix-2026-08-27.md`. Two bounded fresh
  one-call prompt passes were run read-only. The final pass measured TP 649 / FP 10 / FN 219, 98.48%
  precision, 74.77% recall, 85.00% F1, 87.35% explicit-active-use recall, 80.14% CRITICAL recall,
  69.76% HIGH recall, 72.00% seasoning/herb recall, and 38.18% prepared-component recall with 46
  incorrect component labels. The raw semantic plan found 699/868 expected ingredient relationships,
  missed 169, had 647 correct proposals accepted and 52 correct proposals rejected, and still had nine
  incorrect proposals accepted. All six reported omissions were fixed. One plan failed full-step
  coverage and correctly used deterministic-v5 fallback. Across the two complete passes, 72 successful
  model calls consumed 112,492 input and 240,217 output tokens (352,709 total); one additional request
  failed at strict structured-schema transport before generation. Firestore recipe/map writes were zero.
  Per the hard gate, stability, the full 228 run, post-audit recipe adjudication, manifest/SHA, migration
  prompt, production activation, commit, and push were not authorized. See
  `docs/audits/cooking-mode-semantic-v7-focused-validation-2026-08-27.md`.
- **The 2026-08-27 exhaustive ingredient×step matrix v8 focused validation failed the release gate.**
  Exact V6/V7 failures were reconstructed into the machine-readable
  `docs/audits/cooking-mode-usage-matrix-v8-design-input-2026-08-27.json` before implementation. One
  fresh blind matrix call ran for each of the same 36 source-hash-matching recipes; all 36 calls
  completed and used 55,814 input / 145,659 output / 201,473 total tokens. Raw matrices classified
  758/868 expected ingredient relationships `USE_NOW`, incorrectly classified 110 expected uses as
  `NOT_THIS_STEP`, proposed 55 incorrect uses, and abstained on zero. The validator accepted 380/758
  correct uses, rejected 378/758 correct uses, rejected all 55 incorrect uses, and preserved all 25 v6/v7
  ingredient false-positive regressions. Five whole matrices correctly failed structural validation.
  The additive candidate measured TP 383 / FP 1 / FN 485, 99.74% precision, 44.12% recall, 61.18% F1,
  58.64% explicit-active-use recall, 42.55% CRITICAL recall, 42.34% HIGH recall, 44.00%
  seasoning/herb recall, and 2.42% prepared-component recall with one component false positive. All six
  named regressions passed, but every release-quality metric failed. The primary blocker is AI
  classification recall: even perfect validation of the raw decisions could reach only 87.33% overall
  ingredient recall; component modeling and validator overrejection are additional blockers. Firestore
  recipe/map writes were zero. Per the hard gate, stability, the full 228 run, manifest/SHA, migration
  prompt, production activation, commit, and push were not authorized. See
  `docs/audits/cooking-mode-usage-matrix-v8-focused-validation-2026-08-27.md`.
- **The 2026-08-28 dual-blind consensus v9 focused validation failed the release gate.** The exact audit
  reviewer architecture did not reproduce at the required focused level: reviewer union recall was
  833/868 (95.97%) versus the 99.5% gate, with 35 relationships missed by both. One four-relation recipe
  repeatedly failed arbiter structured output and fell back safely. The larger blocker was downstream
  adjudication: 108 correct candidates were rejected, four were unavailable, and nine incorrect candidates
  were accepted. The narrow hard-safety implementation was also still overbroad, rejecting 65 correct
  arbiter accepts (32 negative/deferred-evidence, 13 quantity, six consumed-row, six component-leakage,
  four fresh-process, and four compound-name classifications) while blocking zero incorrect accepts.
  Final metrics were TP 657 / FP 9 / FN 211, 98.65% precision, 75.69% recall, 85.80%
  explicit-active-use recall, 83.69% CRITICAL recall, 68.55% HIGH recall, 74.55% seasoning/herb recall,
  and 31.52% prepared-component recall with 16 component false positives. All six
  named UI omissions passed; historical ingredient false-positive coverage was 66/72 unique cases and
  the 52 positive validator regressions passed only 44/52. Focused validation used 113 successful model
  requests and 459,934 tokens including structured-output retries; normal production code remains capped
  at exactly three calls and was not committed. Do not iterate another architecture until reviewer misses,
  arbiter false decisions, and each overbroad safety family are analyzed independently. See
  `docs/audits/cooking-mode-consensus-v9-focused-validation-2026-08-28.md` and
  `docs/audits/cooking-mode-consensus-v9-regression-input-2026-08-28.json`.
- **The 2026-08-28 V9 recall root-cause investigation isolated multiple independent bottlenecks.** All
  35 fresh reviewer-union misses were found by at least one stored original audit reviewer (32 by both),
  even though the reviewer system and user prompts are byte-identical and the ingredient schema/model/
  temperature/timeout are unchanged. In a bounded exact-contract repeat over ten recipes, 30/35 target
  relationships returned 4/4, one returned 1/4, and four returned 0/4, proving both temperature-zero
  nondeterminism and a smaller stable interpretation tail. Review voting alone measured A 780 TP / 20 FP,
  B 816/17, intersection 763/9, and union 833/28. The arbiter independently reduced the executable
  candidate result to 722 TP / 9 FP (including recipe 190 deterministic fallback), while current hard
  safety alone reduced the complete deterministic+reviewer pool to 714 TP / 28 FP; the full stack remained
  657/9. The arbiter false-rejected 64/763 correct 2/2 relationships and 44/70 correct single-reviewer
  relationships. Every one of its nine false accepts passed all hard-safety checks; all were relationships
  deterministic-v5 had conservatively avoided. The 65 safety false rejections came from lexical rules that
  lack grammatical-scope, quantity-allocation, lifecycle, and component-establishment state. Prepared
  components independently finished at 52/165 recall with 16 false positives. Recipe 190 is not a size
  limit: its 2,143-byte/four-decision arbiter request succeeded once and failed structured parsing three
  times in four bounded repeats after the original two failures. No model revision metadata or raw failed
  response is exposed, so no provider model change is provable. Redesign the arbiter subsystem next, define
  lifecycle/component state before rewriting hard safety, and harden structured transport independently;
  this diagnosis does not authorize V10 or production behavior changes. Firestore/map/recipe writes were
  zero. See `docs/audits/cooking-mode-recall-root-cause-analysis-2026-08-28.md` and its JSON evidence.
- **The 2026-08-28 V10A frozen-candidate arbiter improved recall but did not protect precision.** The exact
  deterministic-augmented V9 pool is 863 ingredient candidates, not the 861-member reviewer union:
  833 correct and 30 incorrect. Candidate-centric micro-batching eliminated observed structured-output
  failures across 107 logical batches and recipe 190 succeeded 4/4, but the minimal arbiter accepted
  828/833 correct and 20/30 incorrect candidates. It recovered 107/108 prior false rejections while
  rejecting none of the nine prior false accepts. Disagreement-only arbitration reached 831 TP / 20 FP /
  2 candidate FN and used 91 AI decisions; it is not dominated by the no-AI vote strategies, but it fails
  the zero-FP requirement. Current hard safety then removes 73 correct arbiter accepts and none of the 20
  false accepts. Prepared-component identity remains separate and poor. Continue isolated arbiter error
  analysis; do not activate V10 or carry current safety forward. See
  `docs/audits/cooking-mode-arbiter-v10a-analysis-2026-08-28.md`.
- **The 2026-08-28 V10B risk facts still cannot separate passive constituents from active continuing
  use.** Risk routing covered all 30 frozen incorrect candidates, but the state-aware arbiter accepted
  passive salt/oil/seasoning constituents during later roast/simmer/serve operations for the same reason
  it correctly accepted principal ingredients during continuing cooking. It rejected 13/20 target false
  accepts but also rejected 85 correct candidates. Before another prompt experiment, represent the
  instruction's active target and conservative component membership at ingredient-row granularity. Also
  keep quantity facts row-scoped: punctuation-stripping turned `1.5`, `3/4`, and Unicode fractions into
  false quantities, while a generic current-instruction quantity could attach to the wrong row. See
  `docs/audits/cooking-mode-v10b-ingredient-precision-analysis-2026-08-28.md`.
- **The 2026-08-28 V10C active-target state repaired quantity facts but still failed the ingredient
  gate.** All nine known quantity regressions passed, including raw decimal/fraction and row-local
  instruction-quantity scope. V10C rejected 18/20 target false positives, but its final 669 TP / 2 FP /
  164 FN result missed both zero-FP and 99.5%-recall requirements. Generic “taste and adjust seasoning”
  still falsely activates the already-listed salt/pepper rows, while valid unnamed continuation is
  over-classified as passive carry (116 correct rejections used `PASSIVE_COMPONENT_CONSTITUENT`). See
  `docs/audits/cooking-mode-v10c-active-target-analysis-2026-08-28.md`.
- **The 2026-08-28 V10D principal-target/generic-seasoning pass reached zero-FP but recall is capped
  far below gate by categories outside its scope.** The V10C ratatouille salt/pepper false accepts are
  benchmark-consistent (salt/pepper's `CORRECT` link is only the row's first-combination instruction;
  generic seasoning language afterward correctly does not re-trigger it) — confirmed by checking every
  generic-seasoning instruction in the frozen population (there are only two). A truth-blind
  principal-target/alias/timeline/generic-seasoning contract, with continuation eligibility requiring
  zero prior established component membership, reached 642 TP / 0 FP / 191 FN, 100% precision, 20/20
  target-FP protection, and kept 9/9 quantity repairs — but only 77.07% candidate recall (gate is
  99.5%) and historical `LOCKED_TRUTH` protection fell to 4/12 (from V10C's 9/12). The 164-FN taxonomy
  shows only 11 were `PRINCIPAL_TARGET_CONTINUATION`; the bulk (49 `COLLECTIVE_CONTINUATION`, 87
  `OTHER`, 13 misclassified passive-carry) need a different semantic layer before further architecture
  work. Prepared-component establishment/reuse, final production architecture, and persisted-map
  migration remain pending and separate. Production stays on v4/v5; V6–V10 are nonproduction. See
  `docs/audits/cooking-mode-v10d-principal-target-analysis-2026-08-28.md`.
- **V10D's "zero prior component membership" continuation gate is the actual recall blocker, not a
  missing semantic category.** The 2026-08-28 V10E read-only taxonomy pass reclassified all 191 V10D
  false negatives into 10 source-grounded classes (dominant: `DISH_STATE_CONTINUATION` 58/191 30%,
  `PRONOUN_OR_DEICTIC_REFERENCE` 55/191 29%, `SERVING_OR_GARNISH_ACTION` 20/191 10%; zero rows needed
  an `OTHER`-style fallback). 31/58 (53%) of the dominant class already carry non-empty V10C
  `componentMembership` at rejection time, and 14 componentKey labels (e.g. "sauce", "chicken
  skewer", "slaw", "spice mix") recur on both the FN population (benchmark says stay active) and the
  locked `historicalRegression` false-positive-risk population (should not) — so component-membership
  *existence* cannot discriminate; component-membership *kind* (generic bulk/mixture tag vs. a truly
  isolated sub-component) can. Benchmark truth is consistent; the heuristic is not. Recommended next
  subsystem: a per-recipe-instance active-object graph, not another row-level boolean heuristic. See
  `docs/audits/cooking-mode-v10e-remaining-fn-taxonomy-2026-08-28.md`.
- **A narrow, deliberately small active-object rescue rule cleared its own bounded go/no-go gate
  (V10F-Lite, 2026-08-28).** Against a 51-case deterministic challenge set drawn from
  already-adjudicated V10A/V10D/V10E evidence (20 positives, 11 negative leakage cases, 20 locked
  target false positives), the narrow rule reached 90.00% `DISH_STATE_CONTINUATION` recovery,
  100.00% `PRONOUN_OR_DEICTIC_REFERENCE` recovery, 100% precision (0/31 false accepts), and 20/20
  target-FP protection, with 6 flat signal checks and 0 recipe-specific exceptions. Verdict **GO —
  SIMPLE ACTIVE-OBJECT RESCUE WARRANTS FULL FROZEN VALIDATION**. This authorizes only running the
  same unexpanded rule against the complete existing frozen candidate benchmark next — not
  expanding the rule, not a new taxonomy pass, not production integration. Diagnostic-only: zero
  production/Firestore/AI/mapping-code mutation. See
  `docs/audits/cooking-mode-v10f-lite-active-object-go-no-go-2026-08-28.md`.
- **The V10F-Lite active-object rescue rule did not generalize from its 51-case challenge set to the
  full 863-candidate frozen benchmark (V10G, 2026-08-28; final).** Applied rescue-only, byte-identical
  (SHA-256 verified), to every V10D REJECT: 773 TP / 0 FP / 60 FN, 100% precision held, recall
  77.07% → 92.80%, 0 new false positives across all 30 frozen incorrect candidates, 20/20 target-FP
  and 9/9 quantity-regression protection held. `DISH_STATE_CONTINUATION` cleared its bar at 96.55%
  (56/58), but `PRONOUN_OR_DEICTIC_REFERENCE` fell short at 83.64% (46/55) against the required 85% —
  the 10-case challenge subset (100% recovery) did not represent the full 55-case population. Cause:
  the rule's establishing-instruction check needs an earlier instruction to literally name an
  ingredient's own key token, which fails whenever a recipe narrates several distinct ingredients
  under one generic collective word (e.g. "spices" standing in for cumin/basil/thyme/oregano) rather
  than naming each one. This is a token-matching ceiling, not a mislabeled benchmark. Verdict **FAIL —
  ACTIVE-OBJECT RESCUE DOES NOT GENERALIZE**; recommendation **STOP ACTIVE-OBJECT DETERMINISTIC
  REFINEMENT — REASSESS AI-AT-INGESTION ARCHITECTURE** (the original two-reviewer union recovered
  ~99.93% of confirmed omissions, for scale). The rule was never modified after seeing full-benchmark
  results. Zero production/Firestore/AI/mapping-code mutation; production remains v4/v5. See
  `docs/audits/cooking-mode-v10g-active-object-full-frozen-validation-2026-08-28.md`.
- **Cooking Mode's next architecture is reviewed AI-at-ingestion, not another deterministic
  semantic mapper.** The 2026-08-28 reassessment selected two blind reviewer proposals → union →
  versioned deterministic evidence/risk routing → human review of uncertainty → immutable approved
  source-bound map. Agreement alone is unsafe (9 frozen and 19 full-corpus intersection false
  positives); disagreement and semantic risk must route to review, not automatic rejection. V10G's
  zero-FP behavior remains useful only as candidate safe-accept/prioritization evidence until an exact
  standalone routing contract is frozen and validated. For the existing 228-recipe corpus, use a
  stricter one-time complete map/source review before the established manifest-SHA-locked apply
  workflow. Do not call AI, recompute candidates, or substitute values during production apply. See
  `docs/audits/cooking-mode-mapping-architecture-reassessment-2026-08-28.md`.
- **USDA search API rejects parenthesized dataType values.** Sending
  `dataType=Survey (FNDDS)` in the querystring intermittently returns nginx HTTP 400
  (~60% observed, load-balancer dependent). `lib/nutritionEngine.ts` therefore never sends a
  parenthesized dataType: ingredient lookups use `SR Legacy,Foundation`; food-name lookups omit
  the param and post-filter results by dataType. Don't "simplify" this back.
- **USDA ingredient search has an intermittent HTML-404 edge response, and malformed ingredient names can
  trigger nginx 400s (M-04 Prompt 4C).** Repeating an identical valid `foods/search` GET can alternate
  between an HTML app-shell 404 and JSON 200; the engine's single retry sometimes recovers, so a 404 is not
  evidence of a stale FDC record. Separately, flat parenthetical removal can leave an unmatched `)` from a
  nested ingredient alternative; those malformed names returned 400 whenever they reached the API backend.
  Fix/sanitize the ingredient name before retrying deterministic 400s. The same investigation confirmed
  that weak token overlap and alias-subset matching can accept nutritionally material semantic mismatches
  (plant-based beef → real beef, edamame/orzo → teff, marinara → cheese ravioli). Do not apply affected
  recomputes merely because confidence is medium or fallback produced a number; see
  `docs/audits/m04-nutrition-apply-readiness-2026-08-22.md`.
- **USDA candidate semantic validation is identity-complete.** Token overlap alone is unsafe: validated
  candidates must contain all non-qualifier food identity tokens, and known contradictions (e.g. chocolate
  for almond milk, teff for orzo, emu/beet greens for chili/green chiles) are rejected. Dried ingredients
  must not use a canned/drained canonical record. Quantity qualifiers before units and comma-separated prep
  clauses are normalized so they do not hide the core noun.
- **Barcode results carry a `basis`; never treat per-100g as a serving.** `/api/barcode-lookup`
  (`lib/nutritionEngine.ts` `lookupFoodByBarcode`) returns `basis: "per_serving" | "per_100g"`.
  Open Food Facts frequently provides only per-100g `nutriments`, and USDA branded `foodNutrients`
  are always per-100g — both come back tagged `per_100g`. The amount entry in `LogFoodSheet.tsx`
  now switches on basis: `per_100g` items take **grams directly** (macros × grams/100), labelled
  "Macros shown per 100 g" — this retired the old ⚠ "1 serving = 100 g" footgun. `per_serving`
  items with a numeric serving size (`serving_grams`, or grams parsed from the `serving_size`
  string) get a **Servings ⇄ Grams** toggle; without one they stay servings-only. The same model
  applies to USDA name search via its `servingGrams` (a fresh `usda` lookup with `servingGrams:null`
  is per-100g; an AI estimate or a re-logged favorite stays per-serving — `null` vs `undefined`
  distinguishes them).
- **No composite Firestore indexes — keep log queries single-field.** `lib/consumptionLog.ts`
  range-filters and orders on the same field (`date`) and does recipe/cook-event filtering
  client-side. A `where(recipe_id)+where(date>=)` query would demand a composite index, which
  this repo doesn't manage (no firestore.indexes.json).
- **Firestore rules block non-Google-auth writes — even admin-minted custom tokens.** Writes to
  `users/{uid}/**` fail PERMISSION_DENIED for custom-token sessions (with or without email
  claims), so client-SDK smoke tests of user-data writes can't run headless. Verify those flows
  in the live app; the admin SDK (API routes) bypasses rules as usual.
- **Compatible-unit grocery merge is direction-asymmetric by design.** `mergeQuantities` always
  converts the *incoming* quantity into the *existing* grocery item's unit before summing, so
  `"1 cup"+"8 tbsp"="1.5 cups"` but the same two lines added in the other order give
  `"8 tbsp"+"1 cup"="24 tbsp"` — whichever unit reached Firestore first wins and stays stable as
  more recipes are added. This is intentional (§5.16), not a bug; do not "fix" it by picking a
  canonical/prettier unit. Historic compound quantities already stored from before 2026-08-23
  (e.g. a legacy `quantity: "1 cup + 8 tbsp"`, `unit: ""` row) are never re-parsed or migrated —
  only new merges get the compatible-unit conversion.
- **`.env.local` private key was paste-mangled once.** `FIREBASE_PRIVATE_KEY` had smart quotes
  (`“…”`) and clipped PEM dashes, making `verifyAuthToken` silently 401 ALL auth-gated routes in
  local dev (prod unaffected — Vercel env was clean). Fixed 2026-06-11. If local API routes 401
  with a valid sign-in, check the key formatting first.
- **Calendar push uses a client-only OAuth token (Batch 6, Option B).** The app holds **no** server-side
  Google credentials. `/api/calendar/push` is a dumb executor; the `calendar.events` access token is minted
  on the client via a Firebase Google **re-auth popup** (`lib/googleCalendar.ts`) on **each** push — Firebase
  keeps no Google refresh token client-side, so a push needs an interactive popup every time and **will fail
  in popup-blocked / standalone-PWA contexts** (normal sign-in uses `signInWithRedirect` there, but the
  calendar token path is popup-only by design for this option). **Prerequisites for it to work at all:** the
  **Google Calendar API enabled** and the **`calendar.events` scope added to the OAuth consent screen** in the
  `malignant-metro` GCP project (the single user is the test user) — these are Google Cloud Console config, not
  in this repo. The scope is requested only on the push, never on browse/sign-in. The app only ever
  updates/deletes event IDs it stored in `weekPlans.calendarEventIds` — **never** a calendar search-and-delete.

- **`scripts/_lib.js` `getAdmin()`/`mintIdToken()` were broken under firebase-admin v14 (fixed).** They
  used the legacy namespaced API (`admin.apps`, `admin.credential`, `admin.auth()`), which v14's CJS
  root export no longer provides. `getAdmin()` now initialises via the modular subpaths
  (`firebase-admin/app`, `firebase-admin/firestore`, `firebase-admin/auth`) — same as
  `scripts/write-sides-batch.js` already did — and returns an object exposing `.firestore()`/`.auth()`,
  preserving the call shape every caller (`_verify-apply.js`, `run-canonical-{apply,dryrun}.js`) already
  used, so no consumer needed changes. `loadEnv()` was unaffected throughout. New scripts should still
  prefer the modular subpaths directly rather than the legacy `require('firebase-admin')` root.

---

## Section 7 — Feature Backlog

Derived from in-code affordances and comments. No `TODO`/`FIXME` markers exist in app code.

| Feature | Priority | Status | Notes |
|---|---|---|---|
| Canonical recipe category code contract | High | Done | One 12-value tuple drives types, UI, filters, icons, AI schemas/prompts, shared-write validation, defensive read compatibility, and meal-plan role derivation. |
| Existing recipe category data migration | High | Done | Applied the approved exact 2026-08-25 manifest in one transaction: 66 shared categories normalized; post-apply readback verified 236/236 shared documents canonical with the approved 12-category distribution. See `docs/audits/recipe-category-migration-apply-2026-08-25.md`. |
| Legacy personal category override cleanup | Medium | Done | Removed only `overrides.category` from 24 exact redundant/legacy rows; post-apply readback found zero legacy/redundant category overrides and preserved the sole intentional Spicy Quinoa (`182`) → `Salads & Bowls` override. |
| Bookmarklet for paywalled sites (NYT Cooking, etc.) | High | Partial | Setup UI exists at `/queue#bookmarklet`, but it sends URL/image/time metadata rather than logged-in page DOM; paywalled server fetches remain blocked. |
| AI grocery cleanup / dedup | High | Done | `/api/grocery-cleanup`; `mea-grocery-last-cleaned` tracks last run |
| Grocery classifier collision remediation | High | Done | Phase 1: token/phrase boundaries + specific-identity precedence under the unchanged nine categories; manual overrides remain authoritative. |
| Grocery 11-category store taxonomy | Medium | Done | Phase 2: exact 11-category store taxonomy, classifier mappings, all-category manual picker, UI order/emojis, centralized AI cleanup contract, and read-time compatibility for retired manual/saved strings; no Firestore migration. |
| Grocery Usually On Hand preference | Medium | Done (Phase 1) | Persistent exact-identity preference on `SavedGroceryItem`; derived collapsed section; category, checked state, and quantities remain independent. |
| Usually On Hand — temporary Need This Trip override | Medium | Done (Phase 2) | Transient `GroceryItem.needThisTrip?`; normal-category/reverse controls, merge safety, exact-identity rebuild preservation, and clear-list expiry shipped 2026-08-24. |
| Grocery corpus/source-content contamination cleanup | Medium | Partial (Phase 1 complete) | Phase 1 adds shared header handling, evidence-backed content boundaries/filters, and narrow grocery/nutrition defenses; all 173 reviewed legitimate occurrences remain and 84/84 audited subheaders are blocked from grocery purchase output. See `docs/audits/ingredient-source-contamination-phase1-remediation-2026-08-22.md`. Wave 3 completed the separately approved `mole-poblano` repair. Remaining: 23 fixture-driven ingredient-parser artifacts, separately approved repairs for `sasy-notes`/`chipotle-tahini-bowls`, AI-ingest semantic quarantine, and bookmarklet/paywall behavior. Do not encode taxonomy exceptions. |
| Cooking-step ingredient mapping | High | Partial (228/236 shared recipes mapped; Wave 4/5 and personal overrides pending) | Full production hybrid-v3 dry run — **Done / failed precision gate**: five false positives in four recipes; its manifest is historical only. Deterministic-v4 remediation — **Done**. Exhaustive deterministic-v4 review — **Done**: 187/187 eligible recipes, 1,040/1,040 references, 0 false-positive mappings/recipes. Full production hybrid-v4 dry run — **Done**: 134/134 accepted semantic relationships correct, 0 ambiguous/incorrect, 0 unsafe stability differences. Existing eligible-recipe cooking-map backfill — **Done**: exact manifest SHA `b07208384369183e70782f2e017fcea141d9436d43d7ea523133c72cd6435a88`, 187 written, 0 skipped, exact readback and zero non-map differences. Excluded-source discovery — **Done**: 49/49 audited. **Wave 1A parser remediation — Done**: 28 parser-only rows parse-clean, 36 excluded rows improved, 0/187 mapped parses or hashes changed. **Wave 2 mixed parser/data repair — Done**: six exact content-only repairs, zero skips, zero non-content/map/mapped-recipe changes. **Wave 3 data-only repair — Done**: seven exact source-evidence-only repairs, zero skips, 7/7 exact readback, zero non-content/map/mapped-recipe changes, and eight excluded recipes remain. **Recovered 41-recipe v4 mapping audit — Failed / historical**: seven deterministic false positives and repeated incorrect AI salt acceptance; its immutable manifest is never reusable. **Mapping v5 remediation — Done / PASS**: 41/41 recipes, 295 references, 111 omissions, 0 false positives; bounded AI 25/25 correct with 0 unsafe stability differences; all 187 persisted v4 maps remain runtime accepted. **Recovered 41-recipe v5 map audit — Done**: 41/41 READY, 295 deterministic references and 111 omissions safe, 25/25 accepted AI relationships correct, zero unsafe stability differences, immutable manifest SHA `5d4ddaa10c788f9192ae74a5887859bc2847496706461b655752d86e62741170`. **Recovered 41-recipe v5 map apply — Done**: 41 exact field-only writes, 41/41 exact readback/hash/validation matches, zero non-map changes, zero AI/recomputation, 0/187 original maps changed, 0/8 unresolved recipes changed, and post-apply READY_TO_WRITE 0. Production has 228 mapped and eight unmapped recipes. **Wave 4 source recovery/re-import — Pending** (five reimports plus Maple Pecans). **Wave 5 product decisions — Pending** (two recipes). Broad NOTES/Tip/first-person termination remains prohibited. Personal override-specific mappings — **Pending**. See §5.25, §6, `docs/audits/cooking-step-mapping-v4-apply-2026-08-26.md`, `docs/audits/recovered-recipes-mapping-v5-apply-2026-08-26.md`, and the preserved v1-v5 audit evidence. |
| Cooking Mode completeness audit | High | Done | Full 228-recipe actual-runtime precision + recall audit: two blind reviews per recipe, every discrepancy adjudicated, mandatory UI regressions reproduced, TP 1,375 / FP 12 / FN 2,677, precision 99.13%, recall 33.93%, production mutations 0. See §6 and `docs/audits/cooking-mode-completeness-audit-2026-08-26.md`. |
| Cooking Mode recall remediation | High | Architecture decided; implementation pending **DESIGN REVIEW-ROUTING CONTRACT** | V10G ended deterministic semantic refinement at 773 TP / 0 FP / 60 FN (100% precision, 92.80% recall) after its pronoun/deictic class missed the precommitted gate. The 2026-08-28 reassessment selected **AI-at-ingestion with review**: two blind reviewer proposals → high-recall union → narrow versioned deterministic evidence/risk routing → human review of every uncertain relation → immutable approved source-bound map. Agreement is routing evidence, not truth (9 frozen and 19 full-corpus intersection FP). The broad V9–V10D veto pattern is prohibited; V10G survives only as candidate safe-accept/prioritization evidence pending an exact standalone routing contract. The existing 228-recipe remediation should use stricter complete review before immutable-manifest/SHA-locked apply. Production remains approved v4/v5; runtime and apply remain 0-AI. Prepared components retain a separate future quality gate. See §5.25, §6, `docs/audits/cooking-mode-mapping-architecture-reassessment-2026-08-28.md`, and the V9–V10G audit chain. |
| Shared `prepareGroceryItem` pipeline | Medium | Done | Behavior-preserving consolidation shipped 2026-08-23; see §5.16 and `docs/audits/shared-grocery-preparation-pipeline-2026-08-23.md` (0 corpus differences across 3,071 occurrences). |
| Grocery unit conversion | Low | Done | Compatible-unit quantity merge (volume↔volume, mass↔mass) shipped 2026-08-23 in `mergeQuantities`/`convertQuantity`; see §5.16 and `docs/audits/grocery-unit-conversion-2026-08-23.md`. No density/cross-dimension conversion; no data migration. |
| Dietary tags/filtering | Low | Backlog | Separate product feature; not part of grocery taxonomy. |
| Recommendations trigger button (avoid charges) | Medium | Done | Recommendations/suggestions only fire on explicit button + are cached |
| Manual grocery category assignment | Medium | Done | `GroceryItem.manualSection` + the exact current 11-value `MANUAL_CATEGORIES`; retired values normalize on read and never appear as picker choices. |
| Saved/remembered grocery items | Medium | Done | `savedGroceryItems` ranks by `timesUsed` for fast re-entry |
| FlavorGraph-informed generation | Medium | Done | `getComplementaryIngredients` seeds Discover + plan-suggestions prompts |
| Shared week plans (view friends' plans) | Low | Done | `sharedWeekPlans/{weekID}/users/{uid}` |
| Auth / PWA improvements | Medium | Partial | Standalone-mode detection uses `signInWithRedirect` vs popup (`AuthContext`) |
| Commit Firestore rules to repo | Medium | Won't do | Reverted — the `malignant-metro` DB is shared across apps, so rules are managed manually in the Firebase Console only (a deploy from here would overwrite other apps' rules). See **Firestore rules** + Sharp Edges |
| Export utilities | Low | Done (scripts) | `export-recipes.js`; `update-recipe-times.js` is now a manifest-driven, dry-run-default, atomic/preconditioned recipe-time audit/apply tool. Production audit applied 2026-08-24: 98 backfills + 9 conservative corrections, 234/234 usable recipes covered, zero `totalTime` fields. See `docs/audits/recipe-time-audit-2026-08-24.md`. |
| Nutrition tracker (per-recipe macros + consumption log + insights) | High | Done | 5-surface design in `nutrition-tracker-spec.md`. Surface 1 (recipe detail display + editable servings) **Done**; backfill **Done** (202/205); shared lookup engine (`lib/nutritionEngine.ts` + `/api/nutrition-lookup`) **Done**; Surface 2 cooked capture (Cooking Mode finish + plan checkmark → `logCookEvent`, dedupe-guarded) **Done**; Surface 3 log-food sheet (`LogFoodSheet.tsx`) **Done**; Surface 4 Today view **Done**; Surface 5 Insights tab **Done**; **auto-nutrition-on-publish Done** (Surface 1b — see below) — all surfaces complete |
| Canonical staples ingredient resolution (nutrition accuracy fix) | High | **Done (applied — 136 recipes)** | Batch 4 + 4-fix + 4-apply. Root-cause fix for implausible macros from USDA fuzzy mis-matches (e.g. Easy Spaghetti pasta → "Frozen yogurts"). `lib/canonicalStaples.ts` (122 live-verified entries, generated + linted by `scripts/verify-canonical-staples.js`) is the new first tier in `computeRecipeNutrition` (canonical → USDA validation → AI). Re-audit (`batch4-canonical-reaudit.md`) → matcher hardening + lint → v2 dry-run (16 regressions fixed, zero new) → **Batch 4-apply: 136 recipes WRITTEN** via `/api/nutrition-canonical-dryrun?apply=true` on Vercel (AI on), conservatively gated (canonical-attributable change, no confidence downgrade). Revert: `nutrition_prev` per doc + `batch4-apply-revert-manifest.json`. See §5 #22, §6, `batch4-apply-report.md`. |
| Barcode-based packaged-food lookup | Medium | Done | Server-side lookup: `/api/barcode-lookup` + `lib/nutritionEngine.ts` `lookupFoodByBarcode` (Open Food Facts → USDA branded GTIN → miss), client helper `lookupBarcode` (`lib/nutrition.ts`), returns `basis` per_serving\|per_100g. Camera UI: **Scan** mode (4th tab) in `LogFoodSheet.tsx` — native `BarcodeDetector` where supported, lazy-loaded `@zxing/browser` fallback; EAN/UPC only; rear camera via getUserMedia; graceful permission-denied and not-found fallbacks route to Search. Dev panel (`BarcodeTestPanel.tsx`) removed. Reuses `saved_foods`/`consumption_log` — no new collection. Serving/grams amount entry **Done**: per-100g hits take grams directly, per-serving hits with a numeric serving size get a Servings⇄Grams toggle (engine now returns `serving_grams`/`servings_per_container`; entry records `amount_label`). |
| Push meal plan to Google Calendar | Medium | Done | Manual **"Add this week to Calendar"** on the Plan page → one event per planned day, idempotent re-push via `weekPlans.calendarEventIds`. **Option B auth:** client mints a `calendar.events` OAuth token via a Firebase Google re-auth popup and passes it to the auth-gated `/api/calendar/push` executor (no server-side Google creds; route has no list/search). Requires the Calendar API enabled + the scope on the OAuth consent screen (see §6). |
| Password login (email/password via account linking) | Medium | Done | Batch 7. Google-signed-in user adds a password in settings (`PasswordLoginSettings` → `linkWithCredential`, same uid/data, no new account); login screen (`SignInOptions`, used in the `/favorites` + `/plan` gates) keeps Google and adds email/password **sign-in only** (no signup) + "Forgot password?" (`sendPasswordResetEmail`, neutral confirmation). Requires the Email/Password provider enabled in the Firebase console (see §4 #7, §6, §8). |
| Auto-nutrition on recipe create/publish | High | Done | New recipes land with `nutrition` populated. `computeAndStoreNutrition()` (`lib/recipes.ts`) is called after `saveRecipe()` from queue publish (`app/queue/page.tsx`) and Discover direct-save (`app/discover/page.tsx`), with a "Calculating nutrition…" loading state. Timeout-guarded (~20s) — never blocks the save; on failure the recipe is flagged `nutritionStatus:'needs_calc'`. Manual retry: "Calculate nutrition" button in the Surface 1 empty state (`components/NutritionSection.tsx`, 45s window) |
| AI Gateway cost and cache observability | Low | Backlog | Evaluate provider-supported context caching and cost reporting beyond the token usage metadata logged by `lib/ai.ts`. |
| Activity calories in nutrition views | Medium | Done | Nutrition Today and Insights now read user-scoped `healthMetrics.move_calories`, combine it with the user-entered `NutritionGoals.calorie_baseline`, and no longer use the unowned Strava collection. |

**Activity calories in nutrition views — resolved (2026-08-16)**

The nutrition pages previously attempted to read `stravaActivities`, a root collection
with no owner field. That source was unsuitable for a multi-user nutrition tracker and
could overlap with Apple Health workout calories. The implementation now reads
`users/{uid}/healthMetrics` using the same inclusive date-string range query as Training
Web. Active calories are summed only from records that contain a numeric
`move_calories` value; missing daily values are surfaced as incomplete coverage.

The existing `stravaActivities` data remains documented for historical context but is
not part of nutrition calculations. No Firestore rules or indexes were changed; the
existing owner-scoped `healthMetrics` rule is the required access path.

---

## Section 8 — External Services & Keys

Credential **names only** — never commit values. Local `.env.local` is gitignored.

| Service | Purpose | Credential(s) (env var names) |
|---|---|---|
| Firebase Auth | User identity — **Google sign-in** + optional **email/password linked to the same account** (Batch 7) | Web config hardcoded in `lib/firebase.ts` (apiKey, authDomain, projectId, …). **Console prerequisite:** the **Email/Password** provider must be enabled under Authentication → Sign-in method, or the link/sign-in/reset calls throw `auth/operation-not-allowed`. |
| Firebase Firestore (client) | Recipe catalog + per-user data | Same hardcoded web config |
| Firebase Admin | Server-side ID-token verification in API routes | `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` |
| Vercel AI Gateway | AI recipe generation, parsing, grocery cleanup, recommendations, assistant, cooking-step unresolved-semantic resolution, and nutrition fallback | `AI_GATEWAY_API_KEY` in non-Vercel runtimes; Vercel OIDC is also supported. Central config: `lib/aiConfig.ts`. |
| Google Calendar API | Push meal-plan days as calendar events (Batch 6) | **No stored credential.** Client-obtained OAuth access token (`calendar.events` scope) via Firebase Google sign-in re-auth popup. Requires the Calendar API **enabled** + the scope on the **OAuth consent screen** in the `malignant-metro` GCP project. |
| MyFitnessPal (nutrition sync) | Nightly-capable import of the food diary into `users/{uid}/nutrition/root/log` (`source: 'mfp'`). **No API** — `app/api/cron/sync-nutrition` scrapes the classic diary page HTML (`/food/diary/{MFP_USERNAME}?date=…`) with `cheerio`. | `MFP_SYNC_UID`, `MFP_SESSION_COOKIE`, `MFP_USER_AGENT`, `MFP_USERNAME`, `CRON_SECRET`; optional `MFP_DEBUG`. Session cookie expires periodically → refresh manually in Vercel. (`MFP_CSRF_TOKEN` is no longer used by code.) |
| Vercel | Hosting / deployment | Project/team IDs not stored in repo |

### API security boundaries

Normal application APIs verify a Firebase Bearer token before request parsing, provider
calls, model invocation, Admin SDK work, or outbound fetches. Global nutrition applies
additionally require `verifyAdminToken`; the scheduler route instead requires an exact,
non-empty `CRON_SECRET`. Application rate limits and Vercel Firewall SDK rules are not
used by product decision, so missing Firewall configuration cannot produce a 503 for an
authenticated request. Vercel's platform-level DDoS mitigation remains separate.

Public URL fetches are restricted to authenticated users and retain HTTP(S)-only URLs,
no credentials, DNS/IP validation and address pinning for every redirect hop, redirect,
timeout, and 2 MB response bounds. Calendar requests are capped at seven operations;
nutrition pagination only accepts bounded whole integers.

AI model in use across all routes as of 2026-08-20: `openai/gpt-5.6-luna` through
Vercel AI Gateway and the Vercel AI SDK. No retired Gemini or Anthropic provider SDK
is installed, and active application code does not reference their credentials.

---

## Firestore rules

Firestore security rules for the shared malignant-metro database are managed manually in the
Firebase Console, NOT in this repo. Do not add a deployable firestore.rules file or run firebase
deploy for rules — the database is shared across multiple apps and a deploy from here would
overwrite the others' rules. When adding a new collection, update the rules in the console.

Required recipe-catalog rule (paste manually after reviewing sibling-app impact):

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
