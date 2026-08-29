'use client'

import { ChevronLeft, ChevronRight, SkipForward, Map as MapIcon } from 'lucide-react'
import MappingCandidateRow from './MappingCandidateRow'
import type { PersistedMappingCandidateV1, PersistedMappingReviewDecisionV1 } from '@/types/cookingModeMappingPersistence'

export interface MappingStepReviewCardProps {
  stepIndex: number
  instruction: string
  prevInstruction: string | null
  nextInstruction: string | null
  candidates: PersistedMappingCandidateV1[]
  busyCandidateId: string | null
  errorByCandidateId: Record<string, string>
  onDecide: (candidateId: string, decision: 'ACCEPT' | 'REJECT') => void
  onFetchHistory: (candidateId: string) => Promise<PersistedMappingReviewDecisionV1[]>
  resolvedCount: number
  totalCount: number
  stepsRemaining: number
  stepsTotal: number
  onPrevStep: () => void
  onNextStep: () => void
  onJumpNextUnresolved: () => void
  canPrev: boolean
  canNext: boolean
  hasNextUnresolved: boolean
  onViewFullMap: () => void
}

/**
 * Step-centric review — the primary interaction (design §3, §5). The
 * instruction is the dominant element on screen; neighboring steps are
 * collapsed context; every Include/Exclude writes immediately, so
 * navigation never risks losing a decision.
 */
export default function MappingStepReviewCard({
  stepIndex, instruction, prevInstruction, nextInstruction, candidates,
  busyCandidateId, errorByCandidateId, onDecide, onFetchHistory,
  resolvedCount, totalCount, stepsRemaining, stepsTotal,
  onPrevStep, onNextStep, onJumpNextUnresolved, canPrev, canNext, hasNextUnresolved,
  onViewFullMap,
}: MappingStepReviewCardProps) {
  const stepUnresolved = candidates.filter(c => c.finalDecision === null).length

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-faint text-xs font-body">
          {resolvedCount} of {totalCount} reviewed · {stepsTotal - stepsRemaining} of {stepsTotal} steps done
        </p>
        <button type="button" onClick={onViewFullMap} className="inline-flex items-center gap-1.5 text-xs font-body text-amber hover:text-amber/80">
          <MapIcon size={13} aria-hidden="true" /> View full map
        </button>
      </div>
      <div className="h-1 bg-border rounded-full mb-6 overflow-hidden">
        <div className="h-full bg-amber rounded-full transition-all" style={{ width: totalCount ? `${(resolvedCount / totalCount) * 100}%` : '0%' }} />
      </div>

      {prevInstruction !== null && (
        <p className="text-faint text-xs font-body mb-2 truncate">◂ Step {stepIndex} — {prevInstruction}</p>
      )}

      <div className="bg-amber/10 border border-amber/40 rounded-2xl p-5 mb-4">
        <span className="font-display text-2xl font-light text-amber">Step {stepIndex + 1}</span>
        <p className="font-body text-lg text-cream leading-relaxed mt-1">{instruction}</p>
      </div>

      {nextInstruction !== null && (
        <p className="text-faint text-xs font-body mb-6 truncate">Step {stepIndex + 2} — {nextInstruction} ▸</p>
      )}

      <div className="space-y-3 mb-6">
        {candidates.map(candidate => (
          <MappingCandidateRow
            key={candidate.candidateId}
            candidate={candidate}
            busy={busyCandidateId === candidate.candidateId}
            error={errorByCandidateId[candidate.candidateId] ?? null}
            onDecide={decision => onDecide(candidate.candidateId, decision)}
            onFetchHistory={() => onFetchHistory(candidate.candidateId)}
          />
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 pt-4 border-t border-border">
        <button type="button" onClick={onPrevStep} disabled={!canPrev} className="btn-ghost flex items-center gap-1.5 text-xs disabled:opacity-40">
          <ChevronLeft size={14} aria-hidden="true" /> Previous
        </button>
        <button
          type="button"
          onClick={onJumpNextUnresolved}
          disabled={!hasNextUnresolved}
          className="flex items-center gap-1.5 text-xs font-body text-amber hover:text-amber/80 disabled:opacity-40 disabled:hover:text-amber"
        >
          <SkipForward size={14} aria-hidden="true" /> Jump to next unresolved
        </button>
        <button type="button" onClick={onNextStep} disabled={!canNext} className="btn-ghost flex items-center gap-1.5 text-xs disabled:opacity-40">
          Next <ChevronRight size={14} aria-hidden="true" />
        </button>
      </div>
      {stepUnresolved > 0 && (
        <p className="text-faint text-xs font-body mt-2">
          {stepUnresolved} ingredient{stepUnresolved === 1 ? '' : 's'} on this step still need{stepUnresolved === 1 ? 's' : ''} a decision.
        </p>
      )}
    </div>
  )
}
