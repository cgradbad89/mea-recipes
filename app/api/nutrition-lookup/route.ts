import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthToken } from '@/lib/firebaseAdmin'
import { computeRecipeNutrition, lookupFoodByName } from '@/lib/nutritionEngine'

// Shared nutrition lookup endpoint (see nutrition-tracker-spec.md).
//   POST { type: "recipe", recipeId } → compute from the recipe's ingredients
//   POST { type: "food",   name }     → quick-food lookup by name (USDA → AI)
// Response: { nutrition, source, confidence, ... }

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuthToken(req)
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => null)
    if (!body || (body.type !== 'recipe' && body.type !== 'food')) {
      return NextResponse.json(
        { error: 'Body must be { type: "recipe", recipeId } or { type: "food", name }' },
        { status: 400 },
      )
    }

    if (body.type === 'recipe') {
      const recipeId = typeof body.recipeId === 'string' ? body.recipeId.trim() : ''
      if (!recipeId) return NextResponse.json({ error: 'Missing recipeId' }, { status: 400 })
      try {
        const { nutrition, unresolved, flagged } = await computeRecipeNutrition(recipeId)
        return NextResponse.json({
          nutrition,
          source: nutrition.source,
          confidence: nutrition.confidence,
          unresolved,
          flagged,
        })
      } catch (e: any) {
        const msg = e?.message || 'Recipe lookup failed'
        const status = /not found/i.test(msg) ? 404 : /no parseable/i.test(msg) ? 422 : 500
        return NextResponse.json({ error: msg }, { status })
      }
    }

    // type === 'food'
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return NextResponse.json({ error: 'Missing name' }, { status: 400 })
    const result = await lookupFoodByName(name)
    if (!result) {
      return NextResponse.json(
        { error: 'Could not resolve food — try manual entry' },
        { status: 404 },
      )
    }
    return NextResponse.json({
      nutrition: result.nutrition,
      source: result.source,
      confidence: result.confidence,
      name: result.name,
      servingGrams: result.servingGrams,
    })
  } catch (err: any) {
    console.error('nutrition-lookup error:', err)
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 })
  }
}
