'use client'

// Insights tab (Surface 5). The analytical view of the Nutrition page:
//   1. Range selector — week (Mon-start, default), month, YTD, custom picker.
//   2. Totals + goal attainment over the range, against COMPOUNDING goals
//      (daily goal × days). For the current/incomplete period, attainment is
//      pro-rated to ELAPSED days so a mid-week view doesn't read as "failing"
//      the full-week target. Reuses the GoalRing visual (floors/ceilings).
//   3. Nutrient-filtered breakdown — a recharts donut whose slices are the
//      foods/recipes that contributed the selected nutrient (NOT data-source),
//      plus a ranked contributor table with per-food source badges.
//   4. Friendly empty/sparse states (logging just started; most ranges are
//      thin or empty — never show empty charts, zeros, or divide-by-zero).
//
// Reads consumption only via getEntriesForRange (lib/consumptionLog.ts); no new
// data-access logic. See nutrition-tracker-spec.md, Surface 5.

import { useEffect, useMemo, useState } from 'react'
import { BarChart2, Loader2, Calendar } from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { getEntriesForRange } from '@/lib/consumptionLog'
import { NUTRIENTS, formatNutrient, sourceLabel } from '@/lib/nutrition'
import GoalRing, { type RingKind } from '@/components/GoalRing'
import type { ConsumptionEntry, NutritionGoals } from '@/types/nutrition'
import type { NutritionMacros } from '@/types/recipe'

type RangeKind = 'week' | 'month' | 'ytd' | 'custom'

// Same floor/ceiling split the Today view uses: protein & fiber are floors
// (fill toward target), the rest are ceilings (over = warn).
const CEILING_KEYS = new Set<keyof NutritionMacros>(['calories', 'carbs_g', 'fat_g', 'sugar_g'])

// Warm-palette donut slices; the tail collapses into "Other" (faint).
const SLICE_COLORS = ['#E8A838', '#F5C060', '#5eead4', '#93c5fd', '#fb923c', '#c084fc', '#a3e635']
const OTHER_COLOR = '#6B5E50'
const MAX_SLICES = 6

// Overview donut = macro composition by calorie contribution. Only the three
// energy-bearing macros are slices; kcal-per-gram drives each slice's value.
// Fiber & sugar are subsets of carbs (not separate calorie sources) so they are
// list-only context, never slices.
const MACRO_KCAL: Partial<Record<keyof NutritionMacros, number>> = { protein_g: 4, carbs_g: 4, fat_g: 9 }
const MACRO_COLORS: Partial<Record<keyof NutritionMacros, string>> = {
  protein_g: '#E8A838', carbs_g: '#5eead4', fat_g: '#fb923c',
}

// ─── Date helpers (all local-time, calendar-day based) ───────────────────────

function startOfDay(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
function endOfDay(d: Date): Date { const x = new Date(d); x.setHours(23, 59, 59, 999); return x }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x }

function startOfWeekMonday(d: Date): Date {
  const x = startOfDay(d)
  const day = x.getDay()                 // 0=Sun … 6=Sat
  x.setDate(x.getDate() + (day === 0 ? -6 : 1 - day))
  return x
}
function startOfMonth(d: Date): Date { const x = new Date(d.getFullYear(), d.getMonth(), 1); return startOfDay(x) }
function endOfMonth(d: Date): Date { const x = new Date(d.getFullYear(), d.getMonth() + 1, 0); return endOfDay(x) }
function startOfYear(d: Date): Date { return startOfDay(new Date(d.getFullYear(), 0, 1)) }

/** Calendar days from a→b inclusive (both rounded to midnight). */
function daysInclusive(a: Date, b: Date): number {
  const ms = startOfDay(b).getTime() - startOfDay(a).getTime()
  return Math.floor(ms / 86400000) + 1
}

/** <input type="date"> value (YYYY-MM-DD) in local time. */
function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function parseIsoDate(s: string): Date | null {
  const [y, m, d] = s.split('-').map(Number)
  if (!y || !m || !d) return null
  return startOfDay(new Date(y, m - 1, d))
}

interface ResolvedRange {
  start: Date          // midnight, inclusive
  end: Date            // 23:59:59.999 of the last day — the query upper bound
  totalDays: number    // calendar days in the nominal period (for the full compounded target)
  elapsedDays: number  // days elapsed through today — drives pro-rated attainment
  label: string
  valid: boolean
}

/**
 * Resolve a range kind (+ custom inputs) to query bounds and the day counts
 * that drive compounding-goal attainment.
 *
 * Compounding goals: a daily goal compounds over a range to (daily × days).
 * For a period that includes today (incomplete), we pro-rate to ELAPSED days —
 * days from the period start through today inclusive — so attainment reflects
 * where you should be NOW, not the full period's target. A fully-past period
 * uses all of its days; a fully-future period yields 0 elapsed.
 */
function resolveRange(kind: RangeKind, now: Date, customStart: string, customEnd: string): ResolvedRange {
  const today = startOfDay(now)

  let start: Date
  let nominalEnd: Date
  let label: string

  if (kind === 'week') {
    start = startOfWeekMonday(now)
    nominalEnd = addDays(start, 6)
    label = 'This week'
  } else if (kind === 'month') {
    start = startOfMonth(now)
    nominalEnd = startOfDay(endOfMonth(now))
    label = now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  } else if (kind === 'ytd') {
    start = startOfYear(now)
    nominalEnd = today                     // YTD ends today by definition
    label = `${now.getFullYear()} to date`
  } else {
    const cs = parseIsoDate(customStart)
    const ce = parseIsoDate(customEnd)
    if (!cs || !ce || ce.getTime() < cs.getTime()) {
      return { start: today, end: endOfDay(today), totalDays: 0, elapsedDays: 0, label: 'Custom range', valid: false }
    }
    start = cs
    nominalEnd = ce
    label = cs.getTime() === ce.getTime()
      ? cs.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      : `${cs.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${ce.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
  }

  const totalDays = daysInclusive(start, nominalEnd)
  let elapsedDays: number
  if (today.getTime() < start.getTime()) elapsedDays = 0
  else if (today.getTime() > nominalEnd.getTime()) elapsedDays = totalDays
  else elapsedDays = Math.min(daysInclusive(start, today), totalDays)

  return { start, end: endOfDay(nominalEnd), totalDays, elapsedDays, label, valid: true }
}

const ZERO: NutritionMacros = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sugar_g: 0 }

// ─── Component ───────────────────────────────────────────────────────────────

export default function InsightsTab({ userId, goals }: { userId: string; goals: NutritionGoals | null }) {
  const now = useMemo(() => new Date(), [])
  const [kind, setKind] = useState<RangeKind>('week')
  const [customStart, setCustomStart] = useState(isoDate(startOfWeekMonday(now)))
  const [customEnd, setCustomEnd] = useState(isoDate(now))
  // null = overview (macro composition). A nutrient key = drill-down into the
  // foods/recipes that contributed it.
  const [drilled, setDrilled] = useState<keyof NutritionMacros | null>(null)

  const [entries, setEntries] = useState<ConsumptionEntry[]>([])
  const [loading, setLoading] = useState(true)

  const range = useMemo(
    () => resolveRange(kind, now, customStart, customEnd),
    [kind, now, customStart, customEnd],
  )

  useEffect(() => {
    if (!range.valid) { setEntries([]); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    getEntriesForRange(userId, range.start, range.end)
      .then(e => { if (!cancelled) setEntries(e) })
      .catch(() => { if (!cancelled) setEntries([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [userId, range.valid, range.start, range.end])

  // Range totals across all six nutrients.
  const totals = useMemo(() => {
    const t: NutritionMacros = { ...ZERO }
    for (const e of entries) {
      for (const n of NUTRIENTS) t[n.key] += e.nutrition?.[n.key] || 0
    }
    return t
  }, [entries])

  // Per-food contributions to the drilled nutrient, aggregated by name across
  // every log entry of that food in the range (slices = foods/recipes). Empty
  // in the overview state (no nutrient drilled).
  const contributors = useMemo(() => {
    if (!drilled) return []
    const map = new Map<string, { name: string; amount: number; source: string }>()
    for (const e of entries) {
      const amount = e.nutrition?.[drilled] || 0
      if (amount <= 0) continue
      const key = e.name.trim().toLowerCase() || '(unnamed)'
      const cur = map.get(key)
      if (cur) cur.amount += amount
      else map.set(key, { name: e.name.trim() || 'Unnamed', amount, source: e.source })
    }
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount)
  }, [entries, drilled])

  // Overview donut: macro composition by calorie contribution (protein·4,
  // carbs·4, fat·9), each as a share of those calories. Zero-cal macros drop out.
  const composition = useMemo(() => {
    const slices = (['protein_g', 'carbs_g', 'fat_g'] as const)
      .map(key => ({
        key,
        name: NUTRIENTS.find(n => n.key === key)!.label,
        cals: (totals[key] || 0) * (MACRO_KCAL[key] || 0),
      }))
      .filter(s => s.cals > 0)
    const total = slices.reduce((s, d) => s + d.cals, 0)
    return { slices, total }
  }, [totals])

  const selectedMeta = drilled ? NUTRIENTS.find(n => n.key === drilled)! : null
  const selectedTotal = drilled ? totals[drilled] : 0
  const goalsSet = !!goals && NUTRIENTS.some(n => (goals[n.key] || 0) > 0)
  const hasEntries = entries.length > 0

  // Donut data: top slices + a collapsed "Other" tail.
  const donutData = useMemo(() => {
    if (contributors.length <= MAX_SLICES) {
      return contributors.map(c => ({ name: c.name, value: c.amount, isOther: false }))
    }
    const head = contributors.slice(0, MAX_SLICES)
    const tail = contributors.slice(MAX_SLICES)
    const otherTotal = tail.reduce((s, c) => s + c.amount, 0)
    return [
      ...head.map(c => ({ name: c.name, value: c.amount, isOther: false })),
      { name: `Other (${tail.length})`, value: otherTotal, isOther: true },
    ]
  }, [contributors])

  return (
    <div className="space-y-8">
      {/* ── Feature 1: range selector ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {([['week', 'Week'], ['month', 'Month'], ['ytd', 'YTD'], ['custom', 'Custom']] as [RangeKind, string][]).map(
          ([k, label]) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`px-3.5 py-1.5 rounded-xl text-sm font-body font-medium border transition-all ${
                kind === k
                  ? 'bg-amber/10 border-amber/30 text-amber'
                  : 'bg-surface border-border text-muted hover:text-cream hover:border-amber/40'
              }`}
            >
              {label}
            </button>
          ),
        )}

        {kind === 'custom' && (
          <div className="flex items-center gap-2 ml-1">
            <Calendar size={14} className="text-faint" />
            <input
              type="date"
              value={customStart}
              max={customEnd || undefined}
              onChange={e => setCustomStart(e.target.value)}
              className="input-field py-1.5 px-2.5 text-sm w-auto [color-scheme:dark]"
              aria-label="Start date"
            />
            <span className="text-faint text-sm">–</span>
            <input
              type="date"
              value={customEnd}
              min={customStart || undefined}
              onChange={e => setCustomEnd(e.target.value)}
              className="input-field py-1.5 px-2.5 text-sm w-auto [color-scheme:dark]"
              aria-label="End date"
            />
          </div>
        )}
      </div>

      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="font-display text-2xl text-cream font-light">{range.label}</h2>
        {range.valid && (
          <span className="text-faint text-xs font-body">
            {range.elapsedDays < range.totalDays
              ? `${range.elapsedDays} of ${range.totalDays} days elapsed`
              : `${range.totalDays} ${range.totalDays === 1 ? 'day' : 'days'}`}
          </span>
        )}
      </div>

      {!range.valid ? (
        <EmptyState
          title="Pick a valid date range"
          body="Choose a start date on or before the end date to see your totals."
        />
      ) : loading ? (
        <div className="flex items-center justify-center min-h-[30vh]">
          <Loader2 className="animate-spin text-amber" size={28} />
        </div>
      ) : !hasEntries ? (
        <EmptyState
          title="No food logged in this range yet"
          body="Once you log meals in this period, totals, goal attainment, and your top nutrient sources will appear here."
        />
      ) : (
        <>
          {/* ── Feature 2: totals + compounding goal attainment ─────────────── */}
          <section>
            {goalsSet ? (
              <>
                <p className="text-faint text-xs font-body mb-3">
                  Consumed vs. your daily goals compounded over{' '}
                  {range.elapsedDays < range.totalDays
                    ? `the ${range.elapsedDays} day${range.elapsedDays === 1 ? '' : 's'} elapsed so far`
                    : `${range.totalDays} day${range.totalDays === 1 ? '' : 's'}`}
                  .
                </p>
                <div className="bg-surface border border-border rounded-2xl p-5">
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-y-5 gap-x-2">
                    {NUTRIENTS.map(n => {
                      const kindRing: RingKind = CEILING_KEYS.has(n.key) ? 'ceiling' : 'floor'
                      // Compounded, pro-rated target. elapsedFraction=1 because the
                      // target is already scaled to elapsed days — the full elapsed
                      // target is what you should have hit by now.
                      const proRatedGoal = (goals?.[n.key] || 0) * range.elapsedDays
                      return (
                        <GoalRing
                          key={n.key}
                          nutrientKey={n.key}
                          label={n.label}
                          unit={n.unit}
                          consumed={totals[n.key]}
                          goal={proRatedGoal}
                          kind={kindRing}
                          elapsedFraction={1}
                        />
                      )
                    })}
                  </div>
                </div>
              </>
            ) : (
              // No goals set — still show the raw totals so the range is useful.
              <div className="bg-surface border border-border rounded-2xl p-5">
                <p className="text-faint text-xs font-body mb-4">
                  Total consumed this range. Set daily goals to see attainment.
                </p>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-4">
                  {NUTRIENTS.map(n => (
                    <div key={n.key} className="text-center">
                      <p className="font-display text-2xl text-cream font-light leading-none">
                        {formatNutrient(n.key, totals[n.key])}
                        <span className="text-faint text-[10px] font-body ml-0.5">{n.unit}</span>
                      </p>
                      <p className="text-faint text-xs font-body mt-1.5">{n.label}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* ── Feature 3: one donut, two states — macro composition overview
              that drills into per-nutrient food contributors ──────────────── */}
          <section>
            <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
              {drilled ? (
                <div className="flex items-baseline gap-3">
                  <button
                    onClick={() => setDrilled(null)}
                    className="text-amber text-sm font-body font-medium hover:text-amber/80 transition-colors shrink-0"
                  >
                    ← All nutrients
                  </button>
                  <h3 className="font-display text-xl text-cream font-light">
                    {selectedMeta!.label} sources
                  </h3>
                </div>
              ) : (
                <h3 className="font-display text-xl text-cream font-light">Macro composition</h3>
              )}
              <span className="text-faint text-xs font-body">
                {drilled ? 'Foods & recipes that contributed it' : 'Share of calories · tap a slice or row to drill in'}
              </span>
            </div>

            <div className="bg-surface border border-border rounded-2xl p-5 grid md:grid-cols-2 gap-6 items-center">
              {/* Donut — composition (overview) or food contributors (drill) */}
              <div className="relative" style={{ height: 260 }}>
                {drilled ? (
                  selectedTotal <= 0 ? (
                    <InlineNote text={`No ${selectedMeta!.label.toLowerCase()} logged in this range`} />
                  ) : (
                    <>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={donutData}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            innerRadius={68}
                            outerRadius={104}
                            paddingAngle={1.5}
                            stroke="none"
                          >
                            {donutData.map((d, i) => (
                              <Cell key={i} fill={d.isOther ? OTHER_COLOR : SLICE_COLORS[i % SLICE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip content={<DonutTooltip nutrientKey={drilled} unit={selectedMeta!.unit} total={selectedTotal} />} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        <span className="font-display text-3xl text-cream font-light leading-none">
                          {formatNutrient(drilled, selectedTotal)}
                        </span>
                        <span className="text-faint text-[11px] font-body mt-1">
                          total {selectedMeta!.label.toLowerCase()}{selectedMeta!.unit ? ` (${selectedMeta!.unit})` : ''}
                        </span>
                      </div>
                    </>
                  )
                ) : composition.total <= 0 ? (
                  <InlineNote text="Not enough macro data to chart composition" />
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={composition.slices}
                          dataKey="cals"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={68}
                          outerRadius={104}
                          paddingAngle={1.5}
                          stroke="none"
                          cursor="pointer"
                          onClick={(d: { key?: keyof NutritionMacros; payload?: { key?: keyof NutritionMacros } }) => {
                            const k = d?.key ?? d?.payload?.key
                            if (k) setDrilled(k)
                          }}
                        >
                          {composition.slices.map(s => (
                            <Cell key={s.key} fill={MACRO_COLORS[s.key]} />
                          ))}
                        </Pie>
                        <Tooltip content={<CompositionTooltip total={composition.total} />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="font-display text-3xl text-cream font-light leading-none">
                        {formatNutrient('calories', totals.calories)}
                      </span>
                      <span className="text-faint text-[11px] font-body mt-1">total calories</span>
                    </div>
                  </>
                )}
              </div>

              {/* List — six-nutrient overview, or ranked food contributors */}
              <div className="space-y-1">
                {drilled ? (
                  contributors.length === 0 ? (
                    <p className="text-faint text-sm font-body text-center py-6">
                      No {selectedMeta!.label.toLowerCase()} logged in this range.
                    </p>
                  ) : (
                    contributors.map((c, i) => {
                      const pct = selectedTotal > 0 ? Math.round((c.amount / selectedTotal) * 100) : 0
                      const swatch = i < MAX_SLICES ? SLICE_COLORS[i % SLICE_COLORS.length] : OTHER_COLOR
                      return (
                        <div key={c.name + i} className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-card transition-colors">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: swatch }} />
                          <div className="flex-1 min-w-0">
                            <p className="text-cream text-sm font-body truncate">{c.name}</p>
                            <span className="tag text-[10px] capitalize mt-0.5 inline-block">{sourceLabel(c.source)}</span>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-cream text-sm font-body font-medium leading-none">
                              {formatNutrient(drilled, c.amount)}
                              <span className="text-faint text-[10px] ml-0.5">{selectedMeta!.unit}</span>
                            </p>
                            <p className="text-faint text-[10px] font-body mt-0.5">{pct}%</p>
                          </div>
                        </div>
                      )
                    })
                  )
                ) : (
                  NUTRIENTS.map(n => {
                    const isMacro = n.key in MACRO_COLORS
                    const cals = (totals[n.key] || 0) * (MACRO_KCAL[n.key] || 0)
                    const pct = isMacro && composition.total > 0 ? Math.round((cals / composition.total) * 100) : null
                    const sub =
                      n.key === 'calories' ? 'total energy'
                      : isMacro ? `${pct}% of calories`
                      : 'subset of carbs'
                    return (
                      <button
                        key={n.key}
                        onClick={() => setDrilled(n.key)}
                        className="w-full flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-card transition-colors text-left"
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ background: isMacro ? MACRO_COLORS[n.key] : OTHER_COLOR }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-cream text-sm font-body truncate">{n.label}</p>
                          <p className="text-faint text-[10px] font-body mt-0.5">{sub}</p>
                        </div>
                        <p className="text-cream text-sm font-body font-medium leading-none shrink-0">
                          {formatNutrient(n.key, totals[n.key])}
                          <span className="text-faint text-[10px] ml-0.5">{n.unit}</span>
                        </p>
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

// ── Composition tooltip (overview: macro share of calories) ─────────────────

function CompositionTooltip({
  active, payload, total,
}: {
  active?: boolean
  payload?: { name: string; value: number }[]
  total: number
}) {
  if (!active || !payload?.length) return null
  const { name, value } = payload[0]
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-lg">
      <p className="text-cream text-xs font-body font-medium">{name}</p>
      <p className="text-faint text-[11px] font-body mt-0.5">
        {Math.round(value)} cal · {pct}%
      </p>
    </div>
  )
}

// ── Inline note shown in place of the donut when a layer has no data ─────────

function InlineNote({ text }: { text: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center text-center px-4">
      <p className="text-faint text-sm font-body">{text}</p>
    </div>
  )
}

// ── Donut tooltip ────────────────────────────────────────────────────────────

function DonutTooltip({
  active, payload, nutrientKey, unit, total,
}: {
  active?: boolean
  payload?: { name: string; value: number }[]
  nutrientKey: keyof NutritionMacros
  unit: string
  total: number
}) {
  if (!active || !payload?.length) return null
  const { name, value } = payload[0]
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-lg">
      <p className="text-cream text-xs font-body font-medium">{name}</p>
      <p className="text-faint text-[11px] font-body mt-0.5">
        {formatNutrient(nutrientKey, value)}{unit} · {pct}%
      </p>
    </div>
  )
}

// ── Shared empty state ─────────────────────────────────────────────────────

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-12 text-center">
      <BarChart2 size={36} className="text-faint mx-auto mb-4" />
      <p className="font-display text-2xl text-cream font-light mb-2">{title}</p>
      <p className="text-faint text-sm font-body max-w-md mx-auto">{body}</p>
    </div>
  )
}
