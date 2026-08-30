import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthToken } from '@/lib/firebaseAdmin'
import { generateAIText } from '@/lib/ai'
import { ApiRequestError, readBoundedJson, safeErrorLogDetails } from '@/lib/apiRequest'
import type { ModelMessage } from 'ai'
import { z } from 'zod'
import { aiAbuseControlResponse } from '@/lib/aiAbuseControl'

const AI_STANDARD_MAX_BODY_BYTES = 256_000
const MAX_MESSAGE_COUNT = 40
const MAX_MESSAGE_LENGTH = 8_000
const MAX_HISTORY_LENGTH = 64_000
const MAX_RECIPE_CONTEXT_LENGTH = 16_000
const MAX_RECIPE_INGREDIENTS = 200
const MAX_RECIPE_INSTRUCTIONS = 150

type AssistantMessage = {
  role: 'user' | 'assistant'
  content: string
}

type AssistantRecipe = {
  title: string
  cuisine: string
  category: string
  ingredients: string[]
  instructions: string[]
}

type RecipeAssistantRequest = {
  recipe: AssistantRecipe
  messages: AssistantMessage[]
}

const CONTEXT_TEXT = z.string().max(MAX_RECIPE_CONTEXT_LENGTH)
const RECIPE_SCHEMA: z.ZodType<AssistantRecipe> = z.object({
  title: CONTEXT_TEXT,
  cuisine: CONTEXT_TEXT,
  category: CONTEXT_TEXT,
  ingredients: z.array(CONTEXT_TEXT).max(MAX_RECIPE_INGREDIENTS),
  instructions: z.array(CONTEXT_TEXT).max(MAX_RECIPE_INSTRUCTIONS),
})
const MESSAGE_SCHEMA: z.ZodType<AssistantMessage> = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(MAX_MESSAGE_LENGTH),
})
const REQUEST_SCHEMA: z.ZodType<RecipeAssistantRequest> = z.object({
  recipe: RECIPE_SCHEMA,
  messages: z.array(MESSAGE_SCHEMA).min(1).max(MAX_MESSAGE_COUNT),
}).superRefine((value, context) => {
  const historyLength = value.messages.reduce((sum, message) => sum + message.content.length, 0)
  if (historyLength > MAX_HISTORY_LENGTH) {
    context.addIssue({ code: 'custom', message: 'Conversation history is too large.' })
  }

  const currentQuestion = value.messages.at(-1)
  if (currentQuestion?.role !== 'user' || !currentQuestion.content.trim()) {
    context.addIssue({ code: 'custom', message: 'A current question is required.' })
  }

  const recipeContextLength = [
    value.recipe.title,
    value.recipe.cuisine,
    value.recipe.category,
    ...value.recipe.ingredients,
    ...value.recipe.instructions,
  ].reduce((sum, part) => sum + part.length, 0)
  if (recipeContextLength > MAX_RECIPE_CONTEXT_LENGTH) {
    context.addIssue({ code: 'custom', message: 'Recipe context is too large.' })
  }
})

export async function POST(req: NextRequest) {
  let requestMetadata = { messageCount: 0, historyLength: 0, recipeContextLength: 0 }

  try {
    const uid = await verifyAuthToken(req)
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const requestResult = REQUEST_SCHEMA.safeParse(
      await readBoundedJson(req, AI_STANDARD_MAX_BODY_BYTES),
    )
    if (!requestResult.success) {
      return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
    }

    const { recipe, messages } = requestResult.data
    const { ingredients, instructions } = recipe
    requestMetadata = {
      messageCount: messages.length,
      historyLength: messages.reduce((sum, message) => sum + message.content.length, 0),
      recipeContextLength: [
        recipe.title,
        recipe.cuisine,
        recipe.category,
        ...ingredients,
        ...instructions,
      ].reduce((sum, part) => sum + part.length, 0),
    }

    const systemPrompt = `You are a helpful, practical cooking assistant for one specific recipe. Answer the user's questions about THIS recipe only — ingredient substitutions, variations, scaling servings up or down, dietary modifications (vegetarian, vegan, gluten-free, healthier, etc.), and technique.

Keep answers concise and practical. Use short lists or steps when it helps. Do not invent a different recipe — ground every suggestion in the recipe below.

RECIPE
Title: ${recipe.title || 'Untitled'}
Cuisine: ${recipe.cuisine || 'unspecified'}
Category: ${recipe.category || 'unspecified'}

Ingredients:
${ingredients.length ? ingredients.map(i => `- ${i}`).join('\n') : '- (none provided)'}

Instructions:
${instructions.length ? instructions.map((s, i) => `${i + 1}. ${s}`).join('\n') : '(none provided)'}`

    try {
      const formattedMessages: ModelMessage[] = messages.map(message => ({
        role: message.role,
        content: message.content,
      }))

      const reply = await generateAIText({
        feature: 'recipe-assistant',
        userId: uid,
        system: systemPrompt,
        messages: formattedMessages,
      })
      return NextResponse.json({ reply })
    } catch (err) {
      const limited = aiAbuseControlResponse(err)
      if (limited) return limited
      console.error('[recipe-assistant] AI request failed', {
        error: safeErrorLogDetails(err),
        ...requestMetadata,
      })
      return NextResponse.json({ error: 'Assistant request failed' }, { status: 500 })
    }
  } catch (err) {
    const limited = aiAbuseControlResponse(err)
    if (limited) return limited
    if (err instanceof ApiRequestError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[recipe-assistant] request failed', {
      error: safeErrorLogDetails(err),
      ...requestMetadata,
    })
    return NextResponse.json({ error: 'Unable to complete the request.' }, { status: 500 })
  }
}
