// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import MappingCandidateRow from '@/components/mapping-review/MappingCandidateRow'
import type { PersistedMappingCandidateV1 } from '@/types/cookingModeMappingPersistence'

afterEach(cleanup)

function candidate(overrides: Partial<PersistedMappingCandidateV1> = {}): PersistedMappingCandidateV1 {
  return {
    schemaVersion: 1,
    candidateType: 'INGREDIENT_STEP_RELATIONSHIP',
    candidateId: 'mc1:abc',
    proposalId: 'mp1:abc',
    recipeId: 'recipe-1',
    recipeRevision: 'v1:sha256:abc',
    parserVersion: 'v1',
    mappingSourceHash: 'hash',
    ingredientRowIndex: 0,
    ingredientText: '2 cups flour',
    ingredientGroup: null,
    stepIndex: 0,
    stepText: 'Mix the flour and salt.',
    reviewerA: {
      reviewerSlot: 'A', vote: 'ACCEPT', reviewerContractVersion: 'r1', promptVersion: 'p1', modelId: 'm1',
      runId: 'run-a', attemptId: 'attempt-a', completedAt: null, parseStatus: 'VALID', normalizedOutputHash: null,
      confidence: null, sourceEvidence: null,
    },
    reviewerB: {
      reviewerSlot: 'B', vote: 'REJECT', reviewerContractVersion: 'r1', promptVersion: 'p1', modelId: 'm1',
      runId: 'run-b', attemptId: 'attempt-b', completedAt: null, parseStatus: 'VALID', normalizedOutputHash: null,
      confidence: null, sourceEvidence: null,
    },
    deterministicEvidence: {
      contractVersion: 'cooking-routing-evidence-v1', extractorFingerprint: 'fp', status: 'COMPLETE',
      positive: [], risks: ['LIFECYCLE_RISK'], tags: [],
      observations: {
        explicitlyNamed: false, ingredientGroup: null, duplicateSiblingIndexes: [], priorMentionStepIndexes: [],
        laterMentionStepIndexes: [], priorReviewerUseStepIndexes: [], listedQuantity: null, currentStepQuantity: null,
        componentLabels: [], componentEstablishedAtStep: null, remainingLanguage: false,
      },
    },
    routingDecision: 'REVIEW_REQUIRED',
    routingReasons: ['REVIEWER_DISAGREEMENT'],
    reviewStatus: 'PENDING',
    finalDecision: null,
    decisionSource: null,
    provenance: {
      routingContractVersion: 'cooking-review-routing-v1', evidenceContractVersion: 'cooking-routing-evidence-v1',
      reviewerContractVersion: 'r1', candidateOrigin: 'REVIEWER_UNION', acceptedByReviewerSlots: ['A'],
    },
    createdAt: '2026-08-28T00:00:00.000Z',
    effectiveReviewEventId: null,
    updatedAt: null,
    ...overrides,
  }
}

describe('MappingCandidateRow', () => {
  it('renders ingredient text, reviewer agreement/disagreement, and risk copy (not the raw enum)', () => {
    render(
      <MappingCandidateRow candidate={candidate()} busy={false} error={null} onDecide={() => {}} onFetchHistory={async () => []} />,
    )
    expect(screen.getByText('2 cups flour')).toBeTruthy()
    expect(screen.getByText(/Reviewer A · Include/)).toBeTruthy()
    expect(screen.getByText(/Reviewer B · Exclude/)).toBeTruthy()
    expect(screen.getByText('Used earlier in the recipe')).toBeTruthy()
    expect(screen.queryByText('LIFECYCLE_RISK')).toBeNull()
  })

  it('shows both reviewers agreeing when both accept', () => {
    render(
      <MappingCandidateRow
        candidate={candidate({ reviewerB: { ...candidate().reviewerB!, vote: 'ACCEPT' } })}
        busy={false} error={null} onDecide={() => {}} onFetchHistory={async () => []}
      />,
    )
    expect(screen.getByText(/Reviewer A · Include/)).toBeTruthy()
    expect(screen.getByText(/Reviewer B · Include/)).toBeTruthy()
  })

  it('Include calls onDecide with ACCEPT', () => {
    const onDecide = vi.fn()
    render(<MappingCandidateRow candidate={candidate()} busy={false} error={null} onDecide={onDecide} onFetchHistory={async () => []} />)
    fireEvent.click(screen.getByRole('button', { name: /Include/ }))
    expect(onDecide).toHaveBeenCalledWith('ACCEPT')
  })

  it('Exclude calls onDecide with REJECT', () => {
    const onDecide = vi.fn()
    render(<MappingCandidateRow candidate={candidate()} busy={false} error={null} onDecide={onDecide} onFetchHistory={async () => []} />)
    fireEvent.click(screen.getByRole('button', { name: /Exclude/ }))
    expect(onDecide).toHaveBeenCalledWith('REJECT')
  })

  it('a resolved candidate collapses to a summary line with a Change control', () => {
    render(
      <MappingCandidateRow candidate={candidate({ finalDecision: 'ACCEPT', decisionSource: 'HUMAN' })} busy={false} error={null} onDecide={() => {}} onFetchHistory={async () => []} />,
    )
    expect(screen.getByText('Included')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Include/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    expect(screen.getByRole('button', { name: /Include/ })).toBeTruthy()
  })

  it('does not advance past the busy state when a write fails — the row still shows the retry error', () => {
    render(
      <MappingCandidateRow candidate={candidate()} busy={false} error="Couldn’t save this decision — try again." onDecide={() => {}} onFetchHistory={async () => []} />,
    )
    expect(screen.getByRole('alert').textContent).toContain('Couldn’t save this decision')
    // Still unresolved — Include/Exclude remain available for retry.
    expect(screen.getByRole('button', { name: /Include/ })).toBeTruthy()
  })

  it('history is hidden by default and can be opened on demand', async () => {
    const onFetchHistory = vi.fn().mockResolvedValue([
      { decisionId: 'mr1:a', decision: 'REJECT', reasonCode: 'SOURCE_NO_ACTIVE_USE', note: null },
    ])
    render(
      <MappingCandidateRow candidate={candidate({ finalDecision: 'ACCEPT' })} busy={false} error={null} onDecide={() => {}} onFetchHistory={onFetchHistory} />,
    )
    expect(screen.queryByText(/Excluded —/)).toBeNull()
    expect(onFetchHistory).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'History' }))
    await waitFor(() => expect(onFetchHistory).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByText(/Excluded —/)).not.toBeNull())
  })

  it('Include/Exclude expose aria-pressed state, not color alone', () => {
    render(<MappingCandidateRow candidate={candidate()} busy={false} error={null} onDecide={() => {}} onFetchHistory={async () => []} />)
    expect(screen.getByRole('button', { name: /Include/ }).getAttribute('aria-pressed')).toBe('false')
  })
})
