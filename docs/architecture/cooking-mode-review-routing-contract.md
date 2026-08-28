# Cooking Mode Review-Routing Contract

Status: **NORMATIVE DESIGN CONTRACT**

Contract version: `cooking-review-routing-v1`

Evidence version: `cooking-routing-evidence-v1`

Candidate schema version: `1`

Approved-map schema version: `1`

Decision date: 2026-08-28

## 1. Scope and invariants

This contract governs ingredient-row-to-instruction-step proposals created when an exact recipe source is finalized. It does not implement routing, change Cooking Mode, write Firestore, migrate maps, or authorize production activation.

The architecture is fixed:

```text
exact finalized recipe source
  -> blind reviewer A + blind reviewer B
  -> normalized reviewer union
  -> deterministic evidence and risk routing
  -> AUTO_ACCEPT | REVIEW_REQUIRED | AUTO_REJECT
  -> candidate-level human decisions where required
  -> map-level approval
  -> immutable, source-bound approved map
  -> Cooking Mode read with zero AI calls
```

The AI union owns semantic discovery. Deterministic code may expose source facts, identify risk, prioritize review, and recognize a separately frozen safe-accept class. It must not create a parallel semantic candidate set or use absence of deterministic support as evidence that a relationship is false.

Prepared components are excluded from this version and require a separate candidate schema, routing contract, benchmark, and release gate.

## 2. Normative terminology

- **Mapping source**: the exact ordered ingredient and instruction arrays emitted by the supported recipe parser.
- **Recipe revision**: the parser version plus SHA-256 identity of the mapping source.
- **Reviewer union**: every valid ingredient-step relationship accepted by at least one complete blind reviewer result.
- **Candidate**: one normalized reviewer-union relationship for one recipe revision.
- **Risk flag**: one finite, source-observable V1 condition that forces review. A risk flag is not a semantic rejection.
- **Evidence tag**: finite diagnostic or prioritization metadata with no routing authority unless this contract explicitly grants it.
- **Proposal**: the complete, attempt-bound reviewer outputs, candidates, evidence, routes, and review decisions for one recipe revision.
- **Approved map**: the immutable runtime artifact built only after proposal resolution and map-level approval.

Normative keywords **MUST**, **MUST NOT**, **SHOULD**, and **MAY** carry their RFC 2119 meanings.

## 3. Recipe revision and source identity

V1 reuses the existing repository canonicalization:

```ts
mappingSourceJson = JSON.stringify({ ingredients, instructions })
mappingSourceHash = lowercaseHex(SHA256(UTF8(mappingSourceJson)))
recipeRevision = `${parserVersion}:sha256:${mappingSourceHash}`
```

`ingredients` and `instructions` are the exact parsed strings in exact array order. Ingredient group/header rows remain in the ingredient array because the current mapping source and indexes include them. JSON property order is exactly `ingredients`, then `instructions`.

A revision changes when any of the following changes:

- parsed ingredient text, row count, row order, or group/header structure;
- parsed instruction text, step count, or step order;
- `parserVersion`, even if the emitted arrays happen to be byte-identical.

A revision does not change for metadata that does not affect the parsed arrays: title, image, category, cuisine, labels, source URL, prep/cook time, nutrition, ratings, notes, servings, or meal-plan role. A raw `content` edit that produces byte-identical parsed arrays under the same parser version also does not change the revision.

The current implementation locations are `canonicalizeCookingMappingSource` and `computeCookingMappingSourceHash` in `lib/cookingStepMapping.ts`; the parser is `parseRecipeContent` in `lib/recipeContent.ts`.

## 4. Candidate identity

The V1 candidate identifier is:

```ts
identityTuple = JSON.stringify([
  'mapping-candidate',
  1,
  recipeId,
  recipeRevision,
  ingredientRowIndex,
  stepIndex,
])

candidateId = `mc1:${lowercaseHex(SHA256(UTF8(identityTuple)))}`
```

The identifier includes neither reviewer explanation, confidence, prompt wording, model output, timestamps, nor deterministic evidence. It is stable across retries for the same recipe revision and relationship. A changed revision produces a different identifier even if the row and step indexes remain the same.

On insert/read, the stored identity fields MUST be recomputed and compared with `candidateId`. If two different identity tuples ever produce the same digest, processing MUST fail closed with `CANDIDATE_ID_COLLISION`; neither record may be approved. Duplicate proposals of the same identity are normalized into one candidate with two reviewer votes. Exact duplicate relationships inside one otherwise valid reviewer output are normalized before hashing and never create another candidate; conflicting or structurally invalid entries invalidate that reviewer attempt.

## 5. Canonical candidate contract

```ts
interface MappingCandidateV1 {
  schemaVersion: 1
  candidateType: 'INGREDIENT_STEP_RELATIONSHIP'
  candidateId: string

  proposalId: string
  recipeId: string
  recipeRevision: string
  parserVersion: string
  mappingSourceHash: string

  ingredientRowIndex: number
  ingredientText: string
  ingredientGroup: string | null
  stepIndex: number
  stepText: string

  reviewerA: ReviewerVoteV1
  reviewerB: ReviewerVoteV1

  deterministicEvidence: DeterministicEvidenceV1
  routingDecision: MappingRoutingDecision
  routingReasons: MappingRoutingReason[]

  reviewStatus: MappingReviewStatus
  finalDecision: MappingFinalDecision | null
  decisionSource: 'AUTO' | 'HUMAN' | null

  provenance: MappingCandidateProvenanceV1
  createdAt: string
}
```

Field rules:

- Indexes are zero-based integers and refer to the exact revision snapshot.
- `ingredientText` and `stepText` are immutable source snapshots used for review/audit; they MUST match the indexed mapping source.
- `ingredientGroup` is the parser-observed group label or `null`; it is evidence, not identity.
- Arrays use canonical enum order, contain no duplicates, and are not open-ended string bags.
- `createdAt` and all other timestamps are server-recorded RFC 3339 UTC strings. Client clocks have no authority.
- `finalDecision` is `ACCEPT` for `AUTO_ACCEPT`, `REJECT` for a structurally valid materialized `AUTO_REJECT`, the human decision after review, or `null` while unresolved.

```ts
type MappingRoutingDecision =
  | 'AUTO_ACCEPT'
  | 'REVIEW_REQUIRED'
  | 'AUTO_REJECT'

type MappingReviewStatus =
  | 'NOT_REQUIRED'
  | 'PENDING'
  | 'DECIDED'
  | 'BLOCKED'

type MappingFinalDecision = 'ACCEPT' | 'REJECT'
```

## 6. Reviewer contract

Reviewer A and reviewer B MUST:

- receive the same exact recipe revision and the same versioned reviewer contract;
- be blind to each other, all current/proposed/persisted mappings, deterministic candidate output, and adjudicated truth;
- execute independently, with distinct run and attempt identifiers;
- return a complete whole-recipe result under the same schema;
- never be replaced by a deterministic candidate generator or a third semantic judge.

Exactly two successful semantic reviewer results are required. Bounded retry of a transport/schema failure MAY repeat the failed reviewer slot. It does not create a third vote.

```ts
type ReviewerVoteValue = 'ACCEPT' | 'REJECT' | 'UNPARSEABLE' | 'MISSING'
type ReviewerParseStatus = 'VALID' | 'INVALID' | 'NO_RESULT'

interface ReviewerVoteV1 {
  reviewerSlot: 'A' | 'B'
  vote: ReviewerVoteValue
  reviewerContractVersion: string
  promptVersion: string
  modelId: string
  runId: string
  attemptId: string
  completedAt: string | null
  parseStatus: ReviewerParseStatus
  normalizedOutputHash: string | null
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | null
  sourceEvidence: string | null
}
```

Vote normalization:

- `ACCEPT`: a valid, complete reviewer output proposes this exact row-step relationship.
- `REJECT`: the reviewer output is valid and complete but omits this relationship.
- `UNPARSEABLE`: a response exists but fails schema, coverage, duplicate, index, or source validation. It has no semantic authority.
- `MISSING`: no usable result exists because of timeout, unavailable provider, exhausted retry, or absent execution. It has no semantic authority.

Confidence and `sourceEvidence` are evidence-only. They never override vote counts, risk flags, or routing precedence. `sourceEvidence` is a bounded source quote/summary, not chain-of-thought. Provider conversation/message formats are diagnostic transport data and MUST NOT become canonical domain data.

A valid whole-recipe output that omits a union candidate becomes `REJECT`; absence is not `MISSING`. Any whole-output parse/coverage failure marks that reviewer slot `UNPARSEABLE` for the attempt and prevents map approval.

Canonical state retains normalized outputs and their SHA-256 hashes. Raw provider output is diagnostic-only: encrypt/restrict it, retain it for 30 days or until the associated audit incident closes (whichever is later), then delete it. Do not retain hidden reasoning or unbounded model explanations.

### 6.1 Implemented reviewer transport contract

The in-memory execution implementation uses reviewer contract `cooking-mapping-reviewer-v1` and prompt `cooking-mapping-reviewer-prompt-v1`. Both blind slots receive byte-identical system/prompt source content and schema; the slot appears only in execution feature/provenance metadata. The central `lib/ai.ts` `generateAIObject` helper executes the currently configured Gateway model from `lib/aiConfig.ts` (`openai/gpt-5.6-luna` at implementation time). No reviewer output is ever supplied to the other slot.

The structured response is flat and bounded:

```ts
interface MappingReviewerResponseV1 {
  reviewerContractVersion: 'cooking-mapping-reviewer-v1'
  promptVersion: 'cooking-mapping-reviewer-prompt-v1'
  recipeRevision: string
  coverage: {
    ingredientRowCount: number
    nonHeaderIngredientRowCount: number
    stepCount: number
    reviewedCellCount: number
  }
  acceptedRelationships: Array<{
    ingredientRowIndex: number
    stepIndex: number
  }>
}
```

`reviewedCellCount` MUST equal `nonHeaderIngredientRowCount * stepCount`, and every coverage count, contract version, prompt version, and recipe revision MUST exactly match the immutable request. Only then may an omitted cell normalize to `REJECT`. Invalid JSON/schema, missing or mismatched coverage, stale revision, header indexes, or out-of-range indexes make the attempt `UNPARSEABLE`; any structurally invalid returned relationship may be retained only as a bounded diagnostic `AUTO_REJECT` candidate while the entire proposal remains blocked. Exact duplicate accepted relationships are deduplicated and sorted by `(ingredientRowIndex, stepIndex)` before hashing. Successful output hashes cover that normalized fixed-key-order response. When the AI SDK exposes invalid generated text on schema failure, only its SHA-256 may be retained by this slice; the raw text is not stored.

## 7. Deterministic evidence contract

```ts
type DeterministicEvidenceStatus = 'COMPLETE' | 'UNAVAILABLE' | 'INVALID'

type MappingPositiveEvidence =
  | 'DIRECT_EXPLICIT_USE'
  | 'DIRECT_ALIAS_SUPPORT'
  | 'ROW_SCOPED_QUANTITY_MATCH'
  | 'DETERMINISTIC_V5_SUPPORT'
  | 'V10G_ACTIVE_OBJECT_RESCUE_SUPPORT'

type MappingRiskEvidence =
  | 'COMPONENT_CONTAINMENT_RISK'
  | 'LIFECYCLE_RISK'
  | 'CONTEXT_ONLY_RISK'
  | 'PROCESS_MATERIAL_RISK'
  | 'DUPLICATE_ROW_RISK'
  | 'GROUP_CONFLICT_RISK'
  | 'QUANTITY_CONFLICT_RISK'
  | 'COLLECTIVE_REFERENCE_RISK'
  | 'PARTIAL_IDENTITY_MATCH_RISK'

type MappingEvidenceTag =
  | 'GENERIC_SEASONING'
  | 'PASSIVE_COMPONENT_CARRY'
  | 'ISOLATED_SUBCOMPONENT'
  | 'AMBIGUOUS_REFERENCE'
  | 'TRANSFER_OR_ASSEMBLY'
  | 'SERVING_OR_GARNISH'
  | 'PREPARED_COMPONENT_RELATED'
  | 'V10G_FRONTIER_ACCEPT'
  | 'V10G_FRONTIER_REJECT'

interface DeterministicEvidenceV1 {
  contractVersion: 'cooking-routing-evidence-v1'
  extractorFingerprint: string
  status: DeterministicEvidenceStatus
  positive: MappingPositiveEvidence[]
  risks: MappingRiskEvidence[]
  tags: MappingEvidenceTag[]
  observations: {
    explicitlyNamed: boolean
    ingredientGroup: string | null
    duplicateSiblingIndexes: number[]
    priorMentionStepIndexes: number[]
    laterMentionStepIndexes: number[]
    priorReviewerUseStepIndexes: number[]
    listedQuantity: string | null
    currentStepQuantity: string | null
    componentLabels: string[]
    componentEstablishedAtStep: number | null
    remainingLanguage: boolean
  }
}
```

V1 risk meanings and authority:

| Risk | Source-observable condition | V1 authority |
|---|---|---|
| `COMPONENT_CONTAINMENT_RISK` | Current step refers to a component while this not-explicitly-named row may be a constituent from a prior use/group/collective | Forces review; never rejects |
| `LIFECYCLE_RISK` | Row has a prior reviewer use, lacks remaining/reserved language, and current evidence may be continuation/component/context rather than a fresh direct use | Forces review; never rejects |
| `CONTEXT_ONLY_RISK` | Step has audited contextual language such as adjust seasoning, serve with, set aside, refrigerate, assemble, or “everything,” without sufficient row-specific action | Forces review; never rejects |
| `PROCESS_MATERIAL_RISK` | Ingredient resembles water, ice, skewer, foil, parchment, or process oil and is not explicit in the step | Forces review; may support only structural/source error rejection, never semantic rejection |
| `DUPLICATE_ROW_RISK` | Another non-header ingredient row has substantially overlapping identity tokens | Forces review; never rejects |
| `GROUP_CONFLICT_RISK` | Candidate belongs to one source group while the step explicitly names another group | Forces review; never rejects |
| `QUANTITY_CONFLICT_RISK` | Row and step carry different row-scoped quantities while the row is explicit | Forces review; never rejects |
| `COLLECTIVE_REFERENCE_RISK` | Step uses “all/rest of the ingredients,” “everything,” or equivalent without naming the row | Forces review; never rejects |
| `PARTIAL_IDENTITY_MATCH_RISK` | Only a generic subset such as “oil” or a component noun matches a multi-token ingredient identity | Forces review; never rejects |

The exact measured V1 extractor is the truth-blind source-risk implementation in `scripts/analyze-cooking-mode-v10b-ingredient-precision-core.mjs`, SHA-256 `423b0934c1e7f2f6ba3a224b43e0c9343ce58508d50ee549c97861f40abeacad`. A production implementation must port and freeze equivalent behavior under a new implementation fingerprint; it must not silently change the measured class.

Positive evidence and tags have no independent V1 auto-accept or auto-reject authority. In particular, `DETERMINISTIC_V5_SUPPORT` cannot create a candidate, and `V10G_ACTIVE_OBJECT_RESCUE_SUPPORT` is review-priority evidence only in V1. Absence of positive evidence is never a rejection reason.

## 8. Routing reasons

```ts
type MappingRoutingReason =
  | 'AUTO_ACCEPT_BOTH_REVIEWERS_NO_V1_RISK'
  | 'REVIEWER_DISAGREEMENT'
  | 'REVIEWER_RESULT_INCOMPLETE'
  | 'DETERMINISTIC_EVIDENCE_UNAVAILABLE'
  | 'DETERMINISTIC_RISK_PRESENT'
  | 'BOTH_REJECT_WITH_POSITIVE_EVIDENCE'
  | 'UNSUPPORTED_RELATIONSHIP_CLASS'
  | 'INVALID_RECIPE_REVISION'
  | 'INVALID_INGREDIENT_INDEX'
  | 'INGREDIENT_HEADER_INDEX'
  | 'INVALID_STEP_INDEX'
  | 'SOURCE_SNAPSHOT_MISMATCH'
  | 'DUPLICATE_CANDIDATE_IDENTITY'
  | 'CANDIDATE_ID_COLLISION'
```

Every route stores at least one reason. Risk details remain in `deterministicEvidence.risks`; `DETERMINISTIC_RISK_PRESENT` is the stable routing reason.

## 9. Exactly three routing states

### `AUTO_ACCEPT`

The candidate becomes `finalDecision: ACCEPT`, `decisionSource: AUTO`, and `reviewStatus: NOT_REQUIRED` only when all conditions are true:

1. candidate schema, identity, recipe revision, source snapshots, indexes, and non-header row are valid;
2. reviewer A and reviewer B are complete, valid, same-contract results and both votes are `ACCEPT`;
3. deterministic evidence status is `COMPLETE` under the exact supported V1 contract/fingerprint;
4. `deterministicEvidence.risks` is empty; and
5. the relationship class is `INGREDIENT_STEP_RELATIONSHIP`.

This is the frozen class `AUTO_ACCEPT_BOTH_REVIEWERS_NO_V1_RISK`, not generic reviewer agreement. On the 861-candidate benchmark it contains 382 TP, 0 FP, and observed precision 100%.

### `REVIEW_REQUIRED`

The candidate has plausible semantic support but cannot safely be automatically resolved. It gets `finalDecision: null`, `decisionSource: null`, and normally `reviewStatus: PENDING`.

Review is mandatory for any reviewer disagreement, any V1 risk, evidence unavailable/invalid, unsupported relationship class, both reviewers rejecting despite separately recorded positive evidence, or any `UNPARSEABLE`/`MISSING` vote. A missing/unparseable reviewer also blocks the entire proposal from approval until a successful replacement result exists; human candidate review does not waive the two-reviewer execution contract.

### `AUTO_REJECT`

V1 permits `AUTO_REJECT` only for positive structural invalidity: invalid/mismatched revision, invalid/header ingredient index, invalid step index, source snapshot mismatch, duplicate materialized identity, or verified candidate-ID collision. The record becomes `finalDecision: REJECT`, `decisionSource: AUTO`, and `reviewStatus: NOT_REQUIRED` for audit.

No semantically plausible reviewer-union candidate is auto-rejected. Reviewer rejection, lack of deterministic support, low confidence, component/lifecycle ambiguity, or V10G rejection is insufficient. The frozen benchmark contains no structural-invalid candidate, so all evaluated policies have zero `AUTO_REJECT` rows; the semantic safety of broad rejection is not inferred from a zero count.

Malformed whole-reviewer output is a reviewer-attempt failure, not evidence that its proposed relationships are false. It therefore blocks/retries the reviewer slot instead of auto-rejecting semantic candidates.

## 10. Routing precedence and complete decision table

Precedence is strict:

```text
verified structural invalidity
  -> AUTO_REJECT

otherwise incomplete/invalid reviewer pair or evidence evaluation
  -> REVIEW_REQUIRED and proposal BLOCKED

otherwise any V1 risk or unsupported semantic class
  -> REVIEW_REQUIRED

otherwise both valid reviewers ACCEPT
  -> AUTO_ACCEPT

otherwise
  -> REVIEW_REQUIRED
```

| Inputs | Result | Notes |
|---|---|---|
| Any verified structural invalidity | `AUTO_REJECT` | Highest precedence; semantic truth is not evaluated |
| Both accept + any risk | `REVIEW_REQUIRED` | Risk wins; agreement never overrides risk |
| Both accept + complete V1 evidence + no risk | `AUTO_ACCEPT` | The only V1 semantic auto-accept class |
| A accepts, B rejects; or A rejects, B accepts | `REVIEW_REQUIRED` | Deterministic positive evidence changes priority/context only |
| One accepts + strong deterministic support | `REVIEW_REQUIRED` | Single-reviewer candidates are not auto-accepted in V1 |
| Both reject + strong deterministic positive evidence | `REVIEW_REQUIRED` if materialized | Normal reviewer-union generation creates no such candidate; deterministic evidence cannot discover one silently |
| Both reject + no positive evidence | No union candidate | Counted as a completeness diagnostic, not an auto-rejected candidate |
| Any reviewer `UNPARSEABLE` or `MISSING` | `REVIEW_REQUIRED`, proposal `BLOCKED` | Retry failed slot; map approval forbidden |
| Deterministic evidence `UNAVAILABLE`/`INVALID` | `REVIEW_REQUIRED`, proposal `BLOCKED` | Never assume “no risks” |
| Both reject/accept combinations with prepared-component relation | `REVIEW_REQUIRED`, unsupported class | Prepared components are deferred from V1 |

No input combination falls through to implicit approval or semantic rejection.

## 11. Selected policy and measured performance

The selected initial policy is **reviewer agreement plus complete V1 no-risk evidence**.

The benchmark is the 36-recipe frozen reviewer-union population: 861 candidates, 833 correct, and 28 incorrect. Structural invalidity is absent, so `AUTO_REJECT` is zero for every policy.

| Policy | Auto accept TP / FP | Precision | Review correct / incorrect | Auto share | Review share | Recipes with review | Avg items/affected recipe |
|---|---:|---:|---:|---:|---:|---:|---:|
| Agreement only (unsafe) | 763 / 9 | 98.83% | 70 / 19 | 89.66% | 10.34% | 18/36 | 4.94 |
| **Agreement + no V1 risk (selected)** | **382 / 0** | **100%** | **451 / 28** | **44.37%** | **55.63%** | **34/36** | **14.09** |
| Any reviewer + no V1 risk (not selected) | 386 / 0 | 100% | 447 / 28 | 44.83% | 55.17% | 34/36 | 13.97 |
| Recorded V10G combined frontier (experimental only) | 773 / 0 | 100% | 60 / 28 | 89.78% | 10.22% | 21/36 | 4.19 |

The broader no-risk policy gains only four candidates by auto-accepting single-reviewer proposals. V1 declines that small coverage gain to preserve reviewer-agreement as a required positive signal. The V10G frontier is not selected because its 642-candidate baseline included bounded AI arbiter decisions; it is not a standalone deterministic routing class.

The selected review-burden target for initial implementation is therefore the measured frozen envelope: approximately 44% candidate auto-accept, 56% candidate review, 34/36 recipes with review, and 14.09 items per affected recipe. This is intentionally conservative. The earlier projection of roughly two review items per recipe is not an activation target until a standalone zero-FP frontier is measured.

## 12. Reviewer agreement analysis

The 36 recipes contain 3,802 possible non-header ingredient-step cells and 868 adjudicated positive relationships.

| Vote bucket | Correct | Incorrect | Total | Positive precision / correct-rejection rate | Share of union candidates |
|---|---:|---:|---:|---:|---:|
| Both accept | 763 | 9 | 772 | 98.83% | 89.66% |
| A only accepts | 17 | 11 | 28 | 60.71% | 3.25% |
| B only accepts | 53 | 8 | 61 | 86.89% | 7.08% |
| Both reject | 35 positive relationships missed | 2,906 negative cells correctly omitted | 2,941 | 98.81% correct rejection | not a union-candidate bucket |

Both-reject occupies 77.35% of all possible cells, not the union population. Its 35 missed positives are 4.03% of the 868 truth relationships. Agreement is valuable routing evidence but demonstrably not truth.

## 13. V10G support role

V10G has two retained evidence roles in V1:

- `V10G_ACTIVE_OBJECT_RESCUE_SUPPORT`: **review-priority signal**. The standalone rescue-positive subset contains 131/131 correct and 0 incorrect candidates in frozen evidence, but it failed its precommitted pronoun/deictic class gate and is not permitted to override a V1 risk flag.
- `V10G_FRONTIER_ACCEPT` / `V10G_FRONTIER_REJECT`: diagnostic evaluation tags only. They have no production routing authority because the combined frontier includes V10D AI-arbiter decisions.

Measured combinations:

| Combination | Correct | Incorrect | Observed precision |
|---|---:|---:|---:|
| Reviewer-union candidate + recorded V10G accept | 773 | 0 | 100% |
| Reviewer disagreement + recorded V10G accept | 62 | 0 | 100% |
| Both reviewers accept + recorded V10G accept | 711 | 0 | 100% |
| Both reviewers accept + recorded V10G reject | 52 | 9 | 85.25% positive share |
| Reviewer disagreement + recorded V10G reject | 8 | 19 | 29.63% positive share |

V10G rejection is not safe auto-reject evidence: it would discard correct candidates. A future contract version may promote the standalone rescue signal to `SAFE_ACCEPT_SIGNAL` only after an independently frozen candidate-union policy test preserves zero observed FP and all class gates. V1 does not.

## 14. Human review contract

Human decisions are candidate-level append-only events. Map approval is a separate map-level act.

```ts
type MappingHumanReviewReason =
  | 'SOURCE_EXPLICIT_USE'
  | 'SOURCE_NO_ACTIVE_USE'
  | 'ALIAS_OR_REFERENCE'
  | 'COMPONENT_BOUNDARY'
  | 'LIFECYCLE_OR_REUSE'
  | 'QUANTITY_OR_PARTIAL_USE'
  | 'SERVING_OR_GARNISH'
  | 'OTHER'

interface MappingReviewDecisionV1 {
  schemaVersion: 1
  decisionId: string
  candidateId: string
  proposalId: string
  recipeRevision: string
  decision: 'ACCEPT' | 'REJECT'
  reasonCode: MappingHumanReviewReason
  note: string | null
  decidedAt: string
  decidedBy: string
  supersedesDecisionId: string | null
}
```

`decidedBy` stores the authenticated stable user/admin identifier; display names are noncanonical. `reasonCode` is required. `note` is optional except when `reasonCode` is `OTHER`, when a nonempty bounded note is required.

Decisions never mutate. A correction appends a new event referencing `supersedesDecisionId`; the latest valid, same-revision, non-superseded event is effective. Revision mismatches are rejected. A bulk action MAY submit multiple explicit candidate decisions atomically, but it must create one event per candidate and cannot approve unseen candidates or provide a map-wide wildcard decision.

The reviewer must see: recipe title/ID/revision; ingredient row with group and neighboring rows; current step with neighboring steps; both normalized votes and source evidence; finite positive/risk evidence; row-scoped quantity, prior/later mentions and prior uses; component labels/establishment; routing reason; and prior decision history. Hidden model reasoning, benchmark truth, and provider-specific payloads are not review UI inputs.

## 15. Proposal and approved-map lifecycle

Proposal status is separate from approved-map status:

```ts
type MappingProposalStatus =
  | 'COLLECTING_REVIEWERS'
  | 'ROUTING'
  | 'REVIEW_REQUIRED'
  | 'READY_FOR_APPROVAL'
  | 'APPROVED'
  | 'FAILED'
```

`FAILED` means the attempt cannot progress without a retry/new attempt; it never means an empty or partial map is approved. `STALE` is not written onto an immutable approved artifact. Staleness is derived when its `recipeRevision` no longer equals the current recipe revision.

```ts
interface ApprovedCookingStepMapV1 {
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
  routingContractVersion: 'cooking-review-routing-v1'

  status: 'APPROVED'
  approvalMode: 'AUTO' | 'HUMAN_ASSISTED'
  relationships: ApprovedIngredientStepRelationshipV1[]
  preparedComponents: []

  createdAt: string
  approvedAt: string
  approvedBy: string
  completenessAttestedAt: string | null
  mapHash: string
}

interface ApprovedIngredientStepRelationshipV1 {
  candidateId: string
  ingredientRowIndex: number
  stepIndex: number
  decisionSource: 'AUTO' | 'HUMAN'
  decisionId: string | null
}
```

`relationships` are sorted by `(stepIndex, ingredientRowIndex, candidateId)`. `mapHash` is SHA-256 of a fixed-key-order JSON serialization of every field except `mapHash`. `mapId` is `am1:` plus that digest; `mapVersion` is the routing contract version plus the first 16 digest bytes and is an opaque version identifier, not a mutable counter.

A map becomes `APPROVED` only when:

1. both complete reviewer outputs belong to the exact revision and contract;
2. normalization and deterministic evidence are complete;
3. every structurally valid union candidate has an effective final `ACCEPT` or `REJECT` decision;
4. every `REVIEW_REQUIRED` candidate has an effective human decision;
5. no candidate, reviewer, evidence, or persistence failure remains blocked;
6. the source is reread and still matches `recipeRevision` immediately before approval;
7. a human-assisted proposal receives a map-level completeness attestation against the whole source; and
8. the sorted artifact and its hash are persisted successfully and read back exactly.

An auto-only proposal may omit human completeness attestation only after the complete implementation passes the separately required union-recall and severity release gates. The current frozen union is 833/868 (95.97%) and therefore does not itself authorize production activation. Candidate precision and discovery completeness remain separate gates.

Approved maps are immutable. Corrections, reruns, reviewer contract changes, routing contract changes, or mapping-source changes create a new proposal and a new approved map. Prior maps and review events remain historical evidence. No approved map changes in place.

## 16. Ingestion, retries, and idempotency

The ingestion key is the SHA-256 of the fixed tuple:

```text
['mapping-proposal', 1, recipeId, recipeRevision,
 reviewerContractVersion, evidenceContractVersion, routingContractVersion]
```

The implemented logical identifier is `proposalId = "mp1:" + lowercaseHex(SHA256(UTF8(JSON.stringify(tuple))))`. It excludes timestamps, model run IDs, attempt IDs, output hashes, candidate order, and reviewer content. The same source revision plus the same reviewer/evidence/routing contract versions therefore yields the same logical proposal identity across retries.

New recipe flow:

1. finalize exact content and canonical parse;
2. compute revision and create/get the idempotent proposal;
3. execute reviewer A and B independently;
4. validate both complete results and normalize their union;
5. compute V1 evidence once for every candidate;
6. route candidates under the exact contract;
7. if review is needed, await candidate decisions and map-level completeness attestation;
8. otherwise proceed only if the auto-approval release gate is enabled;
9. build, persist, and exact-readback the immutable approved map;
10. update an active-map pointer/materialized runtime copy only after approved persistence succeeds.

Retry rules:

- Same ingestion key returns the existing proposal and does not duplicate candidates, reviews, or maps.
- Retry only the failed reviewer slot under a new `attemptId`; retain all attempts.
- A complete but semantically different successful rerun is a new proposal attempt, not an invisible replacement and not a source for cherry-picking relations.
- Candidate IDs deduplicate the same relationship within an attempt. Review item identity is `(proposalId, candidateId)`. Approved `mapId` deduplicates exact approved content.
- If an approved map already exists for the exact proposal/hash, return it after exact validation; do not write another copy.

Reviewer failure behavior:

- one reviewer fails: proposal `FAILED`/blocked, successful slot retained, failed slot may retry;
- both fail: proposal `FAILED`, no candidates approved;
- parse/schema/coverage failure: affected slot `UNPARSEABLE`, proposal blocked;
- timeout/unavailability: affected slot `MISSING`, proposal blocked;
- no path silently degrades from two reviewers to one.

The in-memory execution helper uses at most two attempts per slot and sets the AI SDK call's internal `maxRetries` to zero, so every model execution attempt has visible orchestration provenance. AI execution failure, timeout, provider schema failure, local parse failure, and missing/mismatched coverage are retryable. A complete valid empty relationship array is a semantic result and is not retried. Each retry receives a new `runId` and `attemptId`; attempts retain start/completion time, parse status, bounded failure code, and output hash when available. Inputs retain the existing cooking-mapping bounds: at most 200 ingredient rows, 150 instruction steps, and 4,000 characters per source line.

`executeBlindMappingReviewers` copies one immutable `MappingRevisionSource` snapshot and starts A and B concurrently from that snapshot. `generateMappingProposal` in `lib/cookingModeMappingOrchestrator.ts` owns the execution-to-build handoff and verifies that the caller-visible source still matches the snapshot afterward. `buildMappingProposal` in the separate AI-free module is the deterministic constructor: it deduplicates the union, computes `mc1` identities/source snapshots, derives the frozen nine-risk V1 evidence, validates structure, and calls the unchanged pure router. Its result includes routing summary counts, `approvalBlocked`, ordered blocking reasons, and `reviewCompleteWithoutHuman`. The latter means only that both reviewer results and all current candidates need no human candidate decision; it does not approve, persist, activate, or create a runtime map.

## 17. Recipe edits and runtime behavior

If mapping-relevant source changes, the prior approved map remains immutable historical evidence and becomes stale by comparison. A new proposal/review/map cycle is required.

While the new revision is unapproved, runtime MUST NOT use the old map because its source hash does not match. Under the future reviewed architecture it must disable per-step mapped highlighting/use an explicit approved-map-missing state rather than treat deterministic discovery or a stale map as canonical truth. The all-ingredients source remains available. Exact UI treatment requires the later DESIGN task.

The current production runtime remains unchanged by this contract: it validates persisted v4/v5 maps and otherwise uses its existing deterministic fallback. Changing that behavior is a later implementation and activation decision.

## 18. Failure-closed behavior

| Failure | Required behavior |
|---|---|
| Reviewer unavailable/timeout | Mark slot `MISSING`, proposal failed/blocked, bounded retry only |
| Reviewer schema/coverage invalid | Mark slot `UNPARSEABLE`, retain diagnostic hash, proposal blocked |
| Candidate normalization failure | Proposal `FAILED`; no partial routing or approval |
| Deterministic evidence failure | Candidate review-blocked and proposal `FAILED`; never interpret as no risks |
| Review data corrupted/revision-mismatched | Ignore as ineffective, block approval, preserve corrupt record for audit |
| Approved-map persistence/readback failure | Do not move active pointer or materialized runtime copy |
| Revision mismatch before approval | Abort attempt for current source; start/get new revision proposal |
| Unsupported schema/contract at runtime | Reject map as a whole; no partial consumption |

Pipeline failure always means **not approved**. It never produces an incomplete successful map.

## 19. Provenance and persistence boundary

Every accepted relationship remains traceable to recipe revision, source indexes/text, reviewer contract/prompt/model/run/attempt/output hashes, both votes, deterministic evidence and fingerprint, route/reasons, human decision history if any, proposal, approved map, approver, and timestamps.

Canonical persisted state:

- proposal header, exact revision and contract versions;
- normalized reviewer run metadata and output hashes;
- candidates, evidence, routes, and effective final decisions;
- append-only human decision events;
- immutable approved map, hash, approval identity/time, and active-map pointer/materialized runtime value.

Diagnostic-only state:

- raw provider envelopes/responses;
- transport retries and latency/token/cost telemetry;
- experimental V10D/V10G tags and benchmark truth;
- unbounded debug logs and model explanations.

Do not persist benchmark adjudicated truth in production candidate records. Raw provider output follows the 30-day/audit-closure retention rule in Section 6. Aggregate evaluation metrics may be retained indefinitely because they contain no raw model reasoning.

## 20. Firestore/persistence concept (not deployed)

The current map is embedded on `recipes/{id}.cookingStepIngredientMap`, and `docToRecipe` explicitly whitelists it. That shape is compact for runtime but cannot by itself represent append-only review events, multiple immutable source revisions, or reviewer/evidence provenance.

The future logical model needs four record classes:

1. `MappingProposal` header plus reviewer runs;
2. `MappingCandidate` records scoped to the proposal;
3. append-only `MappingReviewDecision` events;
4. immutable `ApprovedCookingStepMap` plus a small active pointer/materialized runtime copy.

A likely physical comparison for the infrastructure prompt is:

- separate admin-owned shared collections/subcollections for proposals, candidates, decisions, and approved maps; versus
- an embedded approved runtime copy on `recipes/{id}` with the canonical audit records stored separately.

Recommendation: keep immutable audit/proposal records separate and materialize only the approved runtime map/pointer onto the recipe boundary after exact readback. Do not select final paths in this contract. Exact paths require document-size analysis, admin ownership, rules review, emulator tests, and manual console-managed changes for the shared `malignant-metro` project. No Firestore rules file or deploy command is authorized.

## 21. Prepared-component boundary

Prepared components are deferred entirely from V1. The frozen exact-canonical component arbiter accepted 66/75 correct and 97/121 incorrect candidates (40.49% precision). Component label identity, establishment, constituent membership, later reuse, and semantic equivalence require a separate versioned candidate/review contract and quality gate.

`preparedComponents` is therefore the literal empty array in `ApprovedCookingStepMapV1`. Existing production v4/v5 prepared-component behavior is not changed by this design document.

## 22. Minimum implementation sequence

1. **Next prompt — contract types + pure router prototype.** Add domain types, candidate/revision ID helpers, the frozen V1 evidence adapter, routing table, policy arithmetic tests, and serialization/hash tests. No Firestore, AI, UI, runtime, or activation.
2. Add the two-reviewer ingestion proposal coordinator with bounded retry, complete-output validation, attempt provenance, and idempotent local/emulator persistence behind a disabled feature flag.
3. Separate **DESIGN** task for the review experience, including candidate context and map-level completeness attestation.
4. Implement append-only candidate review and map approval UI/API with emulator rules tests; keep production disabled.
5. Implement immutable approved-map builder/storage/readback and a disabled runtime adapter; keep existing v4/v5 behavior active.
6. Run frozen end-to-end validation for precision, explicit-use recall, CRITICAL/HIGH/seasoning recall, failure closure, and zero runtime AI.
7. Generate the existing-corpus remediation proposal and perform complete human map/source review; produce an immutable SHA-locked manifest and rollback evidence.
8. Use a separate explicit production-apply prompt with zero AI and zero recomputation.

## 23. Activation gates

This contract is complete enough to implement without inventing routing semantics, but it does not authorize activation. Activation still requires:

- `AUTO_ACCEPT` observed precision 100% on the locked benchmark;
- final map precision 100%;
- explicit-active-use recall at least 99%;
- CRITICAL recall 100%;
- HIGH recall at least 99%;
- seasoning/herb recall at least 98%;
- separately approved prepared-component gate;
- exact provenance/source/version coverage;
- zero AI calls and writes in Cooking Mode runtime;
- zero AI/recomputation in production migration apply.

## 24. Direct answers

1. `AUTO_ACCEPT`: both complete reviewers accept, V1 evidence is complete, no V1 risk exists, and structure/source are valid.
2. `REVIEW_REQUIRED`: any disagreement, risk, unsupported class, missing/unparseable reviewer, unavailable evidence, or both-reject/positive-evidence conflict.
3. `AUTO_REJECT`: verified structural invalidity only.
4. Reviewer disagreement always goes to review.
5. Both accept plus any risk always goes to review.
6. V10G is review-priority/diagnostic evidence in V1, not routing authority; rejection never auto-rejects.
7. Human decisions are candidate-level; approval and completeness attestation are map-level.
8. Reviewers see exact source context, votes, finite evidence/risk, lifecycle/component/quantity facts, routing, and decision history.
9. A map becomes approved only after complete two-reviewer execution, complete evidence, all candidates resolved, required human review/completeness attestation, same-revision reread, immutable persistence, and exact readback.
10. An approved map never changes in place.
11. Parser version or any exact parsed ingredient/instruction text/order/header change invalidates the active revision.
12. Reviewer failure blocks approval and retries only the failed slot; there is no one-reviewer fallback.
13. Fixed proposal/candidate/map identities make retries idempotent; attempt history is append-only.
14. Candidate, reviewer, evidence, decision, proposal, and map provenance are retained separately from raw diagnostics.
15. Prepared components are deferred.
16. Selected frozen burden: 55.63% relationships reviewed, 34/36 recipes affected, 14.09 review items per affected recipe.
17. The next implementation prompt is contract types + a pure, frozen deterministic router prototype with no persistence or runtime integration.
