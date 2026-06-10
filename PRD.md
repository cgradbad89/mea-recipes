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

---

## Section 3 — Data Model

Firestore collections (paths defined in `lib/userdata.ts`, `lib/queue.ts`, `lib/recipes.ts`).
All user data is keyed under `users/{uid}/…`. The web app mirrors the iOS app's structure.

### `recipes/{id}` — shared recipe catalog (`lib/recipes.ts`)
Doc ID = slugified title. Fields (see `types/recipe.ts` → `Recipe`):
`recipeID, title, content, category, cuisine, imageURL, sourceURL, sourceFile, labels,
hasImage, created, modified, addedBy?, prepTime?, cookTime?`.
- `content` is a single freeform string; ingredients/instructions are **parsed at runtime**
  (`parseRecipeContent`), not stored as arrays.
- `addedBy` = uid of the web user who added it (used by the "Added by me" filter).
- Read with an in-memory module cache (`_recipesCache`), invalidated on save/delete.

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
   (documented in `README.md`, not committed as `firestore.rules`) allow **any** authenticated
   user to read `recipes` and read/write their own `users/{uid}/**`. Single-user access is a
   product convention + the HubBanner check, not a Firestore-enforced email allowlist.
   _(See Sharp Edges — no `firestore.rules` file exists in the repo.)_
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
   ingredient name to one of 8 iOS-compatible categories by first-match keyword rules.
   `Staples` is **auto-assigned only** (excluded from `MANUAL_CATEGORIES`). Manual override via
   `GroceryItem.manualSection`.
10. **AI grocery cleanup** — `POST /api/grocery-cleanup` sends the list to Anthropic, which
    returns per-item actions (`keep` / `merge` / `normalize` / `remove`) with `mergedWith`
    indices and a category. Last-run tracked in `localStorage` `mea-grocery-last-cleaned`.
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

---

## Section 6 — Known Sharp Edges

- **No `firestore.rules` file in the repo.** Rules exist only as a snippet in `README.md` and
  are managed in the Firebase console. There is therefore **no committed `validRating()` rule**
  — the "validRating rejecting 0" quirk could not be confirmed or located in code. Treat the
  documented rules as advisory until the actual console rules are exported into the repo.
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
- **Category label drift.** The AI prompt and some UI use unpunctuated category names (e.g.
  "Pasta Noodles & Rice"), while `types/recipe.ts` `Category` uses comma forms
  ("Pasta, Noodles & Rice"). Normalize when comparing.
- **Cooking Mode wake lock is best-effort.** `components/CookingMode.tsx` uses the Screen Wake
  Lock API (`navigator.wakeLock.request('screen')`), re-acquiring on `visibilitychange`. Browsers
  without the API (notably iOS Safari historically) silently no-op — the screen may still sleep.
  The takeover is `fixed inset-0 z-[100]`, sharing the same layer as the Add-to-Plan popover; it
  covers the `z-50` HubBanner. Its checked-ingredient / current-step state is in-memory only and
  resets on each launch (no persistence).

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
| Commit Firestore rules to repo | Medium | Backlog | Rules only live in README + console; no `firestore.rules` under version control |
| Export utilities | Low | Done (scripts) | `export-recipes.js`, `update-recipe-times.js` (Node scripts, not app routes) |
| Nutrition tracker (per-recipe macros + consumption log + insights) | High | Backlog | 5-surface design in `nutrition-tracker-spec.md`; build order & schemas defined there |

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
