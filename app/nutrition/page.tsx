'use client'

// Nutrition page (Session B-1): shell + Today tab. Insights tab is a stub here
// (built in a later session). The header hosts the two persistent actions —
// "＋ Log food" (opens the existing LogFoodSheet) and "Goals" (GoalsModal) —
// available from both tabs. See nutrition-tracker-spec.md, Surface 4 + UI Shell.

import { useEffect, useMemo, useState, useCallback } from 'react'
import { Apple, Plus, Target, Trash2, Pencil, Check, X, ChefHat, Loader2 } from 'lucide-react'
import { useAuth } from '@/lib/AuthContext'
import {
  getTodayEntries, getGoals, deleteLogEntry, updateLogEntryServings,
} from '@/lib/consumptionLog'
import { NUTRIENTS, formatNutrient, sourceLabel } from '@/lib/nutrition'
import GoalRing, { type RingKind } from '@/components/GoalRing'
import GoalsModal from '@/components/GoalsModal'
import LogFoodSheet from '@/components/LogFoodSheet'
import InsightsTab from '@/components/InsightsTab'
import type { ConsumptionEntry, NutritionGoals, Meal } from '@/types/nutrition'
import type { NutritionMacros } from '@/types/recipe'

type Tab = 'today' | 'insights'

const MEAL_ORDER: Meal[] = ['breakfast', 'lunch', 'snack', 'dinner']

// Floors fill toward a target; ceilings warn when exceeded. Per the prompt:
// protein & fiber are floors; calories, carbs, fat & sugar are ceilings.
const CEILING_KEYS = new Set<keyof NutritionMacros>(['calories', 'carbs_g', 'fat_g', 'sugar_g'])

function dayElapsedFraction(): number {
  const now = new Date()
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const f = (now.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)
  return Math.min(Math.max(f, 0), 1)
}

const ZERO: NutritionMacros = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sugar_g: 0 }

export default function NutritionPage() {
  const { user, loading: authLoading } = useAuth()
  const [tab, setTab] = useState<Tab>('today')
  const [showLogFood, setShowLogFood] = useState(false)
  const [showGoals, setShowGoals] = useState(false)

  const [entries, setEntries] = useState<ConsumptionEntry[]>([])
  const [goals, setGoals] = useState<NutritionGoals | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!user) return
    const [e, g] = await Promise.all([getTodayEntries(user.uid), getGoals(user.uid)])
    setEntries(e)
    setGoals(g)
  }, [user])

  useEffect(() => {
    if (authLoading) return
    if (!user) { setLoading(false); return }
    setLoading(true)
    refresh().catch(() => {}).finally(() => setLoading(false))
  }, [user, authLoading, refresh])

  const totals = useMemo(() => {
    const t: NutritionMacros = { ...ZERO }
    for (const e of entries) {
      for (const n of NUTRIENTS) t[n.key] += e.nutrition?.[n.key] || 0
    }
    return t
  }, [entries])

  const byMeal = useMemo(() => {
    const map: Record<Meal, ConsumptionEntry[]> = { breakfast: [], lunch: [], snack: [], dinner: [] }
    for (const e of entries) (map[e.meal] || map.dinner).push(e)
    return map
  }, [entries])

  const handleDelete = async (id: string) => {
    if (!user) return
    setEntries(prev => prev.filter(e => e.id !== id))   // optimistic — rings update at once
    try { await deleteLogEntry(user.uid, id) } catch { refresh() }
  }

  const handleUpdateServings = async (entry: ConsumptionEntry, newServings: number) => {
    if (!user) return
    const nutrition = await updateLogEntryServings(user.uid, entry, newServings)
    setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, servings_eaten: newServings, nutrition } : e))
  }

  const goalsSet = !!goals && NUTRIENTS.some(n => (goals[n.key] || 0) > 0)
  const elapsed = dayElapsedFraction()

  // ── Auth / loading gates ────────────────────────────────────────────────
  if (!authLoading && !user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 p-6">
        <Apple size={48} className="text-faint" />
        <p className="font-display text-3xl text-faint font-light">Sign in to track your nutrition</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Persistent header — actions available on both tabs */}
      <div className="flex items-start justify-between gap-3 mb-6 flex-wrap">
        <div>
          <h1 className="font-display text-5xl text-cream font-light tracking-tight mb-1">Nutrition</h1>
          <p className="text-faint text-sm font-body">What you ate today, against your goals</p>
        </div>
        <div className="flex items-center gap-2 mt-2 shrink-0">
          <button onClick={() => setShowGoals(true)} className="btn-ghost flex items-center gap-2 text-xs">
            <Target size={14} /> Goals
          </button>
          <button onClick={() => setShowLogFood(true)} className="btn-primary flex items-center gap-2 text-sm">
            <Plus size={16} /> Log food
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-8 border-b border-border">
        {([['today', 'Today'], ['insights', 'Insights']] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-body font-medium -mb-px border-b-2 transition-colors ${
              tab === t ? 'border-amber text-amber' : 'border-transparent text-muted hover:text-cream'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center min-h-[40vh]">
          <Loader2 className="animate-spin text-amber" size={28} />
        </div>
      ) : tab === 'insights' ? (
        <InsightsTab userId={user!.uid} goals={goals} />
      ) : (
        <TodayTab
          goalsSet={goalsSet}
          goals={goals}
          totals={totals}
          elapsed={elapsed}
          byMeal={byMeal}
          hasEntries={entries.length > 0}
          onSetGoals={() => setShowGoals(true)}
          onLogFood={() => setShowLogFood(true)}
          onDelete={handleDelete}
          onUpdateServings={handleUpdateServings}
        />
      )}

      {showLogFood && <LogFoodSheet onClose={() => setShowLogFood(false)} onLogged={refresh} />}
      {showGoals && <GoalsModal onClose={() => setShowGoals(false)} onSaved={refresh} />}
    </div>
  )
}

// ── Today tab ──────────────────────────────────────────────────────────────

function TodayTab({
  goalsSet, goals, totals, elapsed, byMeal, hasEntries, onSetGoals, onLogFood, onDelete, onUpdateServings,
}: {
  goalsSet: boolean
  goals: NutritionGoals | null
  totals: NutritionMacros
  elapsed: number
  byMeal: Record<Meal, ConsumptionEntry[]>
  hasEntries: boolean
  onSetGoals: () => void
  onLogFood: () => void
  onDelete: (id: string) => void
  onUpdateServings: (entry: ConsumptionEntry, newServings: number) => Promise<void>
}) {
  return (
    <>
      {/* Goal rings — or a gentle prompt when no goals are set yet */}
      {goalsSet ? (
        <div className="bg-surface border border-border rounded-2xl p-5 mb-8">
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-y-5 gap-x-2">
            {NUTRIENTS.map(n => {
              const kind: RingKind = CEILING_KEYS.has(n.key) ? 'ceiling' : 'floor'
              return (
                <GoalRing
                  key={n.key}
                  nutrientKey={n.key}
                  label={n.label}
                  unit={n.unit}
                  consumed={totals[n.key]}
                  goal={goals?.[n.key] || 0}
                  kind={kind}
                  elapsedFraction={elapsed}
                />
              )
            })}
          </div>
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-2xl p-6 mb-8 text-center">
          <Target size={28} className="text-amber mx-auto mb-3" />
          <p className="text-cream font-body text-sm mb-1">Set your daily goals to see today against your targets.</p>
          <p className="text-faint text-xs font-body mb-4">Your log below still tracks everything you eat.</p>
          <button onClick={onSetGoals} className="btn-primary inline-flex items-center gap-2 text-sm">
            <Target size={14} /> Set goals
          </button>
        </div>
      )}

      {/* Meal-grouped log */}
      {!hasEntries ? (
        <div className="bg-surface border border-border rounded-2xl p-10 text-center">
          <Apple size={32} className="text-faint mx-auto mb-3" />
          <p className="font-display text-2xl text-cream font-light mb-1">Nothing logged today</p>
          <p className="text-faint text-sm font-body mb-5">Log a meal, a recipe serving, or a quick food to get started.</p>
          <button onClick={onLogFood} className="btn-primary inline-flex items-center gap-2 text-sm">
            <Plus size={16} /> Log food
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {MEAL_ORDER.map(meal => {
            const items = byMeal[meal]
            if (!items.length) return null
            const mealCals = items.reduce((s, e) => s + (e.nutrition?.calories || 0), 0)
            return (
              <div key={meal}>
                <div className="flex items-baseline justify-between mb-2">
                  <h3 className="font-display text-xl text-cream font-light capitalize">{meal}</h3>
                  <span className="text-faint text-xs font-body">{Math.round(mealCals)} cal</span>
                </div>
                <div className="bg-surface border border-border rounded-2xl divide-y divide-border overflow-hidden">
                  {items.map(e => (
                    <LogEntryRow key={e.id} entry={e} onDelete={onDelete} onUpdateServings={onUpdateServings} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

// ── One log entry row (name, macros, badges, edit servings, delete) ─────────

function LogEntryRow({
  entry, onDelete, onUpdateServings,
}: {
  entry: ConsumptionEntry
  onDelete: (id: string) => void
  onUpdateServings: (entry: ConsumptionEntry, newServings: number) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [servingsInput, setServingsInput] = useState(String(entry.servings_eaten))
  const [saving, setSaving] = useState(false)

  const macros = entry.nutrition || ZERO
  const secondary = NUTRIENTS
    .filter(n => n.key !== 'calories')
    .map(n => `${n.label[0]} ${formatNutrient(n.key, macros[n.key])}${n.unit}`)
    .join(' · ')

  const startEdit = () => { setServingsInput(String(entry.servings_eaten)); setEditing(true) }

  const save = async () => {
    const v = parseFloat(servingsInput)
    if (!Number.isFinite(v) || v <= 0) return
    if (v === entry.servings_eaten) { setEditing(false); return }
    setSaving(true)
    try {
      await onUpdateServings(entry, v)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-cream text-sm font-body font-medium truncate">{entry.name}</p>
          {entry.is_cook_event && (
            <span className="inline-flex items-center gap-1 text-[10px] font-body px-1.5 py-0.5 rounded-md bg-amber/10 text-amber">
              <ChefHat size={9} /> cooked
            </span>
          )}
          <span className="tag text-[10px] capitalize">{sourceLabel(entry.source)}</span>
        </div>

        {editing ? (
          <div className="flex items-center gap-2 mt-1.5">
            <input
              type="number"
              min="0.25"
              step="0.25"
              inputMode="decimal"
              value={servingsInput}
              onChange={e => setServingsInput(e.target.value)}
              className="input-field w-20 py-1.5 text-sm"
              autoFocus
            />
            <span className="text-faint text-xs font-body">servings</span>
            <button
              onClick={save}
              disabled={saving}
              aria-label="Save servings"
              className="w-7 h-7 rounded-lg flex items-center justify-center bg-amber/15 text-amber hover:bg-amber/25 transition-all disabled:opacity-40"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />}
            </button>
            <button
              onClick={() => setEditing(false)}
              aria-label="Cancel"
              className="w-7 h-7 rounded-lg flex items-center justify-center bg-card border border-border text-faint hover:text-cream transition-all"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <p className="text-faint text-[11px] font-body mt-1">
            {entry.amount_label || `${entry.servings_eaten}×`} · {secondary}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <span className="font-display text-lg text-cream font-light leading-none">
          {Math.round(macros.calories)}
          <span className="text-faint text-[10px] font-body ml-0.5">cal</span>
        </span>
        {!editing && (
          <div className="flex items-center gap-1">
            <button
              onClick={startEdit}
              aria-label="Edit servings"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-faint hover:text-cream hover:bg-card transition-all"
            >
              <Pencil size={13} />
            </button>
            <button
              onClick={() => onDelete(entry.id)}
              aria-label="Delete entry"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-faint hover:text-red-400 hover:bg-card transition-all"
            >
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
