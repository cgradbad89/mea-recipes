import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthToken } from '@/lib/firebaseAdmin'
import { getComplementaryIngredients } from '@/lib/flavorPairings'
import { GoogleGenAI } from '@google/genai'

const SYSTEM_PROMPT = `You are a recipe parser. Given HTML or text content from a webpage or pasted text, extract the recipe and return ONLY a valid JSON object with no markdown, no backticks, no explanation.

Return exactly this shape:
{
  "title": "string",
  "cuisine": "string (lowercase, e.g. italian, mexican, asian)",
  "category": "string (one of: Chicken & Poultry, Vegetarian Mains, Salads & Bowls, Pasta Noodles & Rice, Soups Stews & Chili, Seafood, Beef & Pork, Breakfast Snacks & Sides)",
  "ingredients": ["ingredient 1", "ingredient 2"],
  "instructions": ["Step 1 text", "Step 2 text"],
  "imageURL": "string or empty string",
  "description": "1-2 sentence description or empty string",
  "servings": "string or empty string",
  "prepTime": "string or empty string",
  "cookTime": "string or empty string"
}

Rules:
- ingredients: each item is a full ingredient line e.g. "2 cups all-purpose flour"
- instructions: each item is one complete step, no step numbers
- cuisine: single word or short phrase, always lowercase
- category: pick the closest match from the list above
- If you cannot find a value, use an empty string
- Return ONLY the JSON object, nothing else`

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuthToken(req)
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { url, html, text, generate, imageURL: providedImage, prepTime: providedPrep, cookTime: providedCook } = await req.json()

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'API key not configured' }, { status: 500 })
    }
    const ai = new GoogleGenAI({ apiKey })

    // Generate mode — create a full recipe from a dish name
    if (generate && !html && !text && !url) {
      const seeds = [generate, ...generate.split(/[\s,]+/)]
      const complementary = getComplementaryIngredients(seeds, 12)
      const flavorGuidance = complementary.length > 0
        ? `\n\nFLAVOR PAIRING GUIDANCE (from FlavorGraph, a food-science ingredient pairing model):\nWhen choosing ingredients, favor these scientifically complementary ingredients where they fit the dish naturally: ${complementary.join(', ')}.\nDo not force them in — use only those that genuinely suit the recipe.`
        : ''

      try {
        const genResponse = await ai.models.generateContent({
          model: 'gemini-3.5-flash',
          contents: `Generate a complete, authentic recipe for: ${generate}\n\nProvide realistic ingredients with measurements and detailed step-by-step instructions.${flavorGuidance}`,
          config: {
            systemInstruction: SYSTEM_PROMPT,
            responseMimeType: 'application/json',
          },
        })
        const genParsed = JSON.parse(genResponse.text || '{}')
        return NextResponse.json({ ...genParsed, title: genParsed.title || generate, sourceURL: '' })
      } catch (err) {
        console.error('Gemini generation error:', err)
        return NextResponse.json({ error: 'AI generation failed or could not parse response' }, { status: 500 })
      }
    }

    if (!html && !text && !url) {
      return NextResponse.json({ error: 'No content provided' }, { status: 400 })
    }

    let content = html || text || ''
    let fetchedTitle = ''

    if (url && !html && !text) {
      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; recipe-parser/1.0)',
            'Accept': 'text/html',
          },
          signal: AbortSignal.timeout(8000),
        })
        if (res.ok) {
          const rawHtml = await res.text()
          const titleMatch = rawHtml.match(/<title[^>]*>([^<]+)<\/title>/i)
          fetchedTitle = titleMatch ? titleMatch[1].replace(' - ', ' | ').split(' | ')[0].trim() : ''
          content = rawHtml
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .slice(0, 15000)
        }
      } catch {
        return NextResponse.json({ error: 'Could not fetch URL. Try the bookmarklet or paste text instead.' }, { status: 422 })
      }
    }

    if (!content.trim()) {
      return NextResponse.json({ error: 'No content to parse' }, { status: 400 })
    }

    const userMessage = url
      ? `Parse this recipe from ${url}:\n\n${content}`
      : `Parse this recipe:\n\n${content}`

    let parsed: any
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: userMessage,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: 'application/json',
        },
      })
      parsed = JSON.parse(response.text || '{}')
    } catch (err) {
      console.error('Gemini error:', err)
      return NextResponse.json({ error: 'AI parsing failed or could not parse response' }, { status: 500 })
    }

    return NextResponse.json({
      ...parsed,
      title: parsed.title || fetchedTitle || 'Untitled Recipe',
      sourceURL: url || '',
      // Prefer client-provided values (from bookmarklet) over parsed ones
      imageURL: providedImage || parsed.imageURL || '',
      prepTime: providedPrep || parsed.prepTime || '',
      cookTime: providedCook || parsed.cookTime || '',
    })

  } catch (err: any) {
    console.error('ai-ingest error:', err)
    return NextResponse.json({ error: err.message || 'Unknown error' }, { status: 500 })
  }
}
