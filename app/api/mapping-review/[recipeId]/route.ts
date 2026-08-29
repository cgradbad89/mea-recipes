import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminToken } from '@/lib/firebaseAdmin'
import { safeErrorLogDetails } from '@/lib/apiRequest'
import { loadMappingReviewRecipe } from '@/lib/cookingModeMappingReviewDetail'
import { serializeMappingTimestamps } from '@/lib/mappingReviewSerialize'

/** Admin-only read of one recipe's full mapping-review state (Phase 25-27). */
export async function GET(req: NextRequest, context: { params: Promise<{ recipeId: string }> }) {
  try {
    const uid = await verifyAdminToken(req)
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { recipeId } = await context.params
    const data = await loadMappingReviewRecipe(recipeId)
    if (!data) return NextResponse.json({ error: 'Recipe not found.' }, { status: 404 })

    return NextResponse.json(serializeMappingTimestamps(data))
  } catch (error) {
    console.error('[mapping-review-detail] request failed', { error: safeErrorLogDetails(error) })
    return NextResponse.json({ error: 'Unable to load this recipe’s mapping review.' }, { status: 500 })
  }
}
