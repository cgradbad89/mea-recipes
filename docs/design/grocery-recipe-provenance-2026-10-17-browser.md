# Grocery provenance — implemented browser verification

Date: 2026-10-17. Approved design: Option A, Used In column; explicit product-owner approval and Figma identities are recorded in the [design gate](grocery-recipe-provenance-2026-10-17-design.md).

**Result: passed the scoped browser checks below.** The actual implemented `GroceryPage` and `GroceryRecipeSources` render correctly at the approved desktop widths. Mobile output matches the original page pixel for pixel for the tested fixtures. Source disclosure/navigation does not mutate grocery state. No production grocery or recipe data was changed.

## Verification boundary

Story: existing grocery `sourceRecipeIDs` → existing in-memory recipe catalog/effective titles → desktop source links → disclosure or a separate recipe tab, while grocery controls continue to work.

A temporary harness at `/tmp/mea-grocery-browser` bundled the actual production page/component with the repository's existing Next-bundled webpack, TypeScript, React and Tailwind. It used the application's built DM Sans/Cormorant font files. Authentication, Firebase operations, `useAppData`, grocery subscription/persistence, and recipe lookup were substituted at module boundaries with synthetic fixtures and counters. The surrounding navigation shell was deliberately simplified; the actual Grocery page markup/CSS was unchanged by the harness. This validates grocery rendering and interaction without production writes; it is not a live Firestore integration test.

The comparison baseline was `git show f204409f68c5859b81754abcb6b4f09072e8a243:app/grocery/page.tsx`, rendered with the same fixtures, shell, font files and final Tailwind output. No dependencies or production routes were added. A loopback-only static server served the temporary bundle at `127.0.0.1:8766`. Browser interaction used the connected Chrome profile through CUA; screenshot comparisons used the existing bundled Pillow runtime.

Verified source hashes:

- `app/grocery/page.tsx`: `5c5eaa4135a7f0366ae5f4849b4da91c5232aaf283b235056026770cc427d213`
- `components/GroceryRecipeSources.tsx`: `2f902fb9a6b4a9ab3dfaa5aff326fb0ae098209be1fbef0efb198f2507cda136`

## Observed results

| Check | Observed evidence |
| --- | --- |
| 1024px desktop | 800px outer page container after the 224px sidebar; source column 224px; no document overflow or overlap of sources with existing controls. |
| 1280px and 1440px desktop | Source column 288px at both widths; document width never exceeded viewport width. Existing category cards, quantities with names, and row controls remained intact. |
| Desktop breakpoint | At 1023px, zero source groups had a visible bounding box. At 1024px, source groups rendered at 224px. |
| Mobile 375px | Baseline and implemented full-page screenshots both 369 × 1777 raster pixels; **0 changed pixels**. All 12 displayed row x/y/width/height measurements matched. Document width was 375px and zero source groups were visible. |
| Mobile 390px | Baseline and implemented screenshots both 384 × 1757 raster pixels; **0 changed pixels**. All displayed row geometries matched. Document width was 390px and zero source groups were visible. |
| Source states | One source, two sources, five sources, manual-empty, recipe-empty, missing-only, mixed valid/missing, historical manual-with-source, checked, long ingredient and long title were rendered using synthetic fixtures. Duplicate source ID on yellow onions produced two links, not three. |
| Keyboard disclosure | Enter on `Show 3 more recipes for olive oil` set `aria-expanded=true` and displayed all five links. Tab from the persistent disclosure button moved to the third recipe, Chicken Noodle Soup. Space on Show less collapsed the list and retained focus on the same trigger. |
| Long-title focus | Focusing the 77-character recipe title changed whitespace to normal, expanded the link to 54px high at 1024px, and showed an amber 2px inset focus ring. Full text remained visible within the source column; no horizontal overflow. |
| Read-only source actions | Disclosure open/close, keyboard focus, edit cancellation, category dismissal and source-link navigation left harness counters at `writes=0`, `singleRecipeReads=0`, `aiCalls=0`. |
| New-tab navigation | Keyboard activation opened a distinct tab at `https://mea-recipes.vercel.app/recipes/recipe-0`; the original Grocery tab stayed open and the onion row remained unchecked. The synthetic ID correctly produced Recipe not found in production; this was expected fixture behavior, not a real-catalog lookup test. The created destination tab was closed. All five expanded source anchors had `target="_blank"` and `rel="noopener noreferrer"`. |
| Editing | At 1024px the actual quantity/unit/name inputs measured 48/64/245px; existing Save/Cancel/category controls and source links remained visible. Escape canceled with no mock persistence operation. |
| Category picker | Opening the existing picker produced one fixed portal. Escape from a focused source link reduced the portal count to zero, demonstrating that source key handling preserves window Escape dismissal. |
| Usually On Hand / trip state | Usually Have This moved olive oil into Usually On Hand. Expanding the section exposed Need This Trip, which returned it to the active category. Exactly two expected synthetic persistence operations occurred; source operations remained read-only. |
| Catalog loading | Source text read Loading recipes…; 12 grocery checkbox controls remained rendered. No recipe links, individual recipe reads, AI calls or writes occurred. |
| Catalog failure | Source text read Recipe links unavailable and the page displayed the neutral catalog message. Checking an existing grocery still worked, changing the count to 12 remaining / 2 checked with one expected synthetic write. |
| Empty grocery | Existing List is empty appeared with zero source groups. |
| 250 groceries / 100 referenced recipes | 250 grocery controls, 250 source groups, 500 initially visible links and 250 disclosures rendered from memory; each row had three references, spanning all 100 catalog IDs. Counters remained `singleRecipeReads=0`, `aiCalls=0`, `writes=0`; no horizontal overflow. This is a bounded rendering check, not a production performance benchmark. |
| Browser errors | No application-origin console errors or warnings were observed. The final log read contained three unrelated Chrome-extension errors (localization registration and a closed extension message port). |

The screenshot service slightly resizes the returned JPEG raster; viewport dimensions were independently read from `window.innerWidth`/`innerHeight`. The mobile image comparison compares identically sized returned images, and therefore remains exact.

## Retained visual evidence

All images are actual renders of the production Grocery page inside the isolated synthetic harness. They are not Figma exports. The navigation shell is simplified and fixture counts/titles differ from the original production references.

- [Desktop 1024](../mockups/grocery-provenance/implemented/desktop-1024.jpg)
- [Desktop 1280](../mockups/grocery-provenance/implemented/desktop-1280.jpg)
- [Desktop 1440](../mockups/grocery-provenance/implemented/desktop-1440.jpg)
- [375px original baseline](../mockups/grocery-provenance/implemented/mobile-375-baseline.jpg) · [375px implemented](../mockups/grocery-provenance/implemented/mobile-375-implemented.jpg)
- [390px original baseline](../mockups/grocery-provenance/implemented/mobile-390-baseline.jpg) · [390px implemented](../mockups/grocery-provenance/implemented/mobile-390-implemented.jpg)
- [Expanded sources and keyboard traversal](../mockups/grocery-provenance/implemented/expanded-1024.jpg)
- [Full long-title keyboard focus](../mockups/grocery-provenance/implemented/keyboard-focus-1024.jpg)

The implementation retains the disclosure button beside the second link while expanded, with additional links after it in DOM order. This documented accessibility refinement makes Tab reach the newly revealed links immediately and retains focus when collapsing. Source styling, counts, widths and states otherwise follow the approved option. Existing catalog order and grocery category order remain authoritative.

## Limits and follow-up

No browser blocker was found. Live Firestore persistence, AI cleanup execution, production network read counts, full real-catalog title accuracy, and recipe detail content were outside the synthetic browser boundary. Unit/integration tests and the cleanup provenance audit cover those source/persistence contracts separately. Actual deployment validation remains the root task's responsibility. Mobile pixel parity applies to the tested default fixtures at 375px and 390px; it is not a claim that every possible data combination was exhaustively screenshot-tested.
