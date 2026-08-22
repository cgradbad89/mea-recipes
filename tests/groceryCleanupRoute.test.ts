import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  verifyAuthToken: vi.fn(),
  generateAIArray: vi.fn(),
  generateAIObject: vi.fn(),
}))

vi.mock('@/lib/firebaseAdmin', () => ({ verifyAuthToken: mocks.verifyAuthToken }))
vi.mock('@/lib/ai', () => ({
  generateAIArray: mocks.generateAIArray,
  generateAIObject: mocks.generateAIObject,
}))

import { POST } from '@/app/api/grocery-cleanup/route'
import { GROCERY_CATEGORIES } from '@/lib/groceryCategories'

function request(body: unknown) {
  return new NextRequest('http://localhost/api/grocery-cleanup', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/grocery-cleanup', () => {
  beforeEach(() => {
    mocks.verifyAuthToken.mockReset().mockResolvedValue('user-123')
    mocks.generateAIArray.mockReset()
    mocks.generateAIObject.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('preserves authentication behavior', async () => {
    mocks.verifyAuthToken.mockResolvedValueOnce(null)

    const response = await POST(request({ items: [] }))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mocks.generateAIArray).not.toHaveBeenCalled()
  })

  it('preserves successful whole-list cleanup behavior', async () => {
    mocks.generateAIArray.mockResolvedValueOnce([{
      originalIndex: 0,
      name: 'garlic',
      quantity: '',
      unit: '',
      category: 'Produce',
      action: 'normalize',
      mergedWith: [],
    }])

    const response = await POST(request({
      items: [{ name: 'Garlic', quantity: '', unit: '', manualSection: 'Produce' }],
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual([{
      originalIndex: 0,
      name: 'garlic',
      quantity: '',
      unit: '',
      category: 'Produce',
      action: 'normalize',
      mergedWith: [],
    }])
    expect(mocks.generateAIArray).toHaveBeenCalledWith(expect.objectContaining({
      feature: 'grocery-cleanup',
      userId: 'user-123',
    }))
    const prompt = mocks.generateAIArray.mock.calls[0][0].prompt as string
    expect(prompt).toContain(GROCERY_CATEGORIES.join(', '))
    expect(prompt).not.toContain('Canned / Jarred / Sauces')
    expect(prompt).not.toContain('"Staples" =')
  })

  it('preserves successful parse-line behavior', async () => {
    mocks.generateAIObject.mockResolvedValueOnce({
      quantity: '2',
      unit: 'cups',
      name: 'flour',
    })

    const response = await POST(request({ mode: 'parse-line', line: '2 cups flour' }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ quantity: '2', unit: 'cups', name: 'flour' })
    expect(mocks.generateAIObject).toHaveBeenCalledWith(expect.objectContaining({
      feature: 'grocery-parse-line',
      userId: 'user-123',
    }))
  })

  it('sanitizes unexpected failures while retaining server diagnostics', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.verifyAuthToken.mockRejectedValueOnce(new Error('provider-secret-debug-message'))

    const response = await POST(request({ items: [] }))
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data).toEqual({ error: 'Unable to complete the request.' })
    expect(JSON.stringify(data)).not.toContain('provider-secret-debug-message')
    expect(consoleError).toHaveBeenCalledWith(
      '[grocery-cleanup] request failed',
      expect.objectContaining({ mode: 'unknown', itemCount: 0, error: expect.any(Object) }),
    )
  })
})
