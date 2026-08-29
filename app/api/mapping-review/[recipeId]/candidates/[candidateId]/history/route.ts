import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminToken } from '@/lib/firebaseAdmin'
import { safeErrorLogDetails } from '@/lib/apiRequest'
import { getMappingReviewHistory } from '@/lib/cookingModeMappingReviewPersistence'
import { serializeMappingTimestamps } from '@/lib/mappingReviewSerialize'

/**
 * On-demand review history for one candidate (Phase 12). Default-hidden in
 * the UI — this route is only ever called when a reviewer explicitly opens
 * the "History" disclosure on a resolved candidate row.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ recipeId: string; candidateId: string }> },
) {
  try {
    const uid = await verifyAdminToken(req)
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { recipeId, candidateId } = await context.params
    const proposalId = req.nextUrl.searchParams.get('proposalId')
    if (!proposalId) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })

    const history = await getMappingReviewHistory(recipeId, proposalId, candidateId)
    return NextResponse.json({ history: serializeMappingTimestamps(history) })
  } catch (error) {
    console.error('[mapping-review-history] request failed', { error: safeErrorLogDetails(error) })
    return NextResponse.json({ error: 'Couldn’t load history — try again.' }, { status: 500 })
  }
}
