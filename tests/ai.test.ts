import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  gateway: vi.fn((model: string) => ({ model })),
  object: vi.fn((value: unknown) => ({ kind: 'object', ...value as object })),
  array: vi.fn((value: unknown) => ({ kind: 'array', ...value as object })),
}))

vi.mock('server-only', () => ({}))
vi.mock('@ai-sdk/gateway', () => ({ gateway: mocks.gateway }))
vi.mock('ai', () => ({
  generateText: mocks.generateText,
  Output: { object: mocks.object, array: mocks.array },
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
})
