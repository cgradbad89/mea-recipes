import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthToken } from '@/lib/firebaseAdmin'
import { generateAIArray } from '@/lib/ai'
import { ApiRequestError, readBoundedJson, safeErrorLogDetails } from '@/lib/apiRequest'
import { z } from 'zod'
import { RECIPE_CATEGORIES } from '@/lib/recipeCategories'

const AI_STANDARD_MAX_BODY_BYTES = 256_000
const MAX_COLLECTION_SIZE = 500
const MAX_TEXT_LENGTH = 2_000

type NewRecipeSuggestionsRequest = {
  topCuisines: string[]
  topCategories: string[]
  recentTitles: string[]
}

const BOUNDED_TEXT = z.string().max(MAX_TEXT_LENGTH)
const REQUEST_SCHEMA: z.ZodType<NewRecipeSuggestionsRequest> = z.object({
  topCuisines: z.array(BOUNDED_TEXT).max(MAX_COLLECTION_SIZE),
  topCategories: z.array(BOUNDED_TEXT).max(MAX_COLLECTION_SIZE),
  recentTitles: z.array(BOUNDED_TEXT).max(MAX_COLLECTION_SIZE),
})

export const NEW_SUGGESTION_SCHEMA = z.object({
  title: z.string(),
  cuisine: z.string(),
  category: z.enum(RECIPE_CATEGORIES),
  description: z.string(),
  searchQuery: z.string(),
})

export async function POST(req: NextRequest) {
  let requestMetadata = {
    topCuisineCount: 0,
    topCategoryCount: 0,
    recentTitleCount: 0,
  }

  try {
    const uid = await verifyAuthToken(req)
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const requestResult = REQUEST_SCHEMA.safeParse(
      await readBoundedJson(req, AI_STANDARD_MAX_BODY_BYTES),
    )
    if (!requestResult.success) {
      return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
    }

    const { topCuisines, topCategories, recentTitles } = requestResult.data
    requestMetadata = {
      topCuisineCount: topCuisines.length,
      topCategoryCount: topCategories.length,
      recentTitleCount: recentTitles.length,
    }

    const categoryVocabulary = JSON.stringify(RECIPE_CATEGORIES)
    const prompt = `You are a chef and food writer. Suggest 6 specific recipes this person doesn't have yet based on their taste profile.

THEIR TASTE PROFILE:
Favorite cuisines: ${topCuisines.join(', ') || 'varied'}
Favorite categories: ${topCategories.join(', ') || 'varied'}
Recent recipes they cook: ${recentTitles.slice(0, 8).join(', ') || 'unknown'}

Return ONLY a JSON array with no markdown, no backticks:
[
  {
    "title": "Specific Recipe Name",
    "cuisine": "cuisine (lowercase)",
    "category": "one exact value from ${categoryVocabulary}",
    "description": "2 sentence description of the dish and why they'd love it",
    "searchQuery": "simple google-friendly search query to find this recipe e.g. 'ottolenghi roasted eggplant recipe'"
  }
]

Rules:
- Suggest real, specific dishes with well-known names (not vague like "chicken stir fry")
- Mix some dishes similar to what they love with 1-2 adventurous picks
- Keep descriptions enticing and personal
- searchQuery should help them find a great version of this recipe online
- Return ONLY the JSON array, nothing else`

    try {
      const parsed = await generateAIArray({
        feature: 'new-recipe-suggestions',
        userId: uid,
        prompt,
        element: NEW_SUGGESTION_SCHEMA,
      })
      return NextResponse.json(parsed)
    } catch (err) {
      console.error('[new-recipe-suggestions] AI request failed', {
        error: safeErrorLogDetails(err),
        ...requestMetadata,
      })
      return NextResponse.json({ error: 'AI request failed or could not parse response' }, { status: 500 })
    }
  } catch (err) {
    if (err instanceof ApiRequestError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[new-recipe-suggestions] request failed', {
      error: safeErrorLogDetails(err),
      ...requestMetadata,
    })
    return NextResponse.json({ error: 'Unable to complete the request.' }, { status: 500 })
  }
}
