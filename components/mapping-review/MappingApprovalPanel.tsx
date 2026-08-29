'use client'

import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'

export interface MappingApprovalPanelProps {
  recipeTitle: string
  stepCount: number
  autoCount: number
  humanCount: number
  attested: boolean
  attesting: boolean
  attestError: string | null
  onAttest: () => void | Promise<void>
  approving: boolean
  approveError: string | null
  onApprove: () => void | Promise<void>
}

/**
 * Map-level attestation + approval (design §7.4-7.5, Phase 18-19). A
 * distinct, deliberate action — never reachable by resolving the last
 * candidate, and the Approve action is simply absent (disabled with a
 * reason) whenever the underlying state isn't approvable.
 */
export default function MappingApprovalPanel({
  recipeTitle, stepCount, autoCount, humanCount, attested, attesting, attestError, onAttest,
  approving, approveError, onApprove,
}: MappingApprovalPanelProps) {
  const [checked, setChecked] = useState(false)
  const total = autoCount + humanCount

  // If a mapping change invalidates a prior attestation (attested flips back
  // to false), the affirmation checkbox must not silently carry over a "yes"
  // from before the change — the reviewer re-affirms the *current* state.
  const wasAttested = useRef(attested)
  useEffect(() => {
    if (wasAttested.current && !attested) setChecked(false)
    wasAttested.current = attested
  }, [attested])

  return (
    <div className="bg-card border border-border rounded-2xl p-5 mt-6">
      <h2 className="font-display text-xl text-cream font-light mb-3">Approve Cooking Mode map</h2>
      <dl className="grid grid-cols-2 gap-3 text-sm font-body mb-4">
        <div>
          <dt className="text-faint text-xs">Recipe</dt>
          <dd className="text-cream">{recipeTitle}</dd>
        </div>
        <div>
          <dt className="text-faint text-xs">Instruction steps</dt>
          <dd className="text-cream">{stepCount}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-faint text-xs">Mapped relationships</dt>
          <dd className="text-cream">{total} total — {autoCount} auto-resolved, {humanCount} from your review</dd>
        </div>
      </dl>

      {!attested && (
        <label className="flex items-start gap-2.5 mb-3 cursor-pointer">
          <input
            type="checkbox"
            checked={checked}
            onChange={e => setChecked(e.target.checked)}
            className="mt-1 w-4 h-4 accent-amber shrink-0"
          />
          <span className="text-sm font-body text-muted">
            I&apos;ve reviewed the complete mapping above and it looks complete for this recipe.
          </span>
        </label>
      )}

      {attested ? (
        <p className="flex items-center gap-1.5 text-sm font-body text-amber mb-1">
          <CheckCircle2 size={15} aria-hidden="true" /> Reviewed and attested complete
        </p>
      ) : (
        <button
          type="button"
          disabled={!checked || attesting}
          onClick={() => void onAttest()}
          className="btn-primary flex items-center gap-1.5 text-sm disabled:opacity-50"
        >
          {attesting ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
          I&apos;ve reviewed the complete mapping
        </button>
      )}
      {attestError && <p role="alert" className="text-red-400 text-xs font-body mt-2">{attestError}</p>}

      <div className="mt-4 pt-4 border-t border-border">
        {attested ? (
          <button
            type="button"
            disabled={approving}
            onClick={() => void onApprove()}
            className="btn-primary flex items-center gap-1.5 text-sm disabled:opacity-50"
          >
            {approving ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}
            Approve Cooking Mode map
          </button>
        ) : (
          <p className="text-faint text-xs font-body">Attest completeness above before this map can be approved.</p>
        )}
        {approveError && <p role="alert" className="text-red-400 text-xs font-body mt-2">{approveError}</p>}
      </div>
    </div>
  )
}
