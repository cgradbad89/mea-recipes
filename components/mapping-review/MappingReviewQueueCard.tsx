import Link from 'next/link'
import { AlertTriangle, ChevronRight, RefreshCw } from 'lucide-react'
import { MAPPING_QUEUE_STATUS_COPY, MAPPING_BLOCKED_REASON_COPY } from '@/lib/mappingReviewRiskCopy'
import type { MappingReviewQueueEntry } from '@/lib/cookingModeMappingReviewQueue'

const STATUS_TONE: Record<string, string> = {
  NEEDS_REVIEW: 'tag-amber',
  IN_PROGRESS: 'tag-amber',
  READY_FOR_FINAL_REVIEW: 'tag-amber',
  APPROVED: 'tag',
  STALE: 'tag',
  BLOCKED: 'tag',
}

export default function MappingReviewQueueCard({ entry }: { entry: MappingReviewQueueEntry }) {
  const copy = MAPPING_QUEUE_STATUS_COPY[entry.status] ?? { label: entry.status, description: '' }
  const showProgress = entry.status === 'NEEDS_REVIEW' || entry.status === 'IN_PROGRESS'
  const showStaleOrBlocked = entry.status === 'STALE' || entry.status === 'BLOCKED'

  return (
    <Link
      href={`/mapping-review/${encodeURIComponent(entry.recipeId)}`}
      className="recipe-card flex items-center justify-between gap-4 p-5 hover:border-amber/30"
    >
      <div className="min-w-0">
        <h3 className="font-display text-xl text-cream font-light truncate">{entry.recipeTitle}</h3>
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <span className={STATUS_TONE[entry.status] ?? 'tag'}>{copy.label}</span>
          {showProgress && (
            <span className="text-faint text-xs font-body">
              {entry.resolvedCandidates} of {entry.totalCandidates} reviewed
            </span>
          )}
          {entry.status === 'APPROVED' && (
            <span className="text-faint text-xs font-body">{entry.totalCandidates} relationships</span>
          )}
        </div>
        {showStaleOrBlocked && (
          <p className="flex items-center gap-1.5 text-faint text-xs font-body mt-2">
            {entry.status === 'STALE'
              ? <RefreshCw size={12} className="text-amber/70 shrink-0" aria-hidden="true" />
              : <AlertTriangle size={12} className="text-amber/70 shrink-0" aria-hidden="true" />}
            {entry.status === 'STALE'
              ? 'This recipe changed since this mapping was reviewed.'
              : (entry.blockedReason ? MAPPING_BLOCKED_REASON_COPY[entry.blockedReason] ?? copy.description : copy.description)}
          </p>
        )}
      </div>
      <ChevronRight size={18} className="text-faint shrink-0" aria-hidden="true" />
    </Link>
  )
}
