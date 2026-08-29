# Cooking Mode — Human Mapping Review Experience (Design)

**Date:** 2026-08-28
**Type:** DESIGN ONLY — no React implementation, no Firestore writes, no routing/reviewer changes.
**Status:** Draft, pending product-owner approval. Nothing in this document is authorized for
implementation until the open decisions in §18 are resolved.

## 0. Executive result

```
HUMAN MAPPING REVIEW DESIGN READY FOR PRODUCT APPROVAL
```

with one explicit exception: **Figma is not connected in this environment** (the `figma` MCP
connector requires authorization the session doesn't have). Per the user's direction, the visual
deliverable was produced instead as a self-contained interactive HTML prototype (published as a
Claude Artifact, MEA design tokens, desktop + mobile, all required states) plus this written spec.
See §14 for the artifact link and §22 for the Figma follow-up.

## 1. Starting state

- Branch `main`, HEAD `61c5ec0f61649eabc997056cec0a567e7e204ca0`, `origin/main` identical — matches
  the expected checkpoint exactly.
- Working tree carried two unrelated pre-existing items, both preserved untouched: a modified
  `docs/audits/cooking-mode-v10f-lite-active-object-go-no-go-2026-08-28.json` and untracked
  `.eslintrc.json` / `firestore-debug.log`.
- No resets, no stashes, no deletions of unrelated files.

## 2. The user job

> **For this recipe and instruction step, should this ingredient actually appear in Cooking Mode?**

The reviewer answers this from recipe source context (the step text, the ingredient text, nearby
steps/ingredients) — never from routing internals. V10A/V10G/candidate IDs/model names are not
primary UI; they exist only as secondary "why was this flagged" detail for the curious or for
audit.

A second, distinct job exists at the map level (§7–8):

> **Does the proposed mapping look complete for this recipe overall?**

Candidate-level review (job 1) can never fully answer job 2, because the reviewer union has ~96%
recall — some true relationships were never generated as candidates at all. Both jobs are designed
for explicitly; job 2 is not a formality tacked onto the end of job 1.

## 3. Primary review model — decision

**Selected: Hybrid, step-centric by default.**

| Model | Review speed | Semantic clarity | Error risk | Mobile | Omission detection | Verdict |
|---|---|---|---|---|---|---|
| A — candidate-at-a-time | Slow at ~14 items/recipe: the same step's instruction is re-read every time two+ candidates land on it (common — `DUPLICATE_ROW_RISK`/`GROUP_CONFLICT_RISK` cluster multiple candidates per step) | High per-item, but the step is out of view once you move to the next candidate | Low per-decision, but re-reading fatigue raises skim risk over 14 items | Fine | Poor — no natural view of "everything on this step" | Rejected as primary |
| B — step-centric batch | Fast — one instruction read, all its candidates decided together; matches the measured shape (14.09 items across ~34/36 recipes, clustered by step) | High — the step is the actual unit of the user's question | Low — seeing siblings side-by-side surfaces `GROUP_CONFLICT_RISK`/`DUPLICATE_ROW_RISK` naturally | Good — one step, short list, big touch targets | Good within a step; weak across the whole recipe | **Selected as primary** |
| C — matrix | Full visibility, best for auditing | Low per-cell — decisions made out of instruction context, exactly the failure mode the routing contract calls out (agreement ≠ truth) | Higher — easy to flip a cell without rereading its step | Poor — a 12×6 grid does not fit a phone | Best | **Secondary/desktop-only**, reused for completeness review |
| D — hybrid | — | — | — | — | — | **Selected**: B for the primary flow, C (as a read-mostly overview, not a decision grid) folded into the completeness screen (§7) and available on demand during step review via "View full map" |

Rationale: the job is "does this ingredient belong on *this* step," so the step is the natural
review unit, not the candidate or the whole recipe. Step-centric review keeps the instruction in
view for every decision made against it (Phase 4/5 requirement), reads the step's full instruction
exactly once per pass, and naturally surfaces sibling risks (two ingredients competing for the same
step) that candidate-at-a-time would hide. The matrix is preserved as a comprehensive secondary
view because it is the right shape for the completeness question, not the candidate-decision
question — decisions are never made by toggling cells in it.

## 4. Queue / navigation — decision

**Selected: a new, separate, admin-gated route — `/mapping-review` (list) and
`/mapping-review/[recipeId]` (detail) — not a subsection of `/queue`.**

Rationale (Phase 12 analysis):

| | `/queue` (existing) | Mapping review (new) |
|---|---|---|
| Job | Approve an AI-parsed recipe *before* it exists as a published recipe | Approve a step↔ingredient *mapping* for a recipe that already exists and is already live in Cooking Mode |
| Data shape | `QueuedRecipe` docs under `users/{uid}/queue` | `MappingProposal`/`MappingCandidate`/`MappingReviewDecision`/`ApprovedCookingStepMap` under `recipes/{recipeId}/...` |
| Primary actions | Edit title/ingredients/instructions, Publish, Discard | Include/Exclude a relationship, correct a decision, attest completeness, approve a map |
| Audience | Anyone adding a recipe (in practice, the one admin user) | Admin only (`ADMIN_EMAIL`), by contract — this is a mapping-integrity workflow, not a content-authoring one |
| Lifecycle stage | Pre-publication | Post-publication, pre-Cooking-Mode-cutover |

Merging them would conflate "does this recipe look right" with "does this mapping look right,"
force the queue UI's edit-heavy card into an approve/reject-heavy one, and put a workflow the
`ADMIN_EMAIL` gate should scope (mapping review touches the shared review-routing pipeline) behind
the same nav item as ordinary recipe intake. They are different jobs with different data, different
audiences in spirit, and different lifecycle stages — kept separate.

**Nav placement:** `components/Navigation.tsx`'s `NAV_ITEMS` is currently a static list rendered for
every signed-in user; there is no existing per-item admin gate there (`HubBanner.tsx`'s admin gate
is a different, cross-app top strip, not a pattern for hiding a nav item). The design adds one new
conditionally-rendered item — `{ href: '/mapping-review', label: 'Mapping Review', icon: ClipboardCheck }`
— filtered into `NAV_ITEMS`/`MORE_ITEMS` only when `user?.email === ADMIN_EMAIL`, mirroring the
existing `ADMIN_EMAIL` check already used by `HubBanner`. On mobile it lands in the "More" sheet
alongside Queue/Discover, not as a primary tab — this is a low-frequency admin workflow, not a
daily-use one. **This nav wiring is implementation, not design decided here** — noted for the
handoff in §16.

## 5. Candidate/step review design

### 5.1 Source context (always visible)

- **Recipe header** (sticky top): recipe title, a compact status pill (`In review` /
  `Ready for final approval`), and progress (§10).
- **Step card** (the dominant element on screen): `STEP {N}` label + the full instruction text at
  the largest type size on the screen (mirrors `CookingMode.tsx`'s current-step treatment:
  `font-display text-2xl` step number in amber, `font-body text-lg` instruction text, on an
  amber-tinted card).
- **Neighboring steps**, collapsed by default: previous step and next step shown as single muted
  lines directly above/below the step card (`◂ Step 2 — …` / `Step 4 — … ▸`), expandable in place.
  This satisfies "don't overwhelm the primary decision with the entire recipe" while keeping
  lifecycle/continuation context (`LIFECYCLE_RISK`, `COMPONENT_CONTAINMENT_RISK`) one tap away.
- **"View full map"** (secondary link, top-right of the step card): opens the same read-mostly
  overview used for completeness review (§7), scrolled to this step, for the rare case a reviewer
  needs the whole recipe. Available at any point during step review — not gated behind finishing
  candidate decisions.

### 5.2 Candidate rows (one per uncertain ingredient on this step)

Each row shows, top to bottom:

1. **Ingredient text**, with its source group label as a small tag if the ingredient has one
   (e.g. `Sauce`) — this is the literal parsed group, not a routing artifact.
2. **Reviewer vote line** — restrained, factual, side-by-side, never framed as a tally:
   `Reviewer A · Include` `Reviewer B · Exclude` as two small pills with a check/x glyph plus text
   (never color alone). Agreement renders both pills in the same neutral tone; disagreement renders
   plainly, not with a warning color — disagreement is informative, not alarming (Phase 4).
3. **Risk chip(s)** (only if any V1 risk fired) — human labels from the table in §6, rendered as a
   single muted-amber chip row, each expandable (tap/click) to one line of the underlying
   source-observable condition. Enum names never appear in the primary view.
4. **Decision control** — two full-width (mobile) / inline (desktop) buttons, **Include** and
   **Exclude**, each with an icon (check-circle / x-circle) and text label, never color-only. The
   active decision is visually filled (amber for Include, a plain outlined state for Exclude);
   before any decision both render as equal, unfilled options — there is no default state that
   looks like a de-facto pre-selected answer.
5. **Already-decided state**: once a candidate has an effective decision, the row collapses to one
   line — icon + "Included" / "Excluded" + a small **Change** button — so a resolved step reads at
   a glance and re-opening for correction is one click (§9). A **History** link (secondary, muted)
   shows prior superseded decisions on demand; it is never shown expanded by default.

### 5.3 Step-level actions

- **Confirm step** — primary action once every candidate on the step has a decision; advances to
  the next unresolved step. Submits one `appendMappingReviewDecision` call per changed candidate
  (§17); already-effective, unchanged decisions are not resubmitted.
- **Previous / Next step**, plus **Jump to next unresolved** — always available, so a reviewer can
  free-navigate without losing any decision (all writes are per-candidate and immediate once a
  button is pressed — nothing is held in unsaved client state waiting for "Confirm step").
- Confirm step is disabled with a one-line reason ("2 ingredients on this step still need a
  decision") rather than hidden, so the control's location never moves.

## 6. Risk copy (Phase 5)

Enum names are never primary UI. Exact designed copy, ranked by how the contract's evidence table
frames "why review was forced":

| V1 enum | Display label | One-line explanation (shown on tap/expand) |
|---|---|---|
| `COMPONENT_CONTAINMENT_RISK` | **Might be part of another component** | This ingredient may already be inside something else used on this step, rather than added directly. |
| `LIFECYCLE_RISK` | **Used earlier in the recipe** | This ingredient was already used in a prior step — this may be a continuation, not a new addition. |
| `CONTEXT_ONLY_RISK` | **Mentioned in passing** | This step's wording (e.g. "adjust seasoning," "serve with") doesn't clearly call out this specific ingredient. |
| `PROCESS_MATERIAL_RISK` | **Process material, not food** | This looks like water, ice, foil, or a similar prep material rather than a real ingredient use. |
| `DUPLICATE_ROW_RISK` | **Possible duplicate ingredient** | Another ingredient row looks very similar to this one — check you're deciding the right one. |
| `GROUP_CONFLICT_RISK` | **Different ingredient group named** | This step calls out a different ingredient group than the one this row belongs to. |
| `QUANTITY_CONFLICT_RISK` | **Quantity doesn't match** | The amount mentioned on this step doesn't match this ingredient's listed amount. |
| `COLLECTIVE_REFERENCE_RISK` | **Vague "everything" reference** | This step says something like "add the rest" without naming this ingredient specifically. |
| `PARTIAL_IDENTITY_MATCH_RISK` | **Only a partial name match** | Only part of this ingredient's name (e.g. "oil") matches what the step says. |

Copy rules applied throughout: no `SNAKE_CASE`, no "AI," no "reviewer" jargon beyond the plain
"Reviewer A / Reviewer B" vote line, no confidence percentages, no chain-of-thought, no raw
provider text (all forbidden by the routing contract §6/§19 — provider payload and hidden
reasoning are diagnostic-only and never review UI inputs).

## 7. Completeness review

### 7.1 Why it exists

Candidate-level review can only ever resolve candidates that exist. The frozen benchmark shows the
reviewer union misses **35/868 (4.03%)** of true relationships entirely — never generated as a
candidate, never seen by ACCEPT/REJECT review. A human who only ever clicked through the review
queue would never notice a relationship that both reviewers silently missed. Completeness review is
the deliberate, separate step that asks the map-level question instead of the candidate-level one.

### 7.2 Flow

```
All REVIEW_REQUIRED candidates resolved
        ↓
"Review complete" milestone card — explicit, not a silent auto-advance
        ↓
Full-map preview (Cooking Mode-style, read-mostly)
        ↓
Attest completeness (explicit checkbox/statement, not implied by scrolling)
        ↓
Approve Cooking Mode map
```

The milestone card between candidate review and the full-map preview exists specifically so
finishing the *last candidate* is never confused with approving the *map* (Phase 8's explicit
requirement) — it is its own screen with its own "Continue to full map review" action, not a toast
that auto-navigates.

### 7.3 What the human inspects

A **Cooking Mode-style preview**: every instruction step, in order, with the ingredients currently
mapped to it shown as chips underneath — the same visual language as `CookingMode.tsx`'s expanded
per-step ingredient list, but read-mostly and showing the *whole* recipe at once (scrollable, not
paginated candidate-by-candidate). Each chip carries a subtle origin mark (a small dot: filled for
`AUTO`, outlined for `HUMAN`) — visible on demand, never load-bearing for the decision. Desktop adds
an optional "Show as grid" toggle that renders the same data as an ingredient × step matrix
(Option C from §3) for reviewers who want the dense overview; it remains read-only — no decision is
ever made by clicking a matrix cell.

Under each step, a low-emphasis **"+ Add ingredient to this step"** affordance lets the human flag a
relationship neither reviewer produced (§8) — the exact answer to Phase 22's critical question #7.

### 7.4 Attestation semantics

Attestation is a deliberate, explicit act — a labeled statement ("I've reviewed the full mapping
above and it looks complete for this recipe") the human affirms, not an implicit consequence of
having scrolled or of having decided every candidate. It maps directly onto
`BuildApprovedMappingInput.completenessAttestedAt` (§17) and is **required for every proposal that
contained any human decision** (`approvalMode: 'HUMAN_ASSISTED'`), per architecture-contract §15
point 7 — this is not a new UX invention, it is surfacing an existing backend requirement.

### 7.5 Map-level approval

The **Approve Cooking Mode map** action shows, before commit:

- recipe title and current mapping revision (short form — see §14 hash-hiding rule);
- instruction step count;
- total mapped relationship count, split as "N auto-resolved, M from your review";
- an explicit "All review decisions complete ✓" line (not shown at all if false — the button is
  simply disabled with a reason instead);
- the attestation statement itself.

This is a distinct, deliberate action — never reachable by pressing the same button that resolved
the final candidate.

## 8. Human-missed-relationship flow (Phase 22, critical #7)

**What happens today if a human notices a real relationship during completeness review that no
candidate represents?** Nothing — there is no path. `appendMappingReviewDecision` only accepts a
`candidateId` that already exists under the proposal (`AppendMappingReviewDecisionInput.candidateId`
is required and validated against the persisted candidate population); there is no "create a
candidate" operation anywhere in the persistence layer, and `MappingCandidateV1`'s routing derives
entirely from two reviewer votes plus deterministic evidence — a human-originated relationship has
neither.

**Designed UX (conceptual only):** on the completeness-preview screen, "+ Add ingredient to this
step" opens a small picker of this recipe's ingredient rows not currently mapped to that step. The
human selects one, gives a reason (reusing the existing `MappingHumanReviewReason` vocabulary —
`SOURCE_EXPLICIT_USE` is the expected common case), and confirms. The new relationship appears in
the step's ingredient-chip list immediately, visually marked as human-added (not "Auto"), and rolls
into the map's relationship count and hash exactly like every other approved relationship.

**Required backend contract extension — flagged explicitly, not hidden:**

1. A new creation path (e.g. `appendHumanCreatedMappingCandidate`) that materializes a
   `MappingCandidateV1` with no reviewer votes to evaluate — routing must special-case this instead
   of running it through the two-reviewer precedence table in contract §10, since a human-added
   candidate has `decisionSource: 'HUMAN'` and an immediately effective `finalDecision` by
   construction.
2. Candidate identity: the existing `mc1:` tuple is `(recipeId, recipeRevision, ingredientRowIndex,
   stepIndex)` — a human-added relationship for the same (row, step) pair as an already-adjudicated
   `REJECT` would collide with an existing id unless the schema adds an explicit `origin` field
   (`'REVIEWER_UNION' | 'HUMAN_ADDED'`) to the identity tuple, or a new prefix (e.g. `mh1:`) is
   introduced for human-originated candidates specifically. This is a normative-contract decision,
   not a UI one.
3. `ApprovedMapProvenanceV1`/`ApprovedIngredientStepRelationshipV1` already carry a
   `decisionSource: 'AUTO' | 'HUMAN'` field, so the *approved-map* shape needs no change —
   human-added relationships slot into the existing `HUMAN` decision-source bucket once a
   `decisionId` exists for them. The gap is entirely upstream, at candidate creation.
4. This must be resolved in a separate, explicitly-scoped backend/architecture task before any UI
   implementation wires this control to a real write. The mockup in §14 renders the control and its
   flow but is annotated in-page as backend-dependent.

## 9. Decision correction / history

Changing a decision reads as ordinary editing, never as "appending an event": a resolved candidate
row shows **Included**/**Excluded** plus a **Change** button; pressing it reopens the Include/Exclude
control pre-set to the current state, and picking the other option submits a new
`appendMappingReviewDecision` call with `supersedesDecisionId` set to the candidate's current
`effectiveReviewEventId` — entirely transparent to the reviewer. **History** is a secondary,
on-demand disclosure (timestamp + decision + reason for each past event, newest first); it is never
shown expanded by default, matching Phase 9's "history should be secondary."

## 10. Progress and navigation

- **Step review progress**: `{resolved} of {total} reviewed` plus a percentage and a thin progress
  bar, computed from `computeProposalCompletion()`'s `resolvedCandidates`/`totalCandidates`
  (§17) — not a client-invented count.
- **Step-level sub-progress**: `{n} of {m} steps needing review`, shown next to the main progress so
  a reviewer always knows both "how many decisions are left" and "how many steps are left."
- **Navigation controls**: Previous / Next step, and **Jump to next unresolved** (skips fully-decided
  steps). No control ever discards a decision — every Include/Exclude press writes immediately, so
  navigating away mid-step never loses progress.

## 11. Recipe-level queue states

Using only the domain states the persistence layer actually produces — no invented lifecycle:

| Displayed state | Derived from |
|---|---|
| **Needs review** | Proposal `READY`, `approvalBlocked: true`, `reviewCompleteWithoutHuman: false`, no review events yet |
| **In progress** | Same as above, but at least one review event exists and at least one `REVIEW_REQUIRED` candidate remains unresolved |
| **Ready for final approval** | Every candidate resolved (`computeProposalCompletion().complete === true`), no approved map yet |
| **Approved** | `getApprovedMapping`/pointer resolves `CURRENT` for this recipe's live revision |
| **Stale** | Pointer resolves `STALE` — the approved (or in-review) proposal's `recipeRevision` no longer equals the recipe's live revision |
| **Blocked** | `approvalBlocked: true` for a reason other than pending human review — `REVIEWER_RESULT_INCOMPLETE`/`DETERMINISTIC_EVIDENCE_UNAVAILABLE`/persistence `FAILED` |

Each queue card shows: title, this status pill, `{resolved}/{total}` progress where applicable, and
a stale/blocked icon with a one-line reason when relevant.

## 12. Blocked / error / stale states (Phase 13–14)

All copy is a plain statement of the actual condition plus the one available recovery action — no
invented auto-retry beyond what the backend contract already promises (bounded reviewer-slot retry
happens server-side before a proposal ever reaches `READY`; the review UI never exposes a "retry AI"
button, since that is not part of the review surface's job):

| State | Copy | Available action |
|---|---|---|
| Reviewer execution incomplete | "One of the two reviewers hasn't finished for this recipe yet. Review can't start until both complete." | none in-UI — informational, resolves server-side |
| Mapping evidence unavailable | "We couldn't evaluate the risk signals for this recipe's mapping. Review is paused until this is resolved." | none in-UI |
| Proposal incomplete | "This recipe's mapping proposal didn't finish generating." | none in-UI |
| Recipe changed / map stale | "This recipe changed since this mapping was reviewed. The old review no longer applies — a new mapping review is needed." | **Start new review** (creates/opens the current-revision proposal; the stale one is never editable) |
| Persistence/read failure | "Couldn't load this recipe's mapping review. [details if available]" | **Retry** |
| No review-required candidates | See §13 | **Continue to full map review** |
| All candidates resolved, awaiting map approval | The §7.2 milestone card | **Continue to full map review** |
| Map approved | The §7.5/§14 success state | — |

The human can never reach **Approve Cooking Mode map** from a blocked, stale, or incomplete state —
the action is absent (not merely disabled) whenever the underlying data isn't in an approvable
shape, so there is no button to accidentally press.

## 13. Zero-review-required proposals (Phase 15)

**Recommendation: Option B — still require map-level completeness attestation.**

This is not actually an open question the design has to invent an answer for: architecture-contract
§15 point 7 already states a `HUMAN_ASSISTED` proposal requires completeness attestation, and point
regarding auto-only proposals states an auto-only proposal **"may omit human completeness
attestation only after the complete implementation passes the separately required union-recall and
severity release gates"** — gates §23 lists as not yet met (frozen union recall is 95.97%, below the
required ≥99%/100% class-specific targets). Until those gates are met, *every* proposal — including
one with zero `REVIEW_REQUIRED` candidates — requires attestation, because "no candidate needed
review" says nothing about the 4% of true relationships that were never candidates at all.

**Designed UX for this case**: the step-by-step Include/Exclude flow is simply skipped (there is
nothing to decide) and the reviewer lands directly on a short milestone card — "This recipe's
mapping was fully resolved automatically — nothing needs your decision" — with one action,
**Continue to full map review**, leading straight into the same completeness-review screen used for
every other proposal. The completeness screen itself is identical either way; only the step-review
phase is skipped.

**Product decision required: No**, for now — the contract already resolves it. Flag for
re-evaluation once the recall/severity gates in §23 are actually met, at which point Option A
(silent auto-approval for zero-review proposals) becomes newly available and would need its own
explicit product sign-off before being enabled.

## 14. Responsive design, accessibility, and the prototype artifact

**Artifact:** published as a Claude Artifact — see the link delivered alongside this document (the
exact URL is included in the chat response, not duplicated here since Artifact URLs are
per-publish). Built with MEA's actual design tokens (`ink`/`surface`/`card`/`border`/`amber`/
`amber-dim`/`amber-glow`/`cream`/`muted`/`faint`, `font-display` via Cormorant, `font-body` via DM
Sans, the existing `.tag`/`.btn-primary`/`.btn-ghost`/`.recipe-card`/`.skeleton` visual language) —
not a generic admin-dashboard aesthetic. Desktop and mobile layouts are both implemented in the same
responsive page (resize the artifact viewport, or view on a phone, to see the mobile layout); it is
not two disconnected mockups.

Contains: Queue (desktop + mobile), Step review (desktop + mobile, with an agreement example, a
disagreement example, and a multi-candidate-per-step example), Completeness review (including the
grid/matrix toggle and the "add missing ingredient" control), Approval success, and every state from
§11–13 (loading, empty, blocked, stale, all-auto-routed, review-complete-awaiting-approval) as
separately reachable panels, plus a guided walk of the primary flow end to end (queue → open recipe
→ resolve candidates including one correction → finish review → inspect full map → attest → approve
→ approved state), matching Phase 20's required prototype path.

Hashes/IDs (`mapId`, `candidateId`, `proposalId`, `mapHash`) never appear as primary UI anywhere in
the artifact; where a technical identifier exists for audit purposes it sits behind a "Technical
details" disclosure.

**Accessibility, applied throughout:**

- Every Include/Exclude, Change, and risk-chip control is a real `<button>` with a text label, never
  a bare icon or a `div` with a click handler.
- Decision state is never color-only: Include/Exclude always pair an icon (✓ / ✕ glyph) with the
  word, and risk chips carry a label, not just an amber dot.
- Visible focus rings on every interactive element (`:focus-visible` outline in `amber-glow`,
  distinct from hover state).
- `aria-pressed` on toggle-style controls (Include/Exclude, the grid/matrix toggle), `aria-label` on
  icon-accompanied buttons where the visible text alone is ambiguous (mirroring the existing
  `aria-label` pattern already used in `CookingMode.tsx`'s ingredient checkboxes).
- Minimum 44×44px touch targets on every mobile control, matching the existing bottom-nav sizing
  (`min-h-[52px]`) already used elsewhere in the app.
- Contrast: body text uses `cream`/`muted` on `ink`/`surface`/`card`, all of which already meet WCAG
  AA in the existing app; risk-chip text uses `amber` on a `amber/10` background at a checked
  contrast ratio, not a low-contrast decorative tint.

## 15. Component reuse and new components

**Reused as-is (visual language, not copy-pasted code — this is a design document, no components
were created):**

- `.recipe-card` / `bg-surface border border-border rounded-2xl` shell — queue cards, step cards,
  candidate rows.
- `.tag` / `.tag-amber` — group labels, status pills.
- `.btn-primary` / `.btn-ghost` — Confirm step / Approve map (primary), Change / Previous (ghost).
- `.input-field` — the reason/note field on a correction or a human-added relationship.
- `.skeleton` shimmer — loading state.
- `CookingMode.tsx`'s current-step treatment (`bg-amber/10 border-amber/40`, `font-display text-2xl`
  step number, `font-body text-lg` instruction) — reused directly for the step-review step card and
  the completeness-preview step list.
- `LoadingErrorRetry` pattern (loading / error+retry / children) — reused for proposal/candidate
  fetch states, matching `/queue`'s existing usage.
- Bottom-sheet pattern from `Navigation.tsx`'s "More" sheet — reused for the mobile risk-detail
  expansion and the mobile "add missing ingredient" picker.

**New components required for implementation** (named here for the handoff, not built):

- `MappingReviewQueueCard` — recipe-level queue card with status pill + progress.
- `MappingStepReviewCard` — the step + neighboring-context + candidate list.
- `MappingCandidateRow` — one candidate's ingredient/votes/risk/decision control.
- `MappingRiskChip` — the label + expandable one-liner.
- `MappingCompletenessPreview` — the full step-by-step (and optional grid) read-mostly view.
- `MappingApprovalPanel` — the stats + attestation + Approve action.
- `MappingAddRelationshipPicker` — the human-added-relationship control (backend-dependent, §8).

## 16. Backend mapping (design action → existing service)

| Design interaction | Backend service | Notes |
|---|---|---|
| Load a recipe's mapping proposal | `getMappingProposal(recipeId, proposalId)` | Queue card and step-review header |
| List items needing decision | `listReviewRequiredCandidates(recipeId, proposalId)` | Drives the step-review candidate list |
| Load one candidate (e.g. from a deep link) | `getMappingCandidate(recipeId, proposalId, candidateId)` | |
| Submit Include/Exclude | `appendMappingReviewDecision({ recipeId, proposalId, candidateId, recipeRevision, decision, reasonCode, note?, decidedBy, supersedesDecisionId? })` | `decidedBy` is server-verified — never a client-supplied field, per §25.7 of the contract |
| Show correction history | `getMappingReviewHistory(recipeId, proposalId, candidateId)` | Secondary "History" disclosure only |
| Compute progress | `computeProposalCompletion(candidates)` | Drives §10's progress bar and the "ready for final approval" state |
| Build/inspect the full map before approval | `buildApprovedMapping(input)` (pure) | Powers the completeness-preview content and the pre-approval stats panel — **read-only preview, not a write** |
| Approve the map | `persistApprovedMapping(...)` then `updateCurrentApprovedMappingPointer(...)` | The Approve Cooking Mode map action |
| Check current/stale status | `getCurrentApprovedMappingPointer(recipeId, currentRecipeRevision)` | Drives the Stale badge/state everywhere |
| Add a human-missed relationship | **No existing service** — see §8 | Explicit backend gap, not implemented here |

No API route currently wraps any of the above (confirmed — architecture-contract §25.7: "No API
route exists yet"). Every one of these calls needs a server-verified-admin API route before any UI
can use it; none is built in this task.

## 17. Product decisions requiring approval

1. **Primary review model** — Hybrid, step-centric default with matrix as secondary (§3).
   Recommended; not yet approved.
2. **Queue location** — new `/mapping-review` route, admin-gated, separate from `/queue` (§4).
   Recommended; not yet approved.
3. **Completeness attestation mandatory for every recipe, including zero-review proposals** — already
   required by the existing contract (§13); no new decision needed, just confirmation this reading
   is correct.
4. **Review history default-hidden, on-demand only** (§9) — recommended; low-risk, but flagging since
   the task explicitly calls it out as a decision point.
5. **Whether reviewers can inspect `AUTO_ACCEPT` relationships during completeness review** —
   **recommended yes**, since completeness review's entire purpose is catching omissions and errors
   across the *whole* map, not just the human-reviewed slice; the origin dot (§7.3) distinguishes
   them without re-litigating already-auto-accepted decisions as editable. Not yet approved.
6. **Human-added-relationship backend extension** (§8) — this is a **required scope addition**, not
   optional polish; flagged as blocking full implementation of the completeness screen's "add
   ingredient" control. Needs explicit backend/architecture sign-off before UI wiring.
7. **Nav item admin-gating pattern** (§4) — `Navigation.tsx` currently has no per-item gate; adding
   one is a small, low-risk implementation detail but changes a shared component, so flagging for
   awareness rather than silently deciding it during a later implementation task.

## 18. Unverifiable items

- Whether `folstromjohn@gmail.com` (the sole admin) is in practice the same person who will perform
  mapping review, or whether a future second reviewer role is planned — assumed single-admin per
  PRD §1 and CLAUDE.md; not independently verifiable from the repo.
- Real-world review session length/frequency (how often the admin will actually work through
  14-item recipes) — the design assumes desktop-primary, mobile-capable usage based on existing app
  patterns, not measured usage data.

## 19. Deferred / not completed

- Figma file — not created (connector not authorized this session); HTML artifact substituted per
  explicit user direction. See §22.
- No React implementation, no API routes, no Firestore writes, no nav wiring — all explicitly out of
  scope for this design task.
- Human-added-relationship backend contract extension (§8) — identified, not designed at the schema
  level beyond the conceptual sketch given; needs its own architecture task.

## 20. PRD.md

**Not updated.** Per this task's instructions, PRD.md is only updated once these design decisions
carry product-owner approval — none of §17's items are approved yet. Once approved, PRD.md's Page
Inventory (new `/mapping-review` route), Feature Backlog (`Cooking Mode recall remediation` row),
and a new Known Sharp Edge entry (the human-added-relationship backend gap) should be updated in the
same commit as the eventual implementation work.

## 21. Next task

If approved: `IMPLEMENT APPROVED HUMAN MAPPING REVIEW EXPERIENCE`
If not yet approved: `REVISE HUMAN MAPPING REVIEW DESIGN`

## 22. Figma follow-up

To get this into an actual Figma file once the connector is authorized (via claude.ai connector
settings, per this session's tooling constraints): re-run this task's Phase 19–20 with the `figma`
MCP connected, using this document (particularly §3–14) as the settled design brief so the Figma
build is a direct port of already-decided information hierarchy and copy rather than a redesign.
