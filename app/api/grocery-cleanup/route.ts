import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthToken } from '@/lib/firebaseAdmin'
import {
  GROCERY_CATEGORIES,
  categorizeIngredient,
  normalizePersistedGroceryCategory,
} from '@/lib/groceryCategories'
import { ALL_UNIT_WORDS, isKnownUnit } from '@/lib/ingredientParser'
import { generateAIArray, generateAIObject } from '@/lib/ai'
import { ApiRequestError, readBoundedJson, safeErrorLogDetails } from '@/lib/apiRequest'
import {
  sanitizeGroceryCleanupChanges,
  type GroceryCleanupChange,
  type GroceryCleanupItem,
} from '@/lib/groceryCleanup'
import { z } from 'zod'

// Single source of truth for the allowed categories — imported from the shared
// taxonomy so the prompt and validation can never drift from lib/groceryCategories.
const CATEGORIES = GROCERY_CATEGORIES as readonly string[]

const GROCERY_CHANGE_SCHEMA = z.object({
  originalIndex: z.number().int(),
  name: z.string(),
  quantity: z.string(),
  unit: z.string(),
  category: z.string(),
  action: z.enum(['merge', 'normalize', 'remove']),
  mergedWith: z.array(z.number().int()),
})

const PARSED_LINE_SCHEMA = z.object({
  quantity: z.string(),
  unit: z.string(),
  name: z.string(),
})

const GROCERY_MAX_BODY_BYTES = 256_000
const MAX_GROCERY_ITEMS = 100
const MAX_GROCERY_ITEM_TEXT = 500
const GROCERY_ITEM_SCHEMA = z.object({
  name: z.string().max(MAX_GROCERY_ITEM_TEXT),
  quantity: z.string().max(100).optional(),
  unit: z.string().max(100).optional(),
  manualSection: z.string().max(100).optional(),
}).passthrough()
const REQUEST_SCHEMA = z.union([
  z.object({ mode: z.literal('parse-line'), line: z.string().max(1_000) }).passthrough(),
  z.object({ items: z.array(GROCERY_ITEM_SCHEMA).max(MAX_GROCERY_ITEMS) }).passthrough(),
])

export async function POST(req: NextRequest) {
  let requestMetadata: {
    mode: 'unknown' | 'cleanup' | 'parse-line'
    itemCount: number
  } = { mode: 'unknown', itemCount: 0 }

  try {
    const uid = await verifyAuthToken(req)
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const requestResult = REQUEST_SCHEMA.safeParse(
      await readBoundedJson(req, GROCERY_MAX_BODY_BYTES),
    )
    if (!requestResult.success) {
      return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
    }
    const body = requestResult.data as {
      mode?: 'parse-line'
      line?: string
      items?: GroceryCleanupItem[]
    }

    // ── Per-item AI fallback (the grocery ADD path) ──────────────────────────
    // Splits ONE ambiguous line the deterministic parser was unsure about into
    // {quantity, unit, name}. Distinct from the whole-list cleanup below — the
    // "AI Clean Up List" button does not send `mode`, so its behavior is
    // unchanged.
    if (body?.mode === 'parse-line') {
      requestMetadata = { mode: 'parse-line', itemCount: 1 }
      return parseSingleLine(String(body.line || ''), uid)
    }

    const items = body.items
    if (!items) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
    requestMetadata = {
      mode: 'cleanup',
      itemCount: Array.isArray(items) ? items.length : 0,
    }

    if (items.length === 0) return NextResponse.json([])

    const prompt = `You are a grocery list organizer. Clean up this grocery list and return improved data.

GROCERY ITEMS:
${items.map((item: any, i: number) => `${i}: "${item.name}" (qty: ${item.quantity || ''} ${item.unit || ''}) [category: ${item.manualSection ? normalizePersistedGroceryCategory(item.manualSection, item.name) : categorizeIngredient(item.name)}]`).join('\n')}

TASKS:
1. Deduplicate similar items (e.g. "garlic cloves grated" + "4 cloves garlic" = "garlic")
2. Normalize names (e.g. "CRUSH and mince the garlic" → "garlic", remove instruction text)
3. Assign the best category from this exact list: ${CATEGORIES.join(', ')}
4. Shopping guidance: "Pantry & Dry Goods" = grains, pasta, dry legumes, broth/stock, baking goods, and sweeteners. "Canned & Jarred" = explicitly canned/jarred foods plus tomato paste and coconut milk. "Sauces & Condiments" = sauces, condiments, oils, vinegars, dressings, and pastes. "Spices & Seasonings" = salt, pepper, dried herbs, spices, and seasoning blends. "Nuts, Seeds & Nut Butters" includes tahini. Fresh herbs and peppers stay in Produce.

Return ONLY a JSON array containing ONLY the items that require modification.
An item requires modification if it needs to be merged, its name/quantity/unit should be normalized, or its current category is incorrect.
Do NOT include items that should be kept exactly as-is (action "keep").

JSON Format:
[
  {
    "originalIndex": 0,
    "name": "cleaned name",
    "quantity": "combined quantity or empty string",
    "unit": "unit or empty string",
    "category": "exact category from list above",
    "action": "merge" | "normalize" | "remove",
    "mergedWith": [1, 2] // indices of items merged into this one, or empty array
  }
]

Rules:
- For a merge, return exactly ONE object for the group. originalIndex is the item that survives; mergedWith contains ONLY the OTHER item indices that should be absorbed and deleted. NEVER include originalIndex in mergedWith.
- Only merge items that represent the same thing a shopper would buy. Do not merge merely related ingredients.
- action "remove" = clearly not a grocery item (e.g. instruction text like "ON THE STOVE")
- action "merge" = combined with another item
- action "normalize" = cleaned up name/quantity/unit, or corrected category
- If no items need modification, return an empty array []
- Return ONLY the JSON array`

    let parsedChanges: any[] = []
    try {
      parsedChanges = await generateAIArray({
        feature: 'grocery-cleanup',
        userId: uid,
        prompt,
        element: GROCERY_CHANGE_SCHEMA,
      })
    } catch (err) {
      console.error('[grocery-cleanup] AI request failed', {
        error: safeErrorLogDetails(err),
        ...requestMetadata,
      })
      return NextResponse.json({ error: 'AI request failed or could not parse response' }, { status: 500 })
    }

    if (!Array.isArray(parsedChanges)) {
      parsedChanges = []
    }

    return NextResponse.json(
      sanitizeGroceryCleanupChanges(items, parsedChanges as GroceryCleanupChange[]),
    )
  } catch (err) {
    if (err instanceof ApiRequestError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[grocery-cleanup] request failed', {
      error: safeErrorLogDetails(err),
      ...requestMetadata,
    })
    return NextResponse.json({ error: 'Unable to complete the request.' }, { status: 500 })
  }
}

// ─── Single-line parse (per-item add-path fallback) ──────────────────────────
// Splits one line into { quantity, unit, name }. The returned unit is validated
// against the SHARED unit vocabulary (lib/ingredientParser); an invented/junk
// unit is dropped, and if the AI result is unusable the whole line is returned
// as `name` (status quo for that item — never worse than today). Always returns
// 200 with a usable object so the caller can write it directly.
async function parseSingleLine(line: string, userId: string): Promise<NextResponse> {
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

  let parsed: any = null
  try {
    parsed = await generateAIObject({
      feature: 'grocery-parse-line',
      userId,
      prompt,
      schema: PARSED_LINE_SCHEMA,
    })
  } catch {
    return NextResponse.json(fallback)
  }

  if (!parsed || typeof parsed !== 'object' || typeof parsed.name !== 'string' || !parsed.name.trim()) {
    return NextResponse.json(fallback)
  }

  let unit = typeof parsed.unit === 'string' ? parsed.unit.trim() : ''
  if (unit && !isKnownUnit(unit)) unit = '' // drop a hallucinated unit
  const quantity = typeof parsed.quantity === 'string' ? parsed.quantity.trim() : ''
  return NextResponse.json({ quantity, unit, name: parsed.name.trim() })
}
