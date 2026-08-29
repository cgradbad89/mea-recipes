import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { verifyAdminToken } from '@/lib/firebaseAdmin'
import { ApiRequestError, readBoundedJson, safeErrorLogDetails } from '@/lib/apiRequest'
import {
  recordMappingCompletenessAttestation,
  MappingCompletenessAttestationRejectedError,
} from '@/lib/cookingModeMappingCompletenessAttestation'
import { serializeMappingTimestamps } from '@/lib/mappingReviewSerialize'

export const MAPPING_ATTESTATION_MAX_BODY_BYTES = 2_000

const REQUEST_SCHEMA = z.object({
  proposalId: z.string().min(1),
  recipeRevision: z.string().min(1),
})

function rejectionMessage(reason: string): string {
  switch (reason) {
    case 'PROPOSAL_NOT_FOUND':
      return 'This recipe’s mapping proposal no longer exists.'
    case 'PROPOSAL_NOT_READY':
      return 'This recipe’s mapping proposal hasn’t finished generating.'
    case 'REVISION_MISMATCH':
      return 'This recipe changed since this mapping was reviewed — refresh to continue.'
    case 'PROPOSAL_NOT_FULLY_RESOLVED':
      return 'Every ingredient on this recipe needs a decision before you can attest completeness.'
    default:
      return 'Couldn’t record your attestation — try again.'
  }
}

/**
 * Map-level completeness attestation (Phase 18, architecture-contract §26.6).
 * Always a distinct, explicit act — never inferred from the last candidate
 * decision. `attestedBy` is always the verified admin uid.
 */
export async function POST(req: NextRequest, context: { params: Promise<{ recipeId: string }> }) {
  try {
    const uid = await verifyAdminToken(req)
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { recipeId } = await context.params
    const parsed = REQUEST_SCHEMA.safeParse(await readBoundedJson(req, MAPPING_ATTESTATION_MAX_BODY_BYTES))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })

    const attestation = await recordMappingCompletenessAttestation({
      recipeId,
      proposalId: parsed.data.proposalId,
      recipeRevision: parsed.data.recipeRevision,
      attestedBy: uid,
    })

    return NextResponse.json({ attestation: serializeMappingTimestamps(attestation) })
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof MappingCompletenessAttestationRejectedError) {
      return NextResponse.json({ error: rejectionMessage(error.reason) }, { status: 409 })
    }
    console.error('[mapping-review-attestation] request failed', { error: safeErrorLogDetails(error) })
    return NextResponse.json({ error: 'Couldn’t record your attestation — try again.' }, { status: 500 })
  }
}
