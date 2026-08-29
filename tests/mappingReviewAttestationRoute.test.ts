import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  verifyAdminToken: vi.fn(),
  recordMappingCompletenessAttestation: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/firebaseAdmin', () => ({ verifyAdminToken: mocks.verifyAdminToken }))
vi.mock('@/lib/cookingModeMappingCompletenessAttestation', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/cookingModeMappingCompletenessAttestation')>()
  return { ...actual, recordMappingCompletenessAttestation: mocks.recordMappingCompletenessAttestation }
})

import { POST } from '@/app/api/mapping-review/[recipeId]/attestation/route'
import { MappingCompletenessAttestationRejectedError } from '@/lib/cookingModeMappingCompletenessAttestation'

function ctx(recipeId = 'recipe-1') {
  return { params: Promise.resolve({ recipeId }) }
}

function request(body: unknown) {
  return new NextRequest('http://localhost/api/mapping-review/recipe-1/attestation', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const validBody = { proposalId: 'mp1:a', recipeRevision: 'v1:sha256:a' }

describe('POST /api/mapping-review/[recipeId]/attestation', () => {
  beforeEach(() => {
    mocks.verifyAdminToken.mockReset()
    mocks.recordMappingCompletenessAttestation.mockReset()
  })

  it('rejects an unauthenticated caller', async () => {
    mocks.verifyAdminToken.mockResolvedValueOnce(null)
    const response = await POST(request(validBody), ctx())
    expect(response.status).toBe(401)
    expect(mocks.recordMappingCompletenessAttestation).not.toHaveBeenCalled()
  })

  it('derives attestedBy from the verified token', async () => {
    mocks.verifyAdminToken.mockResolvedValueOnce('admin-uid')
    mocks.recordMappingCompletenessAttestation.mockResolvedValueOnce({ attestationId: 'ma1:x' })
    const response = await POST(request({ ...validBody, attestedBy: 'someone-else' }), ctx())
    expect(response.status).toBe(200)
    expect(mocks.recordMappingCompletenessAttestation).toHaveBeenCalledWith(
      expect.objectContaining({ recipeId: 'recipe-1', attestedBy: 'admin-uid' }),
    )
  })

  it('maps PROPOSAL_NOT_FULLY_RESOLVED to a sanitized 409', async () => {
    mocks.verifyAdminToken.mockResolvedValueOnce('admin-uid')
    mocks.recordMappingCompletenessAttestation.mockRejectedValueOnce(
      new MappingCompletenessAttestationRejectedError('PROPOSAL_NOT_FULLY_RESOLVED', 'internal detail'),
    )
    const response = await POST(request(validBody), ctx())
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.error).not.toContain('internal detail')
  })
})
