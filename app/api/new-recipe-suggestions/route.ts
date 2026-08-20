import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthToken } from '@/lib/firebaseAdmin'
import { generateAIArray } from '@/lib/ai'
import { z } from 'zod'

const NEW_SUGGESTION_SCHEMA = z.object({
  title: z.string(),
  cuisine: z.string(),
  category: z.string(),
  description: z.string(),
  searchQuery: z.string(),
})

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuthToken(req)
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { topCuisines, topCategories, recentTitles } = await req.json()

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
    "category": "one of: Chicken & Poultry, Vegetarian Mains, Salads & Bowls, Pasta Noodles & Rice, Soups Stews & Chili, Seafood, Beef & Pork, Breakfast Snacks & Sides",
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

    let parsed: any
    try {
      parsed = await generateAIArray({
        feature: 'new-recipe-suggestions',
        userId: uid,
        prompt,
        element: NEW_SUGGESTION_SCHEMA,
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
