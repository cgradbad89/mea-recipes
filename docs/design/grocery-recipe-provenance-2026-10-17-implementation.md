# Desktop Grocery recipe provenance — implementation and release record

Date: 2026-10-17. Repository root: `/Users/johnfolstrom/Desktop/mea-web`.

Verdict: **PASS WITH LIMITATIONS**. The approved feature is implemented and all required local gates passed. Browser validation used the actual Grocery page/component with synthetic data; live production behavior and automatic deployment status are not claimed. Final commit/push verification is recorded in the closing chat report.

## Approval and delivered behavior

The product owner explicitly answered **“Approve Option A and continue implementation”** on 2026-10-17 to approval question `call_7fffba8e08b44f22863e417e894f3862`, item 0. Approved source: [Figma file 2tzBJXKAyecopz1R4QavwD](https://www.figma.com/design/2tzBJXKAyecopz1R4QavwD?node-id=2-114), page **Desktop Grocery — design approval** (`0:1`), frames `2:114`, `2:115`, `2:116`, `2:118`, `2:119`. Alternative `2:117` remains reference-only.

The implemented Used In column is visible from 1024px and displays actual catalog titles, existing personal title overrides, and canonical new-tab links. It shows two valid references before an inline disclosure, deduplicates IDs in stored order, and distinguishes manual, source-empty, loading, error, unavailable, and mixed states. Long titles wrap on hover/focus. Checked groceries keep legible desktop links. Existing editing, category, trip-intent, and cleanup operations remain independent.

One small accessibility refinement from the static expanded Figma frame is documented in the approved design record: Show less remains in the same position beside the second link, before additional links in DOM order. Tab after opening reaches the newly revealed links immediately; collapsing retains focus on the same trigger. No state, action, or scope was added.

## Implementation and safety

- Only `app/grocery/page.tsx` and new `components/GroceryRecipeSources.tsx` change production behavior.
- Grocery reuses existing `useAppData()` catalog/metadata/loading/error fields. One memoized map is keyed by authoritative `Recipe.id`, not the potentially different historical `recipeID`. Each matched ID is encoded as one path segment before using existing `recipeUrl`.
- Derived source displays are memoized by grocery/catalog input. The focused renderer is memoized with stable derived props so unrelated input edits can skip source-cell rendering. It owns only local disclosure state and `useId`; it imports no data or AI client.
- Source interactions do not invoke grocery writes. Only activation keys stop propagation; Escape still reaches the existing category-menu listener. The visual Used In category label is excluded from the category button's accessible name, preserving its existing name.
- The new column/header/error message is CSS-hidden below `lg`. Existing mobile row structure, spacing, checkbox controls, and opacity remain intact. No viewport JavaScript or mobile source UI was introduced.
- Cleanup production files, API contract, model, prompts, quantities, source-union implementation, concurrency guards, manual/recipe pools, stable document IDs, transaction bounds, and partial-commit reporting were not changed.
- No new dependency, Firestore field/collection/migration, rules/index, scheduled job, background sync, or external runtime integration was introduced. No production Firestore data was modified. Emulator writes and browser mock writes used synthetic fixtures only.

## Test and build evidence

Fresh pre-change baseline: **1,644 passed / 1 skipped / 0 failed, 1,645 total** at base commit `f204409f68c5859b81754abcb6b4f09072e8a243`. The [baseline verification record](grocery-recipe-provenance-2026-10-17-verification.md) documents initial environment recovery and its npm version caveat.

Added **24 focused regression tests**: 11 source component cases, 8 Grocery integration cases, and 5 cleanup persistence cases. Existing coverage was retained. New coverage includes one/two/five sources, stable deduplication, authoritative/encoded IDs, title overrides, missing/legacy/manual states, safe links and event boundaries, catalog updates/loading/error, checked sources, 250 groceries/100 references with no N+1 access, three-member unions, missing-array peers, repeated cleanup, and persisted/reloaded 250-item cross-batch source unions. Existing unsafe-merge, quantity, checked, identity, owner, conflict/retry, and partial-commit tests remain in place.

All feature gates use installed **Node 24.19.0 and npm 11.19.0** explicitly, without installing packages:

```sh
PATH=/opt/homebrew/opt/node@24/bin:$PATH /opt/homebrew/opt/node@24/bin/node /opt/homebrew/lib/node_modules/npm/bin/npm-cli.js test -- grocery GroceryRecipeSources
PATH=/opt/homebrew/opt/node@24/bin:$PATH /opt/homebrew/opt/node@24/bin/node /opt/homebrew/lib/node_modules/npm/bin/npm-cli.js run typecheck
PATH=/opt/homebrew/opt/node@24/bin:$PATH /opt/homebrew/opt/node@24/bin/node /opt/homebrew/lib/node_modules/npm/bin/npm-cli.js run build
PATH=/opt/homebrew/opt/node@24/bin:$PATH /opt/homebrew/opt/node@24/bin/node /opt/homebrew/lib/node_modules/npm/bin/npm-cli.js test
PATH=/opt/homebrew/opt/node@24/bin:$PATH /opt/homebrew/opt/node@24/bin/node /opt/homebrew/lib/node_modules/npm/bin/npm-cli.js test -- --maxWorkers=1 --no-file-parallelism
```

| Gate | Observed result | Local complete log |
| --- | --- | --- |
| Focused grocery/component group | **216/216 passed**, 16 files, 0 skipped/failed | `/private/tmp/mea-grocery-feature-focused-final.log` |
| TypeScript | **PASS** (`tsc --noEmit`) | `/private/tmp/mea-grocery-feature-typecheck.log` |
| Production build | **PASS**, Next.js 16.3.1; 30 static pages generated | `/private/tmp/mea-grocery-feature-build-clean.log` |
| First full post-build suite, parallel | 1,662 passed / 1 skipped / 6 failed (1,669 total); emulator transport error and subsequent timeouts; see below | `/private/tmp/mea-grocery-feature-full-postbuild.log` |
| Final full post-build suite, one worker | **1,668 passed / 1 skipped / 0 failed (1,669 total)**; 121 files passed / 1 skipped (122 total), 88.47 seconds | `/private/tmp/mea-grocery-feature-full-postbuild-serial.log` |

The sole deliberately skipped baseline test is the controlled production nutrition apply test. It was not enabled. Test assertions were not removed or skipped to obtain a pass.

### Corrected gate issues

- The first new persistence-test attempt observed an older cached subscription event after a successful commit. New reload assertions now refresh server state before reading back the first subscription event; persisted data and production code were correct. The focused persistence file subsequently passed 16/16.
- The first complete grocery group found that decorative Used In text changed the category button's accessible name. `aria-hidden` on that visual label preserves existing names; per-row groups provide source context. All original Usually On Hand tests subsequently passed.
- The 250-item jsdom test exceeded the default 5-second timeout under parallel suite load. Repeated global queries were scoped to one row and the large fixture received an explicit 20-second allowance. Every data/control/no-request assertion remains. Browser responsiveness is assessed separately; the test is not a timing benchmark.
- Initial TypeScript validation found four byte-identical generated ` 2.ts` copies under ignored `.next/types`, causing duplicate declarations. They were archived to `/private/tmp/mea-grocery-duplicate-next-types`; source/configuration were unchanged. Typecheck then passed.
- The first production build failed because the sandbox denied Turbopack's CSS worker port. An approved port-enabled retry replayed the same cached failure. A direct port probe succeeded for IPv4, IPv6, and default bindings. The generated Turbopack cache was preserved under `/private/tmp/mea-grocery-turbopack-pre-retry-20261017`; the third build with a fresh cache passed. No production changes were used to work around the environment. Failed build logs remain at `/private/tmp/mea-grocery-feature-build.log` and `/private/tmp/mea-grocery-feature-build-final.log`.
- The first parallel full-suite run emitted a Firestore `Listen` transport error (`RESOURCE_EXHAUSTED: Received message larger than max (1768973641 vs 17825792)`) during an existing deleted-snapshot conflict case, followed by maximum backoff, timeouts, and a likely overlapping-operation counter failure. The five new provenance persistence cases had already passed. The exact transport cause could not be established after owned emulator logs were cleaned up; it is not claimed as a demonstrated product defect. A complete unchanged-suite rerun with `--maxWorkers=1 --no-file-parallelism` passed all 1,668 tests. This changes execution concurrency only, not test inclusion, assertions, or production behavior. The parallel emulator instability remains an environment/CI limitation if it recurs.

## Browser and performance evidence

See the [browser verification report](grocery-recipe-provenance-2026-10-17-browser.md) for exact source hashes, screenshots, boundaries, and observed interactions.

- Actual Grocery page/component code rendered in a temporary harness with synthetic data at **1024/1280/1440px**. Column widths were **224/288/288px**, without horizontal overflow. Source controls were hidden at 1023px.
- Original HEAD and implemented page used identical fixtures, fonts, shell, and Tailwind output. Full-page mobile comparisons at **375px and 390px had zero changed pixels** and matching row geometry; no source control was visible.
- Keyboard disclosure, focus/full-title wrapping, Escape category dismissal, edit cancellation, checked source links, and trip-state controls were exercised. Keyboard activation opened the canonical destination in a distinct tab and left Grocery unchanged; the destination used a synthetic ID and therefore did not establish actual recipe content correctness.
- The 250-row/100-reference browser fixture rendered 500 initial links and all source groups with zero individual recipe reads, AI calls, or source-triggered writes. Unit integration assertions independently verify no per-link fetches. This is bounded synthetic evidence, not a production latency benchmark.
- Expected incremental production Firestore reads/writes and AI calls from this display: **zero**. Existing provider loading costs and cache semantics remain unchanged.

## Data-integrity findings

Existing cleanup already unions every merge member's unique source IDs at guarded persistence. New tests verified two/three/multiple contributors, repeated cleanup after reload, absent/empty peers, and duplicates spanning three AI batches with 250 eligible rows. The persisted survivor retained all four cross-batch sources, original document identity, quantity, metadata, trip intent, and unchanged checked peers. Source-display subscription updates and catalog resolution are tested separately; no live production cleanup was run.

Recipe associations do not provide precise per-recipe quantity allocation. Missing historical associations cannot be inferred from names or recovered by this display. Unavailability means absence from the currently loaded catalog; existing caching can temporarily retain a deleted recipe, and titleless records are excluded by the existing loader. No per-source lookup or migration attempts to resolve that limitation.

## Documentation, release boundary, and outstanding limits

PRD sections **2 (Page Inventory), 3 (Data Model), 5 (Business Logic), 6 (Known Sharp Edges), and 7 (Feature Backlog)** now describe the completed feature. The final chat report records the actual resulting commit SHA, push result, and independent remote readback; a document cannot embed its own containing commit SHA in advance.

No manual deployment occurred. Automatic deployment status and production UI behavior must only be reported if independently verified. Production source completeness, full real-catalog title accuracy, fresh deletion detection, real-network latency, and live AI cleanup were not exercised. The temporary browser server was stopped and browser viewport overrides restored. The original unrelated `firebase-debug 4.log` remains outside the intended change set.

## File inventory

### Modified existing tracked files

| Repository-relative path | Reason |
| --- | --- |
| `PRD.md` | Sections 2/3/5/6/7: feature behavior, existing source model, invariants, limitations, and completion status. |
| `app/grocery/page.tsx` | Read-only catalog resolution and desktop column, preserving existing grocery controls. |
| `tests/groceryCleanupWorkflow.test.tsx` | Eight new page integration regressions and catalog mocks; original tests retained. |
| `tests/groceryCleanupPersistence.test.ts` | Five synthetic emulator provenance regressions; original guards retained. |

### Created files

| Repository-relative path | Reason |
| --- | --- |
| `components/GroceryRecipeSources.tsx` | Focused memoized source-link/status/disclosure renderer. |
| `tests/GroceryRecipeSources.test.tsx` | Eleven focused renderer, link, status, and disclosure tests. |
| `docs/design/grocery-recipe-provenance-2026-10-17-browser.md` | Observed browser results, exact code hashes, boundaries, and screenshot links. |
| `docs/design/grocery-recipe-provenance-2026-10-17-design.md` | Approved visual specification, Figma IDs, approval reference, and implementation plan. |
| `docs/design/grocery-recipe-provenance-2026-10-17-discovery.md` | Repository/data-flow/cleanup audit before implementation. |
| `docs/design/grocery-recipe-provenance-2026-10-17-implementation.md` | This final implementation, validation, release, and file inventory record. |
| `docs/design/grocery-recipe-provenance-2026-10-17-ui.md` | Existing application/catalog/UI discovery and reference context. |
| `docs/design/grocery-recipe-provenance-2026-10-17-verification.md` | Historical fresh baseline and proposed regression inventory. |
| `docs/mockups/grocery-provenance/alternative-1440.png` | Editable Figma design exported for review: alternative 1440. |
| `docs/mockups/grocery-provenance/editing-and-usually-on-hand-1024.png` | Editable Figma design exported for review: editing and usually on hand 1024. |
| `docs/mockups/grocery-provenance/figma-manifest.json` | Verified Figma identity/export mapping and explicit approval status. |
| `docs/mockups/grocery-provenance/implemented/desktop-1024.jpg` | Synthetic actual-code browser evidence: desktop 1024. |
| `docs/mockups/grocery-provenance/implemented/desktop-1280.jpg` | Synthetic actual-code browser evidence: desktop 1280. |
| `docs/mockups/grocery-provenance/implemented/desktop-1440.jpg` | Synthetic actual-code browser evidence: desktop 1440. |
| `docs/mockups/grocery-provenance/implemented/expanded-1024.jpg` | Synthetic actual-code browser evidence: expanded 1024. |
| `docs/mockups/grocery-provenance/implemented/keyboard-focus-1024.jpg` | Synthetic actual-code browser evidence: keyboard focus 1024. |
| `docs/mockups/grocery-provenance/implemented/mobile-375-baseline.jpg` | Synthetic actual-code browser evidence: mobile 375 baseline. |
| `docs/mockups/grocery-provenance/implemented/mobile-375-implemented.jpg` | Synthetic actual-code browser evidence: mobile 375 implemented. |
| `docs/mockups/grocery-provenance/implemented/mobile-390-baseline.jpg` | Synthetic actual-code browser evidence: mobile 390 baseline. |
| `docs/mockups/grocery-provenance/implemented/mobile-390-implemented.jpg` | Synthetic actual-code browser evidence: mobile 390 implemented. |
| `docs/mockups/grocery-provenance/interaction-states-1280.png` | Editable Figma design exported for review: interaction states 1280. |
| `docs/mockups/grocery-provenance/preferred-1024.png` | Editable Figma design exported for review: preferred 1024. |
| `docs/mockups/grocery-provenance/preferred-1280.png` | Editable Figma design exported for review: preferred 1280. |
| `docs/mockups/grocery-provenance/preferred-1440.png` | Editable Figma design exported for review: preferred 1440. |
| `docs/mockups/grocery-provenance/reference/current-desktop-1024.jpg` | Read-only existing application reference: current desktop 1024. |
| `docs/mockups/grocery-provenance/reference/current-desktop-1280.jpg` | Read-only existing application reference: current desktop 1280. |
| `docs/mockups/grocery-provenance/reference/current-desktop-1440.jpg` | Read-only existing application reference: current desktop 1440. |
| `docs/mockups/grocery-provenance/reference/current-mobile-375.jpg` | Read-only existing application reference: current mobile 375. |
| `docs/mockups/grocery-provenance/reference/current-mobile-390.jpg` | Read-only existing application reference: current mobile 390. |
