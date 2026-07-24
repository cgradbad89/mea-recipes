'use client'

// Insights tab (Surface 5). The analytical view of the Nutrition page:
//   1. Range selector — week (Mon-start, default), month, YTD, custom picker.
//   2. Totals + goal attainment over the range, against COMPOUNDING goals
//      (daily goal × days). For the current/incomplete period, attainment is
//      pro-rated to ELAPSED days so a mid-week view doesn't read as "failing"
//      the full-week target. Reuses the GoalRing visual (floors/ceilings).
//   3. Macro composition — a recharts donut of macro share-of-calories plus a
//      persistent six-nutrient list. Two independent multi-select filters drive
//      it: MEALS recompute every value in the section (donut, center total,
//      grams, % of calories) from the matching entries only; MACROS are a
//      visual highlight here and a hard row filter on the table below.
//   4. Friendly empty/sparse states (logging just started; most ranges are
//      thin or empty — never show empty charts, zeros, or divide-by-zero).
//
// Reads consumption only via getEntriesForRange (lib/consumptionLog.ts); no new
// data-access logic. See nutrition-tracker-spec.md, Surface 5.

import { Fragment, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { BarChart2, Loader2, Calendar, ChevronUp, ChevronDown, ExternalLink } from 'lucide-react'
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
} from 'recharts'
import { getEntriesForRange } from '@/lib/consumptionLog'
import { getActivitiesForRange } from '@/lib/strava'
import { NUTRIENTS, formatNutrient } from '@/lib/nutrition'
import GoalRing, { type RingKind } from '@/components/GoalRing'
import type { ConsumptionEntry, Meal, NutritionGoals, StravaActivity } from '@/types/nutrition'
import type { NutritionMacros } from '@/types/recipe'

type RangeKind = 'week' | 'month' | 'ytd' | 'custom'

// ── Selection model (read by the donut, the nutrient list and the table) ─────
// Two independent multi-select sets. `calories` is a total, not a macro, so it
// is never selectable. Both live at the top of InsightsTab on purpose — a
// planned chart will read the same state.
export type SelectableMacro = 'protein_g' | 'carbs_g' | 'fat_g' | 'fiber_g' | 'sugar_g'

const SELECTABLE_MACROS: SelectableMacro[] = ['protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugar_g']
const MEALS: Meal[] = ['breakfast', 'lunch', 'dinner', 'snack']
const MEAL_LABELS: Record<Meal, string> = {
  breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack',
}

function isSelectableMacro(k: keyof NutritionMacros): k is SelectableMacro {
  return k !== 'calories'
}

/** Toggle membership immutably — Set identity must change for memos to re-run. */
function toggleIn<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set)
  if (!next.delete(value)) next.add(value)
  return next
}

// Same floor/ceiling split the Today view uses: protein & fiber are floors
// (fill toward target), the rest are ceilings (over = warn).
const CEILING_KEYS = new Set<keyof NutritionMacros>(['calories', 'carbs_g', 'fat_g', 'sugar_g'])

// Swatch for the non-slice nutrients (calories, fiber, sugar) in the list.
const OTHER_COLOR = '#6B5E50'
// Ring drawn around a donut slice whose macro is selected.
const HIGHLIGHT_STROKE = '#F4E4C1'

// Overview donut = macro composition by calorie contribution. Only the three
// energy-bearing macros are slices; kcal-per-gram drives each slice's value.
// Fiber & sugar are subsets of carbs (not separate calorie sources) so they are
// list-only context, never slices.
const MACRO_KCAL: Partial<Record<keyof NutritionMacros, number>> = { protein_g: 4, carbs_g: 4, fat_g: 9 }
const MACRO_COLORS: Partial<Record<keyof NutritionMacros, string>> = {
  protein_g: '#E8A838', carbs_g: '#5eead4', fat_g: '#fb923c',
}

// ── Trend bar chart (between the composition tile and the entries table) ─────
// Segment colors. Deliberately a SEPARATE map from MACRO_COLORS: that map
// doubles as the "is this an energy macro?" test in the nutrient list
// (`n.key in MACRO_COLORS`), so adding fiber/sugar there would silently
// relabel those rows. Protein/carbs/fat reuse their donut hues so a macro
// reads the same in both charts; fiber (lime) and sugar (violet) are new hues,
// well clear of the amber/teal/orange already in play.
const CHART_COLORS: Record<SelectableMacro, string> = {
  protein_g: MACRO_COLORS.protein_g!,
  carbs_g: MACRO_COLORS.carbs_g!,
  fat_g: MACRO_COLORS.fat_g!,
  fiber_g: '#a3e635',
  sugar_g: '#c084fc',
}

// Dark-theme chart chrome, from the tailwind palette (border / faint).
const GRID_COLOR = '#2E2820'
const AXIS_TEXT = '#6B5E50'

// Rounded top corners for the topmost stack segment only. Module-level so the
// prop keeps a stable identity: recharts' isChildrenEqual shallow-compares Bar
// props, and a fresh [3,3,0,0] literal each render forced it to throw away and
// rebuild its axis/stack/graphical-item state on every parent re-render.
const TOP_RADIUS: [number, number, number, number] = [3, 3, 0, 0]

// Same reason — an inline arrow would be a new identity every render.
const legendFormatter = (value: string) => (
  <span className="text-faint text-[11px] font-body">{value}</span>
)

type BucketUnit = 'day' | 'week' | 'month'

/** Bucket granularity from the range's ACTUAL span, so Custom ranges adapt. */
function bucketUnitFor(spanDays: number): BucketUnit {
  if (spanDays <= 14) return 'day'
  if (spanDays <= 90) return 'week'
  return 'month'
}

function macroLabel(k: SelectableMacro): string {
  return NUTRIENTS.find(n => n.key === k)!.label
}

/** Same "Jul 23" convention the entries table uses for its Date column. */
function shortDay(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Display rounding: calories are whole, grams get one decimal. */
function roundFor(mode: 'kcal' | 'grams', v: number): number {
  return mode === 'kcal' ? Math.round(v) : Math.round(v * 10) / 10
}

// ── Entries table (below the macro chart) ────────────────────────────────────
// Sortable column keys: the two text columns, date, plus the six macros.
// 'selected' is not a column — it's the implicit default while macros are
// selected, sorting by the SUM of the selected macros' grams.
type TableSortKey = 'name' | 'meal' | 'date' | 'selected' | keyof NutritionMacros
interface TableSort { key: TableSortKey; dir: 'asc' | 'desc' }

const MEAL_SORT_ORDER: Record<string, number> = { breakfast: 0, lunch: 1, snack: 2, dinner: 3 }

// Large periods (YTD) can return hundreds of rows — cap the initial render and
// grow via "Show more" rather than mounting everything at once.
const TABLE_PAGE_SIZE = 50

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

/** Millis from an entry's Firestore Timestamp `date` (0 when absent/malformed). */
function entryDateMillis(e: ConsumptionEntry): number {
  const d = e.date as { toMillis?: () => number } | null | undefined
  return d?.toMillis ? d.toMillis() : 0
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
  // ── Selection state ────────────────────────────────────────────────────────
  // Two independent multi-select sets, both empty = unfiltered. Selecting meals
  // never clears macros and vice versa. Kept here (not in a child) so the
  // planned macro/meal chart can read them directly.
  const [selectedMacros, setSelectedMacros] = useState<Set<SelectableMacro>>(() => new Set())
  const [selectedMeals, setSelectedMeals] = useState<Set<Meal>>(() => new Set())

  const toggleMacro = (k: SelectableMacro) => setSelectedMacros(prev => toggleIn(prev, k))
  const toggleMeal = (m: Meal) => setSelectedMeals(prev => toggleIn(prev, m))
  const clearFilters = () => { setSelectedMacros(new Set()); setSelectedMeals(new Set()) }
  const hasFilters = selectedMacros.size > 0 || selectedMeals.size > 0
  /** Column/cell highlight test — `calories` is never selectable. */
  const isMacroSelected = (k: keyof NutritionMacros) => isSelectableMacro(k) && selectedMacros.has(k)

  const [entries, setEntries] = useState<ConsumptionEntry[]>([])
  const [activities, setActivities] = useState<StravaActivity[]>([])
  const [loading, setLoading] = useState(true)

  // Entries table (below the macro chart). Default sort: most recent first.
  // Selecting macros re-defaults the sort to their summed grams descending so
  // the rows richest in the selected macros surface first.
  const [tableSort, setTableSort] = useState<TableSort>({ key: 'date', dir: 'desc' })
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [visibleRows, setVisibleRows] = useState(TABLE_PAGE_SIZE)

  const range = useMemo(
    () => resolveRange(kind, now, customStart, customEnd),
    [kind, now, customStart, customEnd],
  )

  useEffect(() => {
    if (!range.valid) { setEntries([]); setActivities([]); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    Promise.all([
      getEntriesForRange(userId, range.start, range.end),
      getActivitiesForRange(range.start, range.end)
    ])
      .then(([e, act]) => {
        if (!cancelled) {
          setEntries(e)
          setActivities(act)
        }
      })
      .catch(() => { if (!cancelled) { setEntries([]); setActivities([]) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [userId, range.valid, range.start, range.end])

  // A new period is a new question — drop macro/meal selection so the section
  // never reads as filtered-but-not-obviously-so after a range switch.
  useEffect(() => {
    setSelectedMacros(new Set())
    setSelectedMeals(new Set())
  }, [kind, customStart, customEnd])

  // Selecting macros re-defaults the table sort to their summed grams (desc);
  // clearing them restores date-desc. Header clicks still override afterwards.
  useEffect(() => {
    setTableSort(selectedMacros.size > 0 ? { key: 'selected', dir: 'desc' } : { key: 'date', dir: 'desc' })
  }, [selectedMacros])

  // New period or new filter ⇒ new row set: collapse any expanded row and
  // reset paging.
  useEffect(() => {
    setExpandedId(null)
    setVisibleRows(TABLE_PAGE_SIZE)
  }, [entries, selectedMacros, selectedMeals])

  // Range totals across all six nutrients — the FULL period, unfiltered. These
  // feed the goal rings, which are deliberately immune to macro/meal selection.
  const totals = useMemo(() => {
    const t: NutritionMacros = { ...ZERO }
    for (const e of entries) {
      for (const n of NUTRIENTS) t[n.key] += e.nutrition?.[n.key] || 0
    }
    return t
  }, [entries])

  const burnedCalories = useMemo(() => {
    return activities.reduce((sum, a) => sum + a.calories, 0)
  }, [activities])

  // Meal filter: OR within the set (a row matches ANY selected meal); empty set
  // means "all meals". Derived from the already-loaded entries — no new query.
  const mealEntries = useMemo(
    () => (selectedMeals.size === 0 ? entries : entries.filter(e => selectedMeals.has(e.meal))),
    [entries, selectedMeals],
  )

  // Totals behind the donut + nutrient list. Identical to `totals` when no meal
  // is selected; otherwise every value in that section is the selected meals'.
  const sectionTotals = useMemo(() => {
    if (selectedMeals.size === 0) return totals
    const t: NutritionMacros = { ...ZERO }
    for (const e of mealEntries) {
      for (const n of NUTRIENTS) t[n.key] += e.nutrition?.[n.key] || 0
    }
    return t
  }, [totals, mealEntries, selectedMeals])

  // Donut: macro composition by calorie contribution (protein·4, carbs·4,
  // fat·9), each as a share of those calories. Zero-cal macros drop out.
  const composition = useMemo(() => {
    const slices = (['protein_g', 'carbs_g', 'fat_g'] as const)
      .map(key => ({
        key,
        name: NUTRIENTS.find(n => n.key === key)!.label,
        cals: (sectionTotals[key] || 0) * (MACRO_KCAL[key] || 0),
      }))
      .filter(s => s.cals > 0)
    const total = slices.reduce((s, d) => s + d.cals, 0)
    return { slices, total }
  }, [sectionTotals])

  const goalsSet = !!goals && NUTRIENTS.some(n => (goals[n.key] || 0) > 0)
  const hasEntries = entries.length > 0

  // The table's row set: meal-filtered (OR within meals), then macro-filtered —
  // AND across selections, so a row must carry EVERY selected macro (> 0g).
  // Still derived straight from the already-fetched `entries`; not a new query.
  const tableRows = useMemo(() => {
    const macros = Array.from(selectedMacros)
    const rows = mealEntries.filter(
      e => macros.every(k => (e.nutrition?.[k] || 0) > 0),
    )

    const dir = tableSort.dir === 'asc' ? 1 : -1
    const sumOf = (e: ConsumptionEntry) => macros.reduce((s, k) => s + (e.nutrition?.[k] || 0), 0)
    rows.sort((a, b) => {
      let cmp = 0
      if (tableSort.key === 'name') cmp = a.name.localeCompare(b.name)
      else if (tableSort.key === 'meal') cmp = (MEAL_SORT_ORDER[a.meal] ?? 4) - (MEAL_SORT_ORDER[b.meal] ?? 4)
      // 'selected' with nothing selected can only be a transient state (the
      // reset effect has not run yet) — fall back to the date default.
      else if (tableSort.key === 'date' || (tableSort.key === 'selected' && macros.length === 0)) {
        cmp = entryDateMillis(a) - entryDateMillis(b)
      } else if (tableSort.key === 'selected') cmp = sumOf(a) - sumOf(b)
      else cmp = (a.nutrition?.[tableSort.key] || 0) - (b.nutrition?.[tableSort.key] || 0)
      if (cmp === 0) cmp = entryDateMillis(a) - entryDateMillis(b)   // stable tiebreak
      return cmp * dir
    })
    return rows
  }, [mealEntries, selectedMacros, tableSort])

  // ── Trend chart data ───────────────────────────────────────────────────────
  // Buckets sum from `mealEntries`, NOT `tableRows`: selectedMacros picks which
  // macros are DISPLAYED, never which entries are counted, so every entry in
  // the meal-filtered set feeds every macro's bucket total. That mirrors the
  // donut's semantics; the table's macro AND-filter deliberately does not apply
  // here. Meal filtering arrives already applied via mealEntries — never re-run.
  // All in-memory over the already-fetched entries; no new query.
  const chart = useMemo(() => {
    const unit = bucketUnitFor(daysInclusive(range.start, range.end))
    const mode: 'kcal' | 'grams' = selectedMacros.size > 0 ? 'grams' : 'kcal'
    // Canonical order, never click order. Mode A is the three energy macros;
    // fiber/sugar are subsets of carbs and have no independent calorie share.
    const series: SelectableMacro[] = mode === 'grams'
      ? SELECTABLE_MACROS.filter(k => selectedMacros.has(k))
      : ['protein_g', 'carbs_g', 'fat_g']

    // Every bucket in the range is emitted, empty ones included — a zero-height
    // bar among real bars is a normal result, not an empty state.
    const last = startOfDay(range.end)
    const multiYear = range.start.getFullYear() !== range.end.getFullYear()
    const buckets: { key: string; label: string; grams: Record<SelectableMacro, number> }[] = []
    const indexOf = new Map<string, number>()
    const push = (key: string, label: string) => {
      indexOf.set(key, buckets.length)
      buckets.push({
        key, label,
        grams: { protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sugar_g: 0 },
      })
    }

    if (unit === 'day') {
      for (let d = startOfDay(range.start); d.getTime() <= last.getTime(); d = addDays(d, 1)) {
        push(isoDate(d), shortDay(d))
      }
    } else if (unit === 'week') {
      // Monday-start, same convention as the "Week" period filter. The first
      // bucket may open before range.start; only in-range entries exist, so the
      // sums are unaffected and the label still names the week.
      for (let d = startOfWeekMonday(range.start); d.getTime() <= last.getTime(); d = addDays(d, 7)) {
        push(isoDate(d), `Wk ${shortDay(d)}`)
      }
    } else {
      for (let d = startOfMonth(range.start); d.getTime() <= last.getTime();
           d = startOfDay(new Date(d.getFullYear(), d.getMonth() + 1, 1))) {
        push(monthKey(d), d.toLocaleDateString(
          undefined, multiYear ? { month: 'short', year: 'numeric' } : { month: 'short' },
        ))
      }
    }

    for (const e of mealEntries) {
      const ms = entryDateMillis(e)
      if (!ms) continue                       // malformed date — can't be bucketed
      const d = new Date(ms)
      const key = unit === 'day' ? isoDate(startOfDay(d))
        : unit === 'week' ? isoDate(startOfWeekMonday(d))
        : monthKey(d)
      const i = indexOf.get(key)
      if (i === undefined) continue
      const g = buckets[i].grams
      for (const k of SELECTABLE_MACROS) g[k] += e.nutrition?.[k] || 0
    }

    const data = buckets.map(b => {
      const row: Record<string, string | number> = { key: b.key, label: b.label }
      for (const k of series) {
        row[k] = roundFor(mode, mode === 'kcal' ? b.grams[k] * (MACRO_KCAL[k] || 0) : b.grams[k])
      }
      return row
    })

    return { unit, mode, series, data }
  }, [mealEntries, selectedMacros, range])

  // Header click: same column toggles direction; a new column starts at its
  // natural default (text ascending, date/macros descending).
  const handleSortClick = (key: TableSortKey) => {
    setTableSort(prev => prev.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'name' || key === 'meal' ? 'asc' : 'desc' })
  }

  // Human-readable active filters, in canonical display order (not click order).
  const macroLabels = SELECTABLE_MACROS
    .filter(k => selectedMacros.has(k))
    .map(k => NUTRIENTS.find(n => n.key === k)!.label)
  const mealLabels = MEALS.filter(m => selectedMeals.has(m)).map(m => MEAL_LABELS[m])

  // Chart caption mirrors the composition caption's style: what's plotted, then
  // the active meal filter, then the bucket size (so a bar that is more than
  // one day says so).
  const chartNames = chart.series.map(k => macroLabel(k).toLowerCase()).join(', ')
  const chartCaption =
    `${chartNames.charAt(0).toUpperCase()}${chartNames.slice(1)} (${chart.mode === 'kcal' ? 'kcal' : 'g'})`
    + (mealLabels.length > 0 ? ` · ${mealLabels.join(', ').toLowerCase()}` : '')
    + ` · one bar per ${chart.unit === 'week' ? 'week (Mon-start)' : chart.unit}`

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
                      const consumedValue = n.key === 'calories' ? Math.max(0, totals.calories - burnedCalories) : totals[n.key]
                      return (
                        <GoalRing
                          key={n.key}
                          nutrientKey={n.key}
                          label={n.label}
                          unit={n.unit}
                          consumed={consumedValue}
                          goal={proRatedGoal}
                          kind={kindRing}
                          elapsedFraction={1}
                        />
                      )
                    })}
                  </div>
                  {burnedCalories > 0 && (
                    <div className="mt-5 pt-4 border-t border-border flex justify-center items-center gap-4 text-xs font-body text-muted">
                      <span>{Math.round(totals.calories)} consumed</span>
                      <span>−</span>
                      <span>{Math.round(burnedCalories)} burned</span>
                      <span>=</span>
                      <span className="text-cream font-medium">{Math.max(0, Math.round(totals.calories - burnedCalories))} net calories</span>
                    </div>
                  )}
                </div>
              </>
            ) : (
              // No goals set — still show the raw totals so the range is useful.
              <div className="bg-surface border border-border rounded-2xl p-5">
                <p className="text-faint text-xs font-body mb-4">
                  Total consumed this range. Set daily goals to see attainment.
                </p>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-4">
                  {NUTRIENTS.map(n => {
                    const consumedValue = n.key === 'calories' ? Math.max(0, totals.calories - burnedCalories) : totals[n.key]
                    return (
                      <div key={n.key} className="text-center">
                        <p className="font-display text-2xl text-cream font-light leading-none">
                          {formatNutrient(n.key, consumedValue)}
                          <span className="text-faint text-[10px] font-body ml-0.5">{n.unit}</span>
                        </p>
                        <p className="text-faint text-xs font-body mt-1.5">{n.label}</p>
                      </div>
                    )
                  })}
                </div>
                {burnedCalories > 0 && (
                  <div className="mt-5 pt-4 border-t border-border flex justify-center items-center gap-4 text-xs font-body text-muted">
                    <span>{Math.round(totals.calories)} consumed</span>
                    <span>−</span>
                    <span>{Math.round(burnedCalories)} burned</span>
                    <span>=</span>
                    <span className="text-cream font-medium">{Math.max(0, Math.round(totals.calories - burnedCalories))} net calories</span>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ── Meal filter chips — recompute the composition below and hard-
              filter the entries table. Same pill styling as the range selector.
              The goal rings above are intentionally NOT affected. ─────────── */}
          <section>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-faint text-xs font-body mr-0.5">Meals</span>
              {MEALS.map(m => {
                const on = selectedMeals.has(m)
                return (
                  <button
                    key={m}
                    onClick={() => toggleMeal(m)}
                    aria-pressed={on}
                    className={`px-3.5 py-1.5 rounded-xl text-sm font-body font-medium border transition-all ${
                      on
                        ? 'bg-amber/10 border-amber/30 text-amber'
                        : 'bg-surface border-border text-muted hover:text-cream hover:border-amber/40'
                    }`}
                  >
                    {MEAL_LABELS[m]}
                  </button>
                )
              })}
              {hasFilters && (
                <button
                  onClick={clearFilters}
                  className="px-2.5 py-1.5 text-amber text-sm font-body font-medium hover:text-amber/80 transition-colors"
                >
                  Clear filters
                </button>
              )}
            </div>
          </section>

          {/* ── Feature 3: macro composition. Meal chips recompute every value
              here; macro selection is highlight-only (and filters the table
              below). ─────────────────────────────────────────────────────── */}
          <section>
            <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
              <h3 className="font-display text-xl text-cream font-light">Macro composition</h3>
              <span className="text-faint text-xs font-body">
                Share of calories
                {selectedMeals.size > 0 ? ` · ${mealLabels.join(', ').toLowerCase()} only` : ''}
                {' · tap a macro to filter the entries below'}
              </span>
            </div>

            <div className="bg-surface border border-border rounded-2xl p-5 grid md:grid-cols-2 gap-6 items-center">
              {/* Donut — macro share of calories over the meal-filtered entries.
                  Selected macros keep full saturation + a ring; the rest dim. */}
              <div className="relative" style={{ height: 260 }}>
                {composition.total <= 0 ? (
                  <InlineNote
                    text={
                      selectedMeals.size > 0
                        ? `No macros logged for ${mealLabels.join(', ').toLowerCase()} in this range`
                        : 'Not enough macro data to chart composition'
                    }
                  />
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
                            if (k && isSelectableMacro(k)) toggleMacro(k)
                          }}
                        >
                          {composition.slices.map(s => {
                            const on = selectedMacros.has(s.key)
                            const dimmed = selectedMacros.size > 0 && !on
                            return (
                              <Cell
                                key={s.key}
                                fill={MACRO_COLORS[s.key]}
                                fillOpacity={dimmed ? 0.28 : 1}
                                stroke={on ? HIGHLIGHT_STROKE : 'none'}
                                strokeWidth={on ? 2 : 0}
                              />
                            )
                          })}
                        </Pie>
                        <Tooltip content={<CompositionTooltip total={composition.total} />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="font-display text-3xl text-cream font-light leading-none">
                        {formatNutrient('calories', Math.max(0, sectionTotals.calories - burnedCalories))}
                      </span>
                      <span className="text-faint text-[11px] font-body mt-1">
                        {selectedMeals.size > 0 ? `${mealLabels.join(', ').toLowerCase()} net cals` : 'net calories'}
                      </span>
                    </div>
                  </>
                )}
              </div>

              {/* List — the six nutrients. Calories is a total (not selectable);
                  the five macros toggle membership in selectedMacros. */}
              <div className="space-y-1">
                {NUTRIENTS.map(n => {
                  const isMacro = n.key in MACRO_COLORS
                  const cals = (sectionTotals[n.key] || 0) * (MACRO_KCAL[n.key] || 0)
                  // Share of the section's macro calories. A zero denominator —
                  // a meal filter matching no entries, or a period with no macro
                  // data — is 0%, never NaN/null (which rendered as "null%").
                  const pct = composition.total > 0 ? Math.round((cals / composition.total) * 100) : 0
                  const sub =
                    n.key === 'calories' ? 'total energy'
                    : isMacro ? `${pct}% of calories`
                    : 'subset of carbs'
                  const swatch = (
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ background: isMacro ? MACRO_COLORS[n.key] : OTHER_COLOR }}
                    />
                  )
                  const body = (
                    <>
                      {swatch}
                      <div className="flex-1 min-w-0">
                        <p className="text-cream text-sm font-body truncate">{n.label}</p>
                        <p className="text-faint text-[10px] font-body mt-0.5">{sub}</p>
                      </div>
                      <p className="text-cream text-sm font-body font-medium leading-none shrink-0">
                        {formatNutrient(n.key, sectionTotals[n.key])}
                        <span className="text-faint text-[10px] ml-0.5">{n.unit}</span>
                      </p>
                    </>
                  )

                  if (!isSelectableMacro(n.key)) {
                    return (
                      <div
                        key={n.key}
                        className="w-full flex items-center gap-3 px-2 py-1.5 rounded-lg border border-transparent"
                      >
                        {body}
                      </div>
                    )
                  }

                  const on = selectedMacros.has(n.key)
                  return (
                    <button
                      key={n.key}
                      onClick={() => toggleMacro(n.key as SelectableMacro)}
                      aria-pressed={on}
                      className={`w-full flex items-center gap-3 px-2 py-1.5 rounded-lg border transition-colors text-left ${
                        on
                          ? 'bg-amber/10 border-amber/30'
                          : 'border-transparent hover:bg-card'
                      }`}
                    >
                      {body}
                    </button>
                  )
                })}
              </div>
            </div>
          </section>

          {/* ── Feature 3b: trend bars over time. Meal-filtered like the donut
              (selectedMacros picks the SERIES, not the entries); bucket size
              follows the range's span. Display only — no click behaviour. ─── */}
          <section>
            <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
              <h3 className="font-display text-xl text-cream font-light">Nutrient trend</h3>
              <span className="text-faint text-xs font-body">{chartCaption}</span>
            </div>

            {mealEntries.length === 0 ? (
              // Only reachable via the meal filter — the period itself has
              // entries (this whole branch is gated on hasEntries). Buckets with
              // no entries are NOT this case; they render as zero-height bars.
              <div className="bg-surface border border-border rounded-2xl p-10 text-center">
                <p className="text-cream text-sm font-body">No entries match the selected meals.</p>
                <p className="text-faint text-xs font-body mt-1.5">
                  Nothing was logged for {mealLabels.join(', ').toLowerCase()} in this range.
                </p>
                <button
                  onClick={clearFilters}
                  className="mt-4 px-3.5 py-1.5 rounded-xl text-sm font-body font-medium border bg-amber/10 border-amber/30 text-amber hover:bg-amber/15 transition-all"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <div className="bg-surface border border-border rounded-2xl p-5">
                <div style={{ height: 288 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chart.data} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
                      <CartesianGrid stroke={GRID_COLOR} vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: AXIS_TEXT, fontSize: 11 }}
                        tickLine={false}
                        axisLine={{ stroke: GRID_COLOR }}
                        interval="preserveStartEnd"
                        minTickGap={6}
                      />
                      <YAxis
                        tick={{ fill: AXIS_TEXT, fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        width={52}
                      />
                      <Tooltip
                        cursor={{ fill: 'rgba(232,168,56,0.06)' }}
                        content={<BucketTooltip mode={chart.mode} />}
                      />
                      <Legend
                        verticalAlign="bottom"
                        height={26}
                        iconType="circle"
                        iconSize={8}
                        formatter={legendFormatter}
                      />
                      {chart.series.map((k, i) => (
                        <Bar
                          key={k}
                          dataKey={k}
                          name={macroLabel(k)}
                          stackId="macros"
                          fill={CHART_COLORS[k]}
                          maxBarSize={56}
                          // Entry animation OFF, deliberately. recharts renders
                          // the grow-in by interpolating each rect's height from
                          // 0, and Rectangle returns null at height 0 — so any
                          // stall leaves the <g class="recharts-bar-rectangle">
                          // groups mounted but EMPTY: correct axes, legend and
                          // positions, no visible bars. That was this chart's
                          // bug. Static rects render on first paint instead.
                          isAnimationActive={false}
                          radius={i === chart.series.length - 1 ? TOP_RADIUS : 0}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </section>

          {/* ── Feature 4: entries table. Unlike the section above, macro and
              meal selection HARD-FILTER the rows here (meals OR'd within the
              set, macros AND'd across selections). ────────────────────────── */}
          <section>
            <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
              <h3 className="font-display text-xl text-cream font-light">
                {hasFilters ? 'Matching entries' : 'All entries'}
              </h3>
              <span className="text-faint text-xs font-body">
                {tableRows.length} {tableRows.length === 1 ? 'entry' : 'entries'}
                {macroLabels.length > 0 ? ` · with ${macroLabels.join(' + ').toLowerCase()}` : ''}
                {mealLabels.length > 0 ? ` · ${mealLabels.join(', ').toLowerCase()}` : ''}
                {selectedMacros.size > 0 ? ' · sorted by selected macros' : ''}
                {' · click a row for detail'}
              </span>
            </div>

            {tableRows.length === 0 ? (
              // Distinct from the period-level empty state above: the period HAS
              // entries, the active filter combination just matches none of them.
              <div className="bg-surface border border-border rounded-2xl p-10 text-center">
                <p className="text-cream text-sm font-body">No entries match the selected filters.</p>
                <p className="text-faint text-xs font-body mt-1.5">
                  {macroLabels.length > 1
                    ? 'An entry must contain every selected macro to appear here.'
                    : 'Try a different macro or meal combination.'}
                </p>
                <button
                  onClick={clearFilters}
                  className="mt-4 px-3.5 py-1.5 rounded-xl text-sm font-body font-medium border bg-amber/10 border-amber/30 text-amber hover:bg-amber/15 transition-all"
                >
                  Clear filters
                </button>
              </div>
            ) : (
            <div className="bg-surface border border-border rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm font-body">
                  <thead>
                    <tr className="border-b border-border">
                      <SortTh label="Name" k="name" sort={tableSort} onSort={handleSortClick} align="left" />
                      <SortTh label="Meal" k="meal" sort={tableSort} onSort={handleSortClick} align="left" />
                      <SortTh label="Date" k="date" sort={tableSort} onSort={handleSortClick} align="left" />
                      {NUTRIENTS.map(n => (
                        <SortTh
                          key={n.key}
                          label={n.label}
                          k={n.key}
                          sort={tableSort}
                          onSort={handleSortClick}
                          align="right"
                          highlighted={isMacroSelected(n.key)}
                        />
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {tableRows.slice(0, visibleRows).map(e => {
                      const expanded = expandedId === e.id
                      const d = new Date(entryDateMillis(e))
                      return (
                        <Fragment key={e.id}>
                          <tr
                            onClick={() => setExpandedId(expanded ? null : e.id)}
                            className={`cursor-pointer transition-colors ${expanded ? 'bg-card' : 'hover:bg-card/60'}`}
                          >
                            <td className="px-3 py-2.5 first:pl-4 max-w-[220px]">
                              <span className="text-cream block truncate">{e.name}</span>
                            </td>
                            <td className="px-3 py-2.5 text-muted capitalize whitespace-nowrap">{e.meal}</td>
                            <td className="px-3 py-2.5 text-muted whitespace-nowrap">
                              {d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                            </td>
                            {NUTRIENTS.map(n => (
                              <td
                                key={n.key}
                                className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap ${
                                  isMacroSelected(n.key) ? 'text-amber bg-amber/[0.06]' : 'text-muted'
                                }`}
                              >
                                {formatNutrient(n.key, e.nutrition?.[n.key])}
                              </td>
                            ))}
                          </tr>
                          {expanded && (
                            <tr className="bg-card/60">
                              <td colSpan={3 + NUTRIENTS.length} className="px-4 py-4">
                                <div className="space-y-3">
                                  <div className="flex items-start justify-between gap-3 flex-wrap">
                                    <div>
                                      <p className="text-cream text-sm font-body font-medium">{e.name}</p>
                                      <p className="text-faint text-xs font-body mt-0.5">
                                        <span className="capitalize">{e.meal}</span>
                                        {' · '}
                                        {d.toLocaleString(undefined, {
                                          weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
                                          hour: 'numeric', minute: '2-digit',
                                        })}
                                      </p>
                                    </div>
                                    {e.recipe_id && (
                                      <Link
                                        href={`/recipes/${e.recipe_id}`}
                                        className="text-amber text-xs font-body font-medium hover:text-amber/80 transition-colors inline-flex items-center gap-1 shrink-0"
                                      >
                                        View recipe <ExternalLink size={11} />
                                      </Link>
                                    )}
                                  </div>
                                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs font-body">
                                    <span className="text-faint">
                                      Servings: <span className="text-cream">{e.servings_eaten}</span>
                                    </span>
                                    {e.amount_label && (
                                      <span className="text-faint">
                                        Amount: <span className="text-cream">{e.amount_label}</span>
                                      </span>
                                    )}
                                  </div>
                                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                                    {NUTRIENTS.map(n => (
                                      <div key={n.key}>
                                        <p className="text-faint text-[10px] font-body">{n.label}</p>
                                        <p className={`text-sm font-body font-medium ${isMacroSelected(n.key) ? 'text-amber' : 'text-cream'}`}>
                                          {formatNutrient(n.key, e.nutrition?.[n.key])}{n.unit}
                                        </p>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {tableRows.length > visibleRows && (
                <button
                  onClick={() => setVisibleRows(v => v + TABLE_PAGE_SIZE)}
                  className="w-full py-3 text-amber text-sm font-body font-medium hover:bg-card/60 transition-colors border-t border-border"
                >
                  Show more ({tableRows.length - visibleRows} more)
                </button>
              )}
            </div>
            )}
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

// ── Trend-chart tooltip: per-segment value + bucket total ───────────────────

function BucketTooltip({
  active, payload, label, mode,
}: {
  active?: boolean
  payload?: { dataKey?: string | number; name?: string; value?: number; color?: string }[]
  label?: string
  mode: 'kcal' | 'grams'
}) {
  if (!active || !payload?.length) return null
  const unit = mode === 'kcal' ? ' kcal' : 'g'
  const show = (v: number) => (mode === 'kcal' ? Math.round(v).toString() : v.toFixed(1))
  const total = payload.reduce((s, p) => s + (p.value || 0), 0)
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-lg min-w-[9rem]">
      <p className="text-cream text-xs font-body font-medium">{label}</p>
      <div className="mt-1.5 space-y-1">
        {payload.map(p => (
          <p key={String(p.dataKey)} className="flex items-center gap-2 text-[11px] font-body">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: p.color || CHART_COLORS[p.dataKey as SelectableMacro] }}
            />
            <span className="text-faint">{p.name}</span>
            <span className="text-cream ml-auto tabular-nums">{show(p.value || 0)}{unit}</span>
          </p>
        ))}
      </div>
      <p className="flex items-center gap-2 text-[11px] font-body mt-1.5 pt-1.5 border-t border-border">
        <span className="text-faint">Total</span>
        <span className="text-cream ml-auto tabular-nums">{show(total)}{unit}</span>
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

// ── Sortable column header for the entries table ────────────────────────────

function SortTh({
  label, k, sort, onSort, align, highlighted = false,
}: {
  label: string
  k: TableSortKey
  sort: TableSort
  onSort: (k: TableSortKey) => void
  align: 'left' | 'right'
  highlighted?: boolean
}) {
  const active = sort.key === k
  const Arrow = sort.dir === 'asc' ? ChevronUp : ChevronDown
  return (
    <th
      className={`px-3 py-2.5 first:pl-4 font-medium whitespace-nowrap ${
        align === 'right' ? 'text-right' : 'text-left'
      } ${highlighted ? 'bg-amber/[0.06]' : ''}`}
    >
      <button
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-0.5 text-xs font-body transition-colors ${
          highlighted ? 'text-amber' : active ? 'text-cream' : 'text-faint hover:text-cream'
        }`}
      >
        {label}
        {active && <Arrow size={12} />}
      </button>
    </th>
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
