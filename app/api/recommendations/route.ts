import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthToken } from '@/lib/firebaseAdmin'
import { generateAIObject } from '@/lib/ai'
import { z } from 'zod'

const RECOMMENDATION_SCHEMA = z.object({
  cookAgain: z.array(z.object({ title: z.string(), reason: z.string() })),
  tryNew: z.array(z.object({ title: z.string(), reason: z.string() })),
  longTime: z.array(z.object({ title: z.string(), reason: z.string() })),
})

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuthToken(req)
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { recipes, cookCounts, ratings, favorites } = await req.json()

    // Build taste profile summary
    const topCooked = Object.entries(cookCounts as Record<string, number>)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([id, count]) => {
        const r = recipes.find((r: any) => r.id === id)
        return r ? `${r.title} (${count}x, ${r.cuisine})` : null
      })
      .filter(Boolean)

    const topRated = Object.entries(ratings as Record<string, number>)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([id, rating]) => {
        const r = recipes.find((r: any) => r.id === id)
        return r ? `${r.title} (${rating}★, ${r.cuisine})` : null
      })
      .filter(Boolean)

    const favoriteTitles = (favorites as string[])
      .slice(0, 10)
      .map(id => {
        const r = recipes.find((r: any) => r.id === id)
        return r?.title
      })
      .filter(Boolean)

    // Cuisine frequency
    const cuisineCounts: Record<string, number> = {}
    Object.entries(cookCounts as Record<string, number>).forEach(([id, count]) => {
      const r = recipes.find((r: any) => r.id === id)
      if (r?.cuisine) cuisineCounts[r.cuisine] = (cuisineCounts[r.cuisine] || 0) + count
    })
    const topCuisines = Object.entries(cuisineCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([c, n]) => `${c} (${n} times)`)

    // Recent weeks - what was cooked in last 4 weeks
    const recentIds = new Set(Object.keys(cookCounts).filter(id => (cookCounts as Record<string, number>)[id] > 0))

    // Not cooked recently but highly rated
    const underutilized = recipes
      .filter((r: any) => {
        const rating = (ratings as Record<string, number>)[r.id] || 0
        return rating >= 4 && !recentIds.has(r.id)
      })
      .slice(0, 20)
      .map((r: any) => `${r.title} (${(ratings as Record<string, number>)[r.id]}★, ${r.cuisine})`)

    // Never cooked
    const neverCooked = recipes
      .filter((r: any) => !(cookCounts as Record<string, number>)[r.id])
      .slice(0, 30)
      .map((r: any) => `${r.title} (${r.cuisine}, ${r.category})`)

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

    let parsed: any
    try {
      parsed = await generateAIObject({
        feature: 'recommendations',
        userId: uid,
        prompt,
        schema: RECOMMENDATION_SCHEMA,
      })
    } catch (err) {
      console.error('AI Gateway error:', err)
      return NextResponse.json({ error: 'AI request failed or could not parse response' }, { status: 500 })
    }

    return NextResponse.json(parsed)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
