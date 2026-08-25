import { describe, expect, it } from 'vitest'
import {
  AI_CACHE_ID,
  AI_MODEL,
  AI_PROMPT_VERSION,
  AI_PROVENANCE,
  AI_PROVIDER,
  COOKING_STEP_MAPPING_PROMPT_VERSION,
  aiCacheKey,
  aiGatewayProviderOptions,
} from '@/lib/aiConfig'

describe('AI configuration', () => {
  it('uses the requested Gateway model and a model-aware cache identity', () => {
    expect(AI_MODEL).toBe('openai/gpt-5.6-luna')
    expect(AI_CACHE_ID).toContain(AI_PROVIDER)
    expect(AI_CACHE_ID).toContain(AI_MODEL)
    expect(AI_CACHE_ID).toContain(AI_PROMPT_VERSION)
    expect(aiGatewayProviderOptions('cooking-step-map', 'user-123', COOKING_STEP_MAPPING_PROMPT_VERSION))
      .toMatchObject({ gateway: { tags: expect.arrayContaining(['prompt:v1']) } })
  })

  it('does not reuse the legacy cache key', () => {
    const legacyKey = 'mea-recommendations-cache:user-123'
    const currentKey = aiCacheKey('mea-recommendations-cache', 'user-123')

    expect(currentKey).not.toBe(legacyKey)
    expect(currentKey).toContain(AI_CACHE_ID)
    expect(currentKey).toContain('user-123')
  })

  it('exports stable nutrition provenance fields', () => {
    expect(AI_PROVENANCE).toEqual({
      provider: 'vercel-ai-gateway',
      model: 'openai/gpt-5.6-luna',
      prompt_version: 'v2',
    })
  })
})
