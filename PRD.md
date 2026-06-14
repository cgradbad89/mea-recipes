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

**Hosting:** Vercel · **Auth:** Firebase Auth (Google sign-in) · **Database:** Firebase Firestore

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
| Recipe detail | `/recipes/[id]` (`app/recipes/[id]/page.tsx`) | Done | Full recipe, parsed ingredients/instructions, notes + rating, edit, full-screen Cooking Mode (`components/CookingMode.tsx`) |
| Discover | `/discover` (`app/discover/page.tsx`) | Done | AI recipe generator (free-text), recommendations, new-recipe suggestions |
| Grocery | `/grocery` (`app/grocery/page.tsx`) | Done | Live grocery list, category grouping, AI cleanup |
| Plan | `/plan` (`app/plan/page.tsx`) | Done | Weekly meal planner (Mon-start weeks), cooked tracking, AI plan suggestions, shared plans |
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
| `/api/new-recipe-suggestions` | POST | Bearer token (required) | AI suggests 6 new recipes from taste profile |
| `/api/plan-suggestions` | POST | Bearer token (required) | AI suggests recipes to complete a week plan (FlavorGraph-informed) |
| `/api/recommendations` | POST | Bearer token (required) | AI 3-bucket recommendations from cooking history + ratings |
| `/api/recipe-assistant` | POST | Bearer token (required) | Conversational cooking assistant for a single recipe (substitutions, scaling, dietary swaps, technique). Stateless; conversation history passed per request. Calls Anthropic. |
| `/api/nutrition-lookup` | POST | Bearer token (required) | Shared nutrition engine (`lib/nutritionEngine.ts`). `{type:"recipe",recipeId}` computes a full `nutrition` object from the recipe's ingredients (parser → USDA with match validation → Anthropic AI fallback); `{type:"food",name}` resolves an arbitrary food ("Big Mac") to per-serving macros via USDA Branded/Survey, AI fallback. Read-only — does not persist to the recipe doc. |
| `/api/barcode-lookup` | POST | Bearer token (required) | Packaged-product nutrition by barcode. `{barcode:"<UPC/EAN>"}` → cascade Open Food Facts (`source:"openfoodfacts"`, confidence medium\|low) → USDA branded by GTIN (`source:"usda_branded"`, confidence medium) → miss. Hit returns `{found,name,nutrition,serving_size,serving_grams?,servings_per_container?,source,confidence,basis}` where `basis` is `per_serving`\|`per_100g` (OFF often gives per-100g). `serving_grams?` (numeric grams in one declared serving) and `servings_per_container?` (≈ servings/pack, derived from OFF `product_quantity`/`serving_quantity` or USDA `packageWeight`) are present when derivable — they drive the servings/grams toggle and the serving-context lines in Scan. Server-side fetch sets OFF's courtesy User-Agent. Read-only. Fed by the **Scan** mode in `LogFoodSheet.tsx` (camera → BarcodeDetector or zxing fallback). |

---

## Section 3 — Data Model

Firestore collections (paths defined in `lib/userdata.ts`, `lib/queue.ts`, `lib/recipes.ts`).
All user data is keyed under `users/{uid}/…`. The web app mirrors the iOS app's structure.

### `recipes/{id}` — shared recipe catalog (`lib/recipes.ts`)
Doc ID = slugified title. Fields (see `types/recipe.ts` → `Recipe`):
`recipeID, title, content, category, cuisine, imageURL, sourceURL, sourceFile, labels,
hasImage, created, modified, addedBy?, prepTime?, cookTime?, servings?, nutrition?`.
- `content` is a single freeform string; ingredients/instructions are **parsed at runtime**
  (`parseRecipeContent`), not stored as arrays.
- `addedBy` = uid of the web user who added it (used by the "Added by me" filter).
- Read with an in-memory module cache (`_recipesCache`), invalidated on save/delete.
- `nutrition` (written by the nutrition backfill; see `nutrition-tracker-spec.md`) is an embedded
  object: per-serving macros `calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g`, plus
  `serving_size, servings, total{…}, source, confidence, computed_at`. `total` (whole-recipe) is
  the durable basis; per-serving = `total / servings`. Editing servings re-derives per-serving via
  `updateRecipeServings` (`lib/recipes.ts`) — a **deep-merge** write that never alters `total`.
  `docToRecipe` must explicitly pass `nutrition`/`servings` through (it whitelists fields).

### `users/{uid}/recipes/root/favorites/{recipeID}` — favorites
Doc per favorited recipe; body `{ updatedAt }`. Existence = favorited.

### `users/{uid}/recipes/root/meta/{recipeID}` — notes, ratings, overrides (`RecipeMeta`)
Fields: `recipeID, note?, rating?, updatedAt?, overrides?`. `overrides` may contain
`title, cuisine, category, content, imageURL, prepTime, cookTime` — per-user edits that
shadow the shared catalog recipe without mutating it. Doc ID is sanitized (`/`→`_`, spaces→`-`).

### `users/{uid}/pantry/root/weekPlans/{weekID}` — meal plans (`WeekPlan`)
`weekID` = ISO date of the **Monday** of the week (`weekIDFromDate`). Fields:
`weekID, weekStartISO, plannedRecipeIDs[], cookedRecipeIDs[], updatedAt?`.

### `users/{uid}/pantry/root/groceryItems/{docId}` — grocery list (`GroceryItem`)
Fields: `id, name, quantity, unit, isChecked, isManual, sourceRecipeIDs[], manualSection?,
createdAt?, updatedAt?`. Per-user isolated (explicit comment in `userdata.ts`). Auto-added
items are keyed `sanitize(recipeID-ingredient)`; manual items keyed `sanitize(name)`.

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
   doc is never mutated by an override.

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
    non-manual/non-legacy items, then re-adds parsed ingredients from each planned recipe,
    deduping by doc ID and unioning `sourceRecipeIDs`.
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

---

## Section 6 — Known Sharp Edges

- **Firestore rules are console-only — do not version them here.** A `firestore.rules` file was
  briefly committed with the auto-nutrition-on-publish work and then removed: the `malignant-metro`
  database is **shared across multiple apps**, so a `firebase deploy` of rules from this repo would
  overwrite the other apps' rulesets. The authoritative ruleset lives exclusively in the Firebase
  console for `malignant-metro` (it includes the `users/{uid}/nutrition/{document=**}` rule added
  after the earlier silent-write incident). See **Firestore rules** below; when adding a collection,
  update the rule in the console, not in this repo.
- **`ANTHROPIC_API_KEY` is not in local `.env.local`.** All AI routes read
  `process.env.ANTHROPIC_API_KEY`; the local env file only defines the three `FIREBASE_*`
  admin vars. The Anthropic key must be set in Vercel project env vars for AI features to work.
- **Firebase web config is hardcoded** in `lib/firebase.ts` (apiKey, project, appId). This is
  normal for Firebase web apps but means the client config is committed, not env-driven.
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
- **Nutrition servings edits write the shared recipe doc, not per-user `meta` overrides.** Unlike
  title/content edits (which are personal overrides), the servings correction in `RecipeEditModal`
  mutates `recipes/{id}.nutrition` for everyone — servings is a property of the recipe, and
  `nutrition.total` only lives on the shared doc. Safe given the single-user model.
- **Category label drift.** The AI prompt and some UI use unpunctuated category names (e.g.
  "Pasta Noodles & Rice"), while `types/recipe.ts` `Category` uses comma forms
  ("Pasta, Noodles & Rice"). Normalize when comparing.
- **Cooking Mode wake lock is best-effort.** `components/CookingMode.tsx` uses the Screen Wake
  Lock API (`navigator.wakeLock.request('screen')`), re-acquiring on `visibilitychange`. Browsers
  without the API (notably iOS Safari historically) silently no-op — the screen may still sleep.
  The takeover is `fixed inset-0 z-[100]`, sharing the same layer as the Add-to-Plan popover; it
  covers the `z-50` HubBanner. Its checked-ingredient / current-step state is in-memory only and
  resets on each launch (no persistence).
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
| Barcode-based packaged-food lookup | Medium | Done | Server-side lookup: `/api/barcode-lookup` + `lib/nutritionEngine.ts` `lookupFoodByBarcode` (Open Food Facts → USDA branded GTIN → miss), client helper `lookupBarcode` (`lib/nutrition.ts`), returns `basis` per_serving\|per_100g. Camera UI: **Scan** mode (4th tab) in `LogFoodSheet.tsx` — native `BarcodeDetector` where supported, lazy-loaded `@zxing/browser` fallback; EAN/UPC only; rear camera via getUserMedia; graceful permission-denied and not-found fallbacks route to Search. Dev panel (`BarcodeTestPanel.tsx`) removed. Reuses `saved_foods`/`consumption_log` — no new collection. Serving/grams amount entry **Done**: per-100g hits take grams directly, per-serving hits with a numeric serving size get a Servings⇄Grams toggle (engine now returns `serving_grams`/`servings_per_container`; entry records `amount_label`). |
| Auto-nutrition on recipe create/publish | High | Done | New recipes land with `nutrition` populated. `computeAndStoreNutrition()` (`lib/recipes.ts`) is called after `saveRecipe()` from queue publish (`app/queue/page.tsx`) and Discover direct-save (`app/discover/page.tsx`), with a "Calculating nutrition…" loading state. Timeout-guarded (~20s) — never blocks the save; on failure the recipe is flagged `nutritionStatus:'needs_calc'`. Manual retry: "Calculate nutrition" button in the Surface 1 empty state (`components/NutritionSection.tsx`, 45s window) |

---

## Section 8 — External Services & Keys

Credential **names only** — never commit values. Local `.env.local` is gitignored.

| Service | Purpose | Credential(s) (env var names) |
|---|---|---|
| Firebase Auth | Google sign-in / user identity | Web config hardcoded in `lib/firebase.ts` (apiKey, authDomain, projectId, …) |
| Firebase Firestore (client) | Recipe catalog + per-user data | Same hardcoded web config |
| Firebase Admin | Server-side ID-token verification in API routes | `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` |
| Anthropic API | AI recipe generation, parsing, grocery cleanup, recommendations | `ANTHROPIC_API_KEY` (set in Vercel; **not** in local `.env.local`) |
| Vercel | Hosting / deployment | Project/team IDs not stored in repo |

AI model in use across all routes: `claude-sonnet-4-20250514`, REST Messages API,
header `anthropic-version: 2023-06-01`.

---

## Firestore rules

Firestore security rules for the shared malignant-metro database are managed manually in the
Firebase Console, NOT in this repo. Do not add a deployable firestore.rules file or run firebase
deploy for rules — the database is shared across multiple apps and a deploy from here would
overwrite the others' rules. When adding a new collection, update the rules in the console.
