import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { verifyAuthToken } from '@/lib/firebaseAdmin'
import { ApiRequestError, readBoundedJson, safeErrorLogDetails } from '@/lib/apiRequest'
import { parseRecipeContent } from '@/lib/recipeContent'
import {
  buildHashedDeterministicCookingStepMap,
  hasAiEligibleCookingSteps,
} from '@/lib/cookingStepMapping'
import {
  countAiCookingMappings,
  mergeValidatedAiCookingMappings,
  resolveCookingStepMappingsWithAi,
} from '@/lib/cookingStepMappingAi'
import type { CookingStepMapApiResponse } from '@/types/recipe'

export const COOKING_STEP_MAP_MAX_BODY_BYTES = 128_000
export const COOKING_STEP_MAP_MAX_CONTENT_LENGTH = 64_000
export const COOKING_STEP_MAP_MAX_INGREDIENTS = 200
export const COOKING_STEP_MAP_MAX_INSTRUCTIONS = 150
export const COOKING_STEP_MAP_MAX_LINE_LENGTH = 4_000

const REQUEST_SCHEMA = z.object({
  content: z.string().min(1).max(COOKING_STEP_MAP_MAX_CONTENT_LENGTH),
})

function deterministicResponse(
  mapping: CookingStepMapApiResponse['mapping'],
  status: 'not_needed' | 'failed',
): CookingStepMapApiResponse {
  return {
    mapping,
    ai: {
      attempted: status === 'failed',
      status,
      resolvedIngredientReferences: 0,
      resolvedPreparedComponents: 0,
    },
  }
}

export async function POST(req: NextRequest) {
  let requestMetadata = { contentLength: 0, ingredientCount: 0, instructionCount: 0 }

  try {
    const uid = await verifyAuthToken(req)
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const requestResult = REQUEST_SCHEMA.safeParse(
      await readBoundedJson(req, COOKING_STEP_MAP_MAX_BODY_BYTES),
    )
    if (!requestResult.success) {
      return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
    }

    const { content } = requestResult.data
    const { ingredients, instructions } = parseRecipeContent(content)
    requestMetadata = {
      contentLength: content.length,
      ingredientCount: ingredients.length,
      instructionCount: instructions.length,
    }
    const sourceLines = [...ingredients, ...instructions]
    if (
      ingredients.length === 0 ||
      instructions.length === 0 ||
      ingredients.length > COOKING_STEP_MAP_MAX_INGREDIENTS ||
      instructions.length > COOKING_STEP_MAP_MAX_INSTRUCTIONS ||
      sourceLines.some(line => line.length > COOKING_STEP_MAP_MAX_LINE_LENGTH)
    ) {
      return NextResponse.json({ error: 'Invalid recipe content.' }, { status: 400 })
    }

    const deterministicMap = await buildHashedDeterministicCookingStepMap(ingredients, instructions)
    if (!hasAiEligibleCookingSteps(deterministicMap)) {
      return NextResponse.json(deterministicResponse(deterministicMap, 'not_needed'))
    }

    try {
      const modelOutput = await resolveCookingStepMappingsWithAi(
        deterministicMap,
        ingredients,
        instructions,
        uid,
      )
      const mapping = mergeValidatedAiCookingMappings(
        deterministicMap,
        ingredients,
        instructions,
        modelOutput,
      )
      const counts = countAiCookingMappings(mapping)
      const response: CookingStepMapApiResponse = {
        mapping,
        ai: { attempted: true, status: 'completed', ...counts },
      }
      return NextResponse.json(response)
    } catch (error) {
      console.error('[cooking-step-map] optional AI resolution failed', {
        error: safeErrorLogDetails(error),
        ...requestMetadata,
      })
      return NextResponse.json(deterministicResponse(deterministicMap, 'failed'))
    }
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[cooking-step-map] request failed', {
      error: safeErrorLogDetails(error),
      ...requestMetadata,
    })
    return NextResponse.json({ error: 'Unable to prepare cooking-step mapping.' }, { status: 500 })
  }
}
