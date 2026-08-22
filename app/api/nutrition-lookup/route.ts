import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthToken } from '@/lib/firebaseAdmin'
import { computeRecipeNutrition, lookupFoodByName } from '@/lib/nutritionEngine'
import { ApiRequestError, readBoundedJson, safeErrorLogDetails } from '@/lib/apiRequest'
import { enforceAbuseLimit } from '@/lib/apiAbuse'
import { z } from 'zod'

const EXTERNAL_LOOKUP_MAX_BODY_BYTES = 32_000
const REQUEST_SCHEMA = z.union([
  z.object({ type: z.literal('recipe'), recipeId: z.string().trim().min(1).max(256) }),
  z.object({ type: z.literal('food'), name: z.string().trim().min(1).max(500) }),
])

// Shared nutrition lookup endpoint (see nutrition-tracker-spec.md).
//   POST { type: "recipe", recipeId } → compute from the recipe's ingredients
//   POST { type: "food",   name }     → quick-food lookup by name (USDA → AI)
// Response: { nutrition, source, confidence, ... }

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuthToken(req)
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const abuseResponse = await enforceAbuseLimit(req, 'externalLookup', uid)
    if (abuseResponse) return abuseResponse

    const requestResult = REQUEST_SCHEMA.safeParse(
      await readBoundedJson(req, EXTERNAL_LOOKUP_MAX_BODY_BYTES),
    )
    if (!requestResult.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
    const body = requestResult.data

    if (body.type === 'recipe') {
      try {
        const { nutrition, unresolved, flagged } = await computeRecipeNutrition(body.recipeId)
        return NextResponse.json({
          nutrition,
          source: nutrition.source,
          confidence: nutrition.confidence,
          unresolved,
          flagged,
        })
      } catch (e) {
        const message = e instanceof Error ? e.message : ''
        const status = /not found/i.test(message) ? 404 : /no parseable/i.test(message) ? 422 : 500
        return NextResponse.json({ error: status === 500 ? 'Recipe lookup failed.' : 'Recipe could not be processed.' }, { status })
      }
    }

    // type === 'food'
    const result = await lookupFoodByName(body.name)
    if (!result) {
      return NextResponse.json(
        { error: 'Could not resolve food — try manual entry' },
        { status: 404 },
      )
    }
    return NextResponse.json({
      nutrition: result.nutrition,
      source: result.source,
      confidence: result.confidence,
      name: result.name,
      servingGrams: result.servingGrams,
      ...(result.aiProvenance ? { aiProvenance: result.aiProvenance } : {}),
    })
  } catch (err) {
    if (err instanceof ApiRequestError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[nutrition-lookup] request failed', { error: safeErrorLogDetails(err) })
    return NextResponse.json({ error: 'Unable to complete the request.' }, { status: 500 })
  }
}
