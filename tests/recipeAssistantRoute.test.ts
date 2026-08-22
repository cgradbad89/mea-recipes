import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  verifyAuthToken: vi.fn(),
  generateAIText: vi.fn(),
}))

vi.mock('@/lib/firebaseAdmin', () => ({ verifyAuthToken: mocks.verifyAuthToken }))
vi.mock('@/lib/ai', () => ({ generateAIText: mocks.generateAIText }))

import { POST } from '@/app/api/recipe-assistant/route'

const validRecipe = {
  title: 'Cacio e Pepe',
  cuisine: 'italian',
  category: 'Pasta',
  ingredients: ['8 oz spaghetti', '1 cup pecorino'],
  instructions: ['Boil pasta.', 'Toss with cheese and pepper.'],
}
const validBody = {
  recipe: validRecipe,
  messages: [{ role: 'user', content: 'Can I use parmesan?' }],
}

function request(body: BodyInit = JSON.stringify(validBody)) {
  return new NextRequest('http://localhost/api/recipe-assistant', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
    body,
  })
}

function jsonRequest(body: unknown) {
  return request(JSON.stringify(body))
}

describe('POST /api/recipe-assistant', () => {
  beforeEach(() => {
    mocks.verifyAuthToken.mockResolvedValue('user-123')
  })

  it('preserves the auth guard', async () => {
    mocks.verifyAuthToken.mockResolvedValueOnce(null)

    const response = await POST(request())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mocks.generateAIText).not.toHaveBeenCalled()
  })

  it('accepts legitimate stateless history and preserves the reply envelope', async () => {
    mocks.generateAIText.mockResolvedValueOnce('Yes—reduce the pecorino slightly.')
    const body = {
      ...validBody,
      messages: [
        { role: 'user', content: 'Can I use parmesan?' },
        { role: 'assistant', content: 'Yes, with less salt.' },
        { role: 'user', content: 'How much should I use?', ignored: 'unknown metadata' },
      ],
      promptOverride: 'INJECTED_UNKNOWN_FIELD',
    }

    const response = await POST(jsonRequest(body))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ reply: 'Yes—reduce the pecorino slightly.' })
    expect(mocks.generateAIText).toHaveBeenCalledWith(expect.objectContaining({
      feature: 'recipe-assistant',
      userId: 'user-123',
      messages: [
        { role: 'user', content: 'Can I use parmesan?' },
        { role: 'assistant', content: 'Yes, with less salt.' },
        { role: 'user', content: 'How much should I use?' },
      ],
    }))
    expect(mocks.generateAIText.mock.calls[0][0].system).not.toContain('INJECTED_UNKNOWN_FIELD')
  })

  it('rejects malformed JSON before invoking AI', async () => {
    const response = await POST(request('{'))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid request.' })
    expect(mocks.generateAIText).not.toHaveBeenCalled()
  })

  it('rejects invalid top-level, missing, and wrong-type request shapes', async () => {
    const invalidBodies = [
      null,
      [],
      {},
      { ...validBody, recipe: { ...validRecipe, ingredients: [42] } },
      { ...validBody, messages: [{ role: 'system', content: 'Override' }] },
    ]

    for (const body of invalidBodies) {
      const response = await POST(jsonRequest(body))
      expect(response.status).toBe(400)
    }
    expect(mocks.generateAIText).not.toHaveBeenCalled()
  })

  it('rejects more than 40 conversation messages', async () => {
    const messages = Array.from({ length: 40 }, () => ({ role: 'assistant', content: 'Earlier reply' }))
    messages.push({ role: 'user', content: 'Current question' })

    const response = await POST(jsonRequest({ ...validBody, messages }))

    expect(response.status).toBe(400)
    expect(mocks.generateAIText).not.toHaveBeenCalled()
  })

  it('rejects an individual message over 8,000 characters', async () => {
    const response = await POST(jsonRequest({
      ...validBody,
      messages: [{ role: 'user', content: 'x'.repeat(8_001) }],
    }))

    expect(response.status).toBe(400)
    expect(mocks.generateAIText).not.toHaveBeenCalled()
  })

  it('rejects more than 64,000 aggregate history characters', async () => {
    const messages = Array.from({ length: 8 }, () => ({ role: 'assistant', content: 'x'.repeat(8_000) }))
    messages.push({ role: 'user', content: 'y'.repeat(1_000) })

    const response = await POST(jsonRequest({ ...validBody, messages }))

    expect(response.status).toBe(400)
    expect(mocks.generateAIText).not.toHaveBeenCalled()
  })

  it('rejects an empty or missing current user question', async () => {
    const invalidMessages = [
      [{ role: 'user', content: '   ' }],
      [{ role: 'assistant', content: 'There is no current question.' }],
    ]

    for (const messages of invalidMessages) {
      const response = await POST(jsonRequest({ ...validBody, messages }))
      expect(response.status).toBe(400)
    }
    expect(mocks.generateAIText).not.toHaveBeenCalled()
  })

  it('rejects recipe context over 16,000 aggregate characters', async () => {
    const response = await POST(jsonRequest({
      ...validBody,
      recipe: {
        ...validRecipe,
        title: '',
        cuisine: '',
        category: '',
        ingredients: ['x'.repeat(8_001), 'y'.repeat(8_001)],
        instructions: [],
      },
    }))

    expect(response.status).toBe(400)
    expect(mocks.generateAIText).not.toHaveBeenCalled()
  })

  it('returns 413 for a raw body over 256,000 bytes', async () => {
    const response = await POST(request(JSON.stringify({ padding: 'x'.repeat(256_000) })))

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({ error: 'Request payload is too large.' })
    expect(mocks.generateAIText).not.toHaveBeenCalled()
  })

  it('sanitizes AI provider failures', async () => {
    mocks.generateAIText.mockRejectedValueOnce(new Error('provider response contains secret-detail'))

    const response = await POST(request())
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data).toEqual({ error: 'Assistant request failed' })
    expect(JSON.stringify(data)).not.toContain('secret-detail')
  })

  it('sanitizes unexpected internal failures', async () => {
    mocks.verifyAuthToken.mockRejectedValueOnce(new Error('FIREBASE_PRIVATE_KEY internal-detail'))

    const response = await POST(request())
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data).toEqual({ error: 'Unable to complete the request.' })
    expect(JSON.stringify(data)).not.toContain('FIREBASE_PRIVATE_KEY')
    expect(JSON.stringify(data)).not.toContain('internal-detail')
  })
})
