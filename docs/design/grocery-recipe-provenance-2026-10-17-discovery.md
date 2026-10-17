# Desktop Grocery recipe provenance — discovery

> Historical pre-approval record. The owner explicitly approved Option A on 2026-10-17; see the [approval record](grocery-recipe-provenance-2026-10-17-design.md) and [implementation report](grocery-recipe-provenance-2026-10-17-implementation.md) for current status.

Date: 2026-10-17 (America/New_York)

Status: Technical discovery for the completed desktop design review packet. The [design specification](grocery-recipe-provenance-2026-10-17-design.md), editable Figma frames, and [fresh baseline verification](grocery-recipe-provenance-2026-10-17-verification.md) are complete; explicit product-owner approval remains pending. No production UI, data model, cleanup behavior, or PRD change is authorized by this document.

## Repository preflight

- Working directory and repository root: `/Users/johnfolstrom/Desktop/mea-web`.
- Origin: `https://github.com/cgradbad89/mea-recipes.git`.
- Branch: `main`.
- Current commit: `f204409f68c5859b81754abcb6b4f09072e8a243`.
- The referenced cleanup remediation commit is the current HEAD and is therefore included in history.
- Initial Git status: no tracked changes; one existing untracked file, `firebase-debug 4.log`.
- The existing untracked log was preserved without alteration.
- The root task read `CLAUDE.md` and `PRD.md` completely. This focused data-integrity audit additionally checked the grocery model, invariants, cleanup, rebuild, and sharp-edge sections against the current implementation.
- Test framework: Vitest (`npm test` → `vitest run`); build: `npm run build` → `next build`; type check: `npm run typecheck` → `tsc --noEmit`.

Source line references below describe this commit. Fresh execution results appear in the [verification record](grocery-recipe-provenance-2026-10-17-verification.md); the [UI/catalog discovery](grocery-recipe-provenance-2026-10-17-ui.md) and [design specification](grocery-recipe-provenance-2026-10-17-design.md) contain current application references and proposed visual behavior. The test table in this document describes inspected assertions; the verification record is authoritative for execution results.

## Principal finding

The current cleanup implementation already preserves and deduplicates all recipe IDs belonging to each merge group. This applies to groups reconciled within and across AI request batches. No demonstrated cleanup provenance-loss defect was found in the inspected implementation.

The proposed capability can resolve source IDs from the existing recipe catalog in memory. The existing cleanup implementation should remain unchanged unless validation demonstrates a concrete defect. Historical missing associations cannot be reconstructed from grocery fields alone.

## Canonical data model and source lifecycle

The canonical model is `GroceryItem` in `lib/userdata.ts:574`:

```ts
export interface GroceryItem {
  id: string
  name: string
  quantity: string
  unit: string
  isChecked: boolean
  isManual: boolean
  sourceRecipeIDs: string[]
  manualSection?: GroceryCategory
  needThisTrip?: boolean
  createdAt?: unknown
  updatedAt?: unknown
}
```

`groceryPath(uid: string)` (`lib/userdata.ts:593`) resolves the existing owner-scoped collection `users/{uid}/pantry/root/groceryItems`. No new schema, source field, or Firestore collection is needed for display.

| Operation | Current source-association behavior | Evidence |
| --- | --- | --- |
| Read/subscription | Preserves stored source arrays, including duplicates. Does not fill missing arrays. Actual document ID overrides stale stored `id`; historical category values normalize in memory. | `lib/userdata.ts:609–634` |
| Add recipe ingredients | Creates new non-manual rows with `[recipeID]`. Existing exact-identity non-manual rows skip an already contributed recipe ID; otherwise append that ID and merge quantity. Existing duplicates are not normalized by this operation. | `lib/userdata.ts:1103–1187`, especially `1155–1172` |
| Add manual ingredient | New manual rows store `isManual: true` and `sourceRecipeIDs: []`. Manual quantities only merge into manual rows; the merge patch leaves any existing source IDs intact. | `app/grocery/page.tsx:495–568` |
| Quick add saved item | Creates a manual row with no source IDs. | `app/grocery/page.tsx:817–836` |
| Toggle checked | Updates only checked state and timestamp, preserving sources. | `lib/userdata.ts:801–805` |
| AI normalization | Updates name, quantity, unit, category, timestamp; source IDs are omitted from the update and therefore preserved. | `lib/userdata.ts:764–775` |
| AI merge | Writes the unique union of every member's IDs to the survivor and deletes peers within the same transaction. | `lib/userdata.ts:757–776` |
| Meal-plan rebuild | Builds current-plan associations from scratch, skips repeat contributions from the same recipe, replaces non-manual state atomically, and retains manual documents. Auto rows are recreated unchecked. | `lib/userdata.ts:969–1086` |

### Recipe additions

Exact signature at `lib/userdata.ts:1103`:

```ts
export async function addRecipeIngredientsToGrocery(
  uid: string,
  recipeID: string,
  ingredients: string[]
): Promise<void>
```

The shared preparation pipeline combines same-recipe ingredient lines before contribution membership checks. Recipe additions cannot merge into manual documents. The writer discovers matching legacy document IDs, re-reads them transactionally, and handles deterministic ID collisions before writing. Existing checked state, category, and trip override survive quantity/source patches. IDs are stored as supplied by the caller; this path does not derive source IDs from recipe titles.

### Rebuild

Exact signature at `lib/userdata.ts:969`:

```ts
export async function rebuildGroceryFromPlan(
  uid: string,
  plannedRecipeIDs: PlannedElement[],
  getRecipeById: (id: string) => Promise<Recipe | null>,
  parseContent: (content: string) => {
    ingredients: string[]
    instructions: string[]
    description: string
  },
  metas?: Record<string, { overrides?: { content?: string } }>,
): Promise<void>
```

`plannedRecipeIDList(planned: PlannedElement[] | undefined): string[]` (`lib/userdata.ts:279`) extracts IDs from old and new plan entry formats. The rebuild resolves every recipe and prepares the complete replacement before writing. Missing recipes, parser failures, unusable ingredient sets, or more than 450 replacement writes abort without changing the list.

For each normalized ingredient, the rebuild creates `[recipeID]` or appends a distinct contributing ID (`1023–1041`). It retains manual records, including same-name collisions, and preserves `needThisTrip` for exact recreated identities. It replaces historical auto associations with the current meal plan, resets auto checked state, and does not accumulate prior-list quantities.

### Legacy and unusual states

The TypeScript interface requires a source array, but the compatibility reader does not enforce or synthesize it. Cleanup explicitly tolerates an absent source array (`lib/groceryCleanup.ts:441–448`), and a regression fixture verifies that absence remains absent (`tests/groceryCleanup.test.ts:259–263`). A display implementation must safely handle historical absence without rewriting data.

An empty array does not establish manual origin. Use both the canonical `isManual` field and the actual source-reference state. A manual row with populated references is possible as stored data; existing manual quantity updates preserve those references. The display must expose available references without inferring or deleting provenance.

## Cleanup architecture and preservation

### Contracts and batching

The existing AI request model (`lib/groceryCleanup.ts:15`) contains only name, quantity, unit, category, and manual status. Source IDs remain in the captured client plan and are never inferred from model output.

Exact planning signature at `lib/groceryCleanup.ts:458`:

```ts
export async function requestGroceryCleanup(
  items: readonly GroceryItem[],
  requestBatch: (items: GroceryCleanupItem[]) => Promise<unknown>,
): Promise<GroceryCleanupPlan>
```

The function:

1. Captures only `isChecked === false` rows and clones source arrays (`462–464`).
2. Sends sequential batches of at most 100 items (`467–473`).
3. Validates all responses and maps batch-local indices to the captured snapshot (`473–477`).
4. Reconciles purchase identities over the complete snapshot, including cross-batch duplicates (`481–527`).
5. Validates the final plan before returning it (`528`).

`compatibleItems` (`lib/groceryCleanup.ts:396`) requires matching manual status, safe purchase identity, annotations, category, and merge-compatible unknown metadata. Manual and recipe-derived items cannot merge (`403`). Conservative identity handling and shared quantity logic are independent of the proposed source display.

Exact group signature at `lib/groceryCleanup.ts:537`:

```ts
export function buildGroceryCleanupGroups(
  plan: GroceryCleanupPlan,
  rejectedIndices: ReadonlySet<number> = new Set(),
): GroceryCleanupGroup[]
```

Groups are disjoint, index-validated, quantity-validated, and limited to 450 members. Rejection applies to the displayed group as a whole. Large or overly long-quantity groups remain split safely; no source arrays are truncated.

### Persistence

Exact persistence signature at `lib/userdata.ts:695`:

```ts
export async function applyGroceryCleanup(
  uid: string,
  plan: GroceryCleanupPlan,
  rejectedIndices?: ReadonlySet<number>,
): Promise<void>
```

Before any write, the complete unchecked snapshot is compared against server state (`735–741`). Affected records are checked again inside the committing transaction (`743–754`). Updates use actual document IDs. Every survivor update and its peer deletions form one indivisible group; groups are packed into transactions containing at most 450 writes.

The existing source-union implementation is `lib/userdata.ts:772`:

```ts
patch.sourceRecipeIDs = [
  ...new Set(members.flatMap(item => item.sourceRecipeIDs || []))
]
```

This union includes every group member, retains distinct IDs, and removes duplicates. It operates identically for same-batch and cross-batch merge groups. Normalize patches omit `sourceRecipeIDs`. Checked records are absent from the eligible snapshot and receive no cleanup writes. Survivor IDs, unrelated metadata, and creation timestamps remain stable; `needThisTrip` becomes true when any peer requires it.

`GroceryCleanupApplyError` (`lib/userdata.ts:643`) reports confirmed committed batches/writes. Multiple transactions are not globally atomic. A later failure reports partial saving and requires fresh review; this limitation must remain visible and unchanged.

### Route

`POST(req: NextRequest)` at `app/api/grocery-cleanup/route.ts:56` requires authentication, bounds the raw body to 256 KB, accepts at most 100 bounded items per cleanup request, and rejects `isChecked: true`. It generates index-based changes and passes them through `validateGroceryCleanupResponse`. It does not persist grocery documents or determine source IDs. The separate manual-add `parse-line` mode remains unchanged.

## Recipe identity boundary

The canonical `Recipe` interface at `types/recipe.ts:81` includes `id`, `recipeID`, and `title`. `docToRecipe` (`lib/recipes.ts:34`) uses the actual Firestore document ID as `id` and `data.recipeID || id` as `recipeID`. Current shared writes set `id` and `recipeID` to the same document ID (`lib/recipes.ts:121–128`); legacy equality is not enforced on read.

Source IDs are authoritative references. The display must use the existing catalog and canonical URL helper, never construct IDs or URLs from recipe titles. Catalog/navigation/loading details are recorded in the [UI/catalog discovery](grocery-recipe-provenance-2026-10-17-ui.md); the [design specification](grocery-recipe-provenance-2026-10-17-design.md) defines the proposed display contract, canonical document-ID lookup, and exact implementation file scope.

## Existing test evidence inspected

These are existing assertions, not fresh execution results:

| Test location | Coverage |
| --- | --- |
| `tests/groceryCleanup.test.ts:130` | Bounded requests for 0, 99, 100, 101, 150, and 250 eligible rows. |
| `tests/groceryCleanup.test.ts:140` | Checked exclusion for the 103-row reproduction; independently captured source arrays. |
| `tests/groceryCleanup.test.ts:162` | Duplicate reconciliation across 250 rows and three batches; source membership retained from indices 0, 1, 100, and 200. |
| `tests/groceryCleanup.test.ts:174` | Manual/recipe, purchase identity, category, and unknown-metadata separation. |
| `tests/groceryCleanup.test.ts:259` | Legacy missing source array remains absent. |
| `tests/groceryCleanup.test.ts:288` | Safe split at 450-member limit without dropping extra items. |
| `tests/groceryCleanupPersistence.test.ts:154` | Real emulator client → API → persistence path for 70 unchecked and 33 checked rows; checked metadata/source arrays remain unchanged. |
| `tests/groceryCleanupPersistence.test.ts:214` | Actual Firestore document ID and historical category projection used consistently for conflict detection. |
| `tests/groceryCleanupPersistence.test.ts:231` | Persisted source union with overlapping IDs; duplicate IDs removed; trip flag, unrelated metadata, rejected items, checked items, and owner isolation retained. |
| `tests/groceryCleanupPersistence.test.ts:263` | Snapshot conflicts for checked/deleted/edited/timestamp/added changes, including otherwise untouched rows. |
| `tests/groceryCleanupPersistence.test.ts:281` | Concurrent checked-state change during SDK transaction retry is preserved. |
| `tests/groceryCleanupPersistence.test.ts:296` | Complete merge groups packed into transactions of at most 450 writes. |
| `tests/groceryCleanupPersistence.test.ts:315` | Partial save counts and stale replay rejection after an earlier chunk committed. |
| `tests/groceryCleanupRoute.test.ts:40` | Oversized direct requests rejected before AI processing. |
| `tests/groceryCleanupRoute.test.ts:52` | Reported 103-item fixture reaches API with only 70 eligible rows. |
| `tests/groceryCleanupWorkflow.test.tsx:109` | Stable captured identities after subscription reordering; only unchecked rows reviewed. |
| `tests/groceryCleanupWorkflow.test.tsx:153` | All-checked list avoids authentication, AI, persistence, and timestamp changes. |
| `tests/groceryCleanupWorkflow.test.tsx:165` | Later batch failure discards earlier proposals without writes or success timestamp. |
| `tests/groceryPersistence.test.tsx:246` | Direct recipe addition preserves checked state and appends source ID. |
| `tests/groceryPersistence.test.tsx:348` | Rebuild combines repeated/same-recipe and cross-recipe contributions, deduplicates sources, replaces stale auto state, and retains manual/trip intent. |

## Limitations and validation gaps

- Historical missing or previously lost associations cannot be recovered from current grocery fields. `PRD.md:1554` explicitly records that prior remediation performs no production migration or recovery of lost quantities/associations.
- Empty or absent sources do not prove manual entry. Historical malformed-field prevalence and production source completeness have not been measured.
- Duplicate IDs can remain in stored records after ordinary reads/adds. Deduplicate display results in memory; do not normalize documents for this feature.
- Missing catalog matches establish unavailability in the loaded catalog, not verified deletion. Do not create broken links or query each missing source individually.
- Existing tests separately establish cross-batch plan retention and persisted source union. There is no combined 250+ cross-batch → persistence → reload → source-display test yet.
- New provenance display/resolution tests are required after approval: one/two/five recipes, duplicate IDs, missing sources, legacy absence, manual records, checked rows, long titles, disclosure/focus, canonical links, and no per-reference reads or writes.
- Additional three-or-more distinct-source and repeated-merge persistence cases would directly support the requested acceptance criteria. These are coverage gaps, not demonstrated implementation defects.
- No production cleanup repair is currently justified by this audit. Preserve existing quantity, identity, grouping, checked exclusion, persistence, and partial-save behavior.

## Design gate and follow-up

DESIGN GATE:
- Approved Figma source: none yet. Proposed [editable Figma source](https://www.figma.com/design/2tzBJXKAyecopz1R4QavwD?node-id=2-114) is file `2tzBJXKAyecopz1R4QavwD`, page **Desktop Grocery — design approval** (`0:1`), frames `2:114`–`2:119`; exact frame/export mapping is in the [manifest](../mockups/grocery-provenance/figma-manifest.json).
- Approval reference: pending explicit product-owner approval of the completed visual packet.
- Approved option: none yet; the specification recommends **A — Used In column**. A secondary-line alternative is provided for comparison.
- Approved states: none yet. The completed [state and interaction specification](grocery-recipe-provenance-2026-10-17-design.md#state-and-interaction-specification) includes required source, unavailable/manual, checked, long-title, disclosure/focus, dense-list, loading/error/empty, editing, and Usually On Hand states.
- Mobile impact: none permitted. The proposed source UI is hidden below the existing `lg` breakpoint; actual 375px and 390px before references are linked in the [design specification](grocery-recipe-provenance-2026-10-17-design.md#mobile-reference).
- Unresolved design gaps: no missing required state in the proposed Option A packet. Product-owner approval and browser validation of the future implementation remain outstanding. Selecting Option B requires adapting the full state/responsive specification before production edits.

The completed [design/implementation handoff](grocery-recipe-provenance-2026-10-17-design.md) supplies the desktop mockups at 1024px, 1280px, and 1440px, an alternative mockup, state frames, interactions, tradeoffs, exact file scope, and artifact inventory. The [UI/catalog discovery](grocery-recipe-provenance-2026-10-17-ui.md) supplies actual desktop/mobile observations. The [verification record](grocery-recipe-provenance-2026-10-17-verification.md) records the passing existing baseline, type check, build, post-build suite, environment recovery, and 24 proposed regression cases.

Implementation, new feature tests, production changes, PRD updates, and release remain deferred until explicit design approval. Passing existing baseline checks do not validate the unimplemented source UI.
