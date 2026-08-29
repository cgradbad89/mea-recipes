'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react'
import { useAuth } from '@/lib/AuthContext'
import { useAdminAccess } from '@/hooks/useAdminAccess'
import {
  fetchMappingReviewRecipe,
  fetchMappingCandidateHistory,
  submitMappingReviewDecision,
  addMappingRelationship,
  removeMappingRelationship,
  attestMappingCompleteness,
  approveMappingReview,
  MappingReviewClientError,
  type MappingReviewRecipeResponse,
  type ApproveMappingResult,
} from '@/lib/mappingReviewClient'
import { MAPPING_BLOCKED_REASON_COPY } from '@/lib/mappingReviewRiskCopy'
import LoadingErrorRetry from '@/components/LoadingErrorRetry'
import MappingStepReviewCard from '@/components/mapping-review/MappingStepReviewCard'
import MappingCompletenessPreview from '@/components/mapping-review/MappingCompletenessPreview'
import MappingApprovalPanel from '@/components/mapping-review/MappingApprovalPanel'
import type { MappingHumanReviewReason } from '@/types/cookingModeMappingPersistence'

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof MappingReviewClientError ? err.message : fallback
}

export default function MappingReviewRecipePage() {
  const { recipeId } = useParams<{ recipeId: string }>()
  const { user, loading: authLoading } = useAuth()
  const { isAdmin, checked } = useAdminAccess()

  const [data, setData] = useState<MappingReviewRecipeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<unknown>(null)

  const [currentStepIndex, setCurrentStepIndex] = useState<number | null>(null)
  const [uiPhase, setUiPhase] = useState<'REVIEW' | 'COMPLETENESS'>('REVIEW')

  const [busyCandidateId, setBusyCandidateId] = useState<string | null>(null)
  const [candidateErrors, setCandidateErrors] = useState<Record<string, string>>({})

  const [completenessBusyKey, setCompletenessBusyKey] = useState<string | null>(null)
  const [completenessErrors, setCompletenessErrors] = useState<Record<string, string>>({})

  const [attesting, setAttesting] = useState(false)
  const [attestError, setAttestError] = useState<string | null>(null)
  const [approving, setApproving] = useState(false)
  const [approveError, setApproveError] = useState<string | null>(null)
  const [justApproved, setJustApproved] = useState<ApproveMappingResult | null>(null)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setLoadError(null)
    try {
      const token = await user.getIdToken()
      const result = await fetchMappingReviewRecipe(token, recipeId)
      setData(result)
    } catch (err) {
      setLoadError(err)
    } finally {
      setLoading(false)
    }
  }, [user, recipeId])

  useEffect(() => { if (checked && isAdmin) void load() }, [checked, isAdmin, load])

  const reviewCandidates = useMemo(
    () => (data?.candidates ?? []).filter(c => c.routingDecision === 'REVIEW_REQUIRED'),
    [data],
  )
  const stepIndexesWithReview = useMemo(
    () => Array.from(new Set(reviewCandidates.map(c => c.stepIndex))).sort((a, b) => a - b),
    [reviewCandidates],
  )
  const unresolvedStepIndexes = useMemo(
    () => stepIndexesWithReview.filter(i => reviewCandidates.some(c => c.stepIndex === i && c.finalDecision === null)),
    [stepIndexesWithReview, reviewCandidates],
  )

  // Land on the first unresolved step once data is available; never override
  // a reviewer's current position on a later refetch.
  useEffect(() => {
    if (!data?.proposal || currentStepIndex !== null) return
    setCurrentStepIndex(unresolvedStepIndexes[0] ?? stepIndexesWithReview[0] ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.proposal?.proposalId])

  const handleDecide = async (candidateId: string, decision: 'ACCEPT' | 'REJECT') => {
    if (!data?.proposal || !user) return
    const candidate = data.candidates.find(c => c.candidateId === candidateId)
    if (!candidate) return
    setBusyCandidateId(candidateId)
    setCandidateErrors(prev => ({ ...prev, [candidateId]: '' }))
    try {
      const token = await user.getIdToken()
      const reasonCode: MappingHumanReviewReason = decision === 'ACCEPT' ? 'SOURCE_EXPLICIT_USE' : 'SOURCE_NO_ACTIVE_USE'
      await submitMappingReviewDecision(token, recipeId, {
        proposalId: data.proposal.proposalId,
        candidateId,
        recipeRevision: data.proposal.recipeRevision,
        decision,
        reasonCode,
        supersedesDecisionId: candidate.effectiveReviewEventId,
      })
      await load()
    } catch (err) {
      setCandidateErrors(prev => ({ ...prev, [candidateId]: errorMessage(err, 'Couldn’t save this decision — try again.') }))
    } finally {
      setBusyCandidateId(null)
    }
  }

  const handleFetchHistory = async (candidateId: string) => {
    if (!user || !data?.proposal) return []
    const token = await user.getIdToken()
    return fetchMappingCandidateHistory(token, recipeId, candidateId, data.proposal.proposalId)
  }

  const handleAddRelationship = async (stepIndex: number, ingredientRowIndex: number) => {
    if (!user || !data?.proposal) return
    const key = `add-${stepIndex}`
    setCompletenessBusyKey(key)
    setCompletenessErrors(prev => ({ ...prev, [key]: '' }))
    try {
      const token = await user.getIdToken()
      await addMappingRelationship(token, recipeId, {
        proposalId: data.proposal.proposalId,
        recipeRevision: data.proposal.recipeRevision,
        ingredientRowIndex,
        stepIndex,
      })
      await load()
    } catch (err) {
      setCompletenessErrors(prev => ({ ...prev, [key]: errorMessage(err, 'Couldn’t add that relationship — try again.') }))
    } finally {
      setCompletenessBusyKey(null)
    }
  }

  const handleRemoveRelationship = async (candidateId: string) => {
    if (!user || !data?.proposal) return
    setCompletenessBusyKey(candidateId)
    setCompletenessErrors(prev => ({ ...prev, [candidateId]: '' }))
    try {
      const token = await user.getIdToken()
      await removeMappingRelationship(token, recipeId, {
        proposalId: data.proposal.proposalId,
        candidateId,
        recipeRevision: data.proposal.recipeRevision,
        reasonCode: 'OTHER',
        note: 'Removed during completeness review',
      })
      await load()
    } catch (err) {
      setCompletenessErrors(prev => ({ ...prev, [candidateId]: errorMessage(err, 'Couldn’t remove that relationship — try again.') }))
    } finally {
      setCompletenessBusyKey(null)
    }
  }

  const handleAttest = async () => {
    if (!user || !data?.proposal) return
    setAttesting(true)
    setAttestError(null)
    try {
      const token = await user.getIdToken()
      await attestMappingCompleteness(token, recipeId, {
        proposalId: data.proposal.proposalId,
        recipeRevision: data.proposal.recipeRevision,
      })
      await load()
    } catch (err) {
      setAttestError(errorMessage(err, 'Couldn’t record your attestation — try again.'))
    } finally {
      setAttesting(false)
    }
  }

  const handleApprove = async () => {
    if (!user || !data?.proposal) return
    setApproving(true)
    setApproveError(null)
    try {
      const token = await user.getIdToken()
      const result = await approveMappingReview(token, recipeId, {
        proposalId: data.proposal.proposalId,
        recipeRevision: data.proposal.recipeRevision,
      })
      setJustApproved(result)
    } catch (err) {
      setApproveError(errorMessage(err, 'Couldn’t approve this map — try again.'))
    } finally {
      setApproving(false)
    }
  }

  if (authLoading || !checked) {
    return <div role="status" className="flex items-center justify-center min-h-[60vh] text-faint font-body text-sm">Loading…</div>
  }
  if (!user || !isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 p-6 text-center">
        <p className="font-display text-2xl text-faint font-light">Mapping review isn’t available</p>
        <p className="text-faint text-sm font-body max-w-sm">This admin-only workflow isn’t available for your account.</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <Link href="/mapping-review" className="inline-flex items-center gap-1.5 text-faint text-xs font-body hover:text-cream mb-4">
        <ArrowLeft size={13} aria-hidden="true" /> Back to mapping review
      </Link>

      <LoadingErrorRetry loading={loading} error={loadError} retry={() => { void load() }} errorPrefix="Couldn’t load this recipe’s mapping review.">
        {!data ? null : (() => {
          const isApproved = justApproved !== null || data.pointer.status === 'CURRENT'

          if (isApproved) {
            const relationshipCount = justApproved?.relationshipCount ?? data.approvedMap?.relationships.length ?? 0
            const approvalMode = justApproved?.approvalMode ?? data.approvedMap?.approvalMode ?? 'AUTO'
            return (
              <div className="text-center py-16 border border-border rounded-2xl">
                <CheckCircle2 size={40} className="text-amber mx-auto mb-4" aria-hidden="true" />
                <h1 className="font-display text-3xl text-cream font-light mb-2">{data.recipeTitle}</h1>
                <p className="text-amber text-sm font-body mb-1">Cooking Mode map approved</p>
                <p className="text-faint text-sm font-body mb-6">
                  {relationshipCount} ingredient-step relationships
                  {approvalMode === 'HUMAN_ASSISTED' ? ' · reviewed by an admin' : ' · fully automatic'}
                </p>
                <div className="flex items-center justify-center gap-3">
                  <Link href="/mapping-review" className="btn-ghost text-xs">Back to mapping review</Link>
                  <Link href={`/recipes/${encodeURIComponent(recipeId)}`} className="btn-primary text-xs">View recipe</Link>
                </div>
              </div>
            )
          }

          if (!data.proposal) {
            return (
              <div className="text-center py-16 border border-border rounded-2xl">
                <RefreshCw size={36} className="text-faint mx-auto mb-4" aria-hidden="true" />
                <h1 className="font-display text-2xl text-cream font-light mb-2">{data.recipeTitle}</h1>
                <p className="text-faint text-sm font-body max-w-sm mx-auto">
                  {data.staleProposalId
                    ? 'The recipe changed after this mapping was created. A new mapping proposal is required.'
                    : 'No mapping proposal exists yet for this recipe.'}
                </p>
              </div>
            )
          }

          const nonReviewBlockers = data.proposal.blockingReasons.filter(r => r !== 'CANDIDATE_REVIEW_REQUIRED')
          if (data.proposal.approvalBlocked && nonReviewBlockers.length > 0) {
            return (
              <div className="text-center py-16 border border-border rounded-2xl">
                <AlertTriangle size={36} className="text-amber/70 mx-auto mb-4" aria-hidden="true" />
                <h1 className="font-display text-2xl text-cream font-light mb-2">{data.recipeTitle}</h1>
                <p className="text-faint text-sm font-body max-w-sm mx-auto">
                  {MAPPING_BLOCKED_REASON_COPY[nonReviewBlockers[0]] ?? 'This proposal cannot be reviewed right now.'}
                </p>
              </div>
            )
          }

          const completion = data.completion
          const showMilestone = !!completion?.complete && uiPhase !== 'COMPLETENESS'
          const hadAnyReviewRequired = reviewCandidates.length > 0

          if (showMilestone) {
            return (
              <div className="text-center py-16 border border-border rounded-2xl">
                <CheckCircle2 size={36} className="text-amber mx-auto mb-4" aria-hidden="true" />
                <h1 className="font-display text-2xl text-cream font-light mb-2">{data.recipeTitle}</h1>
                <p className="text-faint text-sm font-body max-w-sm mx-auto mb-6">
                  {hadAnyReviewRequired
                    ? 'Review complete — every ingredient on this recipe has a decision.'
                    : 'This recipe’s mapping was fully resolved automatically — nothing needs your decision.'}
                </p>
                <button type="button" onClick={() => setUiPhase('COMPLETENESS')} className="btn-primary text-sm">
                  Continue to full map review
                </button>
              </div>
            )
          }

          if (uiPhase === 'COMPLETENESS') {
            const autoCount = data.candidates.filter(c => c.finalDecision === 'ACCEPT' && c.decisionSource === 'AUTO').length
            const humanCount = data.candidates.filter(c => c.finalDecision === 'ACCEPT' && c.decisionSource === 'HUMAN').length
            return (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h1 className="font-display text-2xl text-cream font-light">{data.recipeTitle}</h1>
                  <button type="button" onClick={() => setUiPhase('REVIEW')} className="text-xs font-body text-faint hover:text-cream">
                    Back to step review
                  </button>
                </div>
                <MappingCompletenessPreview
                  ingredients={data.liveSource.ingredients}
                  instructions={data.liveSource.instructions}
                  candidates={data.candidates}
                  busyKey={completenessBusyKey}
                  errorByKey={completenessErrors}
                  onAddRelationship={handleAddRelationship}
                  onRemoveRelationship={handleRemoveRelationship}
                />
                <MappingApprovalPanel
                  recipeTitle={data.recipeTitle}
                  stepCount={data.liveSource.instructions.length}
                  autoCount={autoCount}
                  humanCount={humanCount}
                  attested={!!data.attestation?.valid}
                  attesting={attesting}
                  attestError={attestError}
                  onAttest={handleAttest}
                  approving={approving}
                  approveError={approveError}
                  onApprove={handleApprove}
                />
              </div>
            )
          }

          // REVIEWING — step-centric candidate review.
          if (currentStepIndex === null) return null
          const candidatesForStep = reviewCandidates.filter(c => c.stepIndex === currentStepIndex)
          const currentPosInList = stepIndexesWithReview.indexOf(currentStepIndex)
          const nextUnresolved = unresolvedStepIndexes.find(i => i !== currentStepIndex) ?? unresolvedStepIndexes[0]

          return (
            <div>
              <h1 className="font-display text-2xl text-cream font-light mb-4">{data.recipeTitle}</h1>
              <MappingStepReviewCard
                stepIndex={currentStepIndex}
                instruction={data.liveSource.instructions[currentStepIndex] ?? ''}
                prevInstruction={currentStepIndex > 0 ? data.liveSource.instructions[currentStepIndex - 1] ?? null : null}
                nextInstruction={currentStepIndex < data.liveSource.instructions.length - 1 ? data.liveSource.instructions[currentStepIndex + 1] ?? null : null}
                candidates={candidatesForStep}
                busyCandidateId={busyCandidateId}
                errorByCandidateId={candidateErrors}
                onDecide={(candidateId, decision) => { void handleDecide(candidateId, decision) }}
                onFetchHistory={handleFetchHistory}
                resolvedCount={completion?.resolvedCandidates ?? 0}
                totalCount={completion?.totalCandidates ?? 0}
                stepsRemaining={unresolvedStepIndexes.length}
                stepsTotal={stepIndexesWithReview.length}
                onPrevStep={() => setCurrentStepIndex(stepIndexesWithReview[currentPosInList - 1] ?? currentStepIndex)}
                onNextStep={() => setCurrentStepIndex(stepIndexesWithReview[currentPosInList + 1] ?? currentStepIndex)}
                onJumpNextUnresolved={() => { if (nextUnresolved !== undefined) setCurrentStepIndex(nextUnresolved) }}
                canPrev={currentPosInList > 0}
                canNext={currentPosInList < stepIndexesWithReview.length - 1}
                hasNextUnresolved={unresolvedStepIndexes.length > 0 && nextUnresolved !== undefined}
                onViewFullMap={() => setUiPhase('COMPLETENESS')}
              />
            </div>
          )
        })()}
      </LoadingErrorRetry>
    </div>
  )
}
