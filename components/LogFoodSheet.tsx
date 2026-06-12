'use client'

// Log-food entry sheet (Surface 3): four modes — USDA search / my recipes /
// manual macros / barcode scan — plus a recents+favorites quick row. Writes
// consumption_log entries with is_cook_event: false. NEVER touches the plan or
// cooked status (cooked capture is Cooking Mode / the plan checkmark — see
// lib/consumptionLog logCookEvent). Mounted from the Nutrition page header
// ("＋ Log food").
//
// Scan mode decodes EAN/UPC product barcodes from the camera: the native
// BarcodeDetector API where the browser has it (Chromium, newer Safari),
// otherwise a lazy-loaded @zxing/browser reader (older iOS Safari, Firefox).
// A read stops the camera and resolves via lookupBarcode (/api/barcode-lookup).

import { useState, useEffect, useRef, useMemo } from 'react'
import {
  X, Search, Star, Loader2, Check, ChefHat, PencilLine, ScanBarcode, CameraOff, SearchX,
} from 'lucide-react'
import { useAuth } from '@/lib/AuthContext'
import {
  addLogEntry, saveFavorite, getSavedFoods, getRecents, autoMealForTime, scaleMacros,
} from '@/lib/consumptionLog'
import { getAllRecipes } from '@/lib/recipes'
import { perServingOf, sourceLabel, NUTRIENTS, formatNutrient, lookupBarcode } from '@/lib/nutrition'
import type { Recipe, NutritionMacros } from '@/types/recipe'
import type { Meal, SavedFood, RecentFood, BarcodeProduct, LogSource } from '@/types/nutrition'
import type { IScannerControls } from '@zxing/browser'

type Mode = 'search' | 'recipes' | 'manual' | 'scan'

interface FoodResult {
  name: string
  nutrition: NutritionMacros          // per serving
  source: Exclude<LogSource, 'recipe' | 'manual'>
  confidence?: string
}

// ── Scan mode plumbing ───────────────────────────────────────────────────────

type ScanStatus =
  | 'idle'        // mode not started yet (pre-effect first render)
  | 'starting'    // getUserMedia in flight (permission prompt may be up)
  | 'scanning'    // live feed + decode loop running
  | 'looking_up'  // barcode read, camera stopped, /api/barcode-lookup in flight
  | 'hit'         // product found — confirm-and-log card
  | 'miss'        // lookup returned found:false
  | 'denied'      // no permission / no camera / insecure context
  | 'error'       // lookup or decoder failure

// Product barcodes only (no QR etc.) — keys are the BarcodeDetector format names.
const SCAN_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e']

/**
 * Native BarcodeDetector where the browser supports the product formats
 * (zero-cost, no download), else the zxing fallback. Runtime-detected because
 * support is uneven — historically missing on iOS Safari and Firefox.
 */
async function pickScanEngine(): Promise<{ engine: 'native'; formats: string[] } | { engine: 'zxing' }> {
  try {
    const BD = (window as any).BarcodeDetector
    if (BD && typeof BD.getSupportedFormats === 'function') {
      const supported: string[] = await BD.getSupportedFormats()
      const formats = SCAN_FORMATS.filter(f => supported.includes(f))
      if (formats.length > 0) return { engine: 'native', formats }
    }
  } catch { /* fall through to zxing */ }
  return { engine: 'zxing' }
}

const MEALS: Meal[] = ['breakfast', 'lunch', 'snack', 'dinner']

// One re-loggable food from the user's history (a starred favorite or a recent
// log entry) — nutrition is per-serving, so it feeds the confirm flow directly
// with zero external lookups.
interface HistoryEntry {
  key: string
  fav: boolean
  item: SavedFood | RecentFood
}

function HistoryList({ entries, onPick }: { entries: HistoryEntry[]; onPick: (item: SavedFood | RecentFood) => void }) {
  return (
    <div className="rounded-xl border border-border divide-y divide-border overflow-hidden">
      {entries.map(({ key, fav, item }) => (
        <button
          key={key}
          onClick={() => onPick(item)}
          className="w-full flex items-center justify-between gap-3 px-3 py-2.5 bg-card hover:bg-surface text-left transition-colors"
        >
          <span className="flex items-center gap-1.5 min-w-0">
            {fav && <Star size={10} className="text-amber shrink-0" fill="currentColor" />}
            <span className="text-cream text-sm font-body truncate">{item.name}</span>
          </span>
          <span className="text-faint text-xs font-body shrink-0">{Math.round(item.nutrition.calories)} cal</span>
        </button>
      ))}
    </div>
  )
}

function MacroGrid({ macros }: { macros: NutritionMacros }) {
  return (
    <div className="grid grid-cols-3 gap-x-4 gap-y-1.5">
      {NUTRIENTS.map(n => (
        <div key={n.key} className="flex items-baseline justify-between gap-2">
          <span className="text-faint text-[11px] font-body">{n.label}</span>
          <span className="text-cream text-xs font-body font-medium">
            {formatNutrient(n.key, macros[n.key])}{n.unit}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function LogFoodSheet({ onClose, onLogged }: { onClose: () => void; onLogged?: () => void }) {
  const { user } = useAuth()
  const [mode, setMode] = useState<Mode>('search')

  // shared entry fields
  const [servingsInput, setServingsInput] = useState('1')
  const [meal, setMeal] = useState<Meal>(autoMealForTime())
  const [saving, setSaving] = useState(false)
  const [loggedOk, setLoggedOk] = useState(false)
  const [saveError, setSaveError] = useState('')

  // mode 1 — search
  const [query, setQuery] = useState('')
  const [lookupLoading, setLookupLoading] = useState(false)
  const [result, setResult] = useState<FoodResult | null>(null)
  const [lookupError, setLookupError] = useState('')
  const [starred, setStarred] = useState(false)
  const [historyCollapsed, setHistoryCollapsed] = useState(false)   // hide history matches after an explicit pick
  const skipNextLookup = useRef(false)
  const lookupSeq = useRef(0)

  // mode 2 — my recipes
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [recipesLoading, setRecipesLoading] = useState(true)
  const [recipeQuery, setRecipeQuery] = useState('')
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null)

  // mode 3 — manual
  const [manualName, setManualName] = useState('')
  const [manualMacros, setManualMacros] = useState<Record<string, string>>({
    calories: '', protein_g: '', carbs_g: '', fat_g: '', fiber_g: '', sugar_g: '',
  })

  // mode 4 — scan
  const [scanStatus, setScanStatus] = useState<ScanStatus>('idle')
  const [scanSession, setScanSession] = useState(0)   // bump → restart the scanner
  const [scanHit, setScanHit] = useState<BarcodeProduct | null>(null)
  const [scanCode, setScanCode] = useState('')
  const [scanMessage, setScanMessage] = useState('')
  const [scanStarred, setScanStarred] = useState(false)
  const [manualCode, setManualCode] = useState('')          // typed-barcode fallback
  const [manualCodeError, setManualCodeError] = useState('')
  const [historyQuery, setHistoryQuery] = useState('')      // scan-mode history filter
  const manualInputRef = useRef<HTMLInputElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const zxingControlsRef = useRef<IScannerControls | null>(null)
  const scanLoopRef = useRef<number | null>(null)      // native-detector interval id
  const scanGen = useRef(0)                            // invalidates in-flight camera/decode async work

  // re-log history: recents + favorites (quick row, searchable list — Search/Scan only)
  const [recents, setRecents] = useState<RecentFood[]>([])
  const [favorites, setFavorites] = useState<SavedFood[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)   // gate so the empty state doesn't flash

  useEffect(() => {
    if (!user) return
    Promise.allSettled([
      getRecents(user.uid, 30).then(setRecents),
      getSavedFoods(user.uid).then(setFavorites),
    ]).then(() => setHistoryLoaded(true))
  }, [user])

  useEffect(() => {
    getAllRecipes()
      .then(list => setRecipes(list.filter(r => perServingOf(r.nutrition))))
      .finally(() => setRecipesLoading(false))
  }, [])

  // debounced USDA lookup (mode 1)
  useEffect(() => {
    if (mode !== 'search' || !user) return
    if (skipNextLookup.current) { skipNextLookup.current = false; return }
    const q = query.trim()
    setResult(null); setLookupError(''); setStarred(false)
    setHistoryCollapsed(false)   // typing again re-opens history matches
    if (q.length < 2) { setLookupLoading(false); return }
    setLookupLoading(true)
    const seq = ++lookupSeq.current
    const t = setTimeout(async () => {
      try {
        const token = await user.getIdToken()
        const res = await fetch('/api/nutrition-lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ type: 'food', name: q }),
        })
        if (seq !== lookupSeq.current) return   // stale response — a newer query is in flight
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          throw new Error(d.error || 'Lookup failed')
        }
        const data = await res.json()
        setResult({
          name: data.name || q,
          nutrition: data.nutrition,
          source: data.source === 'ai_estimate' ? 'ai_estimate' : 'usda',
          confidence: data.confidence,
        })
      } catch (e: any) {
        if (seq === lookupSeq.current) setLookupError(e?.message || 'Lookup failed — try manual entry')
      } finally {
        if (seq === lookupSeq.current) setLookupLoading(false)
      }
    }, 500)
    return () => clearTimeout(t)
  }, [query, mode, user])

  // ── scan mode: camera + decode lifecycle ──────────────────────────────────

  // Idempotent teardown — kills the decode loop and every camera track so the
  // camera light never stays on. Bumping scanGen cancels any in-flight async.
  const stopCamera = () => {
    scanGen.current++
    if (scanLoopRef.current !== null) {
      window.clearInterval(scanLoopRef.current)
      scanLoopRef.current = null
    }
    try { zxingControlsRef.current?.stop() } catch { /* already stopped */ }
    zxingControlsRef.current = null
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }

  const onBarcodeDetected = async (code: string) => {
    stopCamera()   // camera off the moment we have a read
    setScanCode(code)
    setScanStatus('looking_up')
    if (!user) return
    try {
      const token = await user.getIdToken()
      const data = await lookupBarcode(code, token)
      if (data.found) {
        setScanHit(data)
        setScanStatus('hit')
      } else {
        setScanStatus('miss')
      }
    } catch (e: any) {
      setScanMessage(e?.message || 'Lookup failed')
      setScanStatus('error')
    }
  }

  const startScanner = async () => {
    const gen = ++scanGen.current
    setScanHit(null); setScanCode(''); setScanMessage(''); setScanStarred(false)
    setScanStatus('starting')

    if (!navigator.mediaDevices?.getUserMedia) {
      // No camera API — insecure context (plain http) or very old browser.
      setScanMessage('Camera is not available in this browser.')
      setScanStatus('denied')
      return
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },   // rear camera on phones
        audio: false,
      })
    } catch (e: any) {
      setScanMessage(e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError'
        ? 'No camera found on this device.'
        : 'Camera access needed to scan.')
      setScanStatus('denied')
      return
    }
    if (gen !== scanGen.current || !videoRef.current) {
      // Mode/sheet closed while the permission prompt was up — release immediately.
      stream.getTracks().forEach(t => t.stop())
      return
    }

    streamRef.current = stream
    const video = videoRef.current
    video.srcObject = stream
    try { await video.play() } catch { /* interrupted by teardown — tracks handled there */ }
    if (gen !== scanGen.current) return
    setScanStatus('scanning')

    const picked = await pickScanEngine()
    if (gen !== scanGen.current) return

    if (picked.engine === 'native') {
      const detector = new (window as any).BarcodeDetector({ formats: picked.formats })
      scanLoopRef.current = window.setInterval(async () => {
        if (gen !== scanGen.current || !videoRef.current) return
        try {
          const codes = await detector.detect(videoRef.current)
          const raw = codes?.[0]?.rawValue
          if (raw && gen === scanGen.current) onBarcodeDetected(String(raw))
        } catch { /* per-frame decode errors are normal — keep scanning */ }
      }, 250)
    } else {
      try {
        const [{ BrowserMultiFormatReader }, zx] = await Promise.all([
          import('@zxing/browser'),
          import('@zxing/library'),
        ])
        if (gen !== scanGen.current) return
        const hints = new Map()
        hints.set(zx.DecodeHintType.POSSIBLE_FORMATS, [
          zx.BarcodeFormat.EAN_13, zx.BarcodeFormat.EAN_8,
          zx.BarcodeFormat.UPC_A, zx.BarcodeFormat.UPC_E,
        ])
        const reader = new BrowserMultiFormatReader(hints)
        zxingControlsRef.current = await reader.decodeFromVideoElement(video, result => {
          if (result && gen === scanGen.current) onBarcodeDetected(result.getText())
        })
      } catch {
        if (gen !== scanGen.current) return
        stopCamera()
        setScanMessage('The barcode scanner failed to start.')
        setScanStatus('error')
      }
    }
  }

  // Start on entering Scan (or on rescan bump); stop on mode switch, sheet
  // close (unmount), or session bump — the cleanup runs in all three.
  useEffect(() => {
    if (mode !== 'scan') return
    startScanner()
    return stopCamera
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, scanSession])

  const handleRescan = () => {
    // Set a feed-showing status BEFORE bumping the session so the <video>
    // element is mounted when startScanner looks for it.
    setScanStatus('starting')
    setScanSession(s => s + 1)
  }

  const switchToSearch = () => {
    setMode('search')   // search input autofocuses on mount
    setSaveError('')
  }

  // Typed-barcode fallback — same lookup + hit/miss path as a camera read.
  // Covers camera-denied, unreadable/damaged codes, or just typing the digits.
  const submitManualCode = () => {
    const code = manualCode.replace(/[\s-]/g, '')
    if (!/^\d{8,14}$/.test(code)) {
      setManualCodeError("That doesn't look like a barcode — it's usually the 8–14 digits printed under the lines.")
      return
    }
    setManualCodeError('')
    onBarcodeDetected(code)   // stops the camera if running (idempotent), then looks up
  }

  // When the camera is denied/unavailable, the typed barcode IS the scan path —
  // put the cursor there.
  useEffect(() => {
    if (mode === 'scan' && scanStatus === 'denied') manualInputRef.current?.focus()
  }, [mode, scanStatus])

  const servings = parseFloat(servingsInput)
  const servingsValid = Number.isFinite(servings) && servings > 0

  const selectedRecipe = useMemo(
    () => recipes.find(r => r.id === selectedRecipeId) || null,
    [recipes, selectedRecipeId],
  )
  const selectedRecipePer = selectedRecipe ? perServingOf(selectedRecipe.nutrition) : null

  const filteredRecipes = useMemo(() => {
    const q = recipeQuery.trim().toLowerCase()
    const list = q ? recipes.filter(r => r.title.toLowerCase().includes(q)) : recipes
    return list.slice(0, 50)
  }, [recipes, recipeQuery])

  const manualPerServing: NutritionMacros | null = useMemo(() => {
    const num = (k: string) => {
      const v = manualMacros[k].trim()
      if (v === '') return 0
      const n = Number(v)
      return Number.isFinite(n) && n >= 0 ? n : NaN
    }
    const m = {
      calories: num('calories'), protein_g: num('protein_g'), carbs_g: num('carbs_g'),
      fat_g: num('fat_g'), fiber_g: num('fiber_g'), sugar_g: num('sugar_g'),
    }
    if (Object.values(m).some(v => Number.isNaN(v))) return null
    if (manualMacros.calories.trim() === '') return null   // calories is required
    return m
  }, [manualMacros])

  const canConfirm = servingsValid && !saving && (
    (mode === 'search' && !!result) ||
    (mode === 'recipes' && !!selectedRecipe && !!selectedRecipePer) ||
    (mode === 'manual' && manualName.trim().length > 0 && !!manualPerServing) ||
    (mode === 'scan' && scanStatus === 'hit' && !!scanHit)
  )

  const handleConfirm = async () => {
    if (!user || !canConfirm) return
    setSaving(true)
    setSaveError('')
    try {
      if (mode === 'search' && result) {
        await addLogEntry(user.uid, {
          meal, type: 'quick_food', is_cook_event: false, recipe_id: null,
          name: result.name, servings_eaten: servings,
          nutrition: scaleMacros(result.nutrition, servings), source: result.source,
        })
      } else if (mode === 'recipes' && selectedRecipe && selectedRecipePer) {
        // leftover/eat-a-serving path: log only — plan & cooked state untouched
        await addLogEntry(user.uid, {
          meal, type: 'recipe', is_cook_event: false, recipe_id: selectedRecipe.id,
          name: selectedRecipe.title, servings_eaten: servings,
          nutrition: scaleMacros(selectedRecipePer, servings), source: 'recipe',
        })
      } else if (mode === 'manual' && manualPerServing) {
        await addLogEntry(user.uid, {
          meal, type: 'manual', is_cook_event: false, recipe_id: null,
          name: manualName.trim(), servings_eaten: servings,
          nutrition: scaleMacros(manualPerServing, servings), source: 'manual',
        })
      } else if (mode === 'scan' && scanHit) {
        // Same shape as a searched quick food; per_100g basis means the snapshot
        // is macros × servings where 1 serving = 100 g (the card says so).
        await addLogEntry(user.uid, {
          meal, type: 'quick_food', is_cook_event: false, recipe_id: null,
          name: scanHit.name, servings_eaten: servings,
          nutrition: scaleMacros(scanHit.nutrition, servings), source: scanHit.source,
        })
      }
      setLoggedOk(true)
      onLogged?.()
      setTimeout(onClose, 700)
    } catch {
      setSaveError("Couldn't save the entry — try again.")
      setSaving(false)
    }
  }

  const handleStar = async () => {
    if (!user || !result || starred) return
    try {
      await saveFavorite(user.uid, { name: result.name, nutrition: result.nutrition, source: result.source })
      setStarred(true)
      getSavedFoods(user.uid).then(setFavorites).catch(() => {})
    } catch { /* non-fatal */ }
  }

  const handleScanStar = async () => {
    if (!user || !scanHit || scanStarred) return
    try {
      await saveFavorite(user.uid, { name: scanHit.name, nutrition: scanHit.nutrition, source: scanHit.source })
      setScanStarred(true)
      getSavedFoods(user.uid).then(setFavorites).catch(() => {})
    } catch { /* non-fatal */ }
  }

  // history pick (chip or list row) → prefill the right confirm flow. Re-logging
  // uses the stored per-serving snapshot — deliberately NO USDA/OFF re-lookup.
  const prefill = (item: { name: string; nutrition: NutritionMacros; source: string; type?: string; recipe_id?: string | null }) => {
    setSaveError('')
    lookupSeq.current++          // a slow in-flight web lookup must not overwrite the pick
    setLookupLoading(false)
    setHistoryCollapsed(true)
    if (item.type === 'recipe' && item.recipe_id) {
      setMode('recipes')
      setSelectedRecipeId(item.recipe_id)
      setRecipeQuery('')
      return
    }
    if (item.source === 'manual') {
      setMode('manual')
      setManualName(item.name)
      setManualMacros({
        calories: String(item.nutrition.calories), protein_g: String(item.nutrition.protein_g),
        carbs_g: String(item.nutrition.carbs_g), fat_g: String(item.nutrition.fat_g),
        fiber_g: String(item.nutrition.fiber_g), sugar_g: String(item.nutrition.sugar_g),
      })
      return
    }
    skipNextLookup.current = true
    setMode('search')
    setQuery(item.name)
    // Barcode-scanned favorites keep their packaged-product source/badge.
    const src: FoodResult['source'] =
      item.source === 'ai_estimate' || item.source === 'openfoodfacts' || item.source === 'usda_branded'
        ? item.source : 'usda'
    setResult({
      name: item.name,
      nutrition: item.nutrition,
      source: src,
    })
    setLookupError('')
  }

  // Deduped re-log history: favorites first (keep the star), then recents whose
  // name isn't already starred. Backs both the quick-tap chips and the
  // searchable lists in Search/Scan.
  const history: HistoryEntry[] = useMemo(() => [
    ...favorites.map(f => ({ key: `fav-${f.id}`, fav: true, item: f })),
    ...recents
      .filter(r => !favorites.some(f => f.name.toLowerCase() === r.name.toLowerCase()))
      .map((r, i) => ({ key: `rec-${i}`, fav: false, item: r })),
  ], [favorites, recents])

  const quickRow = history.slice(0, 12)

  const historyMatches = useMemo(() => {   // search mode — filtered by the main query
    const q = query.trim().toLowerCase()
    if (!q) return []
    return history.filter(h => h.item.name.toLowerCase().includes(q)).slice(0, 6)
  }, [history, query])

  const scanHistoryMatches = useMemo(() => {   // scan mode — its own filter input
    const q = historyQuery.trim().toLowerCase()
    if (!q) return []
    return history.filter(h => h.item.name.toLowerCase().includes(q)).slice(0, 6)
  }, [history, historyQuery])

  return (
    <div className="fixed inset-0 z-[95]">
      <div className="absolute inset-0 bg-ink/80 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className="absolute bottom-0 left-0 right-0 max-w-2xl mx-auto bg-surface border border-border rounded-t-3xl max-h-[88vh] flex flex-col animate-fade-in">
        {/* header */}
        <div className="shrink-0 px-5 pt-4 pb-3 flex items-center justify-between border-b border-border">
          <h2 className="font-display text-2xl text-cream font-light">Log food</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 rounded-full flex items-center justify-center bg-card border border-border text-faint hover:text-cream transition-all"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* recents + favorites quick row — re-log contexts only (Search/Scan);
              Recipes and Manual have their own selection logic */}
          {(mode === 'search' || mode === 'scan') && historyLoaded && (
            <div className="mb-4">
              <p className="text-faint text-[10px] font-body uppercase tracking-widest mb-2">Recent & saved</p>
              {quickRow.length > 0 ? (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {quickRow.map(({ key, item, fav }) => (
                    <button
                      key={key}
                      onClick={() => prefill(item)}
                      className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-card border border-border text-muted text-xs font-body hover:text-cream hover:border-amber/30 transition-all"
                    >
                      {fav && <Star size={10} className="text-amber" fill="currentColor" />}
                      <span className="max-w-[140px] truncate">{item.name}</span>
                      <span className="text-faint">{Math.round(item.nutrition.calories)} cal</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-faint text-xs font-body">
                  Nothing logged yet — search or scan to add your first food.
                </p>
              )}
            </div>
          )}

          {/* mode pills — labels kept short so four tabs fit a phone width */}
          <div className="flex gap-1.5 mb-4">
            {([
              { m: 'search' as Mode, label: 'Search', icon: <Search size={13} /> },
              { m: 'recipes' as Mode, label: 'Recipes', icon: <ChefHat size={13} /> },
              { m: 'manual' as Mode, label: 'Manual', icon: <PencilLine size={13} /> },
              { m: 'scan' as Mode, label: 'Scan', icon: <ScanBarcode size={13} /> },
            ]).map(({ m, label, icon }) => (
              <button
                key={m}
                onClick={() => { setMode(m); setSaveError('') }}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-body font-medium transition-all ${
                  mode === m ? 'bg-amber text-ink' : 'bg-card border border-border text-muted hover:text-cream'
                }`}
              >
                {icon} {label}
              </button>
            ))}
          </div>

          {/* mode 1 — search */}
          {mode === 'search' && (
            <div>
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder='Try "Big Mac", "greek yogurt", "pad thai"…'
                className="input-field mb-3"
                autoFocus
              />
              {/* instant matches from the user's own log — no network */}
              {historyMatches.length > 0 && !historyCollapsed && (
                <div className="mb-3">
                  <p className="text-faint text-[10px] font-body uppercase tracking-widest mb-1.5">
                    From your history — tap to re-log
                  </p>
                  <HistoryList entries={historyMatches} onPick={prefill} />
                </div>
              )}
              {historyMatches.length > 0 && !historyCollapsed && (lookupLoading || lookupError || result) && (
                <p className="text-faint text-[10px] font-body uppercase tracking-widest mb-1.5">
                  Web lookup — new food
                </p>
              )}
              {lookupLoading && (
                <div className="flex items-center gap-2 text-faint text-sm font-body py-3">
                  <Loader2 size={14} className="animate-spin text-amber" /> Looking up…
                </div>
              )}
              {lookupError && !lookupLoading && (
                <p className="text-red-400 text-xs font-body py-2">{lookupError}</p>
              )}
              {result && !lookupLoading && (
                <div className="bg-card border border-border rounded-xl p-4 mb-1">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0">
                      <p className="text-cream text-sm font-body font-medium truncate">{result.name}</p>
                      <span className="inline-block mt-1 text-[10px] font-body px-2 py-0.5 rounded-md bg-amber/10 text-amber">
                        {sourceLabel(result.source)}{result.confidence ? ` · ${result.confidence}` : ''} · per serving
                      </span>
                    </div>
                    <button
                      onClick={handleStar}
                      aria-label="Save to favorites"
                      className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center border transition-all ${
                        starred ? 'bg-amber/15 border-amber/40 text-amber' : 'bg-surface border-border text-faint hover:text-amber'
                      }`}
                    >
                      <Star size={15} fill={starred ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                  <MacroGrid macros={result.nutrition} />
                </div>
              )}
            </div>
          )}

          {/* mode 2 — my recipes */}
          {mode === 'recipes' && (
            <div>
              <input
                type="text"
                value={recipeQuery}
                onChange={e => setRecipeQuery(e.target.value)}
                placeholder="Search your recipes…"
                className="input-field mb-3"
              />
              {recipesLoading ? (
                <div className="flex items-center gap-2 text-faint text-sm font-body py-3">
                  <Loader2 size={14} className="animate-spin text-amber" /> Loading recipes…
                </div>
              ) : filteredRecipes.length === 0 ? (
                <p className="text-faint text-sm font-body py-3">No recipes with nutrition data match.</p>
              ) : (
                <div className="max-h-44 overflow-y-auto rounded-xl border border-border divide-y divide-border mb-3">
                  {filteredRecipes.map(r => {
                    const per = perServingOf(r.nutrition)
                    const active = r.id === selectedRecipeId
                    return (
                      <button
                        key={r.id}
                        onClick={() => setSelectedRecipeId(r.id)}
                        className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors ${
                          active ? 'bg-amber/10' : 'bg-card hover:bg-surface'
                        }`}
                      >
                        <span className={`text-sm font-body truncate ${active ? 'text-amber' : 'text-cream'}`}>{r.title}</span>
                        <span className="text-faint text-xs font-body shrink-0">{per ? `${Math.round(per.calories)} cal` : ''}</span>
                      </button>
                    )
                  })}
                </div>
              )}
              {selectedRecipe && selectedRecipePer && (
                <div className="bg-card border border-border rounded-xl p-4">
                  <p className="text-cream text-sm font-body font-medium mb-1 truncate">{selectedRecipe.title}</p>
                  <span className="inline-block mb-3 text-[10px] font-body px-2 py-0.5 rounded-md bg-amber/10 text-amber">
                    recipe · per serving — logs as eaten, won&apos;t mark cooked
                  </span>
                  <MacroGrid macros={selectedRecipePer} />
                </div>
              )}
            </div>
          )}

          {/* mode 3 — manual */}
          {mode === 'manual' && (
            <div>
              <input
                type="text"
                value={manualName}
                onChange={e => setManualName(e.target.value)}
                placeholder="Food name"
                className="input-field mb-3"
                autoFocus
              />
              <div className="grid grid-cols-3 gap-2 mb-1">
                {NUTRIENTS.map(n => (
                  <label key={n.key} className="block">
                    <span className="text-faint text-[10px] font-body uppercase tracking-widest">
                      {n.label}{n.unit ? ` (${n.unit})` : ''}
                    </span>
                    <input
                      type="number"
                      min="0"
                      inputMode="decimal"
                      value={manualMacros[n.key]}
                      onChange={e => setManualMacros(prev => ({ ...prev, [n.key]: e.target.value }))}
                      placeholder={n.key === 'calories' ? 'required' : '0'}
                      className="input-field mt-1 text-sm"
                    />
                  </label>
                ))}
              </div>
              <p className="text-faint text-[11px] font-body">Values are per serving.</p>
            </div>
          )}

          {/* mode 4 — scan */}
          {mode === 'scan' && (
            <div>
              {/* Camera viewport stays mounted across statuses (the ref must be
                  live before startScanner resolves getUserMedia) — just hidden
                  once the feed is no longer the thing being shown. */}
              <div
                className={`relative rounded-xl overflow-hidden bg-ink border border-border aspect-[4/3] ${
                  scanStatus === 'idle' || scanStatus === 'starting' || scanStatus === 'scanning' ? '' : 'hidden'
                }`}
              >
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  aria-label="Camera preview for barcode scanning"
                  className="absolute inset-0 w-full h-full object-cover"
                />
                {/* scan-target frame; the giant shadow dims everything outside it */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-[72%] max-w-[260px] aspect-[1.7] rounded-xl border-2 border-amber/90 shadow-[0_0_0_999px_rgba(10,10,10,0.45)]" />
                </div>
                <p className="absolute bottom-2.5 inset-x-0 text-center text-cream/90 text-xs font-body drop-shadow">
                  {scanStatus === 'scanning' ? 'Point the camera at the barcode' : 'Starting camera…'}
                </p>
              </div>

              {scanStatus === 'looking_up' && (
                <div className="flex items-center justify-center gap-2 text-faint text-sm font-body py-8">
                  <Loader2 size={14} className="animate-spin text-amber" /> Looking up {scanCode}…
                </div>
              )}

              {scanStatus === 'hit' && scanHit && (
                <div>
                  <div className="bg-card border border-border rounded-xl p-4">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="min-w-0">
                        <p className="text-cream text-sm font-body font-medium truncate">{scanHit.name}</p>
                        <span className="inline-block mt-1 text-[10px] font-body px-2 py-0.5 rounded-md bg-amber/10 text-amber">
                          {sourceLabel(scanHit.source)} · {scanHit.confidence} ·{' '}
                          {scanHit.basis === 'per_serving' ? 'per serving' : 'per 100 g'}
                          {scanHit.serving_size ? ` · serving: ${scanHit.serving_size}` : ''}
                        </span>
                      </div>
                      <button
                        onClick={handleScanStar}
                        aria-label="Save to favorites"
                        className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center border transition-all ${
                          scanStarred ? 'bg-amber/15 border-amber/40 text-amber' : 'bg-surface border-border text-faint hover:text-amber'
                        }`}
                      >
                        <Star size={15} fill={scanStarred ? 'currentColor' : 'none'} />
                      </button>
                    </div>
                    <MacroGrid macros={scanHit.nutrition} />
                    {scanHit.basis === 'per_100g' && (
                      <p className="text-amber/80 text-[11px] font-body mt-3">
                        ⚠ Values are per 100 g, not per serving — 1 serving below logs 100 g of product.
                      </p>
                    )}
                  </div>
                  <button
                    onClick={handleRescan}
                    className="mt-2 flex items-center gap-1.5 text-faint text-xs font-body hover:text-cream transition-colors"
                  >
                    <ScanBarcode size={12} /> Scan another item
                  </button>
                </div>
              )}

              {scanStatus === 'miss' && (
                <div className="bg-card border border-border rounded-xl p-5 text-center">
                  <SearchX size={22} className="mx-auto text-faint mb-2" />
                  <p className="text-cream text-sm font-body font-medium mb-1">Product not found</p>
                  <p className="text-faint text-xs font-body mb-4">
                    No match for {scanCode || 'that barcode'} — spirits and small store brands often
                    aren&apos;t in the databases. Try searching by name instead.
                  </p>
                  <div className="flex items-center justify-center gap-2">
                    <button onClick={switchToSearch} className="btn-primary text-xs flex items-center gap-1.5">
                      <Search size={13} /> Search by name
                    </button>
                    <button onClick={handleRescan} className="btn-ghost text-xs flex items-center gap-1.5">
                      <ScanBarcode size={13} /> Scan again
                    </button>
                  </div>
                </div>
              )}

              {scanStatus === 'denied' && (
                <div className="bg-card border border-border rounded-xl p-5 text-center">
                  <CameraOff size={22} className="mx-auto text-faint mb-2" />
                  <p className="text-cream text-sm font-body font-medium mb-1">
                    {scanMessage || 'Camera access needed to scan.'}
                  </p>
                  <p className="text-faint text-xs font-body mb-4">
                    Enable it in your browser settings, type the barcode digits below, or use Search instead.
                  </p>
                  <div className="flex items-center justify-center gap-2">
                    <button onClick={switchToSearch} className="btn-primary text-xs flex items-center gap-1.5">
                      <Search size={13} /> Use Search
                    </button>
                    <button onClick={handleRescan} className="btn-ghost text-xs flex items-center gap-1.5">
                      Try again
                    </button>
                  </div>
                </div>
              )}

              {scanStatus === 'error' && (
                <div className="bg-card border border-border rounded-xl p-5 text-center">
                  <p className="text-red-400 text-sm font-body mb-4">{scanMessage || 'Something went wrong.'}</p>
                  <div className="flex items-center justify-center gap-2">
                    <button onClick={handleRescan} className="btn-primary text-xs flex items-center gap-1.5">
                      <ScanBarcode size={13} /> Scan again
                    </button>
                    <button onClick={switchToSearch} className="btn-ghost text-xs flex items-center gap-1.5">
                      <Search size={13} /> Use Search
                    </button>
                  </div>
                </div>
              )}

              {/* typed-barcode fallback — always available, same lookup path as the camera */}
              <div className="mt-4">
                <p className="text-faint text-[10px] font-body uppercase tracking-widest mb-2">
                  Or type the barcode digits
                </p>
                <div className="flex gap-2">
                  <input
                    ref={manualInputRef}
                    type="text"
                    value={manualCode}
                    onChange={e => { setManualCode(e.target.value); setManualCodeError('') }}
                    onKeyDown={e => { if (e.key === 'Enter') submitManualCode() }}
                    inputMode="numeric"
                    placeholder="e.g. 049000006346"
                    className="input-field flex-1 text-sm"
                    disabled={scanStatus === 'looking_up'}
                  />
                  <button
                    onClick={submitManualCode}
                    disabled={scanStatus === 'looking_up' || !manualCode.trim()}
                    className="btn-primary text-xs shrink-0 disabled:opacity-40"
                  >
                    Look up
                  </button>
                </div>
                {manualCodeError && (
                  <p className="text-amber/80 text-[11px] font-body mt-1.5">{manualCodeError}</p>
                )}
              </div>

              {/* re-log from history without scanning anything */}
              {historyLoaded && history.length > 0 && (
                <div className="mt-4">
                  <p className="text-faint text-[10px] font-body uppercase tracking-widest mb-2">
                    Or re-log from your history
                  </p>
                  <input
                    type="text"
                    value={historyQuery}
                    onChange={e => setHistoryQuery(e.target.value)}
                    placeholder="Search foods you've logged…"
                    className="input-field text-sm"
                  />
                  {historyQuery.trim() && (
                    <div className="mt-2">
                      {scanHistoryMatches.length > 0 ? (
                        <HistoryList entries={scanHistoryMatches} onPick={prefill} />
                      ) : (
                        <p className="text-faint text-xs font-body">No matches in your history.</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* shared: servings + meal — in scan mode only once there's a product to log */}
          {(mode !== 'scan' || (scanStatus === 'hit' && !!scanHit)) && (
          <div className="mt-4 flex flex-wrap items-end gap-4">
            <label className="block">
              <span className="text-faint text-[10px] font-body uppercase tracking-widest">Servings</span>
              <input
                type="number"
                min="0.25"
                step="0.25"
                inputMode="decimal"
                value={servingsInput}
                onChange={e => setServingsInput(e.target.value)}
                className="input-field mt-1 w-24 text-sm"
              />
            </label>
            <div>
              <span className="text-faint text-[10px] font-body uppercase tracking-widest">Meal</span>
              <div className="flex gap-1.5 mt-1">
                {MEALS.map(m => (
                  <button
                    key={m}
                    onClick={() => setMeal(m)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-body capitalize transition-all ${
                      meal === m ? 'bg-amber text-ink' : 'bg-card border border-border text-muted hover:text-cream'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          </div>
          )}
        </div>

        {/* footer */}
        <div className="shrink-0 px-5 py-4 border-t border-border">
          {saveError && <p className="text-red-400 text-xs font-body mb-2">{saveError}</p>}
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-40"
          >
            {loggedOk ? (<><Check size={16} /> Logged!</>) :
              saving ? (<><Loader2 size={16} className="animate-spin" /> Saving…</>) :
              'Log it'}
          </button>
        </div>
      </div>
    </div>
  )
}
