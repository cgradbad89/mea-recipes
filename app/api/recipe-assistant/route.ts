import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthToken } from '@/lib/firebaseAdmin'
import { generateAIText } from '@/lib/ai'
import type { ModelMessage } from 'ai'

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuthToken(req)
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { recipe, messages } = await req.json()

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

    try {
      const formattedMessages: ModelMessage[] = messages.map((m: any) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: String(m.content || ''),
      }))

      const reply = await generateAIText({
        feature: 'recipe-assistant',
        userId: uid,
        system: systemPrompt,
        messages: formattedMessages,
      })
      return NextResponse.json({ reply })
    } catch (err) {
      console.error('AI Gateway error:', err)
      return NextResponse.json({ error: 'Assistant request failed' }, { status: 500 })
    }

  } catch (err: any) {
    console.error('recipe-assistant error:', err)
    return NextResponse.json({ error: err.message || 'Unknown error' }, { status: 500 })
  }
}
