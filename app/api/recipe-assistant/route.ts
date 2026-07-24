import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthToken } from '@/lib/firebaseAdmin'
import { GoogleGenAI } from '@google/genai'

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuthToken(req)
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { recipe, messages } = await req.json()

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'API key not configured' }, { status: 500 })
    }
    const ai = new GoogleGenAI({ apiKey })

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
      // Map roles from UI ('assistant' / 'user') to Gemini ('model' / 'user')
      const formattedMessages = messages.map((m: any) => ({
        role: m.role === 'assistant' ? 'model' : m.role,
        parts: [{ text: m.content }],
      }))

      // Gemini's generateContent doesn't take history via `messages` directly without
      // `ai.chats`. But we can use `contents` array with roles.
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: formattedMessages,
        config: {
          systemInstruction: systemPrompt,
        },
      })

      const reply = response.text || ''
      return NextResponse.json({ reply })
    } catch (err) {
      console.error('Gemini error:', err)
      return NextResponse.json({ error: 'Assistant request failed' }, { status: 500 })
    }

  } catch (err: any) {
    console.error('recipe-assistant error:', err)
    return NextResponse.json({ error: err.message || 'Unknown error' }, { status: 500 })
  }
}
