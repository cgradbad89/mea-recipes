'use client'

import { useState } from 'react'
import { Plus, Loader2 } from 'lucide-react'

export interface MappingAddRelationshipPickerProps {
  /** [ingredientRowIndex, ingredientText][] — rows not currently mapped to this step. */
  availableIngredients: Array<[number, string]>
  busy: boolean
  error: string | null
  onAdd: (ingredientRowIndex: number) => void | Promise<void>
}

/**
 * "+ Add ingredient to this step" (design §7.3/§8). The reviewer picks from
 * this recipe's existing, currently-unmapped ingredient rows only — never
 * arbitrary text entry (Phase 15).
 */
export default function MappingAddRelationshipPicker({ availableIngredients, busy, error, onAdd }: MappingAddRelationshipPickerProps) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState('')

  if (availableIngredients.length === 0) return null

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 text-xs font-body text-amber hover:text-amber/80 mt-2">
        <Plus size={13} aria-hidden="true" /> Add ingredient to this step
      </button>
    )
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <select
        value={selected}
        onChange={e => setSelected(e.target.value)}
        aria-label="Ingredient to add to this step"
        className="input-field w-auto text-xs py-2"
      >
        <option value="">Choose an ingredient…</option>
        {availableIngredients.map(([index, text]) => (
          <option key={index} value={index}>{text}</option>
        ))}
      </select>
      <button
        type="button"
        disabled={busy || selected === ''}
        onClick={() => { if (selected !== '') void onAdd(Number(selected)) }}
        className="btn-primary text-xs px-3 py-2 flex items-center gap-1.5 disabled:opacity-50"
      >
        {busy ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Plus size={12} aria-hidden="true" />}
        Add
      </button>
      <button type="button" onClick={() => { setOpen(false); setSelected('') }} className="text-xs font-body text-faint hover:text-cream">
        Cancel
      </button>
      {error && <p role="alert" className="text-red-400 text-xs font-body w-full">{error}</p>}
    </div>
  )
}
