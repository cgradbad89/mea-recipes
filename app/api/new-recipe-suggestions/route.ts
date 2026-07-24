import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthToken } from '@/lib/firebaseAdmin'
import { GoogleGenAI } from '@google/genai'

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuthToken(req)
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { topCuisines, topCategories, recentTitles } = await req.json()

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'API key not configured' }, { status: 500 })
    }
    const ai = new GoogleGenAI({ apiKey })

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
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        },
      })
      parsed = JSON.parse(response.text || '[]')
    } catch (err) {
      console.error('Gemini error:', err)
      return NextResponse.json({ error: 'AI request failed or could not parse response' }, { status: 500 })
    }

    return NextResponse.json(parsed)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
