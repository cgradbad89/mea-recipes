import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  generateImage: vi.fn(),
  imageModel: vi.fn((model: string) => ({ model })),
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
vi.mock('@ai-sdk/gateway', () => ({
  gateway: Object.assign(mocks.gateway, { imageModel: mocks.imageModel }),
}))
vi.mock('ai', () => ({
  generateText: mocks.generateText,
  generateImage: mocks.generateImage,
  Output: { object: mocks.object, array: mocks.array },
}))
vi.mock('@/lib/aiAbuseControl', () => ({
  withAIAbuseControl: mocks.withAIAbuseControl,
}))

import { generateAIArray, generateAIImage, generateAIObject, generateAIText } from '@/lib/ai'
import { AI_IMAGE_MODEL, AI_IMAGE_PROMPT_VERSION, aiGatewayProviderOptions } from '@/lib/aiConfig'

const usage = { inputTokens: 10, outputTokens: 4, totalTokens: 14 }
const image = { base64: 'private-image-bytes', mediaType: 'image/png', extra: 'private-response' }

describe('central AI helpers', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('generates exactly one configured image through the admin-batch boundary with safe metadata', async () => {
    mocks.generateImage.mockResolvedValueOnce({ images: [image], response: 'private-response' })
    await expect(generateAIImage({ feature: 'recipe-photo-generation', prompt: 'private-prompt' }))
      .resolves.toEqual({ base64: image.base64, mediaType: image.mediaType })
    expect(mocks.imageModel).toHaveBeenCalledExactlyOnceWith(AI_IMAGE_MODEL)
    expect(AI_IMAGE_MODEL).toBe('openai/gpt-image-2')
    expect(mocks.generateImage).toHaveBeenCalledTimes(1)
    expect(mocks.generateImage.mock.calls[0][0]).toMatchObject({
      model: { model: AI_IMAGE_MODEL },
      n: 1,
      size: '1024x1024',
      maxRetries: 1,
      abortSignal: expect.any(AbortSignal),
      providerOptions: aiGatewayProviderOptions('recipe-photo-generation', undefined, AI_IMAGE_PROMPT_VERSION),
    })
    expect(mocks.withAIAbuseControl).toHaveBeenCalledWith(
      'recipe-photo-generation', undefined, expect.any(Function), 'admin-batch',
    )
    expect(console.info).toHaveBeenCalledExactlyOnceWith('[ai-image-usage]', {
      provider: 'vercel-ai-gateway', model: AI_IMAGE_MODEL,
      promptVersion: AI_IMAGE_PROMPT_VERSION, feature: 'recipe-photo-generation',
      size: '1024x1024', imageCount: 1,
    })
    const logs = JSON.stringify(vi.mocked(console.info).mock.calls)
    for (const secret of ['private-prompt', image.base64, image.extra]) expect(logs).not.toContain(secret)
  })

  it('clamps retries, forwards verified identity/class and bounds logged metadata', async () => {
    for (const [requested, expected] of [[99, 1], [-1, 0], [0, 0], [0.5, 0], [NaN, 1], [Infinity, 1], [-Infinity, 0]]) {
      mocks.generateImage.mockResolvedValueOnce({ images: [image] })
      await generateAIImage({
        feature: 'x'.repeat(200), prompt: 'private-prompt', userId: 'private-uid',
        promptVersion: 'v'.repeat(200), usageClass: 'interactive', maxRetries: requested,
      })
      expect(mocks.generateImage.mock.calls.at(-1)?.[0].maxRetries).toBe(expected)
    }
    expect(mocks.withAIAbuseControl.mock.calls.at(-1)).toEqual([
      'x'.repeat(200), 'private-uid', expect.any(Function), 'interactive',
    ])
    expect(mocks.generateImage.mock.calls.at(-1)?.[0].providerOptions)
      .toEqual(aiGatewayProviderOptions('x'.repeat(200), 'private-uid', 'v'.repeat(200)))
    expect(vi.mocked(console.info).mock.calls.at(-1)?.[1]).toMatchObject({
      feature: 'x'.repeat(120), promptVersion: 'v'.repeat(120),
    })
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain('private-uid')
  })

  it('cancels pending provider work at the finite profile deadline, including invalid timeout inputs', async () => {
    vi.useFakeTimers()
    for (const [timeout, deadline] of [[undefined, 45_000], [999_999, 45_000], [NaN, 45_000], [Infinity, 45_000], [10, 10], [-1, 1]] as const) {
      mocks.generateImage.mockImplementationOnce(({ abortSignal }: { abortSignal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          abortSignal.addEventListener('abort', () => reject(abortSignal.reason), { once: true })
        }),
      )
      const pending = generateAIImage({ feature: 'image-test', prompt: 'private-prompt', timeout })
      const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      const signal = mocks.generateImage.mock.calls.at(-1)?.[0].abortSignal as AbortSignal
      await vi.advanceTimersByTimeAsync(deadline - 1)
      expect(signal.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await rejected
      expect(signal.aborted).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    }
    expect(console.info).not.toHaveBeenCalled()
  })

  it('clears the deadline after success or provider failure and rejects missing images without logging payloads', async () => {
    vi.useFakeTimers()
    mocks.generateImage.mockResolvedValueOnce({ images: [image] })
    await generateAIImage({ feature: 'image-test', prompt: 'private-prompt' })
    expect(vi.getTimerCount()).toBe(0)
    mocks.generateImage.mockRejectedValueOnce(new Error('provider-failed'))
    await expect(generateAIImage({ feature: 'image-test', prompt: 'private-prompt' }))
      .rejects.toThrow('provider-failed')
    mocks.generateImage.mockResolvedValueOnce({ images: [] })
    await expect(generateAIImage({ feature: 'image-test', prompt: 'private-prompt' }))
      .rejects.toThrow('AI image generation returned no image')
    expect(vi.getTimerCount()).toBe(0)
    expect(console.info).toHaveBeenCalledTimes(1)
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
