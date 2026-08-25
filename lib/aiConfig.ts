import type { GatewayProviderOptions } from '@ai-sdk/gateway'

export const AI_PROVIDER = 'vercel-ai-gateway'
export const AI_MODEL = 'openai/gpt-5.6-luna'
export const AI_PROMPT_VERSION = 'v2'
export const AI_CACHE_VERSION = 'v2'

export const AI_CACHE_ID = [
  AI_CACHE_VERSION,
  AI_PROVIDER,
  AI_MODEL,
  AI_PROMPT_VERSION,
].join(':')

export const AI_PROVENANCE = {
  provider: AI_PROVIDER,
  model: AI_MODEL,
  prompt_version: AI_PROMPT_VERSION,
} as const

export function aiCacheKey(base: string, context?: string): string {
  return [base, AI_CACHE_ID, context].filter(Boolean).join(':')
}

export function aiGatewayProviderOptions(feature: string, userId?: string) {
  return {
    gateway: {
      ...(userId ? { user: userId } : {}),
      tags: [
        `feature:${feature}`,
        `prompt:${AI_PROMPT_VERSION}`,
        `cache:${AI_CACHE_VERSION}`,
      ],
    } satisfies GatewayProviderOptions,
  }
}
