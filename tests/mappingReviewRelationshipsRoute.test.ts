import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  verifyAdminToken: vi.fn(),
  addHumanMappingRelationship: vi.fn(),
  removeHumanMappingRelationship: vi.fn(),
  getRecipeById: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/firebaseAdmin', () => ({ verifyAdminToken: mocks.verifyAdminToken }))
vi.mock('@/lib/recipes', () => ({ getRecipeById: mocks.getRecipeById }))
vi.mock('@/lib/cookingModeMappingHumanRelationship', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/cookingModeMappingHumanRelationship')>()
  return {
    ...actual,
    addHumanMappingRelationship: mocks.addHumanMappingRelationship,
    removeHumanMappingRelationship: mocks.removeHumanMappingRelationship,
  }
})

import { POST, DELETE } from '@/app/api/mapping-review/[recipeId]/relationships/route'
import {
  AddHumanMappingRelationshipRejectedError,
  RemoveHumanMappingRelationshipRejectedError,
} from '@/lib/cookingModeMappingHumanRelationship'

function ctx(recipeId = 'recipe-1') {
  return { params: Promise.resolve({ recipeId }) }
}

function request(method: 'POST' | 'DELETE', body: unknown) {
  return new NextRequest('http://localhost/api/mapping-review/recipe-1/relationships', {
    method,
    headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const fixtureRecipe = {
  id: 'recipe-1', recipeID: 'recipe-1', title: 'R', content: 'INGREDIENTS\n1 egg\n\nINSTRUCTIONS\nStep 1\nCrack the egg.',
  category: 'Dinner', cuisine: '', imageURL: '', sourceURL: '', sourceFile: '', labels: '', hasImage: 'false', created: '', modified: '',
}

const addBody = { proposalId: 'mp1:a', recipeRevision: 'v1:sha256:a', ingredientRowIndex: 0, stepIndex: 0 }
const removeBody = { proposalId: 'mp1:a', candidateId: 'mc1:a', recipeRevision: 'v1:sha256:a', reasonCode: 'OTHER', note: 'oops' }

describe('POST /api/mapping-review/[recipeId]/relationships (add)', () => {
  beforeEach(() => {
    mocks.verifyAdminToken.mockReset()
    mocks.addHumanMappingRelationship.mockReset()
    mocks.getRecipeById.mockReset().mockResolvedValue(fixtureRecipe)
  })

  it('rejects an unauthenticated caller', async () => {
    mocks.verifyAdminToken.mockResolvedValueOnce(null)
    const response = await POST(request('POST', addBody), ctx())
    expect(response.status).toBe(401)
    expect(mocks.addHumanMappingRelationship).not.toHaveBeenCalled()
  })

  it('rejects an invalid body', async () => {
    mocks.verifyAdminToken.mockResolvedValueOnce('admin-uid')
    const response = await POST(request('POST', { proposalId: 'mp1:a' }), ctx())
    expect(response.status).toBe(400)
  })

  it('derives addedBy from the verified token and re-derives source from the live recipe, never the client', async () => {
    mocks.verifyAdminToken.mockResolvedValueOnce('admin-uid')
    mocks.addHumanMappingRelationship.mockResolvedValueOnce({ outcome: 'CREATED', candidate: {} })
    const response = await POST(request('POST', { ...addBody, addedBy: 'someone-else', source: { ingredients: ['fake'] } }), ctx())
    expect(response.status).toBe(200)
    expect(mocks.addHumanMappingRelationship).toHaveBeenCalledWith(
      expect.objectContaining({ addedBy: 'admin-uid', source: expect.objectContaining({ recipeId: 'recipe-1' }) }),
    )
  })

  it('maps a rejected add to a sanitized 409', async () => {
    mocks.verifyAdminToken.mockResolvedValueOnce('admin-uid')
    mocks.addHumanMappingRelationship.mockRejectedValueOnce(
      new AddHumanMappingRelationshipRejectedError('REVISION_MISMATCH', 'internal detail'),
    )
    const response = await POST(request('POST', addBody), ctx())
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.error).not.toContain('internal detail')
  })
})

describe('DELETE /api/mapping-review/[recipeId]/relationships (remove)', () => {
  beforeEach(() => {
    mocks.verifyAdminToken.mockReset()
    mocks.removeHumanMappingRelationship.mockReset()
  })

  it('rejects an unauthenticated caller', async () => {
    mocks.verifyAdminToken.mockResolvedValueOnce(null)
    const response = await DELETE(request('DELETE', removeBody), ctx())
    expect(response.status).toBe(401)
    expect(mocks.removeHumanMappingRelationship).not.toHaveBeenCalled()
  })

  it('derives removedBy from the verified token', async () => {
    mocks.verifyAdminToken.mockResolvedValueOnce('admin-uid')
    mocks.removeHumanMappingRelationship.mockResolvedValueOnce({ decisionId: 'mr1:x' })
    const response = await DELETE(request('DELETE', { ...removeBody, removedBy: 'someone-else' }), ctx())
    expect(response.status).toBe(200)
    expect(mocks.removeHumanMappingRelationship).toHaveBeenCalledWith(expect.objectContaining({ removedBy: 'admin-uid' }))
  })

  it('maps NOT_HUMAN_ADDED to a sanitized 409', async () => {
    mocks.verifyAdminToken.mockResolvedValueOnce('admin-uid')
    mocks.removeHumanMappingRelationship.mockRejectedValueOnce(
      new RemoveHumanMappingRelationshipRejectedError('NOT_HUMAN_ADDED', 'internal detail'),
    )
    const response = await DELETE(request('DELETE', removeBody), ctx())
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.error).not.toContain('internal detail')
  })
})
