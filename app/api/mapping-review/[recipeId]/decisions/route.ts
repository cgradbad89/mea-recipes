import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { verifyAdminToken } from '@/lib/firebaseAdmin'
import { ApiRequestError, readBoundedJson, safeErrorLogDetails } from '@/lib/apiRequest'
import {
  appendMappingReviewDecision,
  MappingReviewDecisionRejectedError,
} from '@/lib/cookingModeMappingReviewPersistence'
import { MAPPING_HUMAN_REVIEW_REASON_ORDER } from '@/types/cookingModeMappingPersistence'
import { serializeMappingTimestamps } from '@/lib/mappingReviewSerialize'

export const MAPPING_DECISION_MAX_BODY_BYTES = 8_000
const MAX_NOTE_LENGTH = 2_000

const REQUEST_SCHEMA = z.object({
  proposalId: z.string().min(1),
  candidateId: z.string().min(1),
  recipeRevision: z.string().min(1),
  decision: z.enum(['ACCEPT', 'REJECT']),
  reasonCode: z.enum(MAPPING_HUMAN_REVIEW_REASON_ORDER),
  note: z.string().max(MAX_NOTE_LENGTH).nullable().optional(),
  supersedesDecisionId: z.string().min(1).nullable().optional(),
})

function rejectionMessage(reason: string): string {
  switch (reason) {
    case 'CANDIDATE_NOT_FOUND':
      return 'This item no longer exists in the current review.'
    case 'PROPOSAL_MISMATCH':
      return 'This item does not belong to the current mapping proposal.'
    case 'REVISION_MISMATCH':
      return 'This recipe changed since this mapping was reviewed — refresh to continue.'
    case 'CANDIDATE_NOT_REVIEW_REQUIRED':
      return 'This item does not accept a manual decision.'
    case 'MISSING_REQUIRED_NOTE':
      return 'A note is required for this reason.'
    case 'MISSING_SUPERSESSION_FOR_CORRECTION':
      return 'This item already has a decision — refresh and try correcting it again.'
    case 'INVALID_SUPERSESSION':
      return 'This decision was already changed elsewhere — refresh to see the latest state.'
    default:
      return 'Couldn’t save this decision — try again.'
  }
}

/**
 * Include/Exclude (and correction) submission for one candidate (Phase 9-10,
 * 26). Trusted-server boundary: `decidedBy` is always the verified admin
 * uid, never a client-supplied field.
 */
export async function POST(req: NextRequest, context: { params: Promise<{ recipeId: string }> }) {
  try {
    const uid = await verifyAdminToken(req)
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { recipeId } = await context.params
    const parsed = REQUEST_SCHEMA.safeParse(await readBoundedJson(req, MAPPING_DECISION_MAX_BODY_BYTES))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })

    const event = await appendMappingReviewDecision({
      recipeId,
      proposalId: parsed.data.proposalId,
      candidateId: parsed.data.candidateId,
      recipeRevision: parsed.data.recipeRevision,
      decision: parsed.data.decision,
      reasonCode: parsed.data.reasonCode,
      note: parsed.data.note ?? null,
      decidedBy: uid,
      supersedesDecisionId: parsed.data.supersedesDecisionId ?? null,
    })

    return NextResponse.json({ decision: serializeMappingTimestamps(event) })
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof MappingReviewDecisionRejectedError) {
      return NextResponse.json({ error: rejectionMessage(error.reason) }, { status: 409 })
    }
    console.error('[mapping-review-decisions] request failed', { error: safeErrorLogDetails(error) })
    return NextResponse.json({ error: 'Couldn’t save this decision — try again.' }, { status: 500 })
  }
}
