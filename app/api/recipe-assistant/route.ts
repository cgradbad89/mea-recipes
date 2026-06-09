import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { recipe, messages } = await req.json()

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'API key not configured' }, { status: 500 })
    }

    if (!recipe || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'Missing recipe or messages' }, { status: 400 })
    }

    const ingredients: string[] = Array.isArray(recipe.ingredients) ? recipe.ingredients : []
    const instructions: string[] = Array.isArray(recipe.instructions) ? recipe.instructions : []

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

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemPrompt,
        messages: messages.map((m: any) => ({ role: m.role, content: m.content })),
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('Anthropic error:', err)
      return NextResponse.json({ error: 'Assistant request failed' }, { status: 500 })
    }

    const data = await response.json()
    const reply = data.content?.[0]?.text || ''

    return NextResponse.json({ reply })

  } catch (err: any) {
    console.error('recipe-assistant error:', err)
    return NextResponse.json({ error: err.message || 'Unknown error' }, { status: 500 })
  }
}
