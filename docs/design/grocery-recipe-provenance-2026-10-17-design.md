# Desktop Grocery recipe provenance — design and implementation handoff

Date: 2026-10-17. Repository: `/Users/johnfolstrom/Desktop/mea-web` (`cgradbad89/mea-recipes`).

**DESIGN APPROVED — IMPLEMENTED AND VALIDATED.** On 2026-10-17 the product owner explicitly answered “Approve Option A and continue implementation” to the final visual-design approval question in this chat. This approves the Used In column, its documented interaction/status states, and unchanged mobile behavior. The design-checkpoint report below is historical; see the [final implementation and verification report](grocery-recipe-provenance-2026-10-17-implementation.md) for current results and limits.

## Review packet and recommendation

Recommend **Option A: Used In column**. It provides a consistent place to scan recipe associations while retaining the current category cards, combined quantity/name text, and item controls. It widens only the desktop content container. Option B retains the existing narrower container and adds sources under each ingredient; this produces a taller list and competes with long ingredient names.

- [Editable Figma design](https://www.figma.com/design/2tzBJXKAyecopz1R4QavwD?node-id=2-114).
- File key: `2tzBJXKAyecopz1R4QavwD`.
- Page: **Desktop Grocery — design approval**, node `0:1`.
- [Technical/data-integrity discovery](grocery-recipe-provenance-2026-10-17-discovery.md).
- [Actual application UI/catalog discovery](grocery-recipe-provenance-2026-10-17-ui.md).
- [Fresh verification and 24-case regression plan](grocery-recipe-provenance-2026-10-17-verification.md).

| Frame | Node | Review link | Saved export |
| --- | --- | --- | --- |
| A · Used In · 1440 | `2:114` | [Figma](https://www.figma.com/design/2tzBJXKAyecopz1R4QavwD?node-id=2-114) | [PNG](../mockups/grocery-provenance/preferred-1440.png) |
| A · Used In · 1280 | `2:115` | [Figma](https://www.figma.com/design/2tzBJXKAyecopz1R4QavwD?node-id=2-115) | [PNG](../mockups/grocery-provenance/preferred-1280.png) |
| A · Used In · 1024 | `2:116` | [Figma](https://www.figma.com/design/2tzBJXKAyecopz1R4QavwD?node-id=2-116) | [PNG](../mockups/grocery-provenance/preferred-1024.png) |
| B · Secondary line · 1440 | `2:117` | [Figma](https://www.figma.com/design/2tzBJXKAyecopz1R4QavwD?node-id=2-117) | [PNG](../mockups/grocery-provenance/alternative-1440.png) |
| A · Interaction and status states · 1280 | `2:118` | [Figma](https://www.figma.com/design/2tzBJXKAyecopz1R4QavwD?node-id=2-118) | [PNG](../mockups/grocery-provenance/interaction-states-1280.png) |
| A · Editing and Usually On Hand · 1024 | `2:119` | [Figma](https://www.figma.com/design/2tzBJXKAyecopz1R4QavwD?node-id=2-119) | [PNG](../mockups/grocery-provenance/editing-and-usually-on-hand-1024.png) |

The mockups use synthetic groceries and recipe titles to demonstrate states. They do not claim those associations exist in production. Frames are editable text, auto-layout containers, component instances, and vectors; they are not flattened screenshots. They are static review mockups, not an interactive prototype. No sample recipe URLs are attached to fixture text. Native browser behavior must be implemented and verified after approval.

### Option comparison

| Criterion | A — Used In column | B — Secondary source line |
| --- | --- | --- |
| Readability | Sources align across rows and categories. | Sources are close to their ingredient but less scannable across rows. |
| Information density | One source generally fits the existing row height; two use two compact lines. | Most rows become taller; extra source lines accumulate down the page. |
| Desktop usability | Uses desktop width for separate ingredient/actions/source regions. | Retains the narrow, centered list and leaves more unused desktop width. |
| Implementation | Desktop-only width and flex alignment plus a focused source renderer. | Slightly simpler placement using the same renderer. |
| Visual consistency | Existing cards, controls, fonts, colors, and quantity/name format remain recognizable. | Closest to the existing card width, with more vertical information inside every row. |
| Long titles | Bounded source column truncates and reveals full text on hover/focus. | Full ingredient region is available, but ingredient and source wrapping stack. |
| Large lists | Stable source alignment improves scanning; overflow stays collapsed initially. | Taller lists require more scrolling. |

## Proposed design gate record

DESIGN GATE:
- Approved Figma source: file `2tzBJXKAyecopz1R4QavwD`, page `0:1`; Option A frames `2:114`, `2:115`, `2:116`, `2:118`, and `2:119`. Alternative `2:117` is reference-only.
- Approval reference: 2026-10-17 explicit user reply “Approve Option A and continue implementation” to `request_user_input_async` question `call_7fffba8e08b44f22863e417e894f3862`, item 0.
- Approved option: **A — Used In column**.
- Approved states: all 12 required source states and documented loading/error, empty, editing, checked, Usually On Hand, and responsive states below.
- Mobile impact: **none permitted**; source UI is hidden below `lg` (1024px).
- Unresolved design gaps: none. Browser validation of the implementation remains a release gate. Option B was not selected.

Record the actual approval message and selected frames here before implementation. Approval of the general feature is insufficient. Do not mark an unapproved frame as an approved source.

## Layout and responsive behavior

Use the existing Tailwind breakpoints: `md` 768px (sidebar behavior), `lg` 1024px (new desktop enhancement), and `xl` 1280px (source width increase). No new breakpoint is needed.

| Viewport | Proposed content behavior | Source region |
| --- | --- | --- |
| Below 1024px | Keep the existing `p-6 max-w-2xl mx-auto` layout, row markup behavior, spacing, controls, and checked opacity. | Hidden using responsive CSS (`display: none`); no visible space or keyboard stops. |
| 1024–1279px | Keep sidebar at 224px; add `lg:max-w-5xl` to the Grocery container. At 1024px the content/card width is 752px after the existing horizontal padding. | Fixed 224px region; remaining ingredient region can wrap. |
| 1280px and wider | Content container capped at 1024px, including 48px horizontal padding; cards are 976px wide, centered in the available main pane. | Fixed 288px region. |

The cards remain category-based flex layouts, not a new table. Quantity and unit remain part of the existing ingredient string. Keep checkbox and item actions in their established order, with the source region to their right. `min-width: 0` is required on flexible text regions. Existing category chevrons and collapse behavior remain at the right edge; the desktop Used In label aligns with the sources beneath it.

Preserve `GROCERY_CATEGORIES` order, including Dairy & Eggs before Pantry & Dry Goods. Preserve the current checked/category counts and existing green Save checkmark / X Cancel controls while editing. The mockup sidebar is abbreviated: its omitted bottom Add Recipe/authentication controls remain unchanged and are outside this enhancement's scope. The surrounding shell is a reference, not approval to alter navigation.

Preserve the current 16px card radius, 16px row horizontal padding, 12px row vertical padding, 12px flex gaps, 20px checkbox, natural ingredient wrapping, and category spacing. Rows generally remain about 44px for one source and about 62–64px for two; long ingredient text, manual-with-source status, focus expansion, or an opened disclosure can increase height. Use content-driven height, not a fixed height that clips text.

Reused tokens from the application: `ink #0F0D0A`, `surface #1A1612`, `card #221E19`, `border #2E2820`, `amber #E8A838`, `amber-glow #F5C060`, `muted #A89880`, `faint #6B5E50`, and `cream #F5F0E8`. Body text uses DM Sans; the Grocery heading uses Cormorant Garamond Light. Source text is 12px with an approximately 18px line height; links use the existing amber color and an underline. Icons reuse the installed Lucide glyphs and existing category symbols. Local Figma variables/components mirror these existing tokens; they do not introduce application tokens or dependencies.

### Mobile reference

Actual signed-in application screenshots were captured without changing groceries:

- [375px mobile](../mockups/grocery-provenance/reference/current-mobile-375.jpg).
- [390px mobile](../mockups/grocery-provenance/reference/current-mobile-390.jpg).
- [1024px desktop](../mockups/grocery-provenance/reference/current-desktop-1024.jpg).
- [1280px desktop](../mockups/grocery-provenance/reference/current-desktop-1280.jpg).
- [1440px desktop](../mockups/grocery-provenance/reference/current-desktop-1440.jpg).

These are the before references, not evidence that an unimplemented feature passed mobile regression. After approval, compare actual rendered UI against these references and exercise existing controls at 375/390px. New desktop styles must be scoped to `lg:` and above. Do not introduce viewport JavaScript, a mobile source drawer, or duplicate grocery operations.

## State and interaction specification

| State | Proposed treatment | Evidence |
| --- | --- | --- |
| 1. One recipe | One underlined recipe-title link. Ground beef → Beef Chili. | A main frames |
| 2. Two recipes | Two links on separate compact lines. Yellow onions → Chicken Noodle Soup and Beef Chili. | A main frames |
| 3. Five recipes | First two valid links plus `+3 more`, aligned at the end of the second line. | A main frames, olive oil |
| 4. Manual, no references | `Added manually`, muted, no link. Milk and paper towels. | A main frames |
| 5. Recipe-derived, no recorded source | `No recipe linked`, muted. Never infer manual origin. | A main frames, salt |
| 6. All/mixed unavailable | `Recipe unavailable` if one missing; count for multiple. Mixed rows show valid links and `+1 recipe unavailable` (pluralize as needed). No raw IDs or fabricated links. | A main frames, basil and garlic |
| 7. Checked grocery | Existing ingredient/control treatment remains dimmed; desktop source links stay legible and clickable. The mobile whole-row opacity remains unchanged. | A main frames, carrots |
| 8. Long ingredient | Existing ingredient text wraps naturally in its available space. Controls and source column retain width. | A main frames, greens/mirepoix |
| 9. Long recipe title | Single-line ellipsis at rest. Full string stays in the DOM/accessibility name and `title`; hover and keyboard focus allow the link text to wrap within the same source column. | A main frames plus focus state |
| 10. Expanded disclosure | Remaining links appear inline below the first two; the button becomes `Show less`. No overlay, internal scrollbar, or clipping inside category cards. | State frame `2:118`, olive oil |
| 11. Keyboard focus | Existing amber focus treatment, 2px visible ring; focused long title fully wraps. Native links/buttons retain keyboard semantics. | State frame `2:118` |
| 12. Dense category | Repeated compact source cells align with all ingredient rows, including unavailable/mixed/long/checked states. | Produce category in A main frames |
| Catalog loading | Existing groceries remain usable. For unresolved recorded IDs, show `Loading recipes…`; do not label them unavailable yet. Retain any known resolved links. Empty-source/manual fallbacks do not wait for the catalog. | State frame `2:118` |
| Catalog error | Retain any known resolved links. Unknown recorded IDs show `Recipe links unavailable`; one desktop page-level muted message states `Recipe links are temporarily unavailable. Your grocery list is still usable.` No per-row fetch/retry button. | State frame `2:118` |
| Manual with sources | `Added manually · linked to`, followed by actual source links/statuses. Preserve both facts. | State frame `2:118` |
| Empty groceries | Preserve current empty-list panel and grocery controls; do not render an orphan source header. | State frame `2:118` |
| All checked/hidden | Preserve existing show-checked action and current completion treatment. No extra source-only empty state. | Editing/UOH frame `2:119` |
| Inline editing | Keep existing quantity/unit/name inputs and save/cancel controls. Sources remain in the desktop column and are not editable. | Editing/UOH frame `2:119` |
| Usually On Hand / Need This Trip | Preserve default collapse, section movement, trip-intent action, and row controls. Sources follow the row without affecting trip intent. | A collapsed section; expanded rows in `2:119` |

The interaction/status frame combines independent examples for review. The production page must not show mutually exclusive loading/error/empty states together.

### Navigation, disclosure, and accessibility

1. Source anchors use the existing `recipeUrl(id: string): string` helper with the matched canonical catalog document ID encoded as one URL path segment, preserving IDs containing reserved URL characters. They use `target="_blank"` and `rel="noopener noreferrer"`. A descriptive accessible name includes the complete recipe title, ingredient context, and that it opens in a new tab. Do not route from a title or accept a raw external URL from grocery data.
2. Deduplicate source IDs in first-seen stored order. Filter valid/available recipes before selecting the first two. `+N more` counts only additional valid links; unavailable counts are separate. Expansion never truncates the underlying association list.
3. A native `button type="button"` controls the inline disclosure with `aria-expanded`, `aria-controls`, and a unique stable region ID (`useId`). Its accessible name includes the ingredient, e.g. “Show 3 more recipes for olive oil.” Enter/Space toggle it. The expanded label is “Show fewer recipes for olive oil” with visible `Show less`.
4. Keep the same toggle element across expanded/collapsed states so focus remains on it when collapsing. Tab order follows the DOM: existing row controls, first two links, disclosure, then remaining links while expanded. Implementation accessibility refinement: `Show less` stays beside the second link in the same position as `+N more`, so Tab after opening reaches the newly revealed links. The static Figma expanded frame placed it below the remaining links; keeping it before those links avoids skipping them during forward keyboard navigation. No dialog, focus trap, outside-click effect, or portal is needed. Collapsing a category unmounts its rows as today; reopening can reset a local disclosure to collapsed.
5. Recipe anchors and disclosure controls do not invoke grocery operations. If interaction bubbling reaches a parent handler, stop it at this source boundary without preventing the link's default navigation or native keyboard activation. Do not wrap an entire row in a link or button.
6. Use a labeled source region per ingredient so the visual Used In header is also meaningful to assistive technology. Unavailable/pending text is ordinary status text; avoid hundreds of live announcements. A catalog error message appears once at desktop page level.
7. Full-title focus/hover wrapping is intentionally allowed to increase that row's height. No hover-only access is required: keyboard focus exposes the same complete text, and the accessible name is always complete. At narrow desktop widths, the first two links and overflow button must remain independently focusable without horizontal scrolling.

## Implementation plan after approval

### Existing boundaries to reuse

- `app/grocery/page.tsx`: current grocery subscription, category grouping, editing, actions, and cleanup review. It already uses `useAppData()` for metadata; extend that destructuring to the existing `recipes`, `recipesLoading`, and `recipesError`.
- `components/AppDataProvider.tsx`: already loads the shared catalog through `getAllRecipes()` and provides per-user metadata. No provider modification or new subscription is expected.
- `lib/recipes.ts`: `getAllRecipes(): Promise<Recipe[]>` (module cache), `getRecipeById(id: string): Promise<Recipe | null>` (do not add source-display calls), and `recipeUrl(id: string): string` (reuse).
- `types/recipe.ts`: canonical `Recipe`. `Recipe.id` is the actual Firestore document ID; legacy `Recipe.recipeID` can differ. Build the lookup by `recipe.id`.
- `lib/userdata.ts`: canonical `GroceryItem`; do not redefine its schema. Preserve all current grocery mutations and cleanup safeguards.

### Derived data and proposed focused component

Build one memoized map in the Grocery page from the existing `recipes` and `metas`, keyed by `Recipe.id`. Effective title uses the existing nonempty user title override when present, otherwise the canonical recipe title. Resolve each grocery's source list against this map in memory, deduplicating display IDs without editing the input. Missing historical source arrays behave as empty at the display boundary.

A small `components/GroceryRecipeSources.tsx` is justified by the independent disclosure state and repeated source-cell rendering. Keep resolution private to this focused module or the page; do not add an exported data service. Proposed internal types and component contract:

```ts
type GroceryRecipeReference = Readonly<{
  recipeID: string; // actual Recipe.id, never a title-derived ID
  title: string;
  href: string;
}>;

type GroceryRecipeSourceDisplay = Readonly<{
  references: readonly GroceryRecipeReference[];
  unresolvedCount: number; // unique recorded IDs absent from current lookup
}>;

type GroceryRecipeSourcesProps = Readonly<{
  ingredientName: string;
  isManual: boolean;
  sourceCount: number; // unique recorded IDs, before catalog resolution
  display: GroceryRecipeSourceDisplay;
  catalogState: 'loading' | 'ready' | 'error';
}>;

// Renders display-only links/status plus local disclosure state.
// No mutation callback, auth identity, Firestore client, or AI client.
export default function GroceryRecipeSources(
  props: GroceryRecipeSourcesProps
): React.JSX.Element;
```

Error semantics: no recorded sources selects manual/nonmanual fallback independent of catalog state. Known references remain usable during loading/error. Nonzero unresolved count means loading/error copy while the catalog is pending/failed, and unavailable copy only after successful load. No per-source fallback read. Catalog updates recompute the map/display from provider state. Component identity is keyed by existing grocery document ID, and reference keys use recipe IDs.

The map can hold effective title/href values to avoid recomputing them per row. Memoize the map and derived displays by their actual inputs; use `React.memo` for the focused renderer only if stable props provide a measurable benefit. Do not add global caches, effects that fetch data, or a service abstraction solely for tests.

### Exact proposed file scope

| Path | Planned change after approval |
| --- | --- |
| `app/grocery/page.tsx` | Existing catalog access, memoized lookup/display state, desktop-only width/header/cell placement, catalog status, responsive checked styling. Preserve existing grocery handlers. |
| `components/GroceryRecipeSources.tsx` (new) | Narrow read-only rendering component with native source links and local inline disclosure state. |
| `tests/GroceryRecipeSources.test.tsx` (new) | Focused source resolution/display/link/disclosure cases using existing Vitest/Testing Library conventions; casing matches the proposed component. |
| `tests/groceryCleanupWorkflow.test.tsx` | Extend current page/provider mocks and verify interaction isolation, metadata states, checked sources, and large-list no-N+1 behavior. |
| `tests/groceryCleanupPersistence.test.ts` | Add three-member, missing-array, repeated-cleanup, and cross-batch persisted-union regressions using synthetic emulator data. |
| `tests/groceryCleanup.test.ts` | Reuse existing cross-batch fixtures; extend only if needed for a missing assertion, not duplicate existing tests. |
| `PRD.md` | After implementation succeeds, update only sections 2, 3, 5, 6, and 7 as applicable to the completed feature and real limitations. |

`lib/groceryCleanup.ts` and `lib/userdata.ts` are conditional bug-fix locations only if new evidence demonstrates a directly relevant defect. Current audit found none. No changes expected to the API route, recipe provider/helper, schema, Firestore rules/indexes, AI prompts/model, parser, dependencies, or infrastructure.

### Provenance and performance invariants

Cleanup currently writes the complete deduplicated union of group members' `sourceRecipeIDs` to the stable survivor in the existing guarded transaction. Normalization preserves the field by omission. Cross-batch reconciliation feeds the same persistence path. Existing checked exclusion, quantity logic, conservative merge identity, manual/recipe pool separation, conflict detection, 450-write transaction grouping, and explicit partial-save reporting must remain intact.

The source display is read-only. Expected incremental Firestore reads/writes and AI requests: **zero**, because the provider already loads catalog/metadata and all resolution is in memory. This is an implementation requirement, not a measured result for a feature that does not yet exist. Existing catalog acquisition cost remains unchanged. Planned synthetic validation uses 250 groceries and 100 distinct references, asserting no additional per-link reads or mutations and exercising checkbox/edit/category behavior. Browser responsiveness still requires measurement/observation after implementation.

Source IDs establish recipe association, not a precise per-recipe share of the merged quantity. Do not present quantity allocation, reconstruct missing history from ingredient names, or run any migration.

### Known limitations and assumptions

- The existing catalog cache has no TTL/realtime deletion feed. “Recipe unavailable” means absent from the successfully loaded available catalog, not confirmed deletion. Blank-title recipes are filtered by the existing catalog loader. A recipe deleted after it was cached can remain visible until an existing cache refresh/reload; do not solve cache architecture here.
- `refetchRecipes` uses the existing cached loader, so a new per-row retry would not reliably prove deletion. The proposed error treatment adds no retry UI or per-recipe reads.
- `recipeUrl` currently returns the canonical absolute production-origin route (`https://mea-recipes.vercel.app/recipes/{id}`). Local/preview navigation tests must acknowledge that contract. No helper rewrite is part of this design.
- Missing historical arrays and unusual manual-with-source records are tolerated, but their prevalence was not measured and prior lost associations cannot be recovered.
- At 1024px, long ingredients wrap more often because the sources occupy 224px. This is the main tradeoff of the recommended column.
- Figma visuals establish intended appearance only; focus, new-tab behavior, responsive hiding, performance, and zero mutations require actual component/browser tests after approval.

## Historical required output report at the pre-approval design checkpoint

1. **Executive verdict:** DESIGN COMPLETE — IMPLEMENTATION BLOCKED PENDING APPROVAL. Discovery and editable desktop design are complete. No feature implementation or release is claimed.
2. **Files modified:** no pre-existing tracked files. The initial unrelated `firebase-debug 4.log` remains untouched. Build/typecheck generated ignored local output only.
3. **Files created:** repository-relative paths and reasons are listed in the artifact inventory below. All are design/discovery/verification artifacts, currently uncommitted.
4. **Design gate:** proposed Figma source/page/six frames are listed above; approved IDs, selected option, and approval reference are pending. Recommendation A. Design widths inspected: 1024/1280/1440; existing mobile references: 375/390. Browser comparison of an implementation is pending.
5. **Tests:** fresh valid baseline and final post-build run both report **1,644 passed / 1 skipped / 0 failed, 1,645 total** (120 files passed / 1 skipped). **0 new tests**. Commands: `PATH=/opt/homebrew/opt/node@24/bin:$PATH npm test`; `PATH=/opt/homebrew/opt/node@24/bin:$PATH npm run typecheck`; full `npm test` rerun with that PATH after build. Typecheck passed. Runtime was Node 24.19.0 / npm 11.17.0; package declares npm 11.19.0. The verification record documents the initial Node26/sandbox failure, recovery, complete logs, and exact npm11.19 future gate commands. One controlled production nutrition apply test remains deliberately skipped. No feature behavior is validated by this baseline.
6. **Build:** `PATH=/opt/homebrew/opt/node@24/bin:$PATH npm run build` — **PASS**, followed by passing full tests. Existing app baseline only.
7. **Commit:** unchanged HEAD `f204409f68c5859b81754abcb6b4f09072e8a243`, branch `main`. No new commit or push. Closing read-only `git ls-remote origin refs/heads/main` independently returned that same SHA for live `origin/main`.
8. **Deployment/data mutation:** no manual deployment; automatic deployment status not verified; no production Firestore writes, rule/index changes, migration, dependency addition, or AI configuration change. Synthetic emulator writes were used by existing tests.
9. **PRD updates:** none. Sections 2/3/5/6/7 are planned after approval, implementation, and validation. Marking the feature completed now would be inaccurate.
10. **Data integrity:** source union/deduplication, cross-batch plan preservation, checked safety, quantity behavior, stable identity, manual separation, and concurrency/partial-save guards are present in inspected code and existing passing tests. Combined cross-batch persistence/reload/display and repeated/three-member source cases remain planned. Missing-source UI behavior is designed, not implemented. No demonstrated loss defect was found.
11. **Performance:** no new application reads/writes/AI calls were introduced because production code is unchanged. Proposed lookup uses existing provider data plus one in-memory map. Existing 250-item cleanup tests pass; 250-item source UI performance and no-N+1 assertions remain pending.
12. **Unverifiable items:** live production source navigation/merge behavior was not exercised; actual source UI keyboard/mobile/browser behavior is pending implementation; human design approval is pending; historical completeness and true deletion cannot be established from a cached catalog. Figma is a static visual artifact. Production screenshots were observed read-only; deployed-version parity with the local checkout and automatic deployment status were not independently established.
13. **Deferred/failed:** production implementation, new focused tests, desktop/mobile regression, PRD updates, final release gates, commit/push, and deployment status verification are deferred until explicit approval. No unresolved baseline/build failure remains. Initial export-download attempts produced empty files; all final exports were replaced with verified PNG screenshots. No empty artifact is retained.

### Artifact inventory

| Repository-relative path | Purpose |
| --- | --- |
| `docs/design/grocery-recipe-provenance-2026-10-17-discovery.md` | Repository/model/source lifecycle and cleanup integrity audit. |
| `docs/design/grocery-recipe-provenance-2026-10-17-ui.md` | Current UI, catalog/navigation, breakpoint, and source-display architecture discovery. |
| `docs/design/grocery-recipe-provenance-2026-10-17-verification.md` | Fresh test/build evidence, environment caveat, existing coverage, and 24 proposed regression cases. |
| `docs/design/grocery-recipe-provenance-2026-10-17-design.md` | This design specification, explicit approval gate, implementation scope, and required report. |
| `docs/mockups/grocery-provenance/figma-manifest.json` | Stable Figma file/page/frame IDs, local export mapping, and approval status. |
| `docs/mockups/grocery-provenance/preferred-1440.png` | Preferred desktop design, 1440px. |
| `docs/mockups/grocery-provenance/preferred-1280.png` | Preferred desktop design, 1280px. |
| `docs/mockups/grocery-provenance/preferred-1024.png` | Preferred desktop design, 1024px. |
| `docs/mockups/grocery-provenance/alternative-1440.png` | Alternative secondary source line design. |
| `docs/mockups/grocery-provenance/interaction-states-1280.png` | Expanded disclosure, focus, loading/error, unusual manual, and empty states. |
| `docs/mockups/grocery-provenance/editing-and-usually-on-hand-1024.png` | Editing, trip intent, expanded Usually On Hand, and completion states. |
| `docs/mockups/grocery-provenance/reference/current-desktop-1024.jpg` | Actual existing desktop reference. |
| `docs/mockups/grocery-provenance/reference/current-desktop-1280.jpg` | Actual existing desktop reference. |
| `docs/mockups/grocery-provenance/reference/current-desktop-1440.jpg` | Actual existing desktop reference. |
| `docs/mockups/grocery-provenance/reference/current-mobile-375.jpg` | Actual existing mobile reference. |
| `docs/mockups/grocery-provenance/reference/current-mobile-390.jpg` | Actual existing mobile reference. |

After approval, record it, implement only the selected design, execute focused tests and real-browser visual checks, update the relevant PRD sections, run typecheck/build/full post-build tests with the declared runtime/toolchain, review the complete diff, explicitly stage intended paths, commit on `main`, and push only after all gates pass. Do not manually deploy or mutate production data.
