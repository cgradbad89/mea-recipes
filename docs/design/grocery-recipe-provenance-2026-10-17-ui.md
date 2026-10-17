# Grocery recipe provenance — UI and catalog discovery

Date: 2026-10-17. Status: discovery complete; Option A explicitly approved by the product owner (“Approve Option A and continue implementation”). See the [design gate](grocery-recipe-provenance-2026-10-17-design.md) and [implemented browser verification](grocery-recipe-provenance-2026-10-17-browser.md). This discovery report and the accompanying reference captures describe the pre-implementation UI; implementation results are recorded separately.

## Actual application reference

The production Grocery page at `https://mea-recipes.vercel.app/grocery` was inspected read-only through the already authenticated Chrome session. No grocery controls, authentication controls, cleanup, rebuild, edit, delete, or persistence operations were activated. Temporary viewport overrides were reset after capture.

Captured references:

| Viewport | File |
| --- | --- |
| 1024 × 1000 | [Desktop 1024](../mockups/grocery-provenance/reference/current-desktop-1024.jpg) |
| 1280 × 1000 | [Desktop 1280](../mockups/grocery-provenance/reference/current-desktop-1280.jpg) |
| 1440 × 1000 | [Desktop 1440](../mockups/grocery-provenance/reference/current-desktop-1440.jpg) |
| 375 × 812 | [Mobile 375](../mockups/grocery-provenance/reference/current-mobile-375.jpg) |
| 390 × 844 | [Mobile 390](../mockups/grocery-provenance/reference/current-mobile-390.jpg) |

These are CSS viewport settings (read back as 1024 × 1000 and 390 × 844 for the two sampled checks, DPR 1). The browser screenshot service returns slightly resized JPEG files, so their raster dimensions differ from the CSS viewport dimensions in the filenames.

The inspected list displayed 45 remaining items and 33 checked items. Checked items were hidden by default. Produce contained 17 visible items and Usually On Hand contained 12, collapsed by default. These are observations of that session, not fixed design content or test fixtures.

## Existing rendering and responsive behavior

- `app/grocery/page.tsx` exports `GroceryPage()` and contains the complete grocery row UI. The page container is `p-6 max-w-2xl mx-auto`: a 672px maximum outer width with 24px padding on each side. It has no existing desktop-only row layout.
- `app/grocery/layout.tsx` uses `main.md:pl-56`; `components/Navigation.tsx` shows a fixed 224px sidebar at `md` and a bottom navigation bar below `md`.
- `tailwind.config.js` does not override screen breakpoints. Existing Tailwind defaults apply: `sm` 640px, `md` 768px, `lg` 1024px, `xl` 1280px, `2xl` 1536px. The catalog already uses `lg` and `xl`; Grocery itself currently uses neither.
- Categories are a single vertical stack, **not a category grid or HTML table**. `GROCERY_CATEGORIES` order is followed by Usually On Hand. Empty sections are omitted; items are sorted by extracted ingredient name, case-insensitively.
- Category cards use `bg-surface border border-border rounded-2xl overflow-hidden`, with 16px between cards. The full category header is a native button (`px-4 py-3`, `aria-expanded`) and toggles only that section.
- Each row is a plain, non-clickable `div` using `flex items-center gap-3 px-4 py-3`, separated by `border-border/50`. There is no parent-row selection or navigation handler.
- Normal rows are about 44px tall when the ingredient fits on one 20px line. The quantity, unit and name are one 14px text paragraph. Long ingredients wrap naturally; they are not truncated. Real mobile rows can exceed 100px when long names share width with existing controls.
- Current order is checkbox → combined quantity/name or edit controls → Usually On Hand preference → optional Need This Trip/Usually Have This button → edit → delete → category picker. Checkbox is 20px, ordinary action icons 12px (category icon 11px), and most icon actions have 4px padding.
- Checked rows have `opacity-60`; their ingredient text is `text-faint`. They are not struck through. Show/Hide checked is page-local state and has no persistence.
- Edit mode replaces the combined text with quantity (48px), unit (64px), flexible name, Save and Cancel. Preference, trip, edit and delete controls are hidden while editing; category remains. Enter saves and Escape cancels.
- Usually On Hand is derived by `deriveGrocerySections(items, savedItems, showCheckedItems)`; its preference and Need This Trip controls must retain their existing behavior and order.
- The admin-only `HubBanner` is visible in these captures. Its actual desktop height is about 46px; its links can wrap within the horizontally scrollable mobile banner. The banner is outside this feature's scope.

## Verified design tokens

The existing palette is ink `#0F0D0A`, surface `#1A1612`, card `#221E19`, border `#2E2820`, amber `#E8A838`, amber-dim `#B8832A`, amber-glow `#F5C060`, cream `#F5F0E8`, muted `#A89880`, faint `#6B5E50`.

`app/layout.tsx` loads Cormorant Garamond for display and DM Sans for body. Grocery heading is light 48px display type; row body is 14px; counts, compact controls and metadata use 12px. Category headings are 14px medium. Existing hover states use card backgrounds and amber/cream text. `app/globals.css` defines the shared ghost/primary buttons, inputs, skeleton and navigation classes. No new token system is needed.

## Existing loading, errors and empty states

- Signed-out Grocery displays the existing sign-in message.
- Grocery subscription loading/error occupies the page through `LoadingErrorRetry`; retry increments the subscription attempt.
- Mutation errors and cleanup status display a shared compact alert/status above the controls.
- Empty list and all-items-checked states are distinct. The latter offers Show checked.
- Recipe catalog state is independent of grocery subscription state. Recipe loading or failure must not gate checkbox, editing, category, delete, rebuild, preference, or cleanup operations.
- A missing recipe cannot be inferred while the catalog is still loading or has failed without usable data. The final proposed design uses neutral source-state copy and one page-level error message, without adding a retry control or per-row reads. Known catalog links remain usable. See the [final design specification](grocery-recipe-provenance-2026-10-17-design.md).

## Recipe catalog and identity contracts

Verified signatures and behavior:

```ts
// types/recipe.ts
interface Recipe { id: string; recipeID: string; title: string; /* other existing fields */ }

// lib/recipes.ts
getAllRecipes(): Promise<Recipe[]>
getRecipeById(id: string): Promise<Recipe | null>
invalidateRecipeCache(): void
recipeUrl(id: string): string

// components/AppDataProvider.tsx — relevant context fields
recipes: Recipe[]
recipesLoading: boolean
recipesError: string | null
refetchRecipes: () => Promise<void>
metas: Record<string, RecipeMeta>
metasLoading: boolean
metasError: string | null
```

`Recipe.id` is the authoritative Firestore document ID. `docToRecipe(id, data)` assigns that ID directly and separately assigns `recipeID: data.recipeID || id`. These two fields are not guaranteed equal for legacy data. Build the provenance lookup by **`recipe.id`**, and navigate using that same ID; do not choose `recipe.recipeID` as a replacement key or derive a slug from a title.

`getAllRecipes()` reads the shared `recipes` collection once when its module-level `_recipesCache` is empty, removes titleless records, sorts by canonical title, and caches the result. It is not a real-time subscription and has no TTL. `getRecipeById` always performs an individual document read and is unsuitable for row-by-row source resolution. The existing cache can temporarily retain a deleted recipe until invalidated/refreshed; this is a pre-existing limitation, not proof that missing recipe IDs should trigger individual fetches.

`AppDataProvider` calls `getAllRecipes()` on mount and exposes its state application-wide. `refetchRecipes` preserves previous recipes if a request fails and resolves after setting error state; it does not throw. It calls the same cache-aware `getAllRecipes`, so it does not inherently force a fresh server read after a previously successful cached load.

Grocery currently uses only `const { metas } = useAppData()` for rebuilding. It can consume `recipes`, `recipesLoading`, `recipesError` and `refetchRecipes` from the same provider with no new request or subscription. A memoized map keyed by `recipe.id` provides in-memory resolution for all rows.

Per-user `RecipeMeta.overrides.title?: string` is already available in `metas`. Metas are scoped to the authenticated owner with stale-result guards. Reuse `metas[recipe.id]?.overrides?.title || recipe.title`, matching the recipe detail page's effective-title fallback. While private metadata is unavailable, the canonical title remains usable. Do not create another metadata fetch.

`recipeUrl(id)` returns the absolute `https://mea-recipes.vercel.app/recipes/${id}`. It intentionally targets the canonical production origin, including when invoked from a local or preview build. The existing detail route is `app/recipes/[id]/page.tsx`. Use this helper as requested; flag preview-origin behavior in validation rather than silently replacing the helper.

## Existing disclosure patterns

There is no general-purpose accessible disclosure/popover library in dependencies or shared components. Grocery's category picker is a bespoke fixed-position portal that closes on Escape, outside pointer, scroll and resize; it avoids clipping by the category's `overflow-hidden`. `RecipeCard` has another bespoke portaled plan picker. Neither is a reusable generic component with the complete keyboard focus behavior required here.

`components/mapping-review/MappingRiskChip.tsx` illustrates a simple native-button inline disclosure using local state and `aria-expanded`; it is specific to risk evidence. A small inline source disclosure follows that existing interaction style and avoids portal/clipping/positioning complexity. It should additionally use `aria-controls`, deterministic IDs, visible focus, a descriptive accessible name, and restoration of trigger focus when collapsing from within the expanded content.

## Minimal implementation plan — discovery handoff

1. `app/grocery/page.tsx`: consume existing catalog state; memoize the document-ID lookup and effective titles; append a desktop-only source column after the existing control order; align its Used In category label; preserve existing JSX, width, opacity, gaps and interactions below `lg`.
2. `components/GroceryRecipeSources.tsx` (pending approval): a narrow read-only renderer with local disclosure state. The [final design specification](grocery-recipe-provenance-2026-10-17-design.md) defines its exact proposed props using pre-resolved display data, ingredient context, manual status, source count, and catalog state. No Firestore access, AI, persistence, or quantity mutation. No exported service is required; resolution assertions should exercise the actual page/module boundary where that logic lives.
3. Focused renderer tests plus Grocery integration tests, including no document-write calls from source interactions, exact new-tab link attributes, multi-source/missing/manual states, and unaffected shopping controls. Browser screenshots must verify actual CSS hiding below 1024px because jsdom does not apply responsive CSS.
4. Cleanup files should only change if the separate provenance audit demonstrates a defect. Existing catalog/provider/helper files need no production changes for this display.

The proposed preferred layout uses existing `lg` at 1024px, `lg:max-w-5xl`, a 224px source column at `lg` and 288px at `xl`. The quantity remains with the ingredient, avoiding a separate quantity-grid redesign. The first two resolved recipe titles each occupy a compact 18px line, followed by +N more for remaining valid links. Expanded sources appear inline below that column. The existing 672px-width layout remains the alternate option with a secondary Used in line under the ingredient.

Under the preferred proposal the outer content is at most 800px at a 1024px viewport after the sidebar, and at most 1024px at 1280px/1440px viewports. Existing 24px page padding remains. This adds space for provenance without changing mobile or category grouping. Narrow desktop rows with very long ingredients or Need This Trip will need to wrap; they must not hide existing controls.

Source links use `recipeUrl(recipe.id)`, `target="_blank"` and `rel="noopener noreferrer"`. Deduplicate IDs in first-seen source order without modifying stored arrays. Keep raw internal IDs out of fallback text. Manual-empty, recipe-empty, unresolved, mixed manual/source, catalog-loading and catalog-error cases need separate approved states. For checked rows, the proposal limits opacity to existing desktop content so amber source links remain legible; below `lg` the original full-row opacity remains.

Long-title visual truncation must preserve full title text for screen readers and keyboard users. A title attribute alone is insufficient for reliable keyboard-visible full-name access; the final approved design should specify focus-visible full-title wrapping or an accessible focus/hover tooltip. Inline expansion must remain open when a source link opens a new tab.

## Follow-up and limits

No production UI, recipe, grocery, authentication, Firestore rules, or cleanup state was changed by this discovery. The screenshots are references to current production behavior, not mockups and not approval of a proposed design. Production deployment version parity with the local checkout was not independently established. The root task owns repository preflight, full PRD review, cleanup/source-data audit, baseline tests/build, Figma design, and final approval record.
