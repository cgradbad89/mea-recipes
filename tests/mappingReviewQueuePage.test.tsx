// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchMappingReviewQueue: vi.fn(),
  useAuth: vi.fn(),
  useAdminAccess: vi.fn(),
}))

vi.mock('@/lib/mappingReviewClient', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/mappingReviewClient')>()
  return { ...actual, fetchMappingReviewQueue: mocks.fetchMappingReviewQueue }
})
vi.mock('@/lib/AuthContext', () => ({ useAuth: mocks.useAuth }))
vi.mock('@/hooks/useAdminAccess', () => ({ useAdminAccess: mocks.useAdminAccess }))

import MappingReviewQueuePage from '@/app/mapping-review/page'

afterEach(cleanup)

const adminUser = { uid: 'admin-uid', getIdToken: vi.fn().mockResolvedValue('token') }

describe('MappingReviewQueuePage', () => {
  beforeEach(() => {
    mocks.fetchMappingReviewQueue.mockReset()
    mocks.useAuth.mockReset().mockReturnValue({ user: adminUser, loading: false })
    mocks.useAdminAccess.mockReset().mockReturnValue({ isAdmin: true, checked: true })
  })

  it('gates non-admin users away from the workflow', () => {
    mocks.useAdminAccess.mockReturnValue({ isAdmin: false, checked: true })
    render(<MappingReviewQueuePage />)
    expect(screen.getByText('Mapping review isn’t available')).toBeTruthy()
    expect(mocks.fetchMappingReviewQueue).not.toHaveBeenCalled()
  })

  it('shows the empty state when nothing needs review', async () => {
    mocks.fetchMappingReviewQueue.mockResolvedValueOnce([])
    render(<MappingReviewQueuePage />)
    await waitFor(() => expect(screen.getByText('Nothing to review')).toBeTruthy())
  })

  it('renders a queue entry for each recipe-level state', async () => {
    mocks.fetchMappingReviewQueue.mockResolvedValueOnce([
      { recipeId: 'r1', recipeTitle: 'Needs Review Recipe', status: 'NEEDS_REVIEW', proposalId: 'mp1:a', resolvedCandidates: 0, totalCandidates: 3, blockedReason: null },
      { recipeId: 'r2', recipeTitle: 'In Progress Recipe', status: 'IN_PROGRESS', proposalId: 'mp1:b', resolvedCandidates: 1, totalCandidates: 3, blockedReason: null },
      { recipeId: 'r3', recipeTitle: 'Ready Recipe', status: 'READY_FOR_FINAL_REVIEW', proposalId: 'mp1:c', resolvedCandidates: 3, totalCandidates: 3, blockedReason: null },
      { recipeId: 'r4', recipeTitle: 'Approved Recipe', status: 'APPROVED', proposalId: 'mp1:d', resolvedCandidates: 5, totalCandidates: 5, blockedReason: null },
      { recipeId: 'r5', recipeTitle: 'Stale Recipe', status: 'STALE', proposalId: 'mp1:e', resolvedCandidates: 0, totalCandidates: 0, blockedReason: null },
      { recipeId: 'r6', recipeTitle: 'Blocked Recipe', status: 'BLOCKED', proposalId: 'mp1:f', resolvedCandidates: 0, totalCandidates: 2, blockedReason: 'DETERMINISTIC_EVIDENCE_FAILURE' },
    ])
    render(<MappingReviewQueuePage />)
    await waitFor(() => expect(screen.getByText('Needs Review Recipe')).toBeTruthy())
    expect(screen.getByText('In Progress Recipe')).toBeTruthy()
    expect(screen.getByText('Ready Recipe')).toBeTruthy()
    expect(screen.getByText('Approved Recipe')).toBeTruthy()
    expect(screen.getByText('Stale Recipe')).toBeTruthy()
    expect(screen.getByText('Blocked Recipe')).toBeTruthy()
    expect(screen.getAllByText('Needs review')).toHaveLength(1)
    expect(screen.getAllByText('Ready for final approval')).toHaveLength(1)
    expect(screen.getAllByText('Approved')).toHaveLength(1)
  })

  it('surfaces a load error with retry', async () => {
    mocks.fetchMappingReviewQueue.mockRejectedValueOnce(new Error('network down'))
    render(<MappingReviewQueuePage />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
  })
})
