import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthToken } from '@/lib/firebaseAdmin'

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuthToken(req)
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { topCuisines, topCategories, recentTitles } = await req.json()

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'API key not configured' }, { status: 500 })
    }

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

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!response.ok) {
      return NextResponse.json({ error: 'AI request failed' }, { status: 500 })
    }

    const data = await response.json()
    const rawText = data.content?.[0]?.text || ''

    let parsed: any
    try {
      parsed = JSON.parse(rawText.trim())
    } catch {
      const match = rawText.match(/\[[\s\S]+\]/)
      if (match) {
        try { parsed = JSON.parse(match[0]) }
        catch { return NextResponse.json({ error: 'Could not parse response' }, { status: 500 }) }
      } else {
        return NextResponse.json({ error: 'Could not parse response' }, { status: 500 }) 
      }
    }

    return NextResponse.json(parsed)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
