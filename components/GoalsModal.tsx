'use client'

// Goals editor (Feature 3) — the ONLY place daily nutrition targets are set.
// Loads via getGoals, persists via saveGoals. Six numeric inputs, one per macro.

import { useEffect, useState } from 'react'
import { X, Check, Loader2, Target } from 'lucide-react'
import { useAuth } from '@/lib/AuthContext'
import { getGoals, saveGoals } from '@/lib/consumptionLog'
import { NUTRIENTS } from '@/lib/nutrition'
import type { NutritionMacros } from '@/types/recipe'

const EMPTY: Record<string, string> = {
  calories: '', protein_g: '', carbs_g: '', fat_g: '', fiber_g: '', sugar_g: '',
}

export default function GoalsModal({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const { user } = useAuth()
  const [values, setValues] = useState<Record<string, string>>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedOk, setSavedOk] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user) return
    getGoals(user.uid)
      .then(g => {
        if (g) {
          setValues({
            calories: g.calories ? String(g.calories) : '',
            protein_g: g.protein_g ? String(g.protein_g) : '',
            carbs_g: g.carbs_g ? String(g.carbs_g) : '',
            fat_g: g.fat_g ? String(g.fat_g) : '',
            fiber_g: g.fiber_g ? String(g.fiber_g) : '',
            sugar_g: g.sugar_g ? String(g.sugar_g) : '',
          })
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [user])

  const parsed: NutritionMacros | null = (() => {
    const num = (k: string) => {
      const v = values[k].trim()
      if (v === '') return 0
      const n = Number(v)
      return Number.isFinite(n) && n >= 0 ? n : NaN
    }
    const m = {
      calories: num('calories'), protein_g: num('protein_g'), carbs_g: num('carbs_g'),
      fat_g: num('fat_g'), fiber_g: num('fiber_g'), sugar_g: num('sugar_g'),
    }
    if (Object.values(m).some(v => Number.isNaN(v))) return null
    return m
  })()

  const handleSave = async () => {
    if (!user || !parsed) return
    setSaving(true)
    setError('')
    try {
      await saveGoals(user.uid, parsed)
      setSavedOk(true)
      onSaved?.()
      setTimeout(onClose, 600)
    } catch {
      setError("Couldn't save your goals — try again.")
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[95]">
      <div className="absolute inset-0 bg-ink/80 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className="absolute bottom-0 left-0 right-0 max-w-lg mx-auto bg-surface border border-border rounded-t-3xl max-h-[88vh] flex flex-col animate-fade-in md:bottom-auto md:top-1/2 md:left-1/2 md:right-auto md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-3xl md:w-full">
        <div className="shrink-0 px-5 pt-4 pb-3 flex items-center justify-between border-b border-border">
          <h2 className="font-display text-2xl text-cream font-light flex items-center gap-2">
            <Target size={18} className="text-amber" /> Daily goals
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 rounded-full flex items-center justify-center bg-card border border-border text-faint hover:text-cream transition-all"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center gap-2 text-faint text-sm font-body py-6">
              <Loader2 size={14} className="animate-spin text-amber" /> Loading goals…
            </div>
          ) : (
            <>
              <p className="text-faint text-xs font-body mb-4">
                Daily targets. Protein &amp; fiber are floors to reach; calories, carbs, fat &amp; sugar are ceilings to stay under. Leave a field blank for no target.
              </p>
              <div className="grid grid-cols-2 gap-3">
                {NUTRIENTS.map(n => (
                  <label key={n.key} className="block">
                    <span className="text-faint text-[10px] font-body uppercase tracking-widest">
                      {n.label}{n.unit ? ` (${n.unit})` : ''}
                    </span>
                    <input
                      type="number"
                      min="0"
                      inputMode="decimal"
                      value={values[n.key]}
                      onChange={e => setValues(prev => ({ ...prev, [n.key]: e.target.value }))}
                      placeholder="—"
                      className="input-field mt-1 text-sm"
                    />
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="shrink-0 px-5 py-4 border-t border-border">
          {error && <p className="text-red-400 text-xs font-body mb-2">{error}</p>}
          <button
            onClick={handleSave}
            disabled={!parsed || saving || loading}
            className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-40"
          >
            {savedOk ? (<><Check size={16} /> Saved!</>) :
              saving ? (<><Loader2 size={16} className="animate-spin" /> Saving…</>) :
              'Save goals'}
          </button>
        </div>
      </div>
    </div>
  )
}
