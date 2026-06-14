# MEA Recipes — Product Requirements & Technical Reference (PRD)

> Single source of truth for domain knowledge, data model, business logic, and backlog.
> Bootstrapped from the codebase. Keep in sync per the rules in CLAUDE.md.

---

## Section 1 — App Overview

**Purpose:** Personal recipe manager web app, part of the MEA ecosystem. Companion to an
iOS MEA app — both share the same Firestore backend, so recipes, meal plans, favorites,
and grocery lists stay in sync across web and iOS.

**Intended user:** A single authenticated user (`folstromjohn@gmail.com`). The data model
is per-user isolated, but in practice the app is used by one person. Friends' published
week plans can be viewed via the `sharedWeekPlans` collection.

**Hosting:** Vercel · **Auth:** Firebase Auth — Google sign-in, plus an optional email/password
credential **linked to the same account** (Batch 7; same uid/data, no separate accounts) ·
**Database:** Firebase Firestore

### Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js (App Router) | 14.2.5 |
| Language | TypeScript | ^5 |
| Runtime | React / React DOM | ^18 |
| Styling | Tailwind CSS | ^3.4.1 |
| Client SDK | firebase | ^10.12.0 |
| Server SDK | firebase-admin | ^13.7.0 |
| Search | fuse.js | ^7.3.0 |
| Icons | lucide-react | ^0.383.0 |
| Charts | recharts | ^2.12.0 |
| Utility | clsx | ^2.1.1 |
| AI | Anthropic Messages API (`claude-sonnet-4-20250514`) | REST, `anthropic-version: 2023-06-01` |

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
| Recipe detail | `/recipes/[id]` (`app/recipes/[id]/page.tsx`) | Done | Full recipe, parsed ingredients/instructions, notes + rating, edit, **meal-plan default main/side control**, **bulk "Add all to grocery"** (reuses `addRecipeIngredientsToGrocery`, same path as plan rebuild), full-screen Cooking Mode (`components/CookingMode.tsx`, with **tap-to-start step timers**) |
| Discover | `/discover` (`app/discover/page.tsx`) | Done | AI recipe generator (free-text), recommendations, new-recipe suggestions |
| Grocery | `/grocery` (`app/grocery/page.tsx`) | Done | Live grocery list, category grouping, AI cleanup |
| Plan | `/plan` (`app/plan/page.tsx`) | Done | Weekly meal planner (Mon-start weeks), **day-based grid (7-col desktop / stacked mobile + Unscheduled bucket)** with auto-defaulted **main/side** role per recipe (**color-accented tiles, name below image; tap a tile → action sheet with all actions**), **desktop drag-and-drop day assignment + in-sheet day picker**, cooked tracking, AI plan suggestions, shared plans, **push week to Google Calendar (one idempotent event per planned day)** |
| Queue | `/queue` (`app/queue/page.tsx`) | Done | Review queue for AI-parsed recipes before publishing; bookmarklet setup |
| Favorites | `/favorites` (`app/favorites/page.tsx`) | Done | Grid of favorited recipes; sign-in gated; same search/filter/sort controls as `/recipes`, scoped to favorites |
| History | `/history` (`app/history/page.tsx`) | Done | Cooking history: 52-week heatmap, streaks, recent cooked weeks |
| Insights | `/insights` (`app/insights/page.tsx`) | Done | Analytics: cooked totals, avg rating, cuisine breakdown, CSV export |
| Nutrition | `/nutrition` (`app/nutrition/page.tsx`) | Done | Two tabs: **Today** (six countdown goal rings w/ floor/ceiling colour logic, meal-grouped log w/ inline edit-servings + delete) and **Insights** (`components/InsightsTab.tsx` — range selector week/month/YTD/custom, compounding goal attainment pro-rated to elapsed days via reused `GoalRing`, recharts donut + ranked contributor table by food/recipe per selected nutrient, empty/sparse states). Header hosts persistent "＋ Log food" (`LogFoodSheet`) + "Goals" (`GoalsModal`). Hand-built SVG rings (`components/GoalRing.tsx`); recharts powers the Insights donut |

### API Routes (`app/api/`)

| Route | Method | Auth | Summary |
|---|---|---|---|
| `/api/ai-ingest` | POST | Bearer token (required) | Parse a recipe from URL/HTML/text, **or** generate a full recipe from a dish name (`generate` mode). Calls Anthropic. |
| `/api/fetch-recipe` | GET | None | Server-side fetch of a page's raw HTML + `<title>` (CORS workaround for URL import) |
| `/api/grocery-cleanup` | POST | Bearer token (required) | AI dedup/normalize/categorize a grocery list |
| `/api/calendar/push` | POST | Bearer token (required) | **Google Calendar push executor (Batch 6).** Body carries a **client-obtained** Google OAuth access token (`calendar.events` scope) + explicit per-day `create`/`update`/`delete` operations; route calls the Calendar REST API against the user's **primary** calendar and returns one result per op. Has **no list/search** — only acts on the exact event IDs passed (the "no search-and-delete" safety invariant is structural). Token used transiently, never stored. |
| `/api/new-recipe-suggestions` | POST | Bearer token (required) | AI suggests 6 new recipes from taste profile |
| `/api/plan-suggestions` | POST | Bearer token (required) | AI suggests recipes to complete a week plan (FlavorGraph-informed) |
| `/api/recommendations` | POST | Bearer token (required) | AI 3-bucket recommendations from cooking history + ratings |
| `/api/recipe-assistant` | POST | Bearer token (required) | Conversational cooking assistant for a single recipe (substitutions, scaling, dietary swaps, technique). Stateless; conversation history passed per request. Calls Anthropic. |
| `/api/nutrition-lookup` | POST | Bearer token (required) | Shared nutrition engine (`lib/nutritionEngine.ts`). `{type:"recipe",recipeId}` computes a full `nutrition` object from the recipe's ingredients (parser → **canonical staples table (Batch 4)** → USDA with match validation → Anthropic AI fallback); `{type:"food",name}` resolves an arbitrary food ("Big Mac") to per-serving macros via USDA Branded/Survey, AI fallback. Read-only — does not persist to the recipe doc. |
| `/api/nutrition-revalidate` | POST | Bearer token (required) | Re-validate low-confidence recipe nutrition by re-running the shared engine (`computeRecipeNutrition`). **DRY-RUN by default** — diffs old vs proposed per-serving/total macros, matched tier, new confidence, **without** writing; `?apply=true` persists. Filters recipes whose estimate is low-confidence / AI-derived / assumed-servings (`servingsAssumed` OR source contains `ai`). Apply persists **only** recomputes that are no longer `low` confidence (still-low → left untouched). Bounded batches: `?limit` (default 25, max 50) + `?offset`. Engine-reuse only — no parallel estimator. |
| `/api/nutrition-canonical-dryrun` | POST | Bearer token (required) | **Canonical-staples recompute — DRY-RUN ONLY (Batch 4); there is no apply path in this route.** Recomputes catalog nutrition with the canonical-aware engine and emits a diff: per recipe **baseline** (`useCanonical:false`) vs **proposed** (`useCanonical:true`), so `canonicalΔ = proposed.total − baseline.total` isolates the table's effect; plus stored `old`, which ingredients newly resolved via the table, and old/new confidence. Never writes (no `apply` param exists). `?scope=low` restricts to `confidence==='low'` (Task-C projection); `?recipeId=<id>` targets one; bounded `?limit`(≤50)/`?offset`. |
| `/api/barcode-lookup` | POST | Bearer token (required) | Packaged-product nutrition by barcode. `{barcode:"<UPC/EAN>"}` → cascade Open Food Facts (`source:"openfoodfacts"`, confidence medium\|low) → USDA branded by GTIN (`source:"usda_branded"`, confidence medium) → miss. Hit returns `{found,name,nutrition,serving_size,serving_grams?,servings_per_container?,source,confidence,basis}` where `basis` is `per_serving`\|`per_100g` (OFF often gives per-100g). `serving_grams?` (numeric grams in one declared serving) and `servings_per_container?` (≈ servings/pack, derived from OFF `product_quantity`/`serving_quantity` or USDA `packageWeight`) are present when derivable — they drive the servings/grams toggle and the serving-context lines in Scan. Server-side fetch sets OFF's courtesy User-Agent. Read-only. Fed by the **Scan** mode in `LogFoodSheet.tsx` (camera → BarcodeDetector or zxing fallback). |

---

## Section 3 — Data Model

Firestore collections (paths defined in `lib/userdata.ts`, `lib/queue.ts`, `lib/recipes.ts`).
All user data is keyed under `users/{uid}/…`. The web app mirrors the iOS app's structure.

### `recipes/{id}` — shared recipe catalog (`lib/recipes.ts`)
Doc ID = slugified title. Fields (see `types/recipe.ts` → `Recipe`):
`recipeID, title, content, category, cuisine, imageURL, sourceURL, sourceFile, labels,
hasImage, created, modified, addedBy?, prepTime?, cookTime?, servings?, nutrition?, nutritionStatus?, defaultRole?`.
- `content` is a single freeform string; ingredients/instructions are **parsed at runtime**
  (`parseRecipeContent`), not stored as arrays.
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
Fields: `id, name, quantity, unit, isChecked, isManual, sourceRecipeIDs[], manualSection?,
createdAt?, updatedAt?`. Per-user isolated (explicit comment in `userdata.ts`). `quantity`/`unit`/
`name` are populated by the shared parser at add time (see §5.16) — `name` holds the bare noun
phrase, not the whole line. Auto-added (recipe) items are keyed `sanitize(normalizedNoun)` so the
same ingredient across recipes lands on one doc (legacy `sanitize(recipeID-ingredient)` ids are
still read/merged); manual items keyed `sanitize(name)-<timestamp>`. Existing items are never
re-parsed — parsing is additive, on the add path only.

### `users/{uid}/pantry/root/savedGroceryItems/{itemId}` — remembered grocery items (`SavedGroceryItem`)
Fields: `id, name, defaultCategory, timesUsed, lastUsed`. Frequency-ranked memory of
manually-added items + their chosen category, for faster re-entry.

### `users/{uid}/nutrition/root/log/{entryId}` — consumption log (`ConsumptionEntry`, `lib/consumptionLog.ts`)
One doc per consumed item (auto-ID). Fields: `date (Timestamp eaten), meal('breakfast'|'lunch'|'snack'|'dinner'), type('recipe'|'quick_food'|'manual'), is_cook_event, recipe_id|null, name, servings_eaten, amount_label?, nutrition{6 macros — SNAPSHOT totals = per-serving × servings_eaten}, source('recipe'|'usda'|'ai_estimate'|'manual'), created_at, userId`.
`servings_eaten` is always the multiplier on the per-basis nutrition (per serving, or per 100 g for grams-entered items); `amount_label?` (optional) records the human-readable amount as entered — e.g. `"45 g"` or `"1.5 servings"` — for the Today view. The recursive console rule `users/{uid}/nutrition/{document=**}` already covers it (no rules change).
Snapshot semantics: editing a recipe later never rewrites past entries. `is_cook_event: true`
entries (written only via `logCookEvent` — Cooking Mode finish or plan checkmark) are the only
ones tied to the plan; leftover/quick logs are `false` and never touch the plan.
Note: the spec drafted this as a top-level `consumption_log` collection; implementation follows
the existing `users/{uid}/{area}/root/*` convention instead.

### `users/{uid}/nutrition/root/goals/daily` — daily nutrition goals (`NutritionGoals`)
Single doc: the six macro targets + `updated_at`. (Spec drafted `goals/{userId}`; same
convention-following relocation as the log.)

### `users/{uid}/nutrition/root/savedFoods/{foodId}` — starred quick-foods (`SavedFood`)
Doc ID = sanitized lowercased name. Fields: `id, name, nutrition{6 macros per serving},
source('usda'|'ai_estimate'|'manual'), created_at`.

### `users/{uid}/recipeQueue/{id}` — AI parse queue (`QueuedRecipe`, `lib/queue.ts`)
Staging area for AI-parsed/generated recipes before publishing into `recipes`. Fields:
`title, cuisine, category, ingredients[], instructions[], imageURL, sourceURL, description,
servings, prepTime, cookTime, status('pending'|'published'), createdAt?`.
`buildRecipeContent()` serializes the structured fields back into the flat `content` format.

### `sharedWeekPlans/{weekID}/users/{uid}` — friends' published plans (`SharedPlanEntry`)
Fields: `uid, displayName, photoURL, plannedRecipeIDs[], updatedAt?`. The Plan page can
publish the current user's week and subscribe to other users' entries for the same week.
**`plannedRecipeIDs[]` here stays a flat `string[]`** (Batch 5): `publishSharedPlan` maps the
owner's `PlannedEntry[]` down to bare IDs via `plannedRecipeIDList`, so friends see *which* recipes
were planned but never the owner's private day/role assignments. The publish/Friends' feature is
otherwise unchanged.

---

## Section 4 — Domain Invariants

1. **Single admin user / HubBanner gating.** `components/HubBanner.tsx` renders the cross-app
   MEA hub navigation **only** when `user.email === 'folstromjohn@gmail.com'`
   (`ADMIN_EMAIL` constant). This is the one hard admin-email check in the app.
2. **Auth required for all writes & AI.** Every API route except `/api/fetch-recipe` calls
   `verifyAuthToken` (Firebase Admin `verifyIdToken`) and returns 401 without a valid Bearer
   token. Client Firestore writes always pass `user.uid` from `useAuth()`.
3. **Access enforcement is NOT email-restricted at the data layer.** The Firestore rules
   (managed manually in the Firebase Console — **not** version-controlled here; see
   **Firestore rules** below) allow **any** authenticated user to read `recipes` and
   read/write their own `users/{uid}/**`. Single-user access is a product convention + the
   HubBanner check, not a Firestore-enforced email allowlist.
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

---

## Section 5 — Key Calculations & Business Logic

1. **Recipe list filtering & live count** — `app/recipes/page.tsx`. A `filtered` `useMemo`
   recomputes on every change to search text, cuisine, category, min-rating, source, time
   filter, and sort; the displayed count updates live (per keystroke). Search uses fuse.js.
2. **Filter persistence** — `app/recipes/page.tsx` writes filter state to `localStorage` keys:
   `mea_recipes_search`, `mea_recipes_cuisine`, `mea_recipes_category`, `mea_recipes_minRating`,
   `mea_recipes_source`, `mea_recipes_sort`, `mea_recipes_filter`, `mea_recipes_timeFilter`.
   `app/favorites/page.tsx` mirrors the same controls with parallel `mea_favorites_*` keys so
   the two pages persist independently. Favorites does **not** apply the default "Added by me"
   source filter.
3. **Default "Added by me" filter** — on first mount, if no remembered choice exists in
   `sessionStorage` (`mea_recipes_default_mine_applied`) **and** the user is signed in, the
   source filter defaults to `mine` once per session.
4. **AI recipe generation flow** — Discover page: free-text dish name → `POST /api/ai-ingest`
   with `{ generate }` → Anthropic returns structured JSON → user reviews/edits → `saveRecipe`
   into `recipes`. Generation is **FlavorGraph-informed**: `getComplementaryIngredients` seeds
   the prompt with scientifically complementary ingredients (`lib/flavorPairings.ts` +
   `lib/flavor-pairings.json`).
5. **AI recipe import flow** — Add modal / Queue: URL or pasted text → `POST /api/ai-ingest`
   → structured recipe → saved to `recipeQueue` (`status: 'pending'`) → reviewed in `/queue`
   → published into `recipes`. Client-provided `imageURL`/`prepTime`/`cookTime` (e.g. from the
   bookmarklet) take precedence over AI-parsed values.
6. **Ingredient/instruction parsing** — `parseRecipeContent` (`lib/recipes.ts`) splits the flat
   `content` string into ingredients/instructions by header keywords (`INGREDIENTS`,
   `INSTRUCTIONS`, etc.) and strips `Step N` prefixes and yield/scale noise.
7. **Ingredient sub-header detection** — `detectIngredientHeader` flags lines that are section
   headers (colon-ending, markdown-bold, or keyword matches like "sauce", "marinade") for
   rendering as sub-headers inside the ingredient list.
8. **Cook/prep time normalization** — `parseTimeToMinutes` parses ISO-8601 (`PT30M`), `1 hr 15 min`,
   `1h30m`, and bare numbers into minutes; `formatMinutes` renders back; `getTotalTime` sums
   prep + cook. Drives the time filter and time badges.
9. **Grocery categorization** — `categorizeIngredient` (`lib/groceryCategories.ts`) maps an
   ingredient name to one of 9 iOS-compatible categories by first-match keyword rules.
   `Spices & Seasonings` (dried spices/chiles — chile, chili, chipotle, ancho, guajillo,
   paprika, cumin, etc.) is matched before `Staples` and **is** manually selectable;
   `Staples` remains **auto-assigned only** (excluded from `MANUAL_CATEGORIES`). Manual
   override via `GroceryItem.manualSection`.
10. **AI grocery cleanup** — `POST /api/grocery-cleanup` sends the list to Anthropic, which
    returns per-item actions (`keep` / `merge` / `normalize` / `remove`) with `mergedWith`
    indices and a category. The route imports `GROCERY_CATEGORIES` (no hand-duplicated list)
    and validates each returned `category`; an off-list value falls back to the local
    `categorizeIngredient` match. Last-run tracked in `localStorage` `mea-grocery-last-cleaned`.
11. **Rebuild grocery from plan** — `rebuildGroceryFromPlan` (`lib/userdata.ts`) deletes
    non-manual/non-legacy items, then re-adds parsed ingredients from each planned recipe via
    `addRecipeIngredientsToGrocery`, which merges by normalized noun and unions `sourceRecipeIDs`
    (see §5.16). Idempotent: re-adding a recipe already in `sourceRecipeIDs` is a no-op, and the
    delete-then-re-add means quantities never double-count across rebuilds.
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
    lowercase + strip punctuation/articles, **no stemming or modifier-drop**, so `"red onion"` ≠
    `"onion"`); `mergeQuantities` **sums** compatible units (`"2 cups"+"1 cup"="3 cups"`) and
    otherwise lists both side by side without dropping either (`"2 cups + 3 tbsp"`). Manual adds
    merge only into manual items and recipe adds only into recipe items (the pools stay separate
    to preserve the rebuild invariant in §5.11). The existing whole-list "AI Clean Up List" button
    (§5.10) is unchanged.
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
    from the recipe's `category` via `deriveRoleFromCategory`/`CATEGORY_ROLE` (`lib/userdata.ts`): only
    **"Breakfast, Snacks & Sides" → `side`**; all mains (Chicken & Poultry, Beef & Pork, Seafood,
    Vegetarian Mains, Pasta/Noodles & Rice) **and** the ambiguous categories (Salads & Bowls, Soups/Stews
    & Chili) → `main` (a missing side is less wrong than a missing main; unknown/empty category → `main`).
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
    (`lib/canonicalStaples.ts`, 123 entries) maps common cooking staples → the exact correct USDA
    FoodData Central entry (fdcId + description + dataType + per-100g macros, SR Legacy/Foundation
    plain base forms; generated + verified by `scripts/verify-canonical-staples.js`). It is the **new
    first tier** of ingredient resolution in `computeRecipeNutrition`: **canonical table → existing
    USDA search+validation → AI estimate**. On a canonical hit the engine uses the verified per-100g
    macros directly and skips the fuzzy matcher (the kcal-band check still runs as a *signal* — logged,
    not rejected). On no hit it falls through to the **existing matcher, unchanged** for non-staples.
    **Matching rule (conservative, in `matchCanonicalStaple`):** tokenize the name with `keyTokens`;
    an entry matches when one of its aliases' tokens are a subset of the ingredient's tokens; the
    most-specific (most-tokens) entry wins; **ties between different entries → no match (fall through)**;
    per-entry `guard` regexes veto homographs (e.g. "butter beans"/"butternut" never → dairy butter,
    "sugar snap peas" never → granulated sugar). A *missed* canonical match is just status-quo; a
    *wrong* one is the thing avoided. Recipes resolved via the table carry a `+canonical` source suffix
    (still `startsWith('usda')`, so `sourceLabel`/`servingsAssumed`/revalidation predicates are
    unaffected). **Data status:** as of Batch 4 this is **engine + table + dry-run tool only** — the
    recompute is DRY-RUN (`/api/nutrition-canonical-dryrun`, no apply path) and **no stored nutrition
    has been rewritten**; applying the corrected macros is a separate, later, explicitly-authorized step
    (see `batch4-canonical-dryrun.md`).

---

## Section 6 — Known Sharp Edges

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
- **`ANTHROPIC_API_KEY` is not in local `.env.local`.** All AI routes read
  `process.env.ANTHROPIC_API_KEY`; the local env file only defines the three `FIREBASE_*`
  admin vars. The Anthropic key must be set in Vercel project env vars for AI features to work.
- **Firebase web config is hardcoded** in `lib/firebase.ts` (apiKey, project, appId). This is
  normal for Firebase web apps but means the client config is committed, not env-driven.
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
  Fallback is the **bookmarklet** (set up in `/queue#bookmarklet`) which captures the page from
  the user's logged-in browser, or pasting text directly.
- **Image display precedence.** Cards and detail prefer `meta.overrides.imageURL` over the
  catalog `recipe.imageURL` (`RecipeCard.tsx`, `RecipeEditModal.tsx`). A stale override will
  win over a corrected catalog image.
- **"Add to Plan" popover** on `RecipeCard` lets you pick a week (current +0…+4), writes via
  `addRecipeToWeekPlan`, shows an "Added!" confirmation, and auto-closes after ~1.5s. It is
  rendered at `z-[100]`; the recipes-page time-filter dropdown is `z-50` — keep popover layers
  above page chrome to avoid the historical z-index overlap.
- **Recipe doc IDs are slugified titles.** Two recipes with the same title collide on the same
  `recipes/{slug}` document; `saveRecipe` overwrites by slug.
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
  per-serving sugar **18.3 → 3.7 g**. Those corrected macros are **not yet applied** (dry-run only).
- **Canonical staples table is AUTO-GENERATED — don't hand-edit (Batch 4).** `lib/canonicalStaples.ts`
  is emitted by `scripts/verify-canonical-staples.js` (curated seeds → live USDA search → detail-endpoint
  per-100g macros → kcal-band check). To change/add an entry, edit the **seed list in the script** and
  re-run it (it re-verifies every entry live and overwrites the file), not the `.ts` directly. The
  generated entries are SR Legacy/Foundation only; `rice vinegar` is intentionally **excluded** (no plain
  USDA entry) and falls through to the fuzzy matcher. The dry-run tool runs locally **without
  `ANTHROPIC_API_KEY`**, so it computes baseline (canonical-off) and proposed (canonical-on) in the same
  AI-less runtime — the `canonicalΔ` is exact, but absolute totals for AI-dependent recipes read lower
  than the stored `old`, and the high/medium confidence split is a local lower bound. **The Batch-4 diff
  is review-only: stored `nutrition`/`servings`/`confidence` are unchanged until a separate apply step.**
- **Category label drift.** The AI prompt and some UI use unpunctuated category names (e.g.
  "Pasta Noodles & Rice"), while `types/recipe.ts` `Category` uses comma forms
  ("Pasta, Noodles & Rice"). Normalize when comparing.
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
- **USDA search API rejects parenthesized dataType values.** Sending
  `dataType=Survey (FNDDS)` in the querystring intermittently returns nginx HTTP 400
  (~60% observed, load-balancer dependent). `lib/nutritionEngine.ts` therefore never sends a
  parenthesized dataType: ingredient lookups use `SR Legacy,Foundation`; food-name lookups omit
  the param and post-filter results by dataType. Don't "simplify" this back.
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

---

## Section 7 — Feature Backlog

Derived from in-code affordances and comments. No `TODO`/`FIXME` markers exist in app code.

| Feature | Priority | Status | Notes |
|---|---|---|---|
| Bookmarklet for paywalled sites (NYT Cooking, etc.) | High | Done | Setup UI at `/queue#bookmarklet`; captures page from logged-in browser |
| AI grocery cleanup / dedup | High | Done | `/api/grocery-cleanup`; `mea-grocery-last-cleaned` tracks last run |
| Recommendations trigger button (avoid charges) | Medium | Done | Recommendations/suggestions only fire on explicit button + are cached |
| Manual grocery category assignment | Medium | Done | `GroceryItem.manualSection` + `MANUAL_CATEGORIES` (Staples excluded) |
| Saved/remembered grocery items | Medium | Done | `savedGroceryItems` ranks by `timesUsed` for fast re-entry |
| FlavorGraph-informed generation | Medium | Done | `getComplementaryIngredients` seeds Discover + plan-suggestions prompts |
| Shared week plans (view friends' plans) | Low | Done | `sharedWeekPlans/{weekID}/users/{uid}` |
| Auth / PWA improvements | Medium | Partial | Standalone-mode detection uses `signInWithRedirect` vs popup (`AuthContext`) |
| Commit Firestore rules to repo | Medium | Won't do | Reverted — the `malignant-metro` DB is shared across apps, so rules are managed manually in the Firebase Console only (a deploy from here would overwrite other apps' rules). See **Firestore rules** + Sharp Edges |
| Export utilities | Low | Done (scripts) | `export-recipes.js`, `update-recipe-times.js` (Node scripts, not app routes) |
| Nutrition tracker (per-recipe macros + consumption log + insights) | High | Done | 5-surface design in `nutrition-tracker-spec.md`. Surface 1 (recipe detail display + editable servings) **Done**; backfill **Done** (202/205); shared lookup engine (`lib/nutritionEngine.ts` + `/api/nutrition-lookup`) **Done**; Surface 2 cooked capture (Cooking Mode finish + plan checkmark → `logCookEvent`, dedupe-guarded) **Done**; Surface 3 log-food sheet (`LogFoodSheet.tsx`) **Done**; Surface 4 Today view **Done**; Surface 5 Insights tab **Done**; **auto-nutrition-on-publish Done** (Surface 1b — see below) — all surfaces complete |
| Canonical staples ingredient resolution (nutrition accuracy fix) | High | Partial (dry-run done; apply pending review) | Batch 4. Root-cause fix for implausible macros from USDA fuzzy mis-matches (e.g. Easy Spaghetti pasta → "Frozen yogurts"). `lib/canonicalStaples.ts` (123 live-verified entries, generated by `scripts/verify-canonical-staples.js`) is the new first tier in `computeRecipeNutrition` (canonical → USDA validation → AI). DRY-RUN recompute + diff via `/api/nutrition-canonical-dryrun` → `batch4-canonical-dryrun.md`. **No stored nutrition written** — applying the corrected macros is a separate, explicitly-authorized step. See §5 #22, §6. |
| Barcode-based packaged-food lookup | Medium | Done | Server-side lookup: `/api/barcode-lookup` + `lib/nutritionEngine.ts` `lookupFoodByBarcode` (Open Food Facts → USDA branded GTIN → miss), client helper `lookupBarcode` (`lib/nutrition.ts`), returns `basis` per_serving\|per_100g. Camera UI: **Scan** mode (4th tab) in `LogFoodSheet.tsx` — native `BarcodeDetector` where supported, lazy-loaded `@zxing/browser` fallback; EAN/UPC only; rear camera via getUserMedia; graceful permission-denied and not-found fallbacks route to Search. Dev panel (`BarcodeTestPanel.tsx`) removed. Reuses `saved_foods`/`consumption_log` — no new collection. Serving/grams amount entry **Done**: per-100g hits take grams directly, per-serving hits with a numeric serving size get a Servings⇄Grams toggle (engine now returns `serving_grams`/`servings_per_container`; entry records `amount_label`). |
| Push meal plan to Google Calendar | Medium | Done | Manual **"Add this week to Calendar"** on the Plan page → one event per planned day, idempotent re-push via `weekPlans.calendarEventIds`. **Option B auth:** client mints a `calendar.events` OAuth token via a Firebase Google re-auth popup and passes it to the auth-gated `/api/calendar/push` executor (no server-side Google creds; route has no list/search). Requires the Calendar API enabled + the scope on the OAuth consent screen (see §6). |
| Password login (email/password via account linking) | Medium | Done | Batch 7. Google-signed-in user adds a password in settings (`PasswordLoginSettings` → `linkWithCredential`, same uid/data, no new account); login screen (`SignInOptions`, used in the `/favorites` + `/plan` gates) keeps Google and adds email/password **sign-in only** (no signup) + "Forgot password?" (`sendPasswordResetEmail`, neutral confirmation). Requires the Email/Password provider enabled in the Firebase console (see §4 #7, §6, §8). |
| Auto-nutrition on recipe create/publish | High | Done | New recipes land with `nutrition` populated. `computeAndStoreNutrition()` (`lib/recipes.ts`) is called after `saveRecipe()` from queue publish (`app/queue/page.tsx`) and Discover direct-save (`app/discover/page.tsx`), with a "Calculating nutrition…" loading state. Timeout-guarded (~20s) — never blocks the save; on failure the recipe is flagged `nutritionStatus:'needs_calc'`. Manual retry: "Calculate nutrition" button in the Surface 1 empty state (`components/NutritionSection.tsx`, 45s window) |

---

## Section 8 — External Services & Keys

Credential **names only** — never commit values. Local `.env.local` is gitignored.

| Service | Purpose | Credential(s) (env var names) |
|---|---|---|
| Firebase Auth | User identity — **Google sign-in** + optional **email/password linked to the same account** (Batch 7) | Web config hardcoded in `lib/firebase.ts` (apiKey, authDomain, projectId, …). **Console prerequisite:** the **Email/Password** provider must be enabled under Authentication → Sign-in method, or the link/sign-in/reset calls throw `auth/operation-not-allowed`. |
| Firebase Firestore (client) | Recipe catalog + per-user data | Same hardcoded web config |
| Firebase Admin | Server-side ID-token verification in API routes | `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` |
| Anthropic API | AI recipe generation, parsing, grocery cleanup, recommendations | `ANTHROPIC_API_KEY` (set in Vercel; **not** in local `.env.local`) |
| Google Calendar API | Push meal-plan days as calendar events (Batch 6) | **No stored credential.** Client-obtained OAuth access token (`calendar.events` scope) via Firebase Google sign-in re-auth popup. Requires the Calendar API **enabled** + the scope on the **OAuth consent screen** in the `malignant-metro` GCP project. |
| Vercel | Hosting / deployment | Project/team IDs not stored in repo |

AI model in use across all routes: `claude-sonnet-4-20250514`, REST Messages API,
header `anthropic-version: 2023-06-01`.

---

## Firestore rules

Firestore security rules for the shared malignant-metro database are managed manually in the
Firebase Console, NOT in this repo. Do not add a deployable firestore.rules file or run firebase
deploy for rules — the database is shared across multiple apps and a deploy from here would
overwrite the others' rules. When adding a new collection, update the rules in the console.
