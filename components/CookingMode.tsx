'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { X, ChefHat, BookOpen, ChevronLeft, ChevronRight, ExternalLink, Check } from 'lucide-react'
import { detectIngredientHeader } from '@/lib/recipes'

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
}

type Tab = 'ingredients' | 'instructions'

export default function CookingMode({
  title,
  ingredients,
  instructions,
  sourceURL,
  onClose,
}: CookingModeProps) {
  const [tab, setTab] = useState<Tab>('ingredients')
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [currentStep, setCurrentStep] = useState(0)
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null)

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
        <button
          onClick={onClose}
          aria-label="Close cooking mode"
          className="w-11 h-11 shrink-0 rounded-full flex items-center justify-center bg-card border border-border text-faint hover:text-cream hover:border-amber/30 transition-all"
        >
          <X size={20} />
        </button>
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
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      </div>

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
            <button
              onClick={goNext}
              disabled={currentStep === instructions.length - 1}
              className="flex items-center gap-1.5 btn-primary disabled:opacity-30 disabled:pointer-events-none"
            >
              Next <ChevronRight size={16} />
            </button>
          </div>
        </footer>
      )}
    </div>
  )
}
