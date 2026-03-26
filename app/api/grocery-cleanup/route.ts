import { NextRequest, NextResponse } from 'next/server'

const CATEGORIES = [
  'Produce', 'Meat & Seafood', 'Dairy & Eggs', 'Bakery & Bread',
  'Canned / Jarred / Sauces', 'Beverages', 'Staples', 'Other'
]

export async function POST(req: NextRequest) {
  try {
    const { items } = await req.json()

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'API key not configured' }, { status: 500 })

    const prompt = `You are a grocery list organizer. Clean up this grocery list and return improved data.

GROCERY ITEMS:
${items.map((item: any, i: number) => `${i}: "${item.name}" (qty: ${item.quantity || ''} ${item.unit || ''})`).join('\n')}

TASKS:
1. Deduplicate similar items (e.g. "garlic cloves grated" + "4 cloves garlic" = "garlic")
2. Normalize names (e.g. "CRUSH and mince the garlic" → "garlic", remove instruction text)
3. Assign the best category from this exact list: ${CATEGORIES.join(', ')}
4. Note: "Staples" = oils, vinegars, spices, sugars, flours, salts — things people usually have

Return ONLY a JSON array, no markdown:
[
  {
    "originalIndex": 0,
    "name": "cleaned name",
    "quantity": "combined quantity or empty string",
    "unit": "unit or empty string",
    "category": "exact category from list above",
    "action": "keep" | "merge" | "normalize" | "remove",
    "mergedWith": [1, 2] // indices of items merged into this one, or empty array
  }
]

Rules:
- If merging items, include all original indices in mergedWith
- action "remove" = clearly not a grocery item (e.g. instruction text like "ON THE STOVE")
- action "merge" = combined with another item
- action "normalize" = cleaned up name but kept as-is
- action "keep" = no changes needed
- Return ONLY the JSON array`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!response.ok) return NextResponse.json({ error: 'AI request failed' }, { status: 500 })

    const data = await response.json()
    const rawText = data.content?.[0]?.text || ''

    let parsed: any
    try { parsed = JSON.parse(rawText.trim()) }
    catch {
      const m = rawText.match(/\[[\s\S]+\]/)
      if (m) { try { parsed = JSON.parse(m[0]) } catch { return NextResponse.json({ error: 'Could not parse response' }, { status: 500 }) } }
      else return NextResponse.json({ error: 'Could not parse response' }, { status: 500 })
    }

    return NextResponse.json(parsed)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
