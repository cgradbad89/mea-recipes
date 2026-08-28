// Cooking Mode mapping persistence contracts (Implementation 3).
//
// This file adds the durable-storage layer on top of the frozen in-memory
// contract in `types/cookingModeMapping.ts`. It does not redefine reviewer
// semantics, routing, or the nine V1 risks — it only describes how proposals,
// candidates, human review decisions, and approved maps are written to and
// read from Firestore.
//
// Naming note (documented contract deviation — see
// docs/architecture/cooking-mode-review-routing-contract.md §25):
// `docs/architecture/cooking-mode-review-routing-contract.md` already
// normatively names two persistence-adjacent domain concepts:
//   - §14 `MappingReviewDecisionV1` (human review decision)
//   - §15 `ApprovedCookingStepMapV1` / `ApprovedIngredientStepRelationshipV1`
// Those exact shapes are reused below (adapted only where Firestore requires
// a server timestamp instead of a plain RFC 3339 string). The illustrative
// TypeScript snippets in the Implementation 3 task prompt used different
// names/shapes for the same two concepts (`MappingReviewDecisionV1` with
// `reviewEventId`/`supersedesReviewEventId`, `ApprovedCookingModeMapV1`); this
// file keeps the already-normative architecture names and adds a `Persisted`
// prefix only for the Firestore-shaped variants, to avoid two conflicting
// definitions of the same normative type name.

import type {
  MappingCandidateV1,
  MappingProposalBlockingReason,
  MappingProposalSummaryV1,
} from '@/types/cookingModeMapping'

// ── Identity prefixes ────────────────────────────────────────────────────
//
// Existing frozen prefixes (do not change): `mc1:` (candidate),
// `mp1:` (proposal) — both defined in lib/cookingModeMappingIdentity.ts.
// New prefixes introduced by this file:
export const MAPPING_APPROVED_MAP_ID_PREFIX = 'am1:' as const
export const MAPPING_REVIEW_DECISION_ID_PREFIX = 'mr1:' as const

// ── Proposal persistence ─────────────────────────────────────────────────

/**
 * Write-completeness state of the proposal header document. This is
 * orthogonal to the review-workflow status (`MappingProposalStatus` in the
 * architecture contract, §15) — it exists purely so a reader can never
 * observe a proposal header claiming a candidate population that has not
 * finished writing (Phase 9 atomicity requirement).
 */
export type MappingProposalPersistenceStatus = 'WRITING' | 'READY' | 'FAILED'

export interface PersistedMappingProposalV1 {
  schemaVersion: 1
  proposalId: string
  recipeId: string
  recipeRevision: string
  parserVersion: string
  mappingSourceHash: string

  reviewerContractVersion: string
  evidenceContractVersion: string
  routingContractVersion: string

  summary: MappingProposalSummaryV1
  candidateCount: number

  approvalBlocked: boolean
  blockingReasons: MappingProposalBlockingReason[]
  reviewCompleteWithoutHuman: boolean

  /** Write-completeness only; see `MappingProposalPersistenceStatus`. */
  persistenceStatus: MappingProposalPersistenceStatus

  createdAt: unknown
  updatedAt: unknown
}

/**
 * A candidate document, scoped under
 * `recipes/{recipeId}/mappingProposals/{proposalId}/candidates/{candidateId}`.
 * This is the full in-memory `MappingCandidateV1` (reviewer votes, evidence,
 * routing, review status, final decision, provenance) plus the small amount
 * of persistence-only bookkeeping needed to materialize the *current*
 * effective decision for cheap reads without replaying the append-only
 * review-event history.
 */
export interface PersistedMappingCandidateV1 extends MappingCandidateV1 {
  /** The review event currently in effect for this candidate, or null if none has been recorded. */
  effectiveReviewEventId: string | null
  updatedAt: unknown
}

export interface PersistMappingProposalResult {
  proposalId: string
  outcome: 'CREATED' | 'REPLAYED_IDENTICAL'
  candidateCount: number
}

// ── Human review decisions (append-only) ─────────────────────────────────

/**
 * Reuses `MappingHumanReviewReason` from the architecture contract §14
 * verbatim (not yet defined as a TS type anywhere in the repo before this
 * file).
 */
export const MAPPING_HUMAN_REVIEW_REASON_ORDER = [
  'SOURCE_EXPLICIT_USE',
  'SOURCE_NO_ACTIVE_USE',
  'ALIAS_OR_REFERENCE',
  'COMPONENT_BOUNDARY',
  'LIFECYCLE_OR_REUSE',
  'QUANTITY_OR_PARTIAL_USE',
  'SERVING_OR_GARNISH',
  'OTHER',
] as const

export type MappingHumanReviewReason = (typeof MAPPING_HUMAN_REVIEW_REASON_ORDER)[number]

/**
 * Persisted equivalent of architecture-contract §14 `MappingReviewDecisionV1`.
 * Field names (`decisionId`, `supersedesDecisionId`) match the normative
 * contract exactly; `decidedAt` becomes a Firestore server timestamp instead
 * of an RFC 3339 string, and `recipeId` is denormalized onto the document so
 * an exported/copied event never loses its recipe context.
 */
export interface PersistedMappingReviewDecisionV1 {
  schemaVersion: 1
  decisionId: string
  recipeId: string
  proposalId: string
  candidateId: string
  recipeRevision: string

  decision: 'ACCEPT' | 'REJECT'
  reasonCode: MappingHumanReviewReason
  note: string | null

  decidedBy: string
  decidedAt: unknown

  supersedesDecisionId: string | null
}

export interface AppendMappingReviewDecisionInput {
  recipeId: string
  proposalId: string
  candidateId: string
  recipeRevision: string
  decision: 'ACCEPT' | 'REJECT'
  reasonCode: MappingHumanReviewReason
  note?: string | null
  /** Verified server identity of the acting admin. Never a client-supplied field. */
  decidedBy: string
  supersedesDecisionId?: string | null
}

export interface ProposalCompletionResult {
  complete: boolean
  totalCandidates: number
  resolvedCandidates: number
  unresolvedCandidateIds: string[]
  /** True only when at least one candidate's final decision came from a human review event. */
  requiresCompletenessAttestation: boolean
}

// ── Approved map ──────────────────────────────────────────────────────────

/**
 * Reuses `ApprovedIngredientStepRelationshipV1` from architecture-contract
 * §15 verbatim.
 */
export interface ApprovedIngredientStepRelationshipV1 {
  candidateId: string
  ingredientRowIndex: number
  stepIndex: number
  decisionSource: 'AUTO' | 'HUMAN'
  decisionId: string | null
}

/**
 * Diagnostic-only provenance retained alongside the approved map for audit
 * traceability (architecture-contract §19). Deliberately excluded from the
 * map's canonical content hash (`computeApprovedMapHash`) because it is not
 * identity-relevant: reviewer run/attempt identifiers differ across retries
 * of the same logical proposal without changing the accepted relationship
 * set, and including them would make the hash unstable for the exact
 * "same approved semantic map + same recipe revision/proposal" case the
 * contract requires to be stable (Implementation 3 task, Phase 7).
 */
export interface ApprovedMapProvenanceV1 {
  reviewerARunId: string
  reviewerBRunId: string
  reviewerAOutputHash: string | null
  reviewerBOutputHash: string | null
  autoAcceptCandidateCount: number
  humanDecidedCandidateCount: number
}

/**
 * Persisted equivalent of architecture-contract §15 `ApprovedCookingStepMapV1`.
 * `createdAt`/`approvedAt` become Firestore server timestamps; `provenance`
 * is an additive, non-identity field (see `ApprovedMapProvenanceV1`).
 */
export interface PersistedApprovedCookingStepMapV1 {
  schemaVersion: 1
  mapId: string
  mapVersion: string
  recipeId: string
  recipeRevision: string
  parserVersion: string
  mappingSourceHash: string

  proposalId: string
  reviewerContractVersion: string
  evidenceContractVersion: string
  routingContractVersion: string

  status: 'APPROVED'
  approvalMode: 'AUTO' | 'HUMAN_ASSISTED'
  relationships: ApprovedIngredientStepRelationshipV1[]
  /** Always empty in V1 — prepared components are deferred (architecture-contract §21). */
  preparedComponents: never[]

  approvedBy: string
  /** Non-null only for a HUMAN_ASSISTED map; null for an (as-yet unauthorized) AUTO map. */
  completenessAttestedAt: string | null

  mapHash: string
  provenance: ApprovedMapProvenanceV1

  createdAt: unknown
  approvedAt: unknown
}

export interface BuildApprovedMappingInput {
  recipeId: string
  recipeRevision: string
  parserVersion: string
  mappingSourceHash: string
  proposalId: string
  reviewerContractVersion: string
  evidenceContractVersion: string
  routingContractVersion: string
  candidates: readonly PersistedMappingCandidateV1[]
  /** Snapshot of the proposal's own blocking reasons at generation time (reviewer/evidence/source-identity failures only — candidate-level review completeness is re-derived live from `candidates`). */
  proposalBlockingReasons: readonly MappingProposalBlockingReason[]
  approvedBy: string
  /** RFC 3339 UTC string. Required in V1 — see completenessAttestedAt doc above. */
  completenessAttestedAt: string
  provenance: ApprovedMapProvenanceV1
}

export type BuildApprovedMappingFailureReason =
  | 'UNRESOLVED_CANDIDATE'
  | 'STRUCTURAL_BLOCKER'
  | 'PROPOSAL_BLOCKED'
  | 'REVISION_MISMATCH'

export type BuildApprovedMappingOutcome =
  | { ok: true; map: PersistedApprovedCookingStepMapV1 }
  | { ok: false; reason: BuildApprovedMappingFailureReason; unresolvedCandidateIds: string[] }

export interface PersistApprovedMappingResult {
  mapId: string
  outcome: 'CREATED' | 'REPLAYED_IDENTICAL'
}

// ── Current-approved pointer ──────────────────────────────────────────────

export interface CurrentApprovedMappingPointerV1 {
  schemaVersion: 1
  recipeId: string
  recipeRevision: string
  mapId: string
  mapHash: string
  updatedAt: unknown
}

export type MappingPointerReadStatus = 'CURRENT' | 'STALE' | 'NOT_FOUND'

export interface ReadCurrentApprovedMappingPointerResult {
  status: MappingPointerReadStatus
  pointer: CurrentApprovedMappingPointerV1 | null
  /** The recipe revision the caller asked to validate against. */
  currentRecipeRevision: string
}
