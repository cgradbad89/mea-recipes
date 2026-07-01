import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthToken } from '@/lib/firebaseAdmin'
import { getComplementaryIngredients } from '@/lib/flavorPairings'

interface PlannedRecipeIn {
  title: string
  category?: string
  cuisine?: string
  ingredients?: string
}

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuthToken(req)
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { mode, plannedRecipes, existingRecipeTitles } = await req.json() as {
      weekID: string
      mode: 'existing' | 'new' | 'both'
      plannedRecipes: PlannedRecipeIn[]
      existingRecipeTitles: string[]
    }

    if (!plannedRecipes || !Array.isArray(plannedRecipes) || plannedRecipes.length === 0) {
      return NextResponse.json({ error: 'No planned recipes provided' }, { status: 400 })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'API key not configured' }, { status: 500 })

    const plannedSummary = plannedRecipes.map((r, i) => {
      // Strip giant content blobs for prompt size — just take first ~400 chars
      const ingSnippet = (r.ingredients || '').slice(0, 400).replace(/\s+/g, ' ').trim()
      return `${i + 1}. ${r.title} — cuisine: ${r.cuisine || 'unknown'}, category: ${r.category || 'unknown'}${ingSnippet ? `\n   key ingredients/content: ${ingSnippet}` : ''}`
    }).join('\n')

    const existingList = (existingRecipeTitles || []).slice(0, 200).join(', ')
    const plannedTitleSet = new Set(plannedRecipes.map(r => r.title.toLowerCase()))

    const wantExisting = mode === 'existing' || mode === 'both'
    const wantNew = mode === 'new' || mode === 'both'

    const sections: string[] = []
    if (wantExisting) sections.push(`- "existing": up to 3 recipes from this list of TITLES IN THEIR COLLECTION that complement the plan. Use EXACT titles from the list.`)
    if (wantNew) sections.push(`- "new": up to 3 brand-new recipe ideas NOT in their collection that complement the plan.`)

    const seeds: string[] = []
    for (const r of plannedRecipes) {
      if (r.title) seeds.push(r.title)
      if (r.ingredients) {
        r.ingredients.split('\n').forEach(line => seeds.push(line))
      }
    }
    const complementary = getComplementaryIngredients(seeds, 15)
    const flavorGuidance = complementary.length > 0
      ? `\n\nFLAVOR PAIRING GUIDANCE (FlavorGraph food-science model):\nThe user's planned recipes work well with these complementary ingredients:\n${complementary.join(', ')}.\nPrefer suggesting recipes that use some of these ingredients to create cohesive flavor pairings across the week and reduce grocery waste through shared ingredients.`
      : ''

    const prompt = `You are a personal chef advisor helping someone round out their week's meal plan.

CURRENTLY PLANNED FOR THE WEEK:
${plannedSummary}

${wantExisting ? `THEIR EXISTING RECIPE COLLECTION (titles only): ${existingList || '(empty)'}\n` : ''}
Suggest complementary recipes that:
- Reuse or overlap ingredients with the planned recipes to minimize grocery waste
- Diversify cuisines and categories across the week
- Do not duplicate any dish already on the plan
- Are realistic weeknight meals

Return ONLY a JSON object with no markdown, no backticks, no explanation:
{
  "existing": [ { "title": "exact title from their collection", "reason": "1 sentence why" } ],
  "new": [ { "title": "new recipe name", "cuisine": "e.g. italian", "category": "one of: Chicken & Poultry, Vegetarian Mains, Salads & Bowls, Pasta Noodles & Rice, Soups Stews & Chili, Seafood, Beef & Pork, Breakfast Snacks & Sides", "reason": "1 sentence why" } ]
}

Output rules:
${sections.join('\n')}
${!wantExisting ? '- "existing" MUST be an empty array.\n' : ''}${!wantNew ? '- "new" MUST be an empty array.\n' : ''}- For "existing", only use EXACT titles from the provided collection list.
- Keep reasons short and concrete.
- Return ONLY the JSON.${flavorGuidance}`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('Anthropic error:', err)
      return NextResponse.json({ error: 'AI request failed' }, { status: 500 })
    }

    const data = await response.json()
    const rawText = data.content?.[0]?.text || ''

    let parsed: any
    try {
      parsed = JSON.parse(rawText.trim())
    } catch {
      const match = rawText.match(/\{[\s\S]+\}/)
      if (match) {
        try { parsed = JSON.parse(match[0]) }
        catch { return NextResponse.json({ error: 'Could not parse response' }, { status: 500 }) }
      } else {
        return NextResponse.json({ error: 'Could not parse response' }, { status: 500 })
      }
    }

    // Map existing titles back to anchored matches and drop any that duplicate the plan
    const existingArr: Array<{ title: string; reason: string }> = Array.isArray(parsed.existing) ? parsed.existing : []
    const newArr: Array<{ title: string; cuisine: string; category: string; reason: string }> = Array.isArray(parsed.new) ? parsed.new : []

    const titleLower = new Map<string, string>()
    ;(existingRecipeTitles || []).forEach(t => titleLower.set(t.toLowerCase(), t))

    const existingResolved = existingArr
      .filter(s => s && s.title && !plannedTitleSet.has(s.title.toLowerCase()))
      .map(s => {
        const exact = titleLower.get(s.title.toLowerCase())
        return exact ? { title: exact, reason: s.reason || '' } : null
      })
      .filter(Boolean)

    const newFiltered = newArr.filter(s =>
      s && s.title &&
      !plannedTitleSet.has(s.title.toLowerCase()) &&
      !titleLower.has(s.title.toLowerCase())
    )

    return NextResponse.json({
      existing: wantExisting ? existingResolved : [],
      new: wantNew ? newFiltered : [],
    })
  } catch (err: any) {
    console.error('plan-suggestions error:', err)
    return NextResponse.json({ error: err.message || 'Unknown error' }, { status: 500 })
  }
}
