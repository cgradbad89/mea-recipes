import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminToken } from '@/lib/firebaseAdmin'
import { safeErrorLogDetails } from '@/lib/apiRequest'
import { loadMappingReviewQueue } from '@/lib/cookingModeMappingReviewQueue'

/**
 * Admin-only read of the mapping-review queue (Phase 25-27). Trusted-server
 * boundary: verifies the caller is the recipe admin before touching any
 * mapping-persistence read, and never accepts a client-supplied identity.
 */
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAdminToken(req)
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const entries = await loadMappingReviewQueue()
    return NextResponse.json({ entries })
  } catch (error) {
    console.error('[mapping-review-queue] request failed', { error: safeErrorLogDetails(error) })
    return NextResponse.json({ error: 'Unable to load the mapping review queue.' }, { status: 500 })
  }
}
