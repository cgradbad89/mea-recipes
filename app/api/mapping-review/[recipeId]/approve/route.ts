import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { verifyAdminToken } from '@/lib/firebaseAdmin'
import { ApiRequestError, readBoundedJson, safeErrorLogDetails } from '@/lib/apiRequest'
import { loadMappingReviewRecipe } from '@/lib/cookingModeMappingReviewDetail'
import {
  buildApprovedMapping,
  persistApprovedMapping,
  updateCurrentApprovedMappingPointer,
  MappingPersistenceConflictError,
} from '@/lib/cookingModeMappingApprovedPersistence'
import type {
  ApprovedMapProvenanceV1,
  BuildApprovedMappingFailureReason,
  PersistedMappingCandidateV1,
} from '@/types/cookingModeMappingPersistence'
import { serializeMappingTimestamps } from '@/lib/mappingReviewSerialize'

export const MAPPING_APPROVE_MAX_BODY_BYTES = 2_000

const REQUEST_SCHEMA = z.object({
  proposalId: z.string().min(1),
  recipeRevision: z.string().min(1),
})

function deriveProvenance(candidates: readonly PersistedMappingCandidateV1[]): ApprovedMapProvenanceV1 {
  const withVotes = candidates.find(c => c.reviewerA && c.reviewerB)
  return {
    reviewerARunId: withVotes?.reviewerA?.runId ?? '',
    reviewerBRunId: withVotes?.reviewerB?.runId ?? '',
    reviewerAOutputHash: withVotes?.reviewerA?.normalizedOutputHash ?? null,
    reviewerBOutputHash: withVotes?.reviewerB?.normalizedOutputHash ?? null,
    autoAcceptCandidateCount: candidates.filter(c => c.routingDecision === 'AUTO_ACCEPT').length,
    humanDecidedCandidateCount: candidates.filter(c => c.decisionSource === 'HUMAN').length,
  }
}

function buildFailureMessage(reason: BuildApprovedMappingFailureReason): string {
  switch (reason) {
    case 'UNRESOLVED_CANDIDATE':
      return 'Every ingredient on this recipe needs a decision before the map can be approved.'
    case 'STRUCTURAL_BLOCKER':
      return 'This proposal contains an invalid record and can’t be approved.'
    case 'PROPOSAL_BLOCKED':
      return 'This proposal is blocked and can’t be approved yet.'
    case 'REVISION_MISMATCH':
      return 'This recipe changed since this mapping was reviewed — refresh to continue.'
    case 'MISSING_OR_STALE_COMPLETENESS_ATTESTATION':
      return 'This map hasn’t been attested for its current state — review the full mapping and attest completeness again.'
    default:
      return 'Couldn’t approve this map — try again.'
  }
}

/**
 * Map-level approval (Phase 19, architecture-contract §15/§26). Revalidates
 * every precondition against the live server state before building — a
 * stale browser can never approve an outdated map (Phase 34): the caller-
 * supplied `recipeRevision`/`proposalId` must match the recipe's current
 * live revision and its current proposal exactly, and a fresh, valid
 * completeness attestation and full resolution are required. No AI is
 * re-run and no candidate discovery is recomputed — this only reads
 * already-persisted candidates and writes the immutable approved artifact.
 */
export async function POST(req: NextRequest, context: { params: Promise<{ recipeId: string }> }) {
  try {
    const uid = await verifyAdminToken(req)
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { recipeId } = await context.params
    const parsed = REQUEST_SCHEMA.safeParse(await readBoundedJson(req, MAPPING_APPROVE_MAX_BODY_BYTES))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })

    const data = await loadMappingReviewRecipe(recipeId)
    if (!data) return NextResponse.json({ error: 'Recipe not found.' }, { status: 404 })

    if (
      !data.proposal ||
      data.proposal.proposalId !== parsed.data.proposalId ||
      data.proposal.recipeRevision !== parsed.data.recipeRevision ||
      data.liveRevision !== parsed.data.recipeRevision
    ) {
      return NextResponse.json(
        { error: 'This recipe changed since this mapping was reviewed — refresh to continue.' },
        { status: 409 },
      )
    }

    if (!data.completion?.complete) {
      return NextResponse.json({ error: buildFailureMessage('UNRESOLVED_CANDIDATE') }, { status: 400 })
    }

    if (!data.attestation?.valid || !data.attestation.attestation) {
      return NextResponse.json(
        { error: buildFailureMessage('MISSING_OR_STALE_COMPLETENESS_ATTESTATION') },
        { status: 409 },
      )
    }

    const outcome = await buildApprovedMapping({
      recipeId,
      recipeRevision: data.proposal.recipeRevision,
      parserVersion: data.proposal.parserVersion,
      mappingSourceHash: data.proposal.mappingSourceHash,
      proposalId: data.proposal.proposalId,
      reviewerContractVersion: data.proposal.reviewerContractVersion,
      evidenceContractVersion: data.proposal.evidenceContractVersion,
      routingContractVersion: data.proposal.routingContractVersion,
      candidates: data.candidates,
      proposalBlockingReasons: data.proposal.blockingReasons,
      approvedBy: uid,
      completenessAttestation: data.attestation.attestation,
      provenance: deriveProvenance(data.candidates),
    })

    if (!outcome.ok) {
      return NextResponse.json({ error: buildFailureMessage(outcome.reason) }, { status: 409 })
    }

    await persistApprovedMapping(outcome.map)
    await updateCurrentApprovedMappingPointer(recipeId, outcome.map.mapId)

    return NextResponse.json({
      recipeId,
      mapId: outcome.map.mapId,
      approvalMode: outcome.map.approvalMode,
      relationshipCount: outcome.map.relationships.length,
      map: serializeMappingTimestamps(outcome.map),
    })
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof MappingPersistenceConflictError) {
      return NextResponse.json(
        { error: 'This map was already approved with different content — refresh to see the current state.' },
        { status: 409 },
      )
    }
    console.error('[mapping-review-approve] request failed', { error: safeErrorLogDetails(error) })
    return NextResponse.json({ error: 'Couldn’t approve this map — try again.' }, { status: 500 })
  }
}
