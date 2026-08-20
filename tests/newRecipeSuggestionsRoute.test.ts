import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  verifyAuthToken: vi.fn(),
  generateAIArray: vi.fn(),
}))

vi.mock('@/lib/firebaseAdmin', () => ({ verifyAuthToken: mocks.verifyAuthToken }))
vi.mock('@/lib/ai', () => ({ generateAIArray: mocks.generateAIArray }))

import { POST } from '@/app/api/new-recipe-suggestions/route'

function request() {
  return new NextRequest('http://localhost/api/new-recipe-suggestions', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topCuisines: ['italian'],
      topCategories: ['Pasta Noodles & Rice'],
      recentTitles: ['Cacio e Pepe'],
    }),
  })
}

describe('POST /api/new-recipe-suggestions', () => {
  beforeEach(() => {
    mocks.verifyAuthToken.mockResolvedValue('user-123')
  })

  it('preserves the auth guard', async () => {
    mocks.verifyAuthToken.mockResolvedValueOnce(null)

    const response = await POST(request())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mocks.generateAIArray).not.toHaveBeenCalled()
  })

  it('preserves the successful response envelope and passes auth context', async () => {
    const suggestions = [{
      title: 'Pasta alla Norma',
      cuisine: 'italian',
      category: 'Pasta Noodles & Rice',
      description: 'A classic Sicilian pasta.',
      searchQuery: 'pasta alla norma recipe',
    }]
    mocks.generateAIArray.mockResolvedValueOnce(suggestions)

    const response = await POST(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(suggestions)
    expect(mocks.generateAIArray).toHaveBeenCalledWith(expect.objectContaining({
      feature: 'new-recipe-suggestions',
      userId: 'user-123',
      element: expect.anything(),
    }))
  })

  it('preserves the route error envelope when Gateway generation fails', async () => {
    mocks.generateAIArray.mockRejectedValueOnce(new Error('gateway unavailable'))

    const response = await POST(request())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'AI request failed or could not parse response',
    })
  })
})
