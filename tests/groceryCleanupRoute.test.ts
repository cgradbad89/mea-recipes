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
import { requestGroceryCleanup } from '@/lib/groceryCleanup'
import type { GroceryItem } from '@/lib/userdata'

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

  it('rejects direct oversized requests with actionable feedback before AI processing', async () => {
    const items = Array.from({ length: 103 }, (_, index) => ({
      name: `Ingredient ${index}`, quantity: '1', unit: '', isChecked: index >= 70,
    }))
    const response = await POST(request({ items }))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Too many items for one cleanup request. The maximum is 100.', code: 'TOO_MANY_ITEMS',
    })
    expect(mocks.generateAIArray).not.toHaveBeenCalled()
  })

  it('reviews the reported 103-item fixture through the client/API boundary with only 70 eligible items', async () => {
    const items: GroceryItem[] = Array.from({ length: 103 }, (_, index) => ({
      id: `item-${index}`, name: `Tomato ${String.fromCharCode(65 + index)}`, quantity: '1', unit: '',
      isChecked: index >= 70, isManual: true, sourceRecipeIDs: [],
    }))
    const original = structuredClone(items)
    mocks.generateAIArray.mockResolvedValueOnce([])
    const sizes: number[] = []
    const plan = await requestGroceryCleanup(items, async batch => {
      sizes.push(batch.length)
      const response = await POST(request({ items: batch }))
      expect(response.status).toBe(200)
      return response.json()
    })
    expect(sizes).toEqual([70])
    expect(plan.items.map(item => item.id)).toEqual(items.slice(0, 70).map(item => item.id))
    expect(mocks.generateAIArray).toHaveBeenCalledOnce()
    expect(items).toEqual(original)
    const prompt = mocks.generateAIArray.mock.calls[0][0].prompt as string
    expect(prompt).not.toContain('70:')
  })

  it('rejects malformed model output without returning a partial cleanup plan', async () => {
    mocks.generateAIArray.mockResolvedValueOnce([{
      originalIndex: 0, name: 'milk', quantity: '1', unit: 'cup', category: 'Dairy & Eggs',
      action: 'merge', mergedWith: [103],
    }])
    const response = await POST(request({ items: [{ name: 'milk' }] }))
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'Cleanup could not be completed safely. Please try again.' })
  })

  it('sanitizes provider outages into temporary-unavailability feedback', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.generateAIArray.mockRejectedValueOnce(new Error('private provider details'))
    const response = await POST(request({ items: [{ name: 'milk' }] }))
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'Cleanup is temporarily unavailable. Please try again later.' })
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
      maxRetries: 0,
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
