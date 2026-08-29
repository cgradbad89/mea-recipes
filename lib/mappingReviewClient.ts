// Thin, typed client-side fetch layer for the /mapping-review admin UI
// (Phase 6/26). Every mutation/read here is a call to a trusted, admin-
// verified API route — no Firestore access, no persistence logic, lives in
// this file so page/components never duplicate proposal-resolution logic.

import type {
  AddHumanMappingRelationshipResult,
  PersistedMappingCandidateV1,
  PersistedMappingCompletenessAttestationV1,
  PersistedMappingProposalV1,
  PersistedMappingReviewDecisionV1,
  PersistedApprovedCookingStepMapV1,
  ProposalCompletionResult,
  MappingCompletenessAttestationStatus,
  ReadCurrentApprovedMappingPointerResult,
  MappingHumanReviewReason,
} from '@/types/cookingModeMappingPersistence'
import type { MappingRevisionSource } from '@/types/cookingModeMapping'
import type { MappingReviewQueueEntry } from '@/lib/cookingModeMappingReviewQueue'

export class MappingReviewClientError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'MappingReviewClientError'
    this.status = status
  }
}

async function call<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  })
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // no body
  }
  if (!response.ok) {
    const message = (body && typeof body === 'object' && 'error' in body && typeof (body as { error?: unknown }).error === 'string')
      ? (body as { error: string }).error
      : 'Something went wrong — try again.'
    throw new MappingReviewClientError(message, response.status)
  }
  return body as T
}

export async function fetchMappingReviewQueue(token: string): Promise<MappingReviewQueueEntry[]> {
  const result = await call<{ entries: MappingReviewQueueEntry[] }>(token, '/api/mapping-review/queue')
  return result.entries
}

export interface MappingReviewRecipeResponse {
  recipeId: string
  recipeTitle: string
  liveRevision: string
  liveSource: MappingRevisionSource
  proposal: PersistedMappingProposalV1 | null
  staleProposalId: string | null
  candidates: PersistedMappingCandidateV1[]
  completion: ProposalCompletionResult | null
  attestation: MappingCompletenessAttestationStatus | null
  pointer: ReadCurrentApprovedMappingPointerResult
  approvedMap: PersistedApprovedCookingStepMapV1 | null
}

export async function fetchMappingReviewRecipe(token: string, recipeId: string): Promise<MappingReviewRecipeResponse> {
  return call<MappingReviewRecipeResponse>(token, `/api/mapping-review/${encodeURIComponent(recipeId)}`)
}

export async function fetchMappingCandidateHistory(
  token: string,
  recipeId: string,
  candidateId: string,
  proposalId: string,
): Promise<PersistedMappingReviewDecisionV1[]> {
  const result = await call<{ history: PersistedMappingReviewDecisionV1[] }>(
    token,
    `/api/mapping-review/${encodeURIComponent(recipeId)}/candidates/${encodeURIComponent(candidateId)}/history?proposalId=${encodeURIComponent(proposalId)}`,
  )
  return result.history
}

export interface SubmitDecisionInput {
  proposalId: string
  candidateId: string
  recipeRevision: string
  decision: 'ACCEPT' | 'REJECT'
  reasonCode: MappingHumanReviewReason
  note?: string | null
  supersedesDecisionId?: string | null
}

export async function submitMappingReviewDecision(
  token: string,
  recipeId: string,
  input: SubmitDecisionInput,
): Promise<PersistedMappingReviewDecisionV1> {
  const result = await call<{ decision: PersistedMappingReviewDecisionV1 }>(
    token,
    `/api/mapping-review/${encodeURIComponent(recipeId)}/decisions`,
    { method: 'POST', body: JSON.stringify(input) },
  )
  return result.decision
}

export interface AddRelationshipInput {
  proposalId: string
  recipeRevision: string
  ingredientRowIndex: number
  stepIndex: number
  reasonCode?: MappingHumanReviewReason
  note?: string | null
}

export async function addMappingRelationship(
  token: string,
  recipeId: string,
  input: AddRelationshipInput,
): Promise<AddHumanMappingRelationshipResult> {
  return call<AddHumanMappingRelationshipResult>(
    token,
    `/api/mapping-review/${encodeURIComponent(recipeId)}/relationships`,
    { method: 'POST', body: JSON.stringify(input) },
  )
}

export interface RemoveRelationshipInput {
  proposalId: string
  candidateId: string
  recipeRevision: string
  reasonCode: MappingHumanReviewReason
  note?: string | null
}

export async function removeMappingRelationship(
  token: string,
  recipeId: string,
  input: RemoveRelationshipInput,
): Promise<PersistedMappingReviewDecisionV1> {
  const result = await call<{ decision: PersistedMappingReviewDecisionV1 }>(
    token,
    `/api/mapping-review/${encodeURIComponent(recipeId)}/relationships`,
    { method: 'DELETE', body: JSON.stringify(input) },
  )
  return result.decision
}

export async function attestMappingCompleteness(
  token: string,
  recipeId: string,
  input: { proposalId: string; recipeRevision: string },
): Promise<PersistedMappingCompletenessAttestationV1> {
  const result = await call<{ attestation: PersistedMappingCompletenessAttestationV1 }>(
    token,
    `/api/mapping-review/${encodeURIComponent(recipeId)}/attestation`,
    { method: 'POST', body: JSON.stringify(input) },
  )
  return result.attestation
}

export interface ApproveMappingResult {
  recipeId: string
  mapId: string
  approvalMode: 'AUTO' | 'HUMAN_ASSISTED'
  relationshipCount: number
  map: PersistedApprovedCookingStepMapV1
}

export async function approveMappingReview(
  token: string,
  recipeId: string,
  input: { proposalId: string; recipeRevision: string },
): Promise<ApproveMappingResult> {
  return call<ApproveMappingResult>(
    token,
    `/api/mapping-review/${encodeURIComponent(recipeId)}/approve`,
    { method: 'POST', body: JSON.stringify(input) },
  )
}
