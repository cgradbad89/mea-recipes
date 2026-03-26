import { NextRequest, NextResponse } from 'next/server'

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
    const { url, html, text, generate } = await req.json()

    // Generate mode — create a full recipe from a dish name
    if (generate && !html && !text && !url) {
      const genResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2000,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: `Generate a complete, authentic recipe for: ${generate}\n\nProvide realistic ingredients with measurements and detailed step-by-step instructions.` }],
        }),
      })
      if (!genResponse.ok) return NextResponse.json({ error: 'AI generation failed' }, { status: 500 })
      const genData = await genResponse.json()
      const genText = genData.content?.[0]?.text || ''
      let genParsed: any
      try { genParsed = JSON.parse(genText.trim()) }
      catch {
        const m = genText.match(/\{[\s\S]+\}/)
        if (m) { try { genParsed = JSON.parse(m[0]) } catch { return NextResponse.json({ error: 'Could not parse response' }, { status: 500 }) } }
        else return NextResponse.json({ error: 'Could not parse response' }, { status: 500 })
      }
      return NextResponse.json({ ...genParsed, title: genParsed.title || generate, sourceURL: '' })
    }

    if (!html && !text && !url) {
      return NextResponse.json({ error: 'No content provided' }, { status: 400 })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'API key not configured' }, { status: 500 })
    }

    // If URL provided but no HTML, fetch the page server-side
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
          // Extract title for fallback
          const titleMatch = rawHtml.match(/<title[^>]*>([^<]+)<\/title>/i)
          fetchedTitle = titleMatch ? titleMatch[1].replace(' - ', ' | ').split(' | ')[0].trim() : ''
          // Strip scripts/styles to reduce tokens, keep meaningful content
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

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('Anthropic error:', err)
      return NextResponse.json({ error: 'AI parsing failed' }, { status: 500 })
    }

    const data = await response.json()
    const rawText = data.content?.[0]?.text || ''

    let parsed: any
    try {
      parsed = JSON.parse(rawText.trim())
    } catch {
      // Try to extract JSON from response
      const jsonMatch = rawText.match(/\{[\s\S]+\}/)
      if (jsonMatch) {
        try { parsed = JSON.parse(jsonMatch[0]) }
        catch { return NextResponse.json({ error: 'Could not parse AI response' }, { status: 500 }) }
      } else {
        return NextResponse.json({ error: 'Could not parse AI response' }, { status: 500 })
      }
    }

    return NextResponse.json({
      ...parsed,
      title: parsed.title || fetchedTitle || 'Untitled Recipe',
      sourceURL: url || '',
    })

  } catch (err: any) {
    console.error('ai-ingest error:', err)
    return NextResponse.json({ error: err.message || 'Unknown error' }, { status: 500 })
  }
}
