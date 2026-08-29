'use client'

import { useState } from 'react'
import { MAPPING_RISK_COPY } from '@/lib/mappingReviewRiskCopy'
import type { MappingRiskEvidence } from '@/types/cookingModeMapping'

/**
 * One V1 risk, as a human-readable chip (design §6). The enum name is never
 * shown; tapping/clicking reveals the one-line source-observable
 * explanation. Never load-bearing for the Include/Exclude decision itself —
 * purely "why was this flagged."
 */
export default function MappingRiskChip({ risk }: { risk: MappingRiskEvidence }) {
  const [expanded, setExpanded] = useState(false)
  const copy = MAPPING_RISK_COPY[risk]
  if (!copy) return null

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        className="inline-flex items-center gap-1.5 text-xs font-body font-medium px-2.5 py-1 rounded-lg bg-amber/10 border border-amber/20 text-amber"
      >
        {copy.label}
      </button>
      {expanded && (
        <p className="text-faint text-xs font-body mt-1 pl-1 max-w-sm">{copy.explanation}</p>
      )}
    </div>
  )
}
