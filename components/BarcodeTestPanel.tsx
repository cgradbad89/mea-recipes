'use client'

// ⚠️ TEMPORARY — dev-only barcode lookup test harness.
// There is no camera/scanning UI yet (next session). This lets a UPC/EAN be
// TYPED and resolved end-to-end against /api/barcode-lookup, shows the result
// (name, basis, source, confidence, macros) and offers a one-tap "Log it" so
// the whole path can be verified now. DELETE THIS FILE and its mount in
// app/nutrition/page.tsx when the camera UI lands.

import { useState } from 'react'
import { ScanBarcode, Loader2, Check } from 'lucide-react'
import { useAuth } from '@/lib/AuthContext'
import { lookupBarcode, sourceLabel, NUTRIENTS, formatNutrient } from '@/lib/nutrition'
import { addLogEntry, scaleMacros, autoMealForTime } from '@/lib/consumptionLog'
import type { BarcodeProduct } from '@/types/nutrition'

export default function BarcodeTestPanel({ onLogged }: { onLogged?: () => void }) {
  const { user } = useAuth()
  const [barcode, setBarcode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notFound, setNotFound] = useState(false)
  const [hit, setHit] = useState<BarcodeProduct | null>(null)
  const [logged, setLogged] = useState(false)

  const doLookup = async () => {
    if (!user) return
    const code = barcode.replace(/\s+/g, '').trim()
    if (!code) return
    setLoading(true); setError(''); setHit(null); setNotFound(false); setLogged(false)
    try {
      const token = await user.getIdToken()
      const data = await lookupBarcode(code, token)
      if (data.found) setHit(data)
      else setNotFound(true)
    } catch (e: any) {
      setError(e?.message || 'Lookup failed')
    } finally {
      setLoading(false)
    }
  }

  const logIt = async () => {
    if (!user || !hit) return
    // Logs identically to any quick food (LogFoodSheet path): is_cook_event false,
    // never touches the plan. Snapshot is the resolved macros × 1 serving.
    await addLogEntry(user.uid, {
      meal: autoMealForTime(), type: 'quick_food', is_cook_event: false, recipe_id: null,
      name: hit.name, servings_eaten: 1,
      nutrition: scaleMacros(hit.nutrition, 1), source: hit.source,
    })
    setLogged(true)
    onLogged?.()
  }

  return (
    <div className="mt-10 rounded-2xl border border-dashed border-border/70 p-5">
      <div className="flex items-center gap-2 mb-1">
        <ScanBarcode size={16} className="text-amber" />
        <h2 className="font-body text-sm font-semibold text-cream">Barcode lookup (temporary dev test)</h2>
      </div>
      <p className="text-faint text-xs font-body mb-4">
        No camera yet — type a UPC/EAN to verify the lookup. Remove when the scanner lands.
      </p>

      <div className="flex items-center gap-2">
        <input
          value={barcode}
          onChange={e => setBarcode(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') doLookup() }}
          inputMode="numeric"
          placeholder="e.g. 3017620422003"
          className="flex-1 bg-transparent border border-border rounded-lg px-3 py-2 text-cream text-sm font-body placeholder:text-faint focus:outline-none focus:border-amber"
        />
        <button
          onClick={doLookup}
          disabled={loading || !barcode.trim()}
          className="btn-primary flex items-center gap-2 text-sm disabled:opacity-50"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <ScanBarcode size={16} />}
          Look up
        </button>
      </div>

      {error && <p className="text-red-400 text-xs font-body mt-3">{error}</p>}
      {notFound && (
        <p className="text-faint text-xs font-body mt-3">Product not found — try search.</p>
      )}

      {hit && (
        <div className="mt-4 rounded-xl border border-border p-4">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div>
              <p className="text-cream text-sm font-body font-medium">{hit.name}</p>
              <p className="text-faint text-[11px] font-body mt-0.5">
                {sourceLabel(hit.source)} · {hit.confidence} ·{' '}
                {hit.basis === 'per_serving' ? 'per serving' : 'per 100 g'}
                {hit.serving_size ? ` · serving: ${hit.serving_size}` : ''}
              </p>
            </div>
            <button
              onClick={logIt}
              disabled={logged}
              className="btn-ghost flex items-center gap-2 text-xs shrink-0 disabled:opacity-60"
            >
              {logged ? <><Check size={14} /> Logged</> : 'Log it'}
            </button>
          </div>
          <div className="grid grid-cols-3 gap-x-4 gap-y-1.5 mt-3">
            {NUTRIENTS.map(n => (
              <div key={n.key} className="flex items-baseline justify-between gap-2">
                <span className="text-faint text-[11px] font-body">{n.label}</span>
                <span className="text-cream text-xs font-body font-medium">
                  {formatNutrient(n.key, hit.nutrition[n.key])}{n.unit}
                </span>
              </div>
            ))}
          </div>
          {hit.basis === 'per_100g' && (
            <p className="text-amber/80 text-[11px] font-body mt-3">
              ⚠ Values are per 100 g, not per serving — serving math is the camera UI's job.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
