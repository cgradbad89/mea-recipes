import type { RecipeNutrition } from '@/types/recipe'
import { recipeEvidenceFromJsonLd, publisherNutritionFromStructuredData } from './sourceRecipeFacts'

export const BOOKMARKLET_ORIGIN = 'https://mea-recipes.vercel.app'
export const BOOKMARKLET_MAX_BYTES = 1_500_000
export const BOOKMARKLET_TIMEOUT_MS = 60_000

export interface BookmarkletCaptureV1 {
  version: 1
  nonce: string
  sourceURL: string
  capturedHtml: string
  imageURL?: string
  prepTime?: string
  cookTime?: string
  sourceNutrition?: RecipeNutrition
}

/** The browser runtime has no module/global application dependencies. */
function launchBookmarklet(
  targetOrigin: string,
  projectRecipes: typeof recipeEvidenceFromJsonLd,
  maxBytes: number,
  timeoutMs: number,
) {
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), v => v.toString(16).padStart(2, '0')).join('')
  const destination = `${targetOrigin}/queue?capture=1&nonce=${nonce}`
  const popup = window.open(destination, '_blank', 'width=520,height=750')
  if (!popup) { window.alert('MEA could not open the recipe queue. Allow popups and try again.'); return }
  let sourceURL = ''
  let message: Record<string, unknown>
  try {
    // Attribution never forwards credentials, query tokens, or fragments.
    const source = new URL(location.href)
    if (!/^https?:$/.test(source.protocol) || source.username || source.password) throw new Error('invalid-source')
    source.search = ''
    source.hash = ''
    sourceURL = source.href
    const recipes: Record<string, unknown>[] = []
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try { recipes.push(...projectRecipes(JSON.parse(script.textContent || ''))) } catch { /* fallback to visible text */ }
    }
    function safeImage(value: unknown): string {
      if (typeof value === 'string') {
        try {
          const url = new URL(value, sourceURL)
          if (!/^https?:$/.test(url.protocol) || url.username || url.password || /(?:^|[\/_\-.])(icon|logo|avatar)(?:[\/_\-.]|$)/i.test(url.href)) return ''
          url.search = ''
          url.hash = ''
          return url.href
        } catch { return '' }
      }
      if (Array.isArray(value)) {
        for (const v of value) { const image = safeImage(v); if (image) return image }
      }
      if (value && typeof value === 'object') return safeImage((value as Record<string, unknown>).url)
      return ''
    }
    // Only allowlisted Recipe data enters capturedHtml. Arbitrary scripts and
    // application-state properties are never copied, even inside a Recipe node.
    for (const recipe of recipes) if (recipe.image) recipe.image = safeImage(recipe.image)
    const scopes = document.querySelectorAll('[itemtype*="schema.org/Recipe"]')
    const mains = document.querySelectorAll('main')
    const articles = document.querySelectorAll('article')
    const root = scopes.length === 1 ? scopes[0] : mains.length === 1 ? mains[0] : articles.length === 1 ? articles[0] : document.body
    function visibleText(node: Node): string {
      if (node.nodeType === 3) return node.textContent || ''
      if (!(node instanceof Element)) return ''
      if (node.matches('script,style,noscript,template,form,input,textarea,select,button,nav,header,footer,aside,[hidden],[aria-hidden="true"],[contenteditable]')) return ''
      const style = getComputedStyle(node)
      if (style.display === 'none' || style.visibility === 'hidden') return ''
      const block = /^(P|DIV|SECTION|ARTICLE|MAIN|LI|H[1-6]|BR|TR)$/.test(node.tagName)
      const text = Array.from(node.childNodes, visibleText).join('')
      return block ? `\n${text}\n` : text
    }
    const visible = root ? visibleText(root).trim() : ''
    const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const structured = recipes.map(r => `<script type="application/ld+json">${JSON.stringify(r).replace(/</g, '\\u003c')}</script>`).join('\n')
    const capturedHtml = `${structured}\n<pre>${escape(visible)}</pre>`
    if (!structured && !visible) throw new Error('empty-capture')
    let imageURL = ''
    for (const recipe of recipes) { if (!imageURL) imageURL = safeImage(recipe.image) }
    if (!imageURL) {
      for (const element of document.querySelectorAll('[itemprop="image"]')) {
        if (!element.closest('[itemtype*="Recipe"]')) continue
        imageURL = safeImage(element.getAttribute('content') || element.getAttribute('src') || element.getAttribute('href'))
        if (imageURL) break
      }
    }
    if (!imageURL) imageURL = safeImage(document.querySelector('meta[property="og:image"],meta[name="og:image"]')?.getAttribute('content'))
    function duration(value: unknown): string {
      if (typeof value !== 'string') return ''
      const m = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/i)
      return m ? `${m[1] ? `${m[1]}h ` : ''}${m[2] ? `${m[2]} min` : ''}`.trim() : value
    }
    const prepTime = duration(recipes.find(r => typeof r.prepTime === 'string' && r.prepTime.trim())?.prepTime)
    const cookTime = duration(recipes.find(r => typeof r.cookTime === 'string' && r.cookTime.trim())?.cookTime)
    message = { type: 'mea-bookmarklet-capture', version: 1, nonce, sourceURL, capturedHtml, imageURL, prepTime, cookTime }
    if (new TextEncoder().encode(JSON.stringify(message)).byteLength > maxBytes) throw new Error('oversized-capture')
  } catch (error) {
    const code = error instanceof Error && ['oversized-capture', 'empty-capture', 'invalid-source'].includes(error.message) ? error.message : 'capture-failed'
    message = { type: 'mea-bookmarklet-error', version: 1, nonce, sourceURL, code }
  }
  let timer: ReturnType<typeof setInterval>
  let attempts = 0
  const stop = () => { clearInterval(timer); window.removeEventListener('message', acknowledge) }
  function acknowledge(event: MessageEvent) {
    if (event.source === popup && event.origin === targetOrigin && event.data?.type === 'mea-bookmarklet-ack' && event.data.version === 1 && event.data.nonce === nonce) stop()
  }
  window.addEventListener('message', acknowledge)
  timer = setInterval(() => {
    if (popup.closed) { stop(); return }
    if (++attempts > timeoutMs / 500) {
      stop()
      // If Queue never mounted/acknowledged, its eventual load still exposes the
      // existing error state. The recipe body remains absent from this URL.
      popup.location.href = `${destination}&captureError=timeout`
      return
    }
    popup.postMessage(message, targetOrigin)
  }, 500)
}

export function createBookmarklet(): string {
  // javascript: URLs percent-decode before evaluation. Encoding preserves line
  // breaks/comments when the copied value passes through bookmark URL editors.
  const script = `(${launchBookmarklet.toString()})(${JSON.stringify(BOOKMARKLET_ORIGIN)},${recipeEvidenceFromJsonLd.toString()},${BOOKMARKLET_MAX_BYTES},${BOOKMARKLET_TIMEOUT_MS});`
  return `javascript:${encodeURIComponent(script)}`
}

export function validateBookmarkletCaptureEvent(event: MessageEvent, opener: Window | null, nonce: string): BookmarkletCaptureV1 {
  const value = event.data
  if (!opener || event.source !== opener) throw new Error('The bookmarklet message has an unexpected source window.')
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1 || value.nonce !== nonce || !/^[a-f0-9]{32}$/.test(nonce)) throw new Error('Invalid bookmarklet capture session.')
  if (typeof value.sourceURL !== 'string' || value.sourceURL.length > 2_048) throw new Error('Invalid bookmarklet source URL.')
  let url: URL
  try { url = new URL(value.sourceURL) } catch { throw new Error('Invalid bookmarklet source URL.') }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.origin !== event.origin) throw new Error('The bookmarklet source origin does not match its URL.')
  if (value.type === 'mea-bookmarklet-error') {
    const failures: Record<string, string> = {
      'oversized-capture': 'The captured recipe is too large. No content was trimmed.',
      'empty-capture': 'No recipe content was captured. Open the full recipe and try again.',
      'invalid-source': 'The source page must have an HTTP(S) URL without credentials.',
      'capture-failed': 'Recipe capture failed. Open the full recipe and try again.',
    }
    throw new Error(failures[value.code] || 'Invalid bookmarklet capture.')
  }
  const allowed = ['type', 'version', 'nonce', 'sourceURL', 'capturedHtml', 'imageURL', 'prepTime', 'cookTime', 'sourceNutrition']
  if (value.type !== 'mea-bookmarklet-capture' || Object.keys(value).some(key => !allowed.includes(key)) || typeof value.capturedHtml !== 'string' || !value.capturedHtml.trim()) throw new Error('Invalid bookmarklet capture payload.')
  for (const key of ['imageURL', 'prepTime', 'cookTime']) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key].length > 2_048)) throw new Error('Invalid bookmarklet metadata.')
  }
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > BOOKMARKLET_MAX_BYTES) throw new Error('The captured recipe is too large. No content was trimmed.')
  if (value.sourceNutrition !== undefined && !publisherNutritionFromStructuredData(nutritionMetadata(value.sourceNutrition))) throw new Error('Invalid bookmarklet nutrition.')
  return value as BookmarkletCaptureV1
}

function nutritionMetadata(nutrition: RecipeNutrition | undefined) {
  return nutrition ? {
    calories: nutrition.calories, proteinContent: nutrition.protein_g, carbohydrateContent: nutrition.carbs_g,
    fatContent: nutrition.fat_g, fiberContent: nutrition.fiber_g, sugarContent: nutrition.sugar_g,
    recipeYield: nutrition.servings, servingSize: nutrition.serving_size,
  } : undefined
}

export function bookmarkletIngestRequest(capture: BookmarkletCaptureV1) {
  return {
    html: capture.capturedHtml, sourceURL: capture.sourceURL,
    imageURL: capture.imageURL, prepTime: capture.prepTime, cookTime: capture.cookTime,
    ...(capture.sourceNutrition ? { sourceNutrition: nutritionMetadata(capture.sourceNutrition) } : {}),
  }
}

/** Mount before MEA auth finishes; hold the validated capture in memory only. */
export function receiveBookmarkletCapture(host: Window, nonce: string) {
  let cancel = () => {}
  const promise = new Promise<BookmarkletCaptureV1>((resolve, reject) => {
    if (!host.opener) { reject(new Error('The source window is unavailable. Launch the bookmarklet again from the recipe page.')); return }
    let timer: ReturnType<typeof setTimeout>
    const cleanup = () => { clearTimeout(timer); host.removeEventListener('message', receive) }
    cancel = () => { cleanup(); reject(new Error('Bookmarklet capture cancelled.')) }
    function receive(event: MessageEvent) {
      // Ignore unrelated launches/windows; they can never supply this capture.
      if (event.source !== host.opener || event.data?.nonce !== nonce) return
      try {
        const capture = validateBookmarkletCaptureEvent(event, host.opener, nonce)
        host.opener.postMessage({ type: 'mea-bookmarklet-ack', version: 1, nonce }, event.origin)
        cleanup()
        resolve(capture)
      } catch (error) {
        cleanup()
        reject(error)
      }
    }
    host.addEventListener('message', receive)
    timer = setTimeout(() => { cleanup(); reject(new Error('Bookmarklet capture timed out. Keep the recipe page open and launch the bookmarklet again.')) }, BOOKMARKLET_TIMEOUT_MS)
  })
  return { promise, cancel: () => cancel() }
}
