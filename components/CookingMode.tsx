'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { X, ChefHat, BookOpen, ChevronLeft, ChevronRight, ExternalLink, Check, Timer, Play, Pause, Bell, RotateCcw } from 'lucide-react'
import { detectIngredientHeader } from '@/lib/recipes'

// ─── Step-duration timer parsing (Batch 9) ────────────────────────────────────
// Conservative, TAP-TO-START only — nothing here auto-starts. We surface a small
// tappable chip for each explicit cook DURATION found in an instruction step.
// We deliberately EXCLUDE:
//   • cadence/frequency  — "every 2 minutes", "stirring every 5 minutes" (a rate,
//     not a countdown);
//   • ranges as two chips — "1-2 min" / "1 to 2 minutes" yield ONE chip using the
//     LONGER bound;
//   • non-duration numbers — temps ("450 degrees", "350°F"), counts ("2 cloves"),
//     volumes ("1 cup"): only a number directly qualified by a TIME unit matches.

// Vulgar-fraction characters (BMP) for "1½", "½", etc. Escaped so the source file
// carries no raw unicode into the RegExp.
const FRAC_CHARS = '\\u00BC-\\u00BE\\u2150-\\u215E'
const FRAC_VALUES: Record<string, number> = {
  '¼': 0.25, '½': 0.5, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3,
  '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8, '⅙': 1 / 6, '⅚': 5 / 6,
  '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
  '⅐': 1 / 7, '⅑': 1 / 9, '⅒': 0.1,
}

// One quantity token: mixed "1 1/2", "1½", simple fraction "1/2", decimal "1.5",
// integer "3", or a lone unicode fraction "½".
const QTY = `(?:\\d+\\s+\\d+\\s*/\\s*\\d+|\\d+\\s*[${FRAC_CHARS}]|\\d+\\s*/\\s*\\d+|\\d+(?:\\.\\d+)?|[${FRAC_CHARS}])`
const TIME_UNIT = `(hours?|hrs?|minutes?|mins?|seconds?|secs?)`
// QTY, an OPTIONAL range tail (→ longer bound), an optional hyphen ("5-minute"),
// then a time unit. Global so we can collect every duration in a step.
function buildDurationRE(): RegExp {
  return new RegExp(`(${QTY})(?:\\s*(?:-|–|—|to)\\s*(${QTY}))?\\s*-?\\s*${TIME_UNIT}\\b`, 'gi')
}

function qtyToNumber(raw: string): number | null {
  const s = (raw || '').trim()
  if (!s) return null
  let m = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/)            // mixed ascii "1 1/2"
  if (m) return parseInt(m[1], 10) + parseInt(m[2], 10) / parseInt(m[3], 10)
  m = s.match(new RegExp(`^(\\d+)\\s*([${FRAC_CHARS}])$`))   // mixed unicode "1½"
  if (m) return parseInt(m[1], 10) + (FRAC_VALUES[m[2]] ?? NaN)
  m = s.match(/^(\d+)\s*\/\s*(\d+)$/)                        // fraction "1/2"
  if (m) return parseInt(m[1], 10) / parseInt(m[2], 10)
  if (FRAC_VALUES[s] !== undefined) return FRAC_VALUES[s]    // lone "½"
  if (/^\d+(?:\.\d+)?$/.test(s)) return parseFloat(s)        // integer / decimal
  return null
}

function unitToSeconds(unit: string): number {
  const u = unit.toLowerCase()
  if (u.startsWith('h')) return 3600
  if (u.startsWith('s')) return 1
  return 60 // minutes
}

function formatTimerLabel(total: number): string {
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const parts: string[] = []
  if (h) parts.push(`${h}h`)
  if (m) parts.push(`${m}m`)
  if (s) parts.push(`${s}s`)
  return parts.join(' ') || '0s'
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

interface StepDuration { seconds: number; label: string }

// Parse every legit duration in a step. Multiple durations → multiple entries
// ("sear 3 minutes, then rest 5 minutes" → [180s, 300s]).
function parseStepDurations(step: string): StepDuration[] {
  if (!step) return []
  const re = buildDurationRE()
  const out: StepDuration[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(step)) !== null) {
    // Cadence guard: a duration immediately preceded by "every" is a frequency,
    // not a countdown ("stirring every 2 minutes") — skip it.
    if (/\bevery\s+$/i.test(step.slice(0, m.index))) continue
    const lo = qtyToNumber(m[1])
    const hi = m[2] != null ? qtyToNumber(m[2]) : null
    // Range → use the LONGER bound; single value → itself.
    const value = hi != null ? Math.max(lo ?? 0, hi) : lo
    if (value == null || !Number.isFinite(value) || value <= 0) continue
    const seconds = Math.round(value * unitToSeconds(m[3]))
    if (seconds <= 0) continue
    out.push({ seconds, label: formatTimerLabel(seconds) })
  }
  return out
}

interface RunningTimer {
  id: string
  label: string
  totalSeconds: number
  status: 'running' | 'paused' | 'finished'
  endsAt: number | null   // epoch ms while running (background-safe target); null otherwise
  remainingMs: number     // authoritative while paused/finished; mirror while running
}

// Minimal typing for the Screen Wake Lock API (not in all TS lib.dom versions)
interface WakeLockSentinelLike {
  released: boolean
  release: () => Promise<void>
}

interface CookingModeProps {
  title: string
  ingredients: string[]
  instructions: string[]
  sourceURL?: string
  onClose: () => void
  /**
   * Cooked-capture hook (Surface 2): when provided, finishing the cook flow
   * offers a "Mark as cooked?" step with a servings-eaten input. The parent
   * owns all Firestore writes (plan + consumption log) — this component stays
   * presentational.
   */
  onMarkCooked?: (servingsEaten: number) => Promise<void>
}

type Tab = 'ingredients' | 'instructions'

export default function CookingMode({
  title,
  ingredients,
  instructions,
  sourceURL,
  onClose,
  onMarkCooked,
}: CookingModeProps) {
  const [tab, setTab] = useState<Tab>('ingredients')
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [currentStep, setCurrentStep] = useState(0)
  const [showFinish, setShowFinish] = useState(false)
  const [servingsInput, setServingsInput] = useState('1')
  const [savingCooked, setSavingCooked] = useState(false)
  const [cookedError, setCookedError] = useState('')
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null)

  // ─── Tap-to-start step timers (Batch 9) ───────────────────────────────────
  const [timers, setTimers] = useState<RunningTimer[]>([])
  const [now, setNow] = useState(() => Date.now())
  const audioCtxRef = useRef<AudioContext | null>(null)
  const timerSeqRef = useRef(0)

  // Durations parsed per instruction step (memoised; pure, conservative parser).
  const stepDurations = useMemo(
    () => instructions.map(step => parseStepDurations(step)),
    [instructions],
  )

  // Remaining ms — derived from the stored target timestamp while running, so it
  // stays correct across tab backgrounding (no naive setInterval decrement).
  const remainingMsOf = (t: RunningTimer) =>
    t.status === 'running' && t.endsAt != null ? Math.max(0, t.endsAt - now) : t.remainingMs

  // Lazily create + unlock an AudioContext inside the start gesture so the finish
  // beep is allowed to play later (autoplay policy). Feature-detected; if audio is
  // unavailable we simply never beep — vibrate + visual alert still fire.
  const ensureAudio = () => {
    try {
      if (audioCtxRef.current) {
        if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume().catch(() => {})
        return
      }
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctx) return
      audioCtxRef.current = new Ctx()
      audioCtxRef.current.resume?.().catch(() => {})
    } catch { /* no audio support — degrade silently */ }
  }

  // Finish alert: short embedded Web-Audio triple-beep + mobile vibrate. Both are
  // best-effort and feature-detected. HONEST LIMIT: if the tab is backgrounded/
  // locked the OS may block the beep; the visual alert and the correct
  // remaining-time-on-return still work (and Cooking Mode's wake lock keeps the
  // screen on while in this view).
  const fireAlarm = () => {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate([200, 100, 200])
      }
    } catch { /* vibrate unsupported — ignore */ }
    const ctx = audioCtxRef.current
    if (!ctx) return
    try {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {})
      const beepAt = (start: number) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain); gain.connect(ctx.destination)
        osc.type = 'sine'
        osc.frequency.value = 880
        gain.gain.setValueAtTime(0.0001, start)
        gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.25)
        osc.start(start)
        osc.stop(start + 0.26)
      }
      const t0 = ctx.currentTime
      beepAt(t0); beepAt(t0 + 0.35); beepAt(t0 + 0.7)
    } catch { /* audio failed — visual + vibrate still cover it */ }
  }

  // Multiple concurrent timers: starting one never stops another.
  const startTimer = (label: string, seconds: number) => {
    ensureAudio()
    const ms = seconds * 1000
    const id = `t${++timerSeqRef.current}`
    setTimers(prev => [...prev, {
      id, label, totalSeconds: seconds,
      status: 'running', endsAt: Date.now() + ms, remainingMs: ms,
    }])
    setNow(Date.now())
  }

  const pauseTimer = (id: string) => setTimers(prev => prev.map(t => {
    if (t.id !== id || t.status !== 'running') return t
    return { ...t, status: 'paused', endsAt: null, remainingMs: Math.max(0, (t.endsAt ?? Date.now()) - Date.now()) }
  }))

  const resumeTimer = (id: string) => setTimers(prev => prev.map(t =>
    t.id === id && t.status === 'paused'
      ? { ...t, status: 'running', endsAt: Date.now() + t.remainingMs }
      : t,
  ))

  const restartTimer = (id: string) => setTimers(prev => prev.map(t =>
    t.id === id
      ? { ...t, status: 'running', endsAt: Date.now() + t.totalSeconds * 1000, remainingMs: t.totalSeconds * 1000 }
      : t,
  ))

  const removeTimer = (id: string) => setTimers(prev => prev.filter(t => t.id !== id))

  // Single shared ticker drives the countdown re-render; recompute immediately on
  // tab re-focus so the displayed remaining time is correct on return. Runs only
  // while a timer is actively counting (paused/finished-only states don't tick).
  const hasRunning = timers.some(t => t.status === 'running')
  useEffect(() => {
    if (!hasRunning) return
    const interval = setInterval(() => setNow(Date.now()), 250)
    const onVisible = () => { if (document.visibilityState === 'visible') setNow(Date.now()) }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisible) }
  }, [hasRunning])

  // Detect finishes off the timestamp (not a decrement), mark them, fire the alert
  // once. Finished timers are excluded from the next pass, so there is no re-fire.
  useEffect(() => {
    const finished = timers.filter(t => t.status === 'running' && t.endsAt != null && t.endsAt <= now)
    if (finished.length === 0) return
    setTimers(prev => prev.map(t =>
      finished.some(f => f.id === t.id)
        ? { ...t, status: 'finished' as const, endsAt: null, remainingMs: 0 }
        : t,
    ))
    fireAlarm()
  }, [now, timers])

  // Release the AudioContext when Cooking Mode closes.
  useEffect(() => () => { audioCtxRef.current?.close?.().catch(() => {}) }, [])

  const servingsEaten = parseFloat(servingsInput)
  const servingsValid = Number.isFinite(servingsEaten) && servingsEaten > 0

  const handleConfirmCooked = async () => {
    if (!onMarkCooked || !servingsValid || savingCooked) return
    setSavingCooked(true)
    setCookedError('')
    try {
      await onMarkCooked(servingsEaten)
      onClose()
    } catch {
      setCookedError("Couldn't save — check your connection and try again.")
      setSavingCooked(false)
    }
  }

  // ─── Screen Wake Lock ─────────────────────────────────────────────────────
  useEffect(() => {
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> }
    }

    const acquire = async () => {
      if (!nav.wakeLock) return // unsupported → silent no-op
      try {
        wakeLockRef.current = await nav.wakeLock.request('screen')
      } catch {
        // Lock request can reject (e.g. not visible); ignore silently
      }
    }

    const handleVisibility = () => {
      // Browsers drop the lock on tab switch — re-acquire when visible again
      if (document.visibilityState === 'visible' && wakeLockRef.current?.released !== false) {
        acquire()
      }
    }

    acquire()
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      wakeLockRef.current?.release().catch(() => {})
      wakeLockRef.current = null
    }
  }, [])

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const toggleChecked = (i: number) => {
    setChecked(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  const goPrev = () => setCurrentStep(s => Math.max(0, s - 1))
  const goNext = () => setCurrentStep(s => Math.min(instructions.length - 1, s + 1))

  return (
    <div className="fixed inset-0 z-[100] bg-ink flex flex-col animate-fade-in">
      {/* Header */}
      <header className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
        <div className="min-w-0">
          <p className="text-faint text-[11px] font-body uppercase tracking-widest">Cooking Mode</p>
          <h1 className="font-display text-xl md:text-2xl text-cream font-light leading-tight truncate">
            {title}
          </h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {onMarkCooked && (
            <button
              onClick={() => setShowFinish(true)}
              aria-label="Finish cooking"
              className="h-11 px-4 rounded-full flex items-center gap-1.5 bg-card border border-border text-faint hover:text-green-400 hover:border-green-400/30 transition-all text-sm font-body"
            >
              <Check size={16} /> Finish
            </button>
          )}
          <button
            onClick={onClose}
            aria-label="Close cooking mode"
            className="w-11 h-11 shrink-0 rounded-full flex items-center justify-center bg-card border border-border text-faint hover:text-cream hover:border-amber/30 transition-all"
          >
            <X size={20} />
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div className="shrink-0 flex gap-2 px-4 pt-3">
        <button
          onClick={() => setTab('ingredients')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-body font-medium transition-all ${
            tab === 'ingredients'
              ? 'bg-amber text-ink'
              : 'bg-card border border-border text-muted hover:text-cream'
          }`}
        >
          <ChefHat size={15} /> Ingredients
        </button>
        <button
          onClick={() => setTab('instructions')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-body font-medium transition-all ${
            tab === 'instructions'
              ? 'bg-amber text-ink'
              : 'bg-card border border-border text-muted hover:text-cream'
          }`}
        >
          <BookOpen size={15} /> Instructions
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-5">
        <div className="max-w-2xl mx-auto">
          {tab === 'ingredients' ? (
            <ul className="space-y-1">
              {ingredients.map((ing, i) => {
                const header = detectIngredientHeader(ing)
                if (header.isHeader) {
                  return (
                    <li key={i} className="pt-4 first:pt-0 pb-1">
                      <h4 className="font-display text-lg text-cream font-medium tracking-wide">
                        {header.text}
                      </h4>
                    </li>
                  )
                }
                const isChecked = checked.has(i)
                return (
                  <li key={i}>
                    <button
                      onClick={() => toggleChecked(i)}
                      className="w-full flex items-start gap-3 text-left py-3 px-2 rounded-xl hover:bg-card/60 transition-colors"
                    >
                      <span
                        className={`w-5 h-5 mt-0.5 rounded-md border-2 shrink-0 flex items-center justify-center transition-all ${
                          isChecked ? 'bg-amber border-amber text-ink' : 'border-faint/40'
                        }`}
                      >
                        {isChecked && <Check size={13} strokeWidth={3} />}
                      </span>
                      <span
                        className={`text-base font-body leading-relaxed transition-colors ${
                          isChecked ? 'text-faint line-through' : 'text-cream'
                        }`}
                      >
                        {ing}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <ol className="space-y-3">
              {instructions.map((step, i) => {
                const isCurrent = i === currentStep
                return (
                  <li key={i}>
                    <button
                      onClick={() => setCurrentStep(i)}
                      className={`w-full flex gap-4 text-left p-4 rounded-2xl border transition-all ${
                        isCurrent
                          ? 'bg-amber/10 border-amber/40'
                          : 'bg-card/40 border-transparent hover:border-border'
                      }`}
                    >
                      <span
                        className={`font-display text-2xl font-light leading-none mt-0.5 w-7 shrink-0 ${
                          isCurrent ? 'text-amber' : 'text-amber/40'
                        }`}
                      >
                        {i + 1}
                      </span>
                      <p
                        className={`font-body leading-relaxed ${
                          isCurrent ? 'text-cream text-lg' : 'text-muted text-base'
                        }`}
                      >
                        {step}
                      </p>
                    </button>
                    {stepDurations[i] && stepDurations[i].length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2 pl-11">
                        {stepDurations[i].map((d, di) => (
                          <button
                            key={di}
                            onClick={() => startTimer(d.label, d.seconds)}
                            aria-label={`Start ${d.label} timer`}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber/10 border border-amber/30 text-amber text-xs font-body hover:bg-amber/20 transition-colors"
                          >
                            <Timer size={12} /> {d.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      </div>

      {/* Running-timers tray — multiple concurrent timers; each counts down off its
          stored target timestamp and offers pause/resume + cancel. A finished timer
          flashes with a bell until dismissed (visual alert; sound + vibrate fire on
          finish, best-effort). Shown on both tabs so the cook can track e.g. pasta +
          sauce at once. */}
      {timers.length > 0 && (
        <div className="shrink-0 border-t border-border bg-surface/60 px-4 py-3">
          <div className="max-w-2xl mx-auto">
            <p className="text-faint text-[11px] font-body uppercase tracking-widest mb-2">
              Timers
            </p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {timers.map(t => {
                const finished = t.status === 'finished'
                return (
                  <div
                    key={t.id}
                    className={`shrink-0 flex items-center gap-2.5 rounded-xl border px-3 py-2 transition-colors ${
                      finished ? 'border-amber bg-amber/20 animate-pulse' : 'border-border bg-card'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className={`font-mono text-base leading-none tabular-nums ${finished ? 'text-amber' : 'text-cream'}`}>
                        {finished ? 'Done!' : formatClock(remainingMsOf(t))}
                      </p>
                      <p className="text-faint text-[10px] font-body mt-0.5">{t.label}</p>
                    </div>
                    {finished ? (
                      <>
                        <Bell size={16} className="text-amber shrink-0" />
                        <button
                          onClick={() => restartTimer(t.id)}
                          aria-label="Restart timer"
                          className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-faint hover:text-cream hover:bg-card transition-colors"
                        >
                          <RotateCcw size={14} />
                        </button>
                        <button
                          onClick={() => removeTimer(t.id)}
                          aria-label="Dismiss timer"
                          className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-faint hover:text-cream hover:bg-card transition-colors"
                        >
                          <X size={14} />
                        </button>
                      </>
                    ) : (
                      <>
                        {t.status === 'running' ? (
                          <button
                            onClick={() => pauseTimer(t.id)}
                            aria-label="Pause timer"
                            className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-faint hover:text-amber hover:bg-card transition-colors"
                          >
                            <Pause size={14} />
                          </button>
                        ) : (
                          <button
                            onClick={() => resumeTimer(t.id)}
                            aria-label="Resume timer"
                            className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-faint hover:text-amber hover:bg-card transition-colors"
                          >
                            <Play size={14} />
                          </button>
                        )}
                        <button
                          onClick={() => removeTimer(t.id)}
                          aria-label="Cancel timer"
                          className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-faint hover:text-red-400 hover:bg-card transition-colors"
                        >
                          <X size={14} />
                        </button>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Footer — step navigation (instructions tab only) */}
      {tab === 'instructions' && instructions.length > 0 && (
        <footer className="shrink-0 border-t border-border px-4 py-3">
          <div className="max-w-2xl mx-auto flex items-center gap-3">
            <button
              onClick={goPrev}
              disabled={currentStep === 0}
              className="flex items-center gap-1.5 btn-ghost disabled:opacity-30 disabled:pointer-events-none"
            >
              <ChevronLeft size={16} /> Prev
            </button>
            <div className="flex-1 text-center min-w-0">
              <p className="text-faint text-xs font-body">
                Step {currentStep + 1} of {instructions.length}
              </p>
              {sourceURL && (
                <a
                  href={sourceURL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-amber/80 hover:text-amber text-xs font-body mt-0.5"
                >
                  <ExternalLink size={12} /> View source
                </a>
              )}
            </div>
            {onMarkCooked && currentStep === instructions.length - 1 ? (
              <button
                onClick={() => setShowFinish(true)}
                className="flex items-center gap-1.5 btn-primary"
              >
                Finish <Check size={16} />
              </button>
            ) : (
              <button
                onClick={goNext}
                disabled={currentStep === instructions.length - 1}
                className="flex items-center gap-1.5 btn-primary disabled:opacity-30 disabled:pointer-events-none"
              >
                Next <ChevronRight size={16} />
              </button>
            )}
          </div>
        </footer>
      )}

      {/* Completion step — "Mark as cooked?" with servings-eaten capture */}
      {showFinish && onMarkCooked && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center bg-ink/85 backdrop-blur-sm p-6"
          onClick={() => !savingCooked && setShowFinish(false)}
        >
          <div
            className="bg-surface border border-border rounded-2xl p-6 max-w-sm w-full animate-fade-in"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="font-display text-2xl text-cream font-light mb-1">Mark as cooked?</h3>
            <p className="text-faint text-sm font-body mb-4">
              This updates your meal plan and logs it to today&apos;s nutrition.
            </p>
            <label className="block mb-4">
              <span className="text-faint text-xs font-body uppercase tracking-widest">Servings eaten</span>
              <input
                type="number"
                min="0.25"
                step="0.25"
                inputMode="decimal"
                value={servingsInput}
                onChange={e => setServingsInput(e.target.value)}
                className="input-field mt-1.5 w-28"
                autoFocus
              />
            </label>
            {cookedError && <p className="text-red-400 text-xs font-body mb-3">{cookedError}</p>}
            <div className="flex gap-2 justify-end">
              <button
                onClick={onClose}
                disabled={savingCooked}
                className="btn-ghost text-sm"
              >
                Skip
              </button>
              <button
                onClick={handleConfirmCooked}
                disabled={!servingsValid || savingCooked}
                className="btn-primary text-sm flex items-center gap-1.5 disabled:opacity-40"
              >
                {savingCooked && <span className="w-3 h-3 border-2 border-ink/40 border-t-ink rounded-full animate-spin" />}
                Mark cooked
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
