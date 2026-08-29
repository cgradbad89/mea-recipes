// Human-readable copy for the nine frozen V1 mapping risks (Human Mapping
// Review Experience design doc §6). Enum names are never primary UI — this
// is the sole place that maps them to display copy. No semantic
// reinterpretation: these labels/explanations answer "why was this flagged
// for review," never "what decision to make."

import type { MappingRiskEvidence } from '@/types/cookingModeMapping'
import type { MappingHumanReviewReason } from '@/types/cookingModeMappingPersistence'

export const MAPPING_RISK_COPY: Record<MappingRiskEvidence, { label: string; explanation: string }> = {
  COMPONENT_CONTAINMENT_RISK: {
    label: 'Might be part of another component',
    explanation: 'This ingredient may already be inside something else used on this step, rather than added directly.',
  },
  LIFECYCLE_RISK: {
    label: 'Used earlier in the recipe',
    explanation: 'This ingredient was already used in a prior step — this may be a continuation, not a new addition.',
  },
  CONTEXT_ONLY_RISK: {
    label: 'Mentioned in passing',
    explanation: 'This step’s wording (e.g. "adjust seasoning," "serve with") doesn’t clearly call out this specific ingredient.',
  },
  PROCESS_MATERIAL_RISK: {
    label: 'Process material, not food',
    explanation: 'This looks like water, ice, foil, or a similar prep material rather than a real ingredient use.',
  },
  DUPLICATE_ROW_RISK: {
    label: 'Possible duplicate ingredient',
    explanation: 'Another ingredient row looks very similar to this one — check you’re deciding the right one.',
  },
  GROUP_CONFLICT_RISK: {
    label: 'Different ingredient group named',
    explanation: 'This step calls out a different ingredient group than the one this row belongs to.',
  },
  QUANTITY_CONFLICT_RISK: {
    label: 'Quantity doesn’t match',
    explanation: 'The amount mentioned on this step doesn’t match this ingredient’s listed amount.',
  },
  COLLECTIVE_REFERENCE_RISK: {
    label: 'Vague "everything" reference',
    explanation: 'This step says something like "add the rest" without naming this ingredient specifically.',
  },
  PARTIAL_IDENTITY_MATCH_RISK: {
    label: 'Only a partial name match',
    explanation: 'Only part of this ingredient’s name (e.g. "oil") matches what the step says.',
  },
}

export const MAPPING_HUMAN_REVIEW_REASON_LABELS: Record<MappingHumanReviewReason, string> = {
  SOURCE_EXPLICIT_USE: 'Explicitly used on this step',
  SOURCE_NO_ACTIVE_USE: 'Not actually used on this step',
  ALIAS_OR_REFERENCE: 'Referred to by another name',
  COMPONENT_BOUNDARY: 'Part of a prepared component',
  LIFECYCLE_OR_REUSE: 'Continuation from an earlier step',
  QUANTITY_OR_PARTIAL_USE: 'Only part of it is used here',
  SERVING_OR_GARNISH: 'Serving or garnish only',
  OTHER: 'Other (note required)',
}

export const MAPPING_HUMAN_REVIEW_REASON_ORDER_FOR_UI: MappingHumanReviewReason[] = [
  'SOURCE_EXPLICIT_USE',
  'SOURCE_NO_ACTIVE_USE',
  'ALIAS_OR_REFERENCE',
  'COMPONENT_BOUNDARY',
  'LIFECYCLE_OR_REUSE',
  'QUANTITY_OR_PARTIAL_USE',
  'SERVING_OR_GARNISH',
  'OTHER',
]

export const MAPPING_QUEUE_STATUS_COPY: Record<string, { label: string; description: string }> = {
  NEEDS_REVIEW: { label: 'Needs review', description: 'No decisions made yet.' },
  IN_PROGRESS: { label: 'In progress', description: 'Some decisions made; more remain.' },
  READY_FOR_FINAL_REVIEW: { label: 'Ready for final approval', description: 'Every candidate has a decision.' },
  APPROVED: { label: 'Approved', description: 'A Cooking Mode map is approved for this recipe.' },
  STALE: { label: 'Stale', description: 'The recipe changed since this mapping was reviewed.' },
  BLOCKED: { label: 'Blocked', description: 'This proposal cannot be reviewed right now.' },
}

export const MAPPING_BLOCKED_REASON_COPY: Record<string, string> = {
  REVIEWER_A_INCOMPLETE: 'One of the two reviewers hasn’t finished for this recipe yet. Review can’t start until both complete.',
  REVIEWER_B_INCOMPLETE: 'One of the two reviewers hasn’t finished for this recipe yet. Review can’t start until both complete.',
  DETERMINISTIC_EVIDENCE_FAILURE: 'We couldn’t evaluate the risk signals for this recipe’s mapping. Review is paused until this is resolved.',
  SOURCE_IDENTITY_MISMATCH: 'This recipe’s mapping proposal didn’t finish generating correctly.',
  STRUCTURAL_INVALIDITY: 'This recipe’s mapping proposal contains an invalid record and can’t be reviewed.',
}
