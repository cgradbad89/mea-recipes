'use client'

// Log-food entry sheet (Surface 3): five modes — a saved/recents list / USDA
// search / my recipes / manual macros / barcode scan. Writes
// consumption_log entries with is_cook_event: false. NEVER touches the plan or
// cooked status (cooked capture is Cooking Mode / the plan checkmark — see
// lib/consumptionLog logCookEvent). Mounted from the Nutrition page header
// ("＋ Log food").
//
// Scan mode decodes EAN/UPC product barcodes from the camera: the native
// BarcodeDetector API where the browser has it (Chromium, newer Safari),
// otherwise a lazy-loaded @zxing/browser reader (older iOS Safari, Firefox).
// Both engines decode the SAME cropped region — the scan-target overlay box —
// from a single owned loop (see computeRoi), at 1080p-ideal capture. Optional
// camera capabilities (zoom, torch, tap-to-focus) are feature-detected per
// track; unsupported ones simply don't render (iOS Safari often has none).
// A read stops the camera and resolves via lookupBarcode (/api/barcode-lookup).

import { useState, useEffect, useRef, useMemo } from 'react'
import {
  X, Search, Star, Bookmark, Loader2, Check, ChefHat, PencilLine, ScanBarcode, CameraOff, SearchX,
  Flashlight, ZoomIn, ZoomOut,
} from 'lucide-react'
import { useAuth } from '@/lib/AuthContext'
import {
  addLogEntry, saveFavorite, getSavedFoods, getRecents, autoMealForTime, scaleMacros,
} from '@/lib/consumptionLog'
import { useAppData } from '@/components/AppDataProvider'
import {
  perServingOf, sourceLabel, NUTRIENTS, formatNutrient, lookupBarcode,
  prettyAmount, gramsFromServingLabel, servingContextLines, type ServingContext,
} from '@/lib/nutrition'
import type { Recipe, NutritionMacros } from '@/types/recipe'
import type { Meal, SavedFood, RecentFood, BarcodeProduct, LogSource } from '@/types/nutrition'

type Mode = 'saved' | 'search' | 'recipes' | 'manual' | 'scan'

interface FoodResult {
  name: string
  nutrition: NutritionMacros          // per serving (or per 100 g when servingGrams is null and source is usda)
  source: Exclude<LogSource, 'recipe' | 'manual'>
  confidence?: string
  // number → 1 serving = N g (grams toggle); null → fresh lookup had no portion
  // data (usda ⇒ per-100g basis); undefined → re-logged from history (per-serving).
  servingGrams?: number | null
}

// How the amount entry should behave for the currently-selected item.
type AmountKind = 'servings' | 'servings_or_grams' | 'grams_only'
interface AmountModel {
  kind: AmountKind
  perBasis: NutritionMacros | null    // the nutrition to scale (per serving, or per 100 g for grams_only)
  gramsPerServing?: number            // present for servings_or_grams
  basisLabel: 'per serving' | 'per 100 g'
  ctx: ServingContext                 // serving size / container / per-100g display lines
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

interface ZoomRange { min: number; max: number; step: number }

/**
 * object-cover geometry — how the source frame maps onto the displayed video
 * box. Shared by the ROI crop and tap-to-focus coordinate mapping.
 */
function coverGeometry(video: HTMLVideoElement) {
  const vw = video.videoWidth, vh = video.videoHeight
  const rect = video.getBoundingClientRect()
  if (!vw || !vh || rect.width === 0 || rect.height === 0) return null
  const scale = Math.max(rect.width / vw, rect.height / vh)
  return {
    vw, vh, rect, scale,
    offX: (vw * scale - rect.width) / 2,   // display px cropped off the left/top by cover
    offY: (vh * scale - rect.height) / 2,
  }
}

/**
 * Map the scan-target overlay (plus a small catch margin) into source-frame
 * pixels, so the decoder sees exactly the region the user framed. Returns null
 * when geometry isn't measurable yet (pre-metadata / hidden) — the caller then
 * decodes the full frame, so ROI failure can never make scanning worse.
 */
function computeRoi(video: HTMLVideoElement, overlay: HTMLElement) {
  const g = coverGeometry(video)
  if (!g) return null
  const o = overlay.getBoundingClientRect()
  if (o.width === 0 || o.height === 0) return null
  const mx = o.width * 0.15, my = o.height * 0.15
  let sx = (o.left - g.rect.left - mx + g.offX) / g.scale
  let sy = (o.top - g.rect.top - my + g.offY) / g.scale
  let sw = (o.width + 2 * mx) / g.scale
  let sh = (o.height + 2 * my) / g.scale
  sx = Math.max(0, Math.min(sx, g.vw - 2))
  sy = Math.max(0, Math.min(sy, g.vh - 2))
  sw = Math.min(sw, g.vw - sx)
  sh = Math.min(sh, g.vh - sy)
  if (sw < 48 || sh < 32) return null
  return { sx, sy, sw, sh }
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

// Serving size / servings-per-container / per-100g lines under a result card.
// Renders nothing when no context exists (missing data omits cleanly).
function ServingLines({ ctx }: { ctx: ServingContext }) {
  const lines = servingContextLines(ctx)
  if (!lines.length) return null
  return (
    <div className="mt-3 space-y-0.5">
      {lines.map((l, i) => (
        <p key={i} className="text-faint text-[11px] font-body">{l}</p>
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
  const [mode, setMode] = useState<Mode>('saved')

  // shared entry fields — servings is the canonical multiplier; grams is an
  // alternate way to enter it when the item has a gram-based serving size.
  const [servingsInput, setServingsInput] = useState('1')
  const [gramsInput, setGramsInput] = useState('')
  const [amountUnit, setAmountUnit] = useState<'servings' | 'grams'>('servings')
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
  const skipNextLookup = useRef(false)
  const lookupSeq = useRef(0)

  // mode 2 — my recipes
  const { recipes: allRecipes, recipesLoading } = useAppData()
  const recipes = useMemo(() => allRecipes.filter(r => perServingOf(r.nutrition)), [allRecipes])
  const [recipeQuery, setRecipeQuery] = useState('')
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null)

  // mode 3 — manual
  const [manualName, setManualName] = useState('')
  const [manualServingSize, setManualServingSize] = useState('')   // optional label, e.g. "1 cup"
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
  const manualInputRef = useRef<HTMLInputElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const trackRef = useRef<MediaStreamTrack | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)   // scan-target box — IS the decode region
  const scanLoopRef = useRef<number | null>(null)      // decode interval id (both engines)
  const scanGen = useRef(0)                            // invalidates in-flight camera/decode async work
  const flashTimerRef = useRef<number | null>(null)    // decode-confirmation flash → lookup handoff

  // optional camera capabilities — feature-detected per track in
  // initTrackCapabilities; a missing capability means its control never renders
  const [scanFlash, setScanFlash] = useState(false)    // brief green "got it" before lookup
  const [zoomCaps, setZoomCaps] = useState<ZoomRange | null>(null)
  const [zoomVal, setZoomVal] = useState(1)
  const [torchSupported, setTorchSupported] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [canTapFocus, setCanTapFocus] = useState(false)
  const [tapPoint, setTapPoint] = useState<{ x: number; y: number } | null>(null)   // focus ring, % of box
  const focusCapsRef = useRef({ poi: false, single: false, continuous: false })
  const pinchPointers = useRef(new Map<number, { x: number; y: number; sx: number; sy: number; t: number }>())
  const pinchStart = useRef<{ dist: number; zoom: number } | null>(null)
  const lastZoomApply = useRef(0)                      // throttle applyConstraints during pinch
  const lastZoomReq = useRef(1)                        // latest requested zoom (state can lag a render)

  // Saved tab — re-log history: recents + favorites, merged & deduped (see `history`)
  const [recents, setRecents] = useState<RecentFood[]>([])
  const [favorites, setFavorites] = useState<SavedFood[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)   // gate so the empty state doesn't flash
  const [savedQuery, setSavedQuery] = useState('')            // Saved-tab filter over the merged history

  useEffect(() => {
    if (!user) return
    Promise.allSettled([
      getRecents(user.uid, 30).then(setRecents),
      getSavedFoods(user.uid).then(setFavorites),
    ]).then(() => setHistoryLoaded(true))
  }, [user])



  // debounced USDA lookup (mode 1)
  useEffect(() => {
    if (mode !== 'search' || !user) return
    if (skipNextLookup.current) { skipNextLookup.current = false; return }
    const q = query.trim()
    setResult(null); setLookupError(''); setStarred(false)
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
          servingGrams: typeof data.servingGrams === 'number' ? data.servingGrams : null,
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

  // Releases the decode loop + camera hardware: torch off (belt-and-braces —
  // stopping the track kills it too, but the light must never outlive the
  // mode), every track stopped, srcObject kept unless `keepFrame`, which the
  // decode-confirmation flash uses to hold the last frame on screen.
  const releaseCamera = (keepFrame = false) => {
    scanGen.current++
    if (scanLoopRef.current !== null) {
      window.clearInterval(scanLoopRef.current)
      scanLoopRef.current = null
    }
    if (flashTimerRef.current !== null) {
      window.clearTimeout(flashTimerRef.current)
      flashTimerRef.current = null
    }
    try { (trackRef.current as any)?.applyConstraints?.({ advanced: [{ torch: false }] })?.catch?.(() => {}) } catch { /* stopping anyway */ }
    trackRef.current = null
    pinchPointers.current.clear()
    pinchStart.current = null
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (!keepFrame && videoRef.current) videoRef.current.srcObject = null
  }

  // Idempotent full teardown — effect cleanup, mode switches, typed-code path.
  const stopCamera = () => releaseCamera(false)

  // Lookup half — shared by camera reads (after the confirmation flash) and
  // the typed-barcode fallback.
  const runBarcodeLookup = async (code: string) => {
    if (videoRef.current) videoRef.current.srcObject = null   // drop the frozen flash frame
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

  // Typed-barcode path — no camera necessarily involved; straight to lookup.
  const onBarcodeDetected = (code: string) => {
    stopCamera()
    runBarcodeLookup(code)
  }

  // Camera-read path: hardware off the moment we have a read (unchanged
  // behaviour), but the last frame stays frozen on screen behind a brief green
  // confirmation before the lookup fires.
  const handleDecodeSuccess = (code: string) => {
    releaseCamera(true)
    setScanCode(code)
    setScanFlash(true)
    const gen = scanGen.current
    flashTimerRef.current = window.setTimeout(() => {
      flashTimerRef.current = null
      if (gen !== scanGen.current) return   // torn down mid-flash
      setScanFlash(false)
      runBarcodeLookup(code)
    }, 450)
  }

  // ── optional camera capabilities (zoom / torch / focus) ──────────────────
  // Everything below is feature-detected per track: absent capability → hidden
  // control, baseline scanning untouched. iOS Safari commonly reports none of
  // these; some Androids populate them only a beat after the track starts
  // (hence the delayed re-probe in startScanner).

  const initTrackCapabilities = (track: MediaStreamTrack) => {
    let caps: any = {}
    try { caps = typeof track.getCapabilities === 'function' ? track.getCapabilities() : {} } catch { caps = {} }

    const z = caps.zoom
    if (z && typeof z.min === 'number' && typeof z.max === 'number' && z.max > z.min) {
      let current = z.min
      try {
        const s: any = track.getSettings()
        if (typeof s.zoom === 'number') current = s.zoom
      } catch { /* keep min */ }
      setZoomCaps({ min: z.min, max: z.max, step: typeof z.step === 'number' && z.step > 0 ? z.step : (z.max - z.min) / 20 })
      setZoomVal(current)
      lastZoomReq.current = current
    }

    if (caps.torch === true) setTorchSupported(true)

    const modes: string[] = Array.isArray(caps.focusMode) ? caps.focusMode : []
    focusCapsRef.current = {
      poi: 'pointsOfInterest' in caps,
      single: modes.includes('single-shot'),
      continuous: modes.includes('continuous'),
    }
    if (focusCapsRef.current.continuous) {
      // keep refocusing as the phone moves between box sizes/distances
      try { track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] } as any).catch(() => {}) } catch { /* ignored */ }
    }
    setCanTapFocus(focusCapsRef.current.poi || focusCapsRef.current.single)
  }

  const applyZoom = (v: number, force = false) => {
    const track = trackRef.current as any
    if (!track || !zoomCaps) return
    const clamped = Math.min(zoomCaps.max, Math.max(zoomCaps.min, v))
    setZoomVal(clamped)
    lastZoomReq.current = clamped
    const now = performance.now()
    if (!force && now - lastZoomApply.current < 90) return   // pinch streams events — don't spam the driver
    lastZoomApply.current = now
    try { track.applyConstraints({ advanced: [{ zoom: clamped }] }).catch(() => {}) } catch { /* capability lied — ignore */ }
  }

  const toggleTorch = () => {
    const track = trackRef.current as any
    if (!track || !torchSupported) return
    const next = !torchOn
    setTorchOn(next)
    try {
      track.applyConstraints({ advanced: [{ torch: next }] }).catch(() => setTorchOn(!next))
    } catch { setTorchOn(!next) }
  }

  const focusAt = (clientX: number, clientY: number) => {
    const video = videoRef.current
    const track = trackRef.current as any
    if (!video || !track || !canTapFocus) return
    const g = coverGeometry(video)
    if (!g) return
    setTapPoint({ x: ((clientX - g.rect.left) / g.rect.width) * 100, y: ((clientY - g.rect.top) / g.rect.height) * 100 })
    window.setTimeout(() => setTapPoint(null), 700)
    const advanced: any[] = []
    if (focusCapsRef.current.poi) {
      // tap → normalized frame coords (inverse of the object-cover crop)
      const fx = Math.min(1, Math.max(0, (clientX - g.rect.left + g.offX) / g.scale / g.vw))
      const fy = Math.min(1, Math.max(0, (clientY - g.rect.top + g.offY) / g.scale / g.vh))
      advanced.push({ pointsOfInterest: [{ x: fx, y: fy }] })
    }
    if (focusCapsRef.current.single) advanced.push({ focusMode: 'single-shot' })
    if (advanced.length === 0) return
    try { track.applyConstraints({ advanced }).catch(() => {}) } catch { /* degrade silently */ }
    if (focusCapsRef.current.single && focusCapsRef.current.continuous) {
      // settle back so the next reposition refocuses on its own
      const gen = scanGen.current
      window.setTimeout(() => {
        if (gen !== scanGen.current) return
        try { (trackRef.current as any)?.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {}) } catch { /* fine */ }
      }, 2500)
    }
  }

  // One pointer = tap-to-focus candidate; two pointers = pinch zoom.
  const onScanPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (scanStatus !== 'scanning' || scanFlash) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    pinchPointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() })
    if (pinchPointers.current.size === 2 && zoomCaps) {
      const [a, b] = [...pinchPointers.current.values()]
      pinchStart.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: lastZoomReq.current }
    }
  }

  const onScanPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = pinchPointers.current.get(e.pointerId)
    if (!p) return
    p.x = e.clientX; p.y = e.clientY
    if (pinchPointers.current.size === 2 && pinchStart.current && pinchStart.current.dist > 0 && zoomCaps) {
      const [a, b] = [...pinchPointers.current.values()]
      applyZoom(pinchStart.current.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinchStart.current.dist))
    }
  }

  const onScanPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = pinchPointers.current.get(e.pointerId)
    pinchPointers.current.delete(e.pointerId)
    if (pinchPointers.current.size >= 2) return
    if (pinchStart.current) {
      pinchStart.current = null
      applyZoom(lastZoomReq.current, true)   // trailing apply so the final pinch value sticks
    } else if (p && performance.now() - p.t < 500 && Math.hypot(p.x - p.sx, p.y - p.sy) < 8) {
      focusAt(e.clientX, e.clientY)          // a clean tap, not a drag or pinch remnant
    }
  }

  const startScanner = async () => {
    const gen = ++scanGen.current
    setScanHit(null); setScanCode(''); setScanMessage(''); setScanStarred(false)
    setScanFlash(false); setZoomCaps(null); setTorchSupported(false); setTorchOn(false)
    setCanTapFocus(false); setTapPoint(null)
    focusCapsRef.current = { poi: false, single: false, continuous: false }
    pinchPointers.current.clear()
    pinchStart.current = null
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
        video: {
          facingMode: { ideal: 'environment' },   // rear camera on phones
          // more pixels = small/distant barcodes still resolve; `ideal` lets
          // the device serve whatever it can — never an OverconstrainedError
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
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

    // probe zoom/torch/focus — plus one delayed re-probe, since some Androids
    // report capabilities only shortly after the track is live
    const track = stream.getVideoTracks()[0] ?? null
    trackRef.current = track
    if (track) {
      initTrackCapabilities(track)
      window.setTimeout(() => {
        if (gen === scanGen.current && trackRef.current) initTrackCapabilities(trackRef.current)
      }, 700)
    }

    const picked = await pickScanEngine()
    if (gen !== scanGen.current) return

    // Per-frame decoder for whichever engine this browser has. Both consume a
    // canvas, so ONE loop below crops to the scan-target box (ROI) for both.
    let decodeFrame: (canvas: HTMLCanvasElement) => Promise<string | null>
    if (picked.engine === 'native') {
      const detector = new (window as any).BarcodeDetector({ formats: picked.formats })
      decodeFrame = async canvas => {
        const codes = await detector.detect(canvas)
        const raw = codes?.[0]?.rawValue
        return raw ? String(raw) : null
      }
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
        hints.set(zx.DecodeHintType.TRY_HARDER, true)   // ROI is small — spend the cycles
        const reader = new BrowserMultiFormatReader(hints)
        decodeFrame = async canvas => {
          try { return reader.decodeFromCanvas(canvas)?.getText() ?? null }
          catch { return null }   // NotFoundException — no code in this frame
        }
      } catch {
        if (gen !== scanGen.current) return
        stopCamera()
        setScanMessage('The barcode scanner failed to start.')
        setScanStatus('error')
        return
      }
    }

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) {
      stopCamera()
      setScanMessage('The barcode scanner failed to start.')
      setScanStatus('error')
      return
    }
    let busy = false   // detect() can outlast a tick — never overlap frames
    scanLoopRef.current = window.setInterval(async () => {
      if (busy || gen !== scanGen.current) return
      const v = videoRef.current
      if (!v || v.readyState < 2 || !v.videoWidth) return
      // crop to the overlay box; full frame if geometry isn't measurable yet
      const roi = overlayRef.current ? computeRoi(v, overlayRef.current) : null
      const sx = roi ? roi.sx : 0
      const sy = roi ? roi.sy : 0
      const sw = roi ? roi.sw : v.videoWidth
      const sh = roi ? roi.sh : v.videoHeight
      canvas.width = Math.round(sw)
      canvas.height = Math.round(sh)
      busy = true
      try {
        ctx.drawImage(v, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
        const code = await decodeFrame(canvas)
        if (code && gen === scanGen.current) handleDecodeSuccess(code)
      } catch { /* per-frame decode errors are normal — keep scanning */ }
      finally { busy = false }
    }, 200)
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

  // ── Adaptive amount entry — degrade per the data each item carries ─────────
  // Normalize the selected item (any mode) into how its amount should be entered
  // and what nutrition basis to scale. Keeps handleConfirm uniform across modes.
  const amountModel: AmountModel = useMemo(() => {
    if (mode === 'recipes' && selectedRecipe && selectedRecipePer) {
      const n = selectedRecipe.nutrition
      return {
        kind: 'servings', perBasis: selectedRecipePer, basisLabel: 'per serving',
        ctx: { servingsPerContainer: typeof n?.servings === 'number' ? n.servings : null, containerKind: 'recipe' },
      }
    }
    if (mode === 'manual') {
      return {
        kind: 'servings', perBasis: manualPerServing, basisLabel: 'per serving',
        ctx: { servingLabel: manualServingSize.trim() || null },
      }
    }
    if (mode === 'search' && result) {
      const g = result.servingGrams
      if (typeof g === 'number' && g > 0) {
        return { kind: 'servings_or_grams', perBasis: result.nutrition, gramsPerServing: g, basisLabel: 'per serving', ctx: { gramsPerServing: g } }
      }
      // null (explicit) from a fresh USDA lookup = per-100g basis; undefined (a
      // re-logged favorite) or an AI estimate stays a per-serving snapshot.
      if (g === null && result.source === 'usda') {
        return { kind: 'grams_only', perBasis: result.nutrition, basisLabel: 'per 100 g', ctx: { per100g: true } }
      }
      return { kind: 'servings', perBasis: result.nutrition, basisLabel: 'per serving', ctx: {} }
    }
    if (mode === 'scan' && scanHit) {
      const g = scanHit.serving_grams ?? gramsFromServingLabel(scanHit.serving_size)
      const ctx: ServingContext = {
        servingLabel: scanHit.serving_size, gramsPerServing: g,
        servingsPerContainer: scanHit.servings_per_container ?? null, containerKind: 'container',
      }
      if (scanHit.basis === 'per_100g') {
        return { kind: 'grams_only', perBasis: scanHit.nutrition, basisLabel: 'per 100 g', ctx: { ...ctx, per100g: true } }
      }
      if (typeof g === 'number' && g > 0) {
        return { kind: 'servings_or_grams', perBasis: scanHit.nutrition, gramsPerServing: g, basisLabel: 'per serving', ctx }
      }
      return { kind: 'servings', perBasis: scanHit.nutrition, basisLabel: 'per serving', ctx }
    }
    return { kind: 'servings', perBasis: null, basisLabel: 'per serving', ctx: {} }
  }, [mode, result, selectedRecipe, selectedRecipePer, manualPerServing, manualServingSize, scanHit])

  // Grams is the live input when the model is grams-only, or when the toggle is
  // on grams for a gram-capable serving.
  const gramsActive = amountModel.kind === 'grams_only' || (amountModel.kind === 'servings_or_grams' && amountUnit === 'grams')

  // The multiplier applied to perBasis, the human label stored on the entry, and
  // the equivalent shown under the input. Never produces NaN macros.
  const amount = useMemo(() => {
    const G = amountModel.gramsPerServing
    if (gramsActive) {
      const g = parseFloat(gramsInput)
      const valid = Number.isFinite(g) && g > 0
      if (amountModel.kind === 'grams_only') {
        // per-100g: scale by grams/100; show the servings equivalent when we know
        // the declared serving size, otherwise just the grams.
        const sg = amountModel.ctx.gramsPerServing
        const s = valid && sg && sg > 0 ? g / sg : 0
        return { valid, multiplier: valid ? g / 100 : 0, label: valid ? `${prettyAmount(g)} g` : '',
          equiv: s ? `≈ ${prettyAmount(Math.round(s * 100) / 100)} ${s === 1 ? 'serving' : 'servings'}` : '' }
      }
      const s = valid && G ? g / G : 0
      return { valid: valid && !!G, multiplier: s, label: valid ? `${prettyAmount(g)} g` : '',
        equiv: valid && G ? `≈ ${prettyAmount(Math.round(s * 100) / 100)} ${s === 1 ? 'serving' : 'servings'}` : '' }
    }
    const s = parseFloat(servingsInput)
    const valid = Number.isFinite(s) && s > 0
    return { valid, multiplier: valid ? s : 0, label: valid ? `${prettyAmount(s)} ${s === 1 ? 'serving' : 'servings'}` : '',
      equiv: valid && amountModel.kind === 'servings_or_grams' && G ? `≈ ${prettyAmount(Math.round(s * G))} g` : '' }
  }, [amountModel, gramsActive, amountUnit, servingsInput, gramsInput])

  // Reset the amount inputs whenever the selected item changes — and seed grams
  // with one serving's worth (or 100 g for per-100g items) so grams entry starts sane.
  const itemKey = useMemo(() => {
    if (mode === 'search') return `s:${result?.name ?? ''}:${result?.servingGrams ?? 'u'}`
    if (mode === 'recipes') return `r:${selectedRecipeId ?? ''}`
    if (mode === 'manual') return 'm'
    if (mode === 'scan') return `b:${scanHit?.name ?? ''}`
    return ''
  }, [mode, result, selectedRecipeId, scanHit])

  useEffect(() => {
    setAmountUnit('servings')
    setServingsInput('1')
    const G = amountModel.gramsPerServing ?? amountModel.ctx.gramsPerServing ?? null
    setGramsInput(
      amountModel.kind === 'grams_only' ? String(Math.round(G ?? 100))
      : G ? String(Math.round(G)) : '',
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemKey])

  const canConfirm = amount.valid && !!amountModel.perBasis && !saving && (
    (mode === 'search' && !!result) ||
    (mode === 'recipes' && !!selectedRecipe && !!selectedRecipePer) ||
    (mode === 'manual' && manualName.trim().length > 0 && !!manualPerServing) ||
    (mode === 'scan' && scanStatus === 'hit' && !!scanHit)
  )

  const handleConfirm = async () => {
    if (!user || !canConfirm) return
    setSaving(true)
    setSaveError('')
    // The multiplier scales whatever basis the item carries (per serving, or per
    // 100 g for grams-only items); amount.label records what the user entered.
    const mult = amount.multiplier
    try {
      if (mode === 'search' && result) {
        await addLogEntry(user.uid, {
          meal, type: 'quick_food', is_cook_event: false, recipe_id: null,
          name: result.name, servings_eaten: mult, amount_label: amount.label,
          nutrition: scaleMacros(result.nutrition, mult), source: result.source,
        })
      } else if (mode === 'recipes' && selectedRecipe && selectedRecipePer) {
        // leftover/eat-a-serving path: log only — plan & cooked state untouched
        await addLogEntry(user.uid, {
          meal, type: 'recipe', is_cook_event: false, recipe_id: selectedRecipe.id,
          name: selectedRecipe.title, servings_eaten: mult, amount_label: amount.label,
          nutrition: scaleMacros(selectedRecipePer, mult), source: 'recipe',
        })
      } else if (mode === 'manual' && manualPerServing) {
        await addLogEntry(user.uid, {
          meal, type: 'manual', is_cook_event: false, recipe_id: null,
          name: manualName.trim(), servings_eaten: mult, amount_label: amount.label,
          nutrition: scaleMacros(manualPerServing, mult), source: 'manual',
        })
      } else if (mode === 'scan' && scanHit) {
        // per_100g items scale by grams/100 (grams-only entry); per_serving by the
        // servings (or grams ÷ serving grams) multiplier — both land here as `mult`.
        await addLogEntry(user.uid, {
          meal, type: 'quick_food', is_cook_event: false, recipe_id: null,
          name: scanHit.name, servings_eaten: mult, amount_label: amount.label,
          nutrition: scaleMacros(scanHit.nutrition, mult), source: scanHit.source,
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
    if (item.type === 'recipe' && item.recipe_id) {
      setMode('recipes')
      setSelectedRecipeId(item.recipe_id)
      setRecipeQuery('')
      return
    }
    if (item.source === 'manual') {
      setMode('manual')
      setManualName(item.name)
      setManualServingSize('')
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
  // name isn't already starred. Backs the Saved tab's single searchable list.
  const history: HistoryEntry[] = useMemo(() => [
    ...favorites.map(f => ({ key: `fav-${f.id}`, fav: true, item: f })),
    ...recents
      .filter(r => !favorites.some(f => f.name.toLowerCase() === r.name.toLowerCase()))
      .map((r, i) => ({ key: `rec-${i}`, fav: false, item: r })),
  ], [favorites, recents])

  // Saved tab — the full merged list filtered by its own input. Empty query =
  // the whole history (favorites first, then most-recent); no cap, it scrolls.
  const savedMatches = useMemo(() => {
    const q = savedQuery.trim().toLowerCase()
    if (!q) return history
    return history.filter(h => h.item.name.toLowerCase().includes(q))
  }, [history, savedQuery])

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/80 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-surface border border-border rounded-3xl max-h-[88vh] flex flex-col overflow-hidden animate-fade-in">
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
          {/* mode pills — five tabs; the icon stacked over a small label keeps
              every column tappable and the labels legible on a narrow phone */}
          <div className="flex gap-1 mb-4">
            {([
              { m: 'saved' as Mode, label: 'Saved', icon: <Bookmark size={15} /> },
              { m: 'search' as Mode, label: 'Search', icon: <Search size={15} /> },
              { m: 'recipes' as Mode, label: 'Recipes', icon: <ChefHat size={15} /> },
              { m: 'manual' as Mode, label: 'Manual', icon: <PencilLine size={15} /> },
              { m: 'scan' as Mode, label: 'Scan', icon: <ScanBarcode size={15} /> },
            ]).map(({ m, label, icon }) => (
              <button
                key={m}
                onClick={() => { setMode(m); setSaveError('') }}
                className={`flex-1 flex flex-col items-center justify-center gap-1 py-2 rounded-xl text-[10px] font-body font-medium transition-all ${
                  mode === m ? 'bg-amber text-ink' : 'bg-card border border-border text-muted hover:text-cream'
                }`}
              >
                {icon}
                <span>{label}</span>
              </button>
            ))}
          </div>

          {/* mode 0 — saved (recents + favorites: one searchable list) */}
          {mode === 'saved' && (
            <div>
              {historyLoaded && history.length > 0 && (
                <input
                  type="text"
                  value={savedQuery}
                  onChange={e => setSavedQuery(e.target.value)}
                  placeholder="Search foods you've logged or saved…"
                  className="input-field mb-3"
                />
              )}
              {!historyLoaded ? (
                <div className="flex items-center gap-2 text-faint text-sm font-body py-3">
                  <Loader2 size={14} className="animate-spin text-amber" /> Loading…
                </div>
              ) : history.length === 0 ? (
                <p className="text-faint text-sm font-body py-3">
                  Nothing saved yet — search, scan, or add a food and it&apos;ll show up here.
                </p>
              ) : savedMatches.length > 0 ? (
                <div className="max-h-[55vh] overflow-y-auto">
                  <HistoryList entries={savedMatches} onPick={prefill} />
                </div>
              ) : (
                <p className="text-faint text-sm font-body py-3">No matches in your saved foods.</p>
              )}
            </div>
          )}

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
                        {sourceLabel(result.source)}{result.confidence ? ` · ${result.confidence}` : ''} · {amountModel.basisLabel}
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
                  <ServingLines ctx={amountModel.ctx} />
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
                  <ServingLines ctx={amountModel.ctx} />
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
              <label className="block mb-3">
                <span className="text-faint text-[10px] font-body uppercase tracking-widest">Serving size (optional)</span>
                <input
                  type="text"
                  value={manualServingSize}
                  onChange={e => setManualServingSize(e.target.value)}
                  placeholder='e.g. "1 cup", "2 cookies"'
                  className="input-field mt-1 text-sm"
                />
              </label>
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
              {manualServingSize.trim() && manualPerServing && <ServingLines ctx={amountModel.ctx} />}
            </div>
          )}

          {/* mode 4 — scan */}
          {mode === 'scan' && (
            <div>
              {/* Camera viewport stays mounted across statuses (the ref must be
                  live before startScanner resolves getUserMedia) — just hidden
                  once the feed is no longer the thing being shown. */}
              <div
                className={`relative rounded-xl overflow-hidden bg-ink border border-border aspect-[4/3] select-none ${
                  scanStatus === 'idle' || scanStatus === 'starting' || scanStatus === 'scanning' ? '' : 'hidden'
                }`}
                style={{ touchAction: 'none' }}   // pinch zooms the camera, not the page
                onPointerDown={onScanPointerDown}
                onPointerMove={onScanPointerMove}
                onPointerUp={onScanPointerUp}
                onPointerCancel={onScanPointerUp}
              >
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  aria-label="Camera preview for barcode scanning"
                  className="absolute inset-0 w-full h-full object-cover"
                />
                {/* scan-target frame = the decode region (computeRoi crops to this
                    box); the giant shadow dims everything outside it */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div
                    ref={overlayRef}
                    className={`w-[72%] max-w-[260px] aspect-[1.7] rounded-xl border-2 shadow-[0_0_0_999px_rgba(10,10,10,0.45)] flex items-center justify-center transition-colors ${
                      scanFlash ? 'border-emerald-400' : 'border-amber/90'
                    }`}
                  >
                    {scanFlash && <Check size={30} className="text-emerald-400" />}
                  </div>
                </div>
                {/* scanning pulse */}
                {scanStatus === 'scanning' && !scanFlash && (
                  <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-ink/70 pointer-events-none">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber animate-pulse" />
                    <span className="text-cream/90 text-[10px] font-body">Scanning…</span>
                  </div>
                )}
                {/* torch — rendered only when the track reports the capability */}
                {torchSupported && scanStatus === 'scanning' && !scanFlash && (
                  <button
                    onClick={toggleTorch}
                    onPointerDown={e => e.stopPropagation()}
                    aria-label={torchOn ? 'Turn flashlight off' : 'Turn flashlight on'}
                    className={`absolute top-2 right-2 w-9 h-9 rounded-full flex items-center justify-center border transition-all ${
                      torchOn ? 'bg-amber text-ink border-amber' : 'bg-ink/70 text-cream/90 border-border'
                    }`}
                  >
                    <Flashlight size={15} />
                  </button>
                )}
                {/* zoom — rendered only when the track reports a usable range */}
                {zoomCaps && scanStatus === 'scanning' && !scanFlash && (
                  <div
                    className="absolute bottom-8 inset-x-4 flex items-center gap-2"
                    onPointerDown={e => e.stopPropagation()}
                  >
                    <ZoomOut size={13} className="text-cream/80 shrink-0" />
                    <input
                      type="range"
                      min={zoomCaps.min}
                      max={zoomCaps.max}
                      step={zoomCaps.step}
                      value={zoomVal}
                      onChange={e => applyZoom(parseFloat(e.target.value), true)}
                      aria-label="Camera zoom"
                      className="flex-1 h-1 accent-amber"
                    />
                    <ZoomIn size={13} className="text-cream/80 shrink-0" />
                  </div>
                )}
                {/* tap-to-focus ring */}
                {tapPoint && (
                  <div
                    className="absolute w-12 h-12 -ml-6 -mt-6 rounded-full border-2 border-amber/90 animate-ping pointer-events-none"
                    style={{ left: `${tapPoint.x}%`, top: `${tapPoint.y}%` }}
                  />
                )}
                <p className="absolute bottom-2.5 inset-x-0 text-center text-cream/90 text-xs font-body drop-shadow pointer-events-none">
                  {scanFlash ? `Barcode read — ${scanCode}` :
                    scanStatus === 'scanning' ? `Fill the frame with the barcode${canTapFocus ? ' · tap to focus' : ''}` :
                    'Starting camera…'}
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
                          {sourceLabel(scanHit.source)} · {scanHit.confidence} · {amountModel.basisLabel}
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
                    <ServingLines ctx={amountModel.ctx} />
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
            </div>
          )}

          {/* shared: amount + meal — in scan mode only once there's a product to log.
              Amount entry adapts: servings, a servings/grams toggle, or grams-only
              (per-100g items) per what the selected item supports. */}
          {mode !== 'saved' && (mode !== 'scan' || (scanStatus === 'hit' && !!scanHit)) && (
          <div className="mt-4 flex flex-wrap items-start gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1 h-4">
                <span className="text-faint text-[10px] font-body uppercase tracking-widest">Amount</span>
                {amountModel.kind === 'servings_or_grams' && (
                  <div className="flex gap-1">
                    {(['servings', 'grams'] as const).map(u => (
                      <button
                        key={u}
                        onClick={() => setAmountUnit(u)}
                        className={`px-2 py-0.5 rounded-md text-[10px] font-body font-medium capitalize transition-all ${
                          amountUnit === u ? 'bg-amber text-ink' : 'bg-card border border-border text-muted hover:text-cream'
                        }`}
                      >
                        {u}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={gramsActive ? '0' : '0.25'}
                  step={gramsActive ? '1' : '0.25'}
                  inputMode="decimal"
                  value={gramsActive ? gramsInput : servingsInput}
                  onChange={e => (gramsActive ? setGramsInput(e.target.value) : setServingsInput(e.target.value))}
                  className="input-field w-24 text-sm"
                />
                <span className="text-faint text-xs font-body">{gramsActive ? 'g' : 'servings'}</span>
              </div>
              {amount.equiv && <p className="text-faint text-[11px] font-body mt-1">{amount.equiv}</p>}
              {!amount.valid && (gramsActive ? gramsInput.trim() : servingsInput.trim()) !== '' && (
                <p className="text-amber/80 text-[11px] font-body mt-1">Enter an amount greater than 0.</p>
              )}
            </div>
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
