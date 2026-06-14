import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthToken } from '@/lib/firebaseAdmin'
import { GROCERY_CATEGORIES, categorizeIngredient } from '@/lib/groceryCategories'
import { ALL_UNIT_WORDS, isKnownUnit } from '@/lib/ingredientParser'

// Single source of truth for the allowed categories — imported from the shared
// taxonomy so the prompt and validation can never drift from lib/groceryCategories.
const CATEGORIES = GROCERY_CATEGORIES as readonly string[]

const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514'

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuthToken(req)
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'API key not configured' }, { status: 500 })

    const body = await req.json()

    // ── Per-item AI fallback (the grocery ADD path) ──────────────────────────
    // Splits ONE ambiguous line the deterministic parser was unsure about into
    // {quantity, unit, name}. Distinct from the whole-list cleanup below — the
    // "AI Clean Up List" button does not send `mode`, so its behavior is
    // unchanged.
    if (body?.mode === 'parse-line') {
      return parseSingleLine(String(body.line || ''), apiKey)
    }

    const { items } = body

    const prompt = `You are a grocery list organizer. Clean up this grocery list and return improved data.

GROCERY ITEMS:
${items.map((item: any, i: number) => `${i}: "${item.name}" (qty: ${item.quantity || ''} ${item.unit || ''})`).join('\n')}

TASKS:
1. Deduplicate similar items (e.g. "garlic cloves grated" + "4 cloves garlic" = "garlic")
2. Normalize names (e.g. "CRUSH and mince the garlic" → "garlic", remove instruction text)
3. Assign the best category from this exact list: ${CATEGORIES.join(', ')}
4. Note: "Spices & Seasonings" = dried spices and chiles (e.g. chile, chili, chipotle, ancho, guajillo, chile powder, chili powder, paprika, cumin, cinnamon, turmeric, garam masala). "Staples" = oils, vinegars, sugars, flours, salts — things people usually have

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

    // Validate each returned category against the allowed list. If the AI invents
    // a category (e.g. "Beverages" for chile powder), fall back to the local
    // matcher so a bogus label can't override the correct local categorization.
    if (Array.isArray(parsed)) {
      parsed = parsed.map((item: any) => {
        if (item && typeof item === 'object' && !CATEGORIES.includes(item.category)) {
          return { ...item, category: categorizeIngredient(item.name || '') }
        }
        return item
      })
    }

    return NextResponse.json(parsed)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ─── Single-line parse (per-item add-path fallback) ──────────────────────────
// Splits one line into { quantity, unit, name }. The returned unit is validated
// against the SHARED unit vocabulary (lib/ingredientParser); an invented/junk
// unit is dropped, and if the AI result is unusable the whole line is returned
// as `name` (status quo for that item — never worse than today). Always returns
// 200 with a usable object so the caller can write it directly.
async function parseSingleLine(line: string, apiKey: string): Promise<NextResponse> {
  const trimmed = line.trim()
  const fallback = { quantity: '', unit: '', name: trimmed }
  if (!trimmed) return NextResponse.json(fallback)

  const prompt = `Split this single grocery/ingredient line into quantity, unit, and item name.

LINE: "${trimmed}"

Rules:
- "quantity": the leading amount only — a number, fraction ("1/2"), or range ("1-2"); "" if none.
- "unit": a measurement or countable unit ONLY if one is present, chosen from this exact list: ${ALL_UNIT_WORDS.join(', ')}. Use "" if there is no unit. Keep countable units like "can", "ear", "clove" as the unit (e.g. "1 can black beans" → unit "can", name "black beans").
- "name": the remaining item/noun phrase WITHOUT the quantity or unit. Keep modifiers like "ground" or "red"; do not stem or pluralize.
- Never invent a quantity or unit that is not literally in the line.

Return ONLY this JSON object, no markdown:
{"quantity": "", "unit": "", "name": ""}`

  let response: Response
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
  } catch {
    return NextResponse.json(fallback)
  }
  if (!response.ok) return NextResponse.json(fallback)

  const data = await response.json()
  const rawText = data.content?.[0]?.text || ''
  let parsed: any
  try {
    parsed = JSON.parse(rawText.trim())
  } catch {
    const m = rawText.match(/\{[\s\S]*\}/)
    if (m) { try { parsed = JSON.parse(m[0]) } catch { parsed = null } }
  }

  if (!parsed || typeof parsed !== 'object' || typeof parsed.name !== 'string' || !parsed.name.trim()) {
    return NextResponse.json(fallback)
  }

  let unit = typeof parsed.unit === 'string' ? parsed.unit.trim() : ''
  if (unit && !isKnownUnit(unit)) unit = '' // drop a hallucinated unit
  const quantity = typeof parsed.quantity === 'string' ? parsed.quantity.trim() : ''
  return NextResponse.json({ quantity, unit, name: parsed.name.trim() })
}
