// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MappingReviewRecipeResponse } from '@/lib/mappingReviewClient'
import type { PersistedMappingCandidateV1 } from '@/types/cookingModeMappingPersistence'

const mocks = vi.hoisted(() => ({
  fetchMappingReviewRecipe: vi.fn(),
  fetchMappingCandidateHistory: vi.fn(),
  submitMappingReviewDecision: vi.fn(),
  addMappingRelationship: vi.fn(),
  removeMappingRelationship: vi.fn(),
  attestMappingCompleteness: vi.fn(),
  approveMappingReview: vi.fn(),
  useAuth: vi.fn(),
  useAdminAccess: vi.fn(),
  useParams: vi.fn(),
}))

vi.mock('@/lib/mappingReviewClient', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/mappingReviewClient')>()
  return {
    ...actual,
    fetchMappingReviewRecipe: mocks.fetchMappingReviewRecipe,
    fetchMappingCandidateHistory: mocks.fetchMappingCandidateHistory,
    submitMappingReviewDecision: mocks.submitMappingReviewDecision,
    addMappingRelationship: mocks.addMappingRelationship,
    removeMappingRelationship: mocks.removeMappingRelationship,
    attestMappingCompleteness: mocks.attestMappingCompleteness,
    approveMappingReview: mocks.approveMappingReview,
  }
})
vi.mock('@/lib/AuthContext', () => ({ useAuth: mocks.useAuth }))
vi.mock('@/hooks/useAdminAccess', () => ({ useAdminAccess: mocks.useAdminAccess }))
vi.mock('next/navigation', () => ({ useParams: mocks.useParams }))

import MappingReviewRecipePage from '@/app/mapping-review/[recipeId]/page'

afterEach(cleanup)

const adminUser = { uid: 'admin-uid', getIdToken: vi.fn().mockResolvedValue('token') }

const LIVE_SOURCE = {
  recipeId: 'recipe-1',
  parserVersion: 'v1',
  ingredients: ['1 cup flour', '1 tsp salt', 'pinch of pepper'],
  instructions: ['Mix flour and salt.', 'Bake at 350F.'],
}

function baseCandidate(overrides: Record<string, unknown>): PersistedMappingCandidateV1 {
  return {
    schemaVersion: 1, candidateType: 'INGREDIENT_STEP_RELATIONSHIP',
    parserVersion: 'v1', mappingSourceHash: 'hash', recipeId: 'recipe-1', recipeRevision: 'rev-1',
    ingredientGroup: null,
    reviewerA: null, reviewerB: null,
    deterministicEvidence: {
      contractVersion: 'cooking-routing-evidence-v1', extractorFingerprint: 'fp', status: 'COMPLETE',
      positive: [], risks: [], tags: [],
      observations: {
        explicitlyNamed: false, ingredientGroup: null, duplicateSiblingIndexes: [], priorMentionStepIndexes: [],
        laterMentionStepIndexes: [], priorReviewerUseStepIndexes: [], listedQuantity: null, currentStepQuantity: null,
        componentLabels: [], componentEstablishedAtStep: null, remainingLanguage: false,
      },
    },
    reviewStatus: 'PENDING', createdAt: '2026-08-28T00:00:00.000Z', effectiveReviewEventId: null, updatedAt: null,
    provenance: {
      routingContractVersion: 'cooking-review-routing-v1', evidenceContractVersion: 'cooking-routing-evidence-v1',
      reviewerContractVersion: 'r1', candidateOrigin: 'REVIEWER_UNION', acceptedByReviewerSlots: [],
    },
    ...overrides,
  } as unknown as PersistedMappingCandidateV1
}

function freshState(): MappingReviewRecipeResponse {
  const flourCandidate = baseCandidate({
    candidateId: 'mc1:flour', proposalId: 'mp1:a', ingredientRowIndex: 0, ingredientText: '1 cup flour',
    stepIndex: 0, stepText: 'Mix flour and salt.', routingDecision: 'REVIEW_REQUIRED', finalDecision: null, decisionSource: null,
    reviewerA: { reviewerSlot: 'A', vote: 'ACCEPT', reviewerContractVersion: 'r1', promptVersion: 'p1', modelId: 'm1', runId: 'run-a', attemptId: 'a1', completedAt: null, parseStatus: 'VALID', normalizedOutputHash: null, confidence: null, sourceEvidence: null },
    reviewerB: { reviewerSlot: 'B', vote: 'REJECT', reviewerContractVersion: 'r1', promptVersion: 'p1', modelId: 'm1', runId: 'run-b', attemptId: 'b1', completedAt: null, parseStatus: 'VALID', normalizedOutputHash: null, confidence: null, sourceEvidence: null },
  })
  const saltCandidate = baseCandidate({
    candidateId: 'mc1:salt', proposalId: 'mp1:a', ingredientRowIndex: 1, ingredientText: '1 tsp salt',
    stepIndex: 1, stepText: 'Bake at 350F.', routingDecision: 'AUTO_ACCEPT', finalDecision: 'ACCEPT', decisionSource: 'AUTO',
  })

  return {
    recipeId: 'recipe-1',
    recipeTitle: 'Test Bake',
    liveRevision: 'rev-1',
    liveSource: LIVE_SOURCE,
    proposal: {
      schemaVersion: 1,
      proposalId: 'mp1:a', recipeId: 'recipe-1', recipeRevision: 'rev-1', parserVersion: 'v1', mappingSourceHash: 'hash',
      reviewerContractVersion: 'r1', evidenceContractVersion: 'e1', routingContractVersion: 'rt1',
      summary: { candidateCount: 2, autoAcceptCount: 1, reviewRequiredCount: 1, autoRejectCount: 0 },
      approvalBlocked: true, blockingReasons: ['CANDIDATE_REVIEW_REQUIRED'], reviewCompleteWithoutHuman: false,
      persistenceStatus: 'READY', candidateCount: 2, createdAt: null, updatedAt: null,
    },
    staleProposalId: null,
    candidates: [flourCandidate, saltCandidate],
    completion: { complete: false, totalCandidates: 1, resolvedCandidates: 0, unresolvedCandidateIds: ['mc1:flour'], requiresCompletenessAttestation: true },
    attestation: { valid: false, attestation: null, liveReviewStateHash: 'h0' },
    pointer: { status: 'NOT_FOUND', pointer: null, currentRecipeRevision: 'rev-1' },
    approvedMap: null,
  }
}

describe('MappingReviewRecipePage — full review flow', () => {
  let state: ReturnType<typeof freshState>

  beforeEach(() => {
    state = freshState()
    mocks.useParams.mockReturnValue({ recipeId: 'recipe-1' })
    mocks.useAuth.mockReturnValue({ user: adminUser, loading: false })
    mocks.useAdminAccess.mockReturnValue({ isAdmin: true, checked: true })
    mocks.fetchMappingReviewRecipe.mockReset().mockImplementation(async () => structuredClone(state))
    mocks.fetchMappingCandidateHistory.mockReset().mockResolvedValue([])
    mocks.submitMappingReviewDecision.mockReset().mockImplementation(async (_t: string, _r: string, input: { candidateId: string; decision: 'ACCEPT' | 'REJECT' }) => {
      const c = state.candidates.find(c => c.candidateId === input.candidateId)!
      c.finalDecision = input.decision
      c.decisionSource = 'HUMAN'
      state.completion = {
        complete: state.candidates.every(c => c.finalDecision !== null),
        totalCandidates: 1, resolvedCandidates: state.candidates.filter(c => c.routingDecision === 'REVIEW_REQUIRED' && c.finalDecision !== null).length,
        unresolvedCandidateIds: [], requiresCompletenessAttestation: true,
      }
      return { decisionId: 'mr1:x' }
    })
    mocks.addMappingRelationship.mockReset().mockImplementation(async (_t: string, _r: string, input: { stepIndex: number; ingredientRowIndex: number }) => {
      state.candidates.push(baseCandidate({
        candidateId: 'mc1:pepper', proposalId: 'mp1:a', ingredientRowIndex: input.ingredientRowIndex,
        ingredientText: 'pinch of pepper', stepIndex: input.stepIndex, stepText: LIVE_SOURCE.instructions[input.stepIndex],
        routingDecision: 'HUMAN_ADDED', finalDecision: 'ACCEPT', decisionSource: 'HUMAN',
        provenance: { routingContractVersion: 'cooking-review-routing-v1', evidenceContractVersion: 'cooking-routing-evidence-v1', reviewerContractVersion: 'r1', candidateOrigin: 'HUMAN_ADDED', acceptedByReviewerSlots: [] },
      }))
      state.attestation = { valid: false, attestation: null, liveReviewStateHash: 'h1' }
      return { outcome: 'CREATED', candidate: {} }
    })
    mocks.removeMappingRelationship.mockReset().mockImplementation(async () => {
      state.candidates = state.candidates.filter(c => c.candidateId !== 'mc1:pepper')
      state.attestation = { valid: false, attestation: null, liveReviewStateHash: 'h2' }
      return { decisionId: 'mr1:y' }
    })
    mocks.attestMappingCompleteness.mockReset().mockImplementation(async () => {
      state.attestation = {
        valid: true,
        attestation: { schemaVersion: 1, attestationId: 'ma1:x', proposalId: 'mp1:a', recipeId: 'recipe-1', recipeRevision: 'rev-1', reviewStateHash: 'h', attestedBy: 'admin-uid', attestedAt: null },
        liveReviewStateHash: 'h',
      }
      return state.attestation!.attestation
    })
    mocks.approveMappingReview.mockReset()
  })

  it('walks queue → resolve candidate → completeness → add relationship → attest → invalidate → re-attest → approve', async () => {
    render(<MappingReviewRecipePage />)

    // Step-centric review: the uncertain flour candidate is shown with source context.
    await waitFor(() => expect(screen.getByText('Mix flour and salt.')).toBeTruthy())
    expect(screen.getByText('1 cup flour')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Include/ }))
    await waitFor(() => expect(mocks.submitMappingReviewDecision).toHaveBeenCalled())

    // Every candidate resolved -> explicit milestone, not an automatic approval.
    await waitFor(() => expect(screen.getByText(/Review complete/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Continue to full map review' }))

    // Completeness review shows both the auto-resolved and human-reviewed relationships.
    await waitFor(() => expect(screen.getByText('Bake at 350F.')).toBeTruthy())
    expect(screen.getAllByText('1 cup flour').length).toBeGreaterThan(0)
    expect(screen.getAllByText('1 tsp salt').length).toBeGreaterThan(0)

    // No attestation yet -> Approve is not reachable.
    expect(screen.queryByRole('button', { name: /Approve Cooking Mode map/ })).toBeNull()

    // Add a missing relationship neither reviewer produced.
    const addButtons = screen.getAllByRole('button', { name: /Add ingredient to this step/ })
    fireEvent.click(addButtons[0])
    const select = screen.getAllByLabelText('Ingredient to add to this step')[0] as HTMLSelectElement
    fireEvent.change(select, { target: { value: '2' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0])
    await waitFor(() => expect(mocks.addMappingRelationship).toHaveBeenCalledWith('token', 'recipe-1', expect.objectContaining({ ingredientRowIndex: 2 })))
    await waitFor(() => expect(screen.getAllByText('pinch of pepper').length).toBeGreaterThan(0))

    // Attest completeness — a distinct, deliberate act.
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: /I've reviewed the complete mapping/ }))
    await waitFor(() => expect(mocks.attestMappingCompleteness).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText('Reviewed and attested complete')).toBeTruthy())

    // Removing the human-added relationship invalidates the attestation again.
    const removeButton = screen.getByRole('button', { name: /Remove pinch of pepper/ })
    fireEvent.click(removeButton)
    await waitFor(() => expect(mocks.removeMappingRelationship).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByText('Reviewed and attested complete')).toBeNull())
    expect(screen.queryByRole('button', { name: /Approve Cooking Mode map/ })).toBeNull()

    // Re-attest, then approve.
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /I've reviewed the complete mapping/ }))
    await waitFor(() => expect(screen.getByText('Reviewed and attested complete')).toBeTruthy())

    mocks.approveMappingReview.mockResolvedValueOnce({
      recipeId: 'recipe-1', mapId: 'am1:final', approvalMode: 'HUMAN_ASSISTED', relationshipCount: 2, map: {},
    })
    fireEvent.click(screen.getByRole('button', { name: /Approve Cooking Mode map/ }))
    await waitFor(() => expect(screen.getByText('Cooking Mode map approved')).toBeTruthy())
    expect(screen.getByText(/2 ingredient-step relationships/)).toBeTruthy()
  })
})

describe('MappingReviewRecipePage — non-happy-path states', () => {
  beforeEach(() => {
    mocks.useParams.mockReturnValue({ recipeId: 'recipe-1' })
    mocks.useAuth.mockReturnValue({ user: adminUser, loading: false })
    mocks.useAdminAccess.mockReturnValue({ isAdmin: true, checked: true })
  })

  it('shows the stale message and no approval path when the recipe changed', async () => {
    const state = freshState()
    state.proposal = null
    state.staleProposalId = 'mp1:old'
    state.candidates = []
    state.completion = null
    mocks.fetchMappingReviewRecipe.mockReset().mockResolvedValue(state)
    render(<MappingReviewRecipePage />)
    await waitFor(() => expect(screen.getByText(/The recipe changed after this mapping was created/)).toBeTruthy())
    expect(screen.queryByRole('button', { name: /Approve Cooking Mode map/ })).toBeNull()
  })

  it('shows the blocked message and no approval path for a non-review blocker', async () => {
    const state = freshState()
    state.proposal!.approvalBlocked = true
    state.proposal!.blockingReasons = ['DETERMINISTIC_EVIDENCE_FAILURE']
    mocks.fetchMappingReviewRecipe.mockReset().mockResolvedValue(state)
    render(<MappingReviewRecipePage />)
    await waitFor(() => expect(screen.getByText(/We couldn’t evaluate the risk signals/)).toBeTruthy())
    expect(screen.queryByRole('button', { name: /Approve Cooking Mode map/ })).toBeNull()
  })

  it('a zero-review proposal skips step review but still requires completeness review and attestation', async () => {
    const state = freshState()
    state.candidates = state.candidates.filter(c => c.routingDecision !== 'REVIEW_REQUIRED')
    state.proposal!.approvalBlocked = false
    state.proposal!.blockingReasons = []
    state.completion = { complete: true, totalCandidates: 0, resolvedCandidates: 0, unresolvedCandidateIds: [], requiresCompletenessAttestation: false }
    mocks.fetchMappingReviewRecipe.mockReset().mockResolvedValue(state)
    render(<MappingReviewRecipePage />)
    await waitFor(() => expect(screen.getByText(/fully resolved automatically/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Continue to full map review' }))
    await waitFor(() => expect(screen.getByText('Approve Cooking Mode map')).toBeTruthy())
    // Not auto-approved — still gated behind the explicit attestation checkbox.
    expect(screen.queryByRole('button', { name: /Approve Cooking Mode map$/ })).toBeNull()
  })

  // Regression (E2E workflow validation, 2026-08-29): getMappingReviewHistory's persisted
  // contract returns a candidate's decision chain oldest-first (lib/cookingModeMappingReviewPersistence.ts).
  // Design §9 requires the on-demand History disclosure to read newest-first; the UI must
  // reverse the fetched chain rather than render the persistence order directly.
  it('shows candidate decision history newest-first, not the persisted oldest-first order', async () => {
    const state = freshState()
    mocks.useParams.mockReturnValue({ recipeId: 'recipe-1' })
    mocks.useAuth.mockReturnValue({ user: adminUser, loading: false })
    mocks.useAdminAccess.mockReturnValue({ isAdmin: true, checked: true })
    mocks.fetchMappingReviewRecipe.mockReset().mockResolvedValue(state)
    mocks.fetchMappingCandidateHistory.mockReset().mockResolvedValue([
      { decisionId: 'mr1:old', candidateId: 'mc1:flour', proposalId: 'mp1:a', recipeRevision: 'rev-1', decision: 'REJECT', reasonCode: 'SOURCE_NO_ACTIVE_USE', note: null, decidedAt: '2026-08-29T00:00:00.000Z', decidedBy: 'admin-uid', supersedesDecisionId: null },
      { decisionId: 'mr1:new', candidateId: 'mc1:flour', proposalId: 'mp1:a', recipeRevision: 'rev-1', decision: 'ACCEPT', reasonCode: 'SOURCE_EXPLICIT_USE', note: null, decidedAt: '2026-08-29T00:05:00.000Z', decidedBy: 'admin-uid', supersedesDecisionId: 'mr1:old' },
    ])

    render(<MappingReviewRecipePage />)
    await waitFor(() => expect(screen.getByText('1 cup flour')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /History/ }))
    await waitFor(() => expect(screen.getByText(/Explicitly used on this step/)).toBeTruthy())
    expect(screen.getByText(/Not actually used on this step/)).toBeTruthy()

    const historyText = screen.getByText(/Explicitly used on this step/).parentElement!.parentElement!.textContent!
    // The latest decision (Included — Explicitly used) must render before the
    // superseded one (Excluded — Not actually used), matching design §9's "newest first".
    expect(historyText.indexOf('Explicitly used')).toBeLessThan(historyText.indexOf('Not actually used'))
  })
})
