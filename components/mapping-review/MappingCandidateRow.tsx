'use client'

import { useEffect, useState } from 'react'
import { Check, X, Loader2, History as HistoryIcon } from 'lucide-react'
import MappingRiskChip from './MappingRiskChip'
import { MAPPING_HUMAN_REVIEW_REASON_LABELS } from '@/lib/mappingReviewRiskCopy'
import type { PersistedMappingCandidateV1, PersistedMappingReviewDecisionV1 } from '@/types/cookingModeMappingPersistence'

export interface MappingCandidateRowProps {
  candidate: PersistedMappingCandidateV1
  busy: boolean
  error: string | null
  onDecide: (decision: 'ACCEPT' | 'REJECT') => void | Promise<void>
  onFetchHistory: () => Promise<PersistedMappingReviewDecisionV1[]>
}

/**
 * One uncertain ingredient on the current step (design §5.2). Include/Exclude
 * are real buttons with icon + text — never color-only. A resolved candidate
 * collapses to one line with a Change affordance; History is a secondary,
 * on-demand disclosure (Phase 12).
 */
export default function MappingCandidateRow({ candidate, busy, error, onDecide, onFetchHistory }: MappingCandidateRowProps) {
  const [correcting, setCorrecting] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<PersistedMappingReviewDecisionV1[] | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)

  const decided = candidate.finalDecision !== null
  const risks = candidate.deterministicEvidence.risks

  // Once the authoritative decision changes (a correction was persisted and
  // the page refetched), fall back out of the editing state on its own —
  // the row should read as "corrected," not stay open mid-edit.
  useEffect(() => { setCorrecting(false) }, [candidate.finalDecision])

  const toggleHistory = async () => {
    const next = !historyOpen
    setHistoryOpen(next)
    if (next && history === null) {
      setHistoryLoading(true)
      setHistoryError(null)
      try {
        setHistory(await onFetchHistory())
      } catch {
        setHistoryError('Couldn’t load history.')
      } finally {
        setHistoryLoading(false)
      }
    }
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <p className="text-cream font-body text-sm font-medium">{candidate.ingredientText}</p>
        {candidate.ingredientGroup && <span className="tag shrink-0">{candidate.ingredientGroup}</span>}
      </div>

      {candidate.reviewerA && candidate.reviewerB && (
        <div className="flex items-center gap-2 mb-2 flex-wrap" aria-label="Reviewer votes">
          <span className="inline-flex items-center gap-1 text-xs font-body text-muted">
            {candidate.reviewerA.vote === 'ACCEPT' ? <Check size={12} className="text-amber" aria-hidden="true" /> : <X size={12} className="text-faint" aria-hidden="true" />}
            Reviewer A · {candidate.reviewerA.vote === 'ACCEPT' ? 'Include' : 'Exclude'}
          </span>
          <span className="inline-flex items-center gap-1 text-xs font-body text-muted">
            {candidate.reviewerB.vote === 'ACCEPT' ? <Check size={12} className="text-amber" aria-hidden="true" /> : <X size={12} className="text-faint" aria-hidden="true" />}
            Reviewer B · {candidate.reviewerB.vote === 'ACCEPT' ? 'Include' : 'Exclude'}
          </span>
        </div>
      )}

      {risks.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {risks.map(risk => <MappingRiskChip key={risk} risk={risk} />)}
        </div>
      )}

      {decided && !correcting ? (
        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="inline-flex items-center gap-1.5 text-sm font-body text-cream">
            {candidate.finalDecision === 'ACCEPT'
              ? <><Check size={14} className="text-amber" aria-hidden="true" /> Included</>
              : <><X size={14} className="text-faint" aria-hidden="true" /> Excluded</>}
          </span>
          <button type="button" onClick={() => setCorrecting(true)} className="text-xs font-body text-faint hover:text-cream underline">
            Change
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            type="button"
            disabled={busy}
            aria-pressed={candidate.finalDecision === 'ACCEPT'}
            onClick={() => void onDecide('ACCEPT')}
            className={`flex items-center justify-center gap-1.5 min-h-[44px] rounded-xl text-sm font-body font-semibold transition-all ${
              candidate.finalDecision === 'ACCEPT' ? 'bg-amber text-ink' : 'border border-border text-cream hover:border-amber/40'
            }`}
          >
            {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
            Include
          </button>
          <button
            type="button"
            disabled={busy}
            aria-pressed={candidate.finalDecision === 'REJECT'}
            onClick={() => void onDecide('REJECT')}
            className={`flex items-center justify-center gap-1.5 min-h-[44px] rounded-xl text-sm font-body font-semibold transition-all ${
              candidate.finalDecision === 'REJECT' ? 'bg-card border border-amber/40 text-cream' : 'border border-border text-cream hover:border-amber/40'
            }`}
          >
            {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <X size={14} aria-hidden="true" />}
            Exclude
          </button>
        </div>
      )}

      {error && <p role="alert" className="text-red-400 text-xs font-body mt-2">{error}</p>}

      <div className="mt-2">
        <button type="button" onClick={() => void toggleHistory()} aria-expanded={historyOpen} className="inline-flex items-center gap-1 text-xs font-body text-faint hover:text-muted">
          <HistoryIcon size={11} aria-hidden="true" /> History
        </button>
        {historyOpen && (
          <div className="mt-2 space-y-1.5 border-t border-border pt-2">
            {historyLoading && <p className="text-faint text-xs font-body">Loading…</p>}
            {historyError && <p role="alert" className="text-red-400 text-xs font-body">{historyError}</p>}
            {history && history.length === 0 && <p className="text-faint text-xs font-body">No decisions recorded yet.</p>}
            {history?.map(event => (
              <p key={event.decisionId} className="text-faint text-xs font-body">
                {event.decision === 'ACCEPT' ? 'Included' : 'Excluded'} — {MAPPING_HUMAN_REVIEW_REASON_LABELS[event.reasonCode]}
                {event.note ? ` — “${event.note}”` : ''}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
