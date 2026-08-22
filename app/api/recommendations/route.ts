import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthToken } from '@/lib/firebaseAdmin'
import { generateAIObject } from '@/lib/ai'
import { ApiRequestError, readBoundedJson, safeErrorLogDetails } from '@/lib/apiRequest'
import { z } from 'zod'

const AI_STANDARD_MAX_BODY_BYTES = 256_000
const MAX_COLLECTION_SIZE = 500
const MAX_TEXT_LENGTH = 2_000

type RecommendationRecipe = {
  id: string
  title: string
  cuisine: string
  category: string
}

type RecommendationsRequest = {
  recipes: RecommendationRecipe[]
  cookCounts: Record<string, number>
  ratings: Record<string, number>
  favorites: string[]
}

const BOUNDED_TEXT = z.string().max(MAX_TEXT_LENGTH)
const RECIPE_SCHEMA: z.ZodType<RecommendationRecipe> = z.object({
  id: BOUNDED_TEXT,
  title: BOUNDED_TEXT,
  cuisine: BOUNDED_TEXT,
  category: BOUNDED_TEXT,
})
const COOK_COUNTS_SCHEMA: z.ZodType<Record<string, number>> = z.record(
  BOUNDED_TEXT,
  z.number().int().nonnegative(),
).refine(value => Object.keys(value).length <= MAX_COLLECTION_SIZE)
const RATINGS_SCHEMA: z.ZodType<Record<string, number>> = z.record(
  BOUNDED_TEXT,
  z.number().min(0).max(5),
).refine(value => Object.keys(value).length <= MAX_COLLECTION_SIZE)
const REQUEST_SCHEMA: z.ZodType<RecommendationsRequest> = z.object({
  recipes: z.array(RECIPE_SCHEMA).max(MAX_COLLECTION_SIZE),
  cookCounts: COOK_COUNTS_SCHEMA,
  ratings: RATINGS_SCHEMA,
  favorites: z.array(BOUNDED_TEXT).max(MAX_COLLECTION_SIZE),
})

const RECOMMENDATION_SCHEMA = z.object({
  cookAgain: z.array(z.object({ title: z.string(), reason: z.string() })),
  tryNew: z.array(z.object({ title: z.string(), reason: z.string() })),
  longTime: z.array(z.object({ title: z.string(), reason: z.string() })),
})

export async function POST(req: NextRequest) {
  let requestMetadata = {
    recipeCount: 0,
    cookCountEntries: 0,
    ratingEntries: 0,
    favoriteCount: 0,
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

    const { recipes, cookCounts, ratings, favorites } = requestResult.data
    requestMetadata = {
      recipeCount: recipes.length,
      cookCountEntries: Object.keys(cookCounts).length,
      ratingEntries: Object.keys(ratings).length,
      favoriteCount: favorites.length,
    }

    // Build taste profile summary
    const topCooked = Object.entries(cookCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([id, count]) => {
        const r = recipes.find(recipe => recipe.id === id)
        return r ? `${r.title} (${count}x, ${r.cuisine})` : null
      })
      .filter(Boolean)

    const topRated = Object.entries(ratings)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([id, rating]) => {
        const r = recipes.find(recipe => recipe.id === id)
        return r ? `${r.title} (${rating}★, ${r.cuisine})` : null
      })
      .filter(Boolean)

    const favoriteTitles = favorites
      .slice(0, 10)
      .map(id => {
        const r = recipes.find(recipe => recipe.id === id)
        return r?.title
      })
      .filter(Boolean)

    // Cuisine frequency
    const cuisineCounts: Record<string, number> = {}
    Object.entries(cookCounts).forEach(([id, count]) => {
      const r = recipes.find(recipe => recipe.id === id)
      if (r?.cuisine) cuisineCounts[r.cuisine] = (cuisineCounts[r.cuisine] || 0) + count
    })
    const topCuisines = Object.entries(cuisineCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([c, n]) => `${c} (${n} times)`)

    // Recent weeks - what was cooked in last 4 weeks
    const recentIds = new Set(Object.keys(cookCounts).filter(id => cookCounts[id] > 0))

    // Not cooked recently but highly rated
    const underutilized = recipes
      .filter(recipe => {
        const rating = ratings[recipe.id] || 0
        return rating >= 4 && !recentIds.has(recipe.id)
      })
      .slice(0, 20)
      .map(recipe => `${recipe.title} (${ratings[recipe.id]}★, ${recipe.cuisine})`)

    // Never cooked
    const neverCooked = recipes
      .filter(recipe => !cookCounts[recipe.id])
      .slice(0, 30)
      .map(recipe => `${recipe.title} (${recipe.cuisine}, ${recipe.category})`)

    const prompt = `You are a personal chef advisor. Based on this person's cooking history, suggest recipes from their collection.

THEIR TASTE PROFILE:
Most cooked: ${topCooked.join(', ') || 'none yet'}
Top rated: ${topRated.join(', ') || 'none yet'}
Favorites: ${favoriteTitles.join(', ') || 'none yet'}
Favorite cuisines: ${topCuisines.join(', ') || 'unknown'}

AVAILABLE RECIPES:
Highly rated but not cooked recently: ${underutilized.join(', ') || 'none'}
Never tried: ${neverCooked.join(', ') || 'none'}

Return ONLY a JSON object with no markdown, no backticks:
{
  "cookAgain": [
    { "title": "exact recipe title from their collection", "reason": "1 sentence why" }
  ],
  "tryNew": [
    { "title": "exact recipe title from their collection", "reason": "1 sentence why" }
  ],
  "longTime": [
    { "title": "exact recipe title from their collection", "reason": "1 sentence why" }
  ]
}

Rules:
- cookAgain: 4 recipes they've cooked before and should make again soon
- tryNew: 4 recipes they've never cooked (from the never tried list)
- longTime: 4 highly-rated recipes they haven't made recently
- ONLY use exact recipe titles from the lists I provided
- Keep reasons short and personal based on their taste profile
- Return ONLY the JSON, nothing else`

    try {
      const parsed = await generateAIObject({
        feature: 'recommendations',
        userId: uid,
        prompt,
        schema: RECOMMENDATION_SCHEMA,
      })
      return NextResponse.json(parsed)
    } catch (err) {
      console.error('[recommendations] AI request failed', {
        error: safeErrorLogDetails(err),
        ...requestMetadata,
      })
      return NextResponse.json({ error: 'AI request failed or could not parse response' }, { status: 500 })
    }
  } catch (err) {
    if (err instanceof ApiRequestError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[recommendations] request failed', {
      error: safeErrorLogDetails(err),
      ...requestMetadata,
    })
    return NextResponse.json({ error: 'Unable to complete the request.' }, { status: 500 })
  }
}
