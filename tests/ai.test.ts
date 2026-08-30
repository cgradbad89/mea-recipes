import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  gateway: vi.fn((model: string) => ({ model })),
  object: vi.fn((value: unknown) => ({ kind: 'object', ...value as object })),
  array: vi.fn((value: unknown) => ({ kind: 'array', ...value as object })),
  withAIAbuseControl: vi.fn((
    _feature: string,
    _uid: string | undefined,
    operation: (profile: unknown) => Promise<unknown>,
    _usageClass?: string,
  ) => operation({
    windowMs: 600_000,
    windowLimit: 20,
    dailyLimit: 60,
    concurrencyLimit: 2,
    deadlineMs: 45_000,
    maxOutputTokens: 2_500,
  })),
}))

vi.mock('server-only', () => ({}))
vi.mock('@ai-sdk/gateway', () => ({ gateway: mocks.gateway }))
vi.mock('ai', () => ({
  generateText: mocks.generateText,
  Output: { object: mocks.object, array: mocks.array },
}))
vi.mock('@/lib/aiAbuseControl', () => ({
  withAIAbuseControl: mocks.withAIAbuseControl,
}))

import { generateAIArray, generateAIObject, generateAIText } from '@/lib/ai'

const usage = { inputTokens: 10, outputTokens: 4, totalTokens: 14 }

describe('central AI helpers', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })

  it('routes text generation through the single configured model without fallbacks', async () => {
    mocks.generateText.mockResolvedValueOnce({ text: 'done', usage })

    await expect(generateAIText({
      feature: 'assistant-test',
      userId: 'user-123',
      prompt: 'hello',
    })).resolves.toBe('done')

    expect(mocks.gateway).toHaveBeenCalledWith('openai/gpt-5.6-luna')
    const request = mocks.generateText.mock.calls[0][0]
    expect(request.providerOptions.gateway.user).toBe('user-123')
    expect(request.providerOptions.gateway).not.toHaveProperty('models')
    expect(request.providerOptions.gateway).not.toHaveProperty('order')
    expect(request).toMatchObject({ timeout: 45_000, maxRetries: 1, maxOutputTokens: 2_500 })
  })

  it('uses schema-constrained object and array outputs', async () => {
    const objectValue = { title: 'Soup' }
    const arrayValue = [{ title: 'Soup' }]
    const schema = z.object({ title: z.string() })
    mocks.generateText
      .mockResolvedValueOnce({ output: objectValue, usage })
      .mockResolvedValueOnce({ output: arrayValue, usage })

    await expect(generateAIObject({
      feature: 'object-test',
      prompt: 'object',
      schema,
    })).resolves.toEqual(objectValue)
    await expect(generateAIArray({
      feature: 'array-test',
      prompt: 'array',
      element: schema,
    })).resolves.toEqual(arrayValue)

    expect(mocks.object).toHaveBeenCalledWith({ schema })
    expect(mocks.array).toHaveBeenCalledWith({ element: schema })
  })

  it('clamps caller options and forwards an explicit usage class', async () => {
    mocks.generateText.mockResolvedValueOnce({ text: 'done', usage })

    await generateAIText({
      feature: 'nutrition-test',
      userId: 'user-123',
      usageClass: 'admin-batch',
      prompt: 'hello',
      timeout: 999_999,
      maxRetries: 99,
      maxOutputTokens: 99_999,
    })

    expect(mocks.generateText.mock.calls.at(-1)?.[0]).toMatchObject({
      timeout: 45_000,
      maxRetries: 1,
      maxOutputTokens: 2_500,
    })
    expect(mocks.withAIAbuseControl.mock.calls.at(-1)?.[3]).toBe('admin-batch')
  })
})
