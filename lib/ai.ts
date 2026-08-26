import 'server-only'

import { generateText, Output, type LanguageModelUsage, type ModelMessage } from 'ai'
import { gateway } from '@ai-sdk/gateway'
import type { ZodType } from 'zod'
import {
  AI_MODEL,
  AI_PROMPT_VERSION,
  AI_PROVIDER,
  aiGatewayProviderOptions,
} from './aiConfig'

interface AIRequestBase {
  feature: string
  userId?: string
  system?: string
  promptVersion?: string
  temperature?: number
}

interface AIPromptRequest extends AIRequestBase {
  prompt: string
  messages?: never
}

interface AIMessageRequest extends AIRequestBase {
  prompt?: never
  messages: ModelMessage[]
}

type AIRequest = AIPromptRequest | AIMessageRequest

function requestInput(request: AIRequest): { prompt: string } | { messages: ModelMessage[] } {
  return request.prompt !== undefined
    ? { prompt: request.prompt }
    : { messages: request.messages }
}

function recordUsage(feature: string, usage: LanguageModelUsage, promptVersion: string = AI_PROMPT_VERSION): void {
  console.info('[ai-usage]', {
    provider: AI_PROVIDER,
    model: AI_MODEL,
    promptVersion,
    feature,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
  })
}

export async function generateAIText(request: AIRequest): Promise<string> {
  const result = await generateText({
    model: gateway(AI_MODEL),
    system: request.system,
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...requestInput(request),
    providerOptions: aiGatewayProviderOptions(request.feature, request.userId, request.promptVersion),
  })
  recordUsage(request.feature, result.usage, request.promptVersion)
  return result.text
}

export async function generateAIObject<T>(
  request: AIRequest & { schema: ZodType<T> },
): Promise<T> {
  const result = await generateText({
    model: gateway(AI_MODEL),
    system: request.system,
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...requestInput(request),
    output: Output.object({ schema: request.schema }),
    providerOptions: aiGatewayProviderOptions(request.feature, request.userId, request.promptVersion),
  })
  recordUsage(request.feature, result.usage, request.promptVersion)
  return result.output
}

export async function generateAIArray<T>(
  request: AIRequest & { element: ZodType<T> },
): Promise<T[]> {
  const result = await generateText({
    model: gateway(AI_MODEL),
    system: request.system,
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...requestInput(request),
    output: Output.array({ element: request.element }),
    providerOptions: aiGatewayProviderOptions(request.feature, request.userId, request.promptVersion),
  })
  recordUsage(request.feature, result.usage, request.promptVersion)
  return result.output
}
