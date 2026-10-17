# Grocery recipe provenance — verification record and regression plan

> Historical pre-approval record. The owner explicitly approved Option A on 2026-10-17; see the [approval record](grocery-recipe-provenance-2026-10-17-design.md) and [implementation report](grocery-recipe-provenance-2026-10-17-implementation.md) for current status.

Date: 2026-10-17 (America/New_York).

Status: existing implementation baseline verified. The proposed desktop source display is **not implemented or approved**. No feature tests have been added. Production implementation, feature validation, and release remain gated on explicit product-owner approval of the final visual design.

## Repository and runtime

- Repository: `/Users/johnfolstrom/Desktop/mea-web`, `cgradbad89/mea-recipes`.
- Branch and tested HEAD: `main`, `f204409f68c5859b81754abcb6b4f09072e8a243`.
- Test runner: Vitest 4.1.11; `npm test` runs `vitest run`.
- Required Node runtime: `.nvmrc` pins 24.19.0; `package.json` permits only 24.x.
- Passing commands below used `PATH=/opt/homebrew/opt/node@24/bin:$PATH`, verified as Node v24.19.0 and bundled npm 11.17.0. The repository declares npm 11.19.0; the default `/opt/homebrew/bin/npm` is 11.19.0. This package-manager version difference is recorded explicitly. No dependency installation or lockfile change was performed.
- The initial untracked `firebase-debug 4.log` was preserved. Verification made no tracked source changes. Type checking refreshed ignored `tsconfig.tsbuildinfo`; the production build generated ignored `.next` output.

## Completed commands and results

All commands ran from the repository root. Log files contain complete captured stdout/stderr and are local, temporary evidence; they are not committed artifacts. Reported counts come from fresh execution, rather than the historical prompt.

| Gate | Exact command | Result | Full log |
| --- | --- | --- | --- |
| Initial attempted baseline | `npm test` | Failed in the default Node 26 sandbox environment; see recovery below. | `/private/tmp/mea-grocery-baseline.log` |
| Initial type check | `npm run typecheck` | Passed under default Node v26.7.0 / npm 11.19.0; superseded by Node 24 verification. | `/private/tmp/mea-grocery-typecheck-baseline.log` |
| Valid Node 24 baseline | `PATH=/opt/homebrew/opt/node@24/bin:$PATH npm test` | **Passed:** 120 files passed / 1 skipped (121 total); 1,644 tests passed / 1 skipped / 0 failed (1,645 total). Duration 17.42s. | `/private/tmp/mea-grocery-baseline-node24.log` |
| Node 24 type check | `PATH=/opt/homebrew/opt/node@24/bin:$PATH npm run typecheck` | **Passed:** `tsc --noEmit`. | `/private/tmp/mea-grocery-typecheck-baseline-node24.log` |
| Production build | `PATH=/opt/homebrew/opt/node@24/bin:$PATH npm run build` | **Passed:** Next.js 16.3.1 compiled, completed TypeScript validation, and generated all 30 static pages. | `/private/tmp/mea-grocery-build-baseline.log` |
| Required full suite after successful build | `PATH=/opt/homebrew/opt/node@24/bin:$PATH npm test` | **Passed:** 120 files passed / 1 skipped (121 total); 1,644 tests passed / 1 skipped / 0 failed (1,645 total). Duration 17.46s. | `/private/tmp/mea-grocery-postbuild-node24.log` |

New tests added: **0**. Final executed test total at this design checkpoint: **1,645**, including **1,644 passing** and **1 deliberately skipped**. These passing gates validate the existing application at the recorded commit; they do not establish acceptance of the proposed source UI.

### Initial environment failure and recovery

The first `npm test` inherited Node v26.7.0 and ran inside the filesystem/network sandbox. It reported 8 failed files, 112 passed files, and 1 skipped file (121 total); 7 failed tests, 1,547 passed tests, and 91 skipped tests (1,645 total). Two environmental problems prevented a valid baseline:

1. Synthetic Firestore emulator suites could not bind localhost ports: `Error: listen EPERM: operation not permitted 127.0.0.1`.
2. Node 26's native storage global shadowed jsdom storage. `groceryPersistence.test.tsx` rejected `undefined` instead of real browser `Storage`, and `groceryCleanupWorkflow.test.tsx` could not call `localStorage.clear()`.

`README.md` and `PRD.md` already document Node 24 as the verification runtime and the Node 26/jsdom incompatibility. No source or test changes were used to hide these failures. The full suite was rerun under the installed pinned Node 24 runtime with tool approval for synthetic localhost emulator ports and passed. The subsequent post-build full run also passed. This was one failed environment attempt followed by successful required gates, not three consecutive failures.

### Emulator scope and intentional skip

Existing integration suites use `tests/helpers/firestoreEmulator.ts`. The helper requires project IDs beginning with `demo-`, allocates localhost ports for Firestore/Hub/logging/WebSocket services, creates isolated temporary configuration/log/locator directories, and awaits cleanup of its owned CLI and Java processes. Tests use synthetic owner IDs and fixtures. Emulator-backed tests perform writes only to those synthetic local fixtures; they do not establish live production correctness.

The sole skipped file/test is `tests/m04FinalNutritionApply.test.ts`, guarded by `describe.skipIf(process.env.M04_RUN_CONTROLLED_APPLY !== 'YES')`. It is an explicitly controlled production nutrition apply operation and is unrelated to this feature. Its guard was preserved and was not enabled to change test counts.

No manual deployment, production Firestore write, Firestore rule/index change, schema migration, or AI model change was performed by this verification work.

## Existing coverage to retain and reuse

| Existing test file | Relevant protection already exercised by the passing full suite |
| --- | --- |
| `tests/groceryRecipeAddOrchestration.test.ts` | Recipe source append, idempotency, compatible/incompatible quantities, manual/recipe separation, and trip intent preservation. |
| `tests/groceryPersistence.test.tsx` | 38 tests exercising actual page handlers and client persistence, source unions, exact document identity, overlapping transaction retries, rebuild replacement, and preservation of manual/trip state. |
| `tests/groceryCleanup.test.ts` | Bounded requests including 250 items; 100-item request boundaries; cross-batch reconciliation retaining original source membership; unsafe-identity/manual/category/metadata separation; absent legacy source arrays; quantity and group limits. |
| `tests/groceryCleanupPersistence.test.ts` | Actual client/API/persistence integration; two-member persisted source union and deduplication; authoritative document identity; checked/rejected/owner metadata preservation; conflicts and transaction retries; indivisible groups; partial-commit reporting and stale replay rejection. |
| `tests/groceryCleanupRoute.test.ts` | Authentication and bounded API requests, checked exclusion, validated responses, and existing error handling. |
| `tests/groceryCleanupWorkflow.test.tsx` | Checked exclusion, subscription reorder safety, all-checked no-op, later-batch failure, invalid merge rejection, bounded/auth/service errors, and persistence failure reporting. |
| `tests/groceryUsuallyOnHandUI.test.tsx`, `tests/groceryNeedThisTripLifecycle.test.ts` | Existing preference/section/checked controls and trip override lifecycle. |

The current suite separately proves cross-batch plan retention and persisted source union. It does not yet combine a large cross-batch cleanup with persistence, reload, and the proposed source display. Repeated cleanup and three-or-more distinct sources also deserve direct persistence regression cases. These are coverage gaps, not demonstrated data-loss defects.

## Planned focused regression cases — only after approval

The following **24 candidate cases** cover the new display and remaining integration gaps. They are a plan, not executed tests or a promised final test count. Keep the renderer/resolver private or narrowly scoped according to the approved implementation; test its observable behavior without introducing an exported service solely for testing. Use a focused renderer test file only if the approved design justifies the component, and extend the existing grocery integration/persistence files where they already own the behavior. Avoid duplicating existing cleanup safety tests. The final proposed component accepts pre-resolved display data: place actual lookup/deduplication/override assertions at the page integration boundary when resolution lives there; references to focused renderer placement below describe observable rendering coverage, not permission to add a test-only exported resolver.

| # | Planned case | Main assertion and intended placement |
| --- | --- | --- |
| 1 | One source | Resolve the catalog record by authoritative `Recipe.id`; render its effective title and `recipeUrl(id)` destination. Focused source renderer. |
| 2 | Two sources | Render both titles in deterministic first-seen source order. Focused renderer. |
| 3 | Five sources | Initially show two valid links plus `+3 more`; expansion reveals the remaining three without dropping associations. Focused renderer. |
| 4 | Duplicate IDs | Show each ID once in stable order, including the overflow count; leave the input source array unchanged. Focused renderer. |
| 5 | All references unavailable | Show neutral unavailable copy without a broken link, raw ID disclosure, fallback lookup, or mutation. Focused renderer. |
| 6 | Mixed available/unavailable | Preserve valid links and the approved unavailable count independently; only valid overflow links contribute to `+N more`. Focused renderer. |
| 7 | Manual with no sources | Show `Added manually` only when `isManual` is true and the actual source list is empty/absent. Focused renderer. |
| 8 | Recipe item with no sources | Empty and legacy-absent arrays show `No recipe linked`; they are not mislabeled manual or written back. Focused renderer with legacy fixture. |
| 9 | Manual with recorded sources | Preserve both facts using the approved mixed-state treatment; do not discard valid associations. Focused renderer. |
| 10 | Identity independent of titles | Use fixtures with duplicate/long titles and `Recipe.id !== recipe.recipeID`; links remain keyed and routed by the authoritative document ID. Focused renderer. |
| 11 | Existing title overrides | Reuse the user's existing metadata title override; fall back to canonical title when absent/unavailable, with no new subscription. Grocery integration. |
| 12 | New-tab link contract | Every source anchor has exact canonical `href`, `target="_blank"`, `rel="noopener noreferrer"`, and a descriptive accessible name. Focused renderer. |
| 13 | Pointer interaction isolation | Clicking a source link/disclosure does not toggle, edit, delete, change category, request AI, rebuild, or write data. Grocery integration with spies on existing operations. |
| 14 | Checked item sources | Showing checked groceries retains their source links and checked state; source interactions do not mutate checked state. Grocery integration. |
| 15 | Keyboard disclosure | Enter/Space activate the native disclosure; `aria-expanded`/`aria-controls` stay coherent; approved close action restores trigger focus without closing a newly opened recipe tab. Focused renderer plus browser check. |
| 16 | Long-title access | The complete title remains in the accessible link name; the approved focus/hover treatment exposes the full visible title without changing its identity. Focused renderer plus browser check. |
| 17 | Catalog loading | Grocery rows and existing controls remain usable while source metadata loads; pending references are not mislabeled deleted/unavailable. Grocery integration. |
| 18 | Catalog error and retained data | Apply the approved error state once at page level; retain usable cached links and keep grocery controls working without per-row fallback reads. The proposed design adds no source retry control. Grocery integration. |
| 19 | Catalog/metadata updates | Provider updates replace derived titles/references correctly and preserve source identity/disclosure behavior without a second fetch or a stored grocery change. Grocery integration. |
| 20 | Three-member persisted union | Merge three synthetic recipe items with overlapping/distinct IDs; reload the survivor and assert the complete unique union, quantity, stable ID, trip flag, and untouched metadata. Extend existing persistence patterns. |
| 21 | Empty/absent-source peers | Merge valid sources with empty or legacy-absent source arrays; reload and assert valid IDs are retained. A subsequent normalize-only cleanup preserves that union. Existing persistence suite. |
| 22 | Repeated cleanup | Persist a merge, reload it, introduce another compatible synthetic source, perform fresh cleanup, and reload again; prior/new IDs remain exactly once and quantities do not double on another no-op review. Existing persistence suite. |
| 23 | Cross-batch persisted/display union | Use 250 eligible synthetic items with duplicates spanning indices 0/1/100/200; run bounded cleanup, persist, reload, and resolve/render all contributing sources. Assert quantity, checked exclusion, actual survivor identity, and three request batches. Reuse `groceryCleanup.test.ts` fixture logic and persistence helpers. |
| 24 | 250 items / 100 references, no N+1 | Render 250 groceries with 100 distinct catalog references, repeats, multiple sources per item, and missing historical IDs. Assert zero added `getRecipeById`/Firestore/AI calls attributable to display, zero writes, and continued checkbox/edit/category operation. Reuse the existing provider and mocked operation boundaries. |

Retain the existing unsafe-merge, manual/recipe pool, quantity-unit, checked-state, owner-isolation, snapshot-conflict/retry, and partial-commit cases. If a test demonstrates an actual provenance defect, fix the narrow responsible boundary after approval; do not redesign cleanup in anticipation of one.

With an unchanged pre-change baseline, final feature validation must retain at least 1,644 passing existing tests and add the actual focused cases. Report the runner's final pass/skip/fail counts; do not infer totals from this planning table or enable the controlled production apply test.

## Required browser and visual validation after implementation

jsdom does not evaluate Tailwind's responsive CSS, real layout dimensions, clipping, focus rings, or scrolling performance. DOM assertions alone cannot prove desktop visibility or unchanged mobile appearance.

- Compare implemented desktop screenshots at CSS widths 1024, 1280, and 1440 against the approved frames and current application references.
- Compare mobile widths 375 and 390 against the captured existing application. Confirm the source column adds no visible content, spacing, focusable mobile controls, or horizontal overflow below the approved `lg` breakpoint.
- Exercise one/two/five sources, mixed missing/manual sources, checked rows, long ingredient/title text, expanded overflow, dense categories, inline editing, Usually On Hand, and Need This Trip controls.
- Verify keyboard tab order, visible focus, full-title access, disclosure opening/closing, focus restoration, and new-tab navigation without grocery mutations.
- Use synthetic large-list fixtures to inspect scrolling and checkbox/edit response. The planned call-count test rules out N+1 reads; it does not by itself prove browser responsiveness or establish a timing benchmark.
- Use the canonical helper's production-origin destination intentionally. Local/preview link tests must acknowledge that current `recipeUrl` points to `https://mea-recipes.vercel.app`; do not silently replace the existing contract.

After approved implementation: run meaningful focused tests, run the repository type check under Node 24, run `npm run build`, then run the full `npm test` suite. Use the declared npm 11.19.0 explicitly for those final gates. The following installed CLI path was verified to report 11.19.0 under Node 24, without installing or changing dependencies:

```sh
PATH=/opt/homebrew/opt/node@24/bin:$PATH /opt/homebrew/opt/node@24/bin/node /opt/homebrew/lib/node_modules/npm/bin/npm-cli.js run typecheck
PATH=/opt/homebrew/opt/node@24/bin:$PATH /opt/homebrew/opt/node@24/bin/node /opt/homebrew/lib/node_modules/npm/bin/npm-cli.js run build
PATH=/opt/homebrew/opt/node@24/bin:$PATH /opt/homebrew/opt/node@24/bin/node /opt/homebrew/lib/node_modules/npm/bin/npm-cli.js test
```

These are future final-gate commands, not a claim that this exact npm 11.19.0 gate sequence has already run. The recorded baseline used npm 11.17.0, and no extra baseline repetition was performed solely for that difference during the design-only stage. Preserve the existing stop-after-three-consecutive-failures rule for any required gate. Record actual commands, runtime versions, counts, visual evidence, and remaining limitations.

## Approval checkpoint and outstanding work

Explicit approval of the final preferred or alternative design is still required. This verification record grants no approval and implements no feature. Feature tests, actual desktop/mobile implementation comparison, live source-link behavior, combined cross-batch persisted/display validation, PRD completion status, commit, push, and deployment verification remain pending that approval and subsequent implementation.

Live production grocery data was not mutated to validate provenance. Historical missing-association prevalence and true deletion of catalog-missing recipes remain unmeasured. Current source IDs identify contributing recipes; they do not retain a precise per-recipe quantity breakdown.
