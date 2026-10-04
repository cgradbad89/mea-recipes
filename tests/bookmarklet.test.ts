import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createBookmarklet, validateBookmarkletCaptureEvent, receiveBookmarkletCapture, BOOKMARKLET_MAX_BYTES, BOOKMARKLET_TIMEOUT_MS, BOOKMARKLET_ORIGIN } from '@/lib/bookmarklet'
import { extractSourceRecipeFacts } from '@/lib/sourceRecipeFacts'
import { nachosHtml, nachosSource, nachosIngredients, nachosInstructions } from './helpers/bookmarkletFixture'

let dom: JSDOM
function launch(html = nachosHtml) {
  dom = new JSDOM(html, { url: 'https://recipes.example/authenticated/nachos?auth_token=secret#private', runScripts: 'outside-only' })
  Object.defineProperty(dom.window, 'TextEncoder', { value: TextEncoder })
  const popup = { postMessage: vi.fn(), closed: false, location: { href: '' } }
  const open = vi.spyOn(dom.window, 'open').mockReturnValue(popup as never)
  dom.window.eval(decodeURIComponent(createBookmarklet().replace(/^javascript:/, '')))
  vi.advanceTimersByTime(500)
  return { popup, open, capture: popup.postMessage.mock.calls[0]?.[0] }
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => { dom?.window.close(); vi.useRealTimers() })

describe('production bookmarklet transport', () => {
  it('captures the full authenticated 13/7 fixture without body/history query parameters or credentials', () => {
    const html = nachosHtml.replace('</body>', '<script>applicationSecret="secret"</script><script type="application/json">{"token":"secret"}</script><form><input value="secret"></form><p hidden>secret</p></body>')
    const { popup, open, capture } = launch(html)
    expect(extractSourceRecipeFacts(capture.capturedHtml).ingredients).toEqual(nachosIngredients)
    expect(extractSourceRecipeFacts(capture.capturedHtml).instructions).toEqual(nachosInstructions)
    expect(capture.sourceURL).toBe('https://recipes.example/authenticated/nachos')
    expect(capture.imageURL).toBe(nachosSource.image)
    expect(capture.prepTime).toBe('20 min')
    expect(capture.cookTime).toBe('40 min')
    expect(capture.capturedHtml).not.toContain('secret')
    expect(popup.postMessage.mock.calls[0][1]).toBe(BOOKMARKLET_ORIGIN)
    const url = new URL(open.mock.calls[0][0] as string)
    expect([...url.searchParams.keys()]).toEqual(['capture', 'nonce'])
    expect(url.href).not.toContain('scallions')
    expect(createBookmarklet()).not.toMatch(/[\r\n]/)
    expect(decodeURIComponent(createBookmarklet())).not.toMatch(/localStorage|sessionStorage|document\.cookie/)
  })

  it.each([
    ['JSON-LD only', `<script type="application/ld+json">${JSON.stringify(nachosSource)}</script>`],
    ['visible fallback', nachosHtml.replace(/<script[\s\S]*?<\/script>/, '')],
    ['malformed/unrelated JSON-LD', nachosHtml.replace(/<script[\s\S]*?<\/script>/, '<script type="application/ld+json">{broken</script><script type="application/ld+json">{"@type":"WebSite","secret":"private"}</script>')],
  ])('retains every recipe row with %s', (_name, html) => {
    const { capture } = launch(html)
    for (const row of [...nachosIngredients, ...nachosInstructions]) expect(capture.capturedHtml).toContain(row)
  })

  it('keeps multiple Recipe nodes ambiguous while retaining complete visible fallback text', () => {
    const { capture } = launch(nachosHtml.replace('</head>', `<script type="application/ld+json">${JSON.stringify({ ...nachosSource, recipeIngredient: ['beans'] })}</script></head>`))
    expect(extractSourceRecipeFacts(capture.capturedHtml).ingredients).toBeUndefined()
    expect(capture.capturedHtml).toContain('scallions')
    expect(capture.capturedHtml).toContain(nachosInstructions[6])
  })

  it('rejects oversized captures with an error message instead of slicing the tail', () => {
    const { capture } = launch(`<main>${'x'.repeat(BOOKMARKLET_MAX_BYTES)}scallions</main>`)
    expect(capture.type).toBe('mea-bookmarklet-error')
    expect(capture.code).toBe('oversized-capture')
    expect(capture.capturedHtml).toBeUndefined()
  })

  it('validates nonce, version, opener, URL origin, shape, and size before acceptance', () => {
    const { capture } = launch()
    const opener = {} as Window
    const event = { source: opener, origin: 'https://recipes.example', data: capture } as MessageEvent
    expect(validateBookmarkletCaptureEvent(event, opener, capture.nonce)).toEqual(capture)
    const invalid = [
      { ...event, data: { ...capture, nonce: '0'.repeat(32) } },
      { ...event, data: { ...capture, version: 2 } },
      { ...event, source: {} },
      { ...event, origin: 'https://attacker.example' },
      { ...event, data: { ...capture, sourceURL: 'javascript:bad' } },
      { ...event, data: { ...capture, sourceURL: 'https://user:secret@recipes.example/x' } },
      { ...event, data: { ...capture, capturedHtml: 123 } },
      { ...event, data: { ...capture, token: 'secret' } },
      { ...event, data: { ...capture, capturedHtml: 'é'.repeat(BOOKMARKLET_MAX_BYTES) } },
    ]
    for (const candidate of invalid) expect(() => validateBookmarkletCaptureEvent(candidate as MessageEvent, opener, capture.nonce)).toThrow()
  })

  it('stops retries on a valid ack and rejects incorrect ack sources/origins/nonces', () => {
    const { popup, capture } = launch()
    for (const change of [{ source: {} as Window }, { origin: 'https://attacker.example' }, { data: { type: 'mea-bookmarklet-ack', version: 1, nonce: 'bad' } }]) {
      dom.window.dispatchEvent(new dom.window.MessageEvent('message', { source: popup as never, origin: BOOKMARKLET_ORIGIN, data: { type: 'mea-bookmarklet-ack', version: 1, nonce: capture.nonce }, ...change }))
      vi.advanceTimersByTime(500)
    }
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', { source: popup as never, origin: BOOKMARKLET_ORIGIN, data: { type: 'mea-bookmarklet-ack', version: 1, nonce: capture.nonce } }))
    const attempts = popup.postMessage.mock.calls.length
    vi.advanceTimersByTime(BOOKMARKLET_TIMEOUT_MS * 2)
    expect(popup.postMessage).toHaveBeenCalledTimes(attempts)
  })

  it('terminates missing-opener and handshake failures clearly, without any URL-fetch fallback', async () => {
    const { popup } = launch()
    const receiver = receiveBookmarkletCapture(dom.window as never, 'a'.repeat(32))
    await expect(receiver.promise).rejects.toThrow('source window is unavailable')
    Object.defineProperty(dom.window, 'opener', { value: popup })
    const waiting = receiveBookmarkletCapture(dom.window as never, 'a'.repeat(32))
    const assertion = expect(waiting.promise).rejects.toThrow('timed out')
    vi.advanceTimersByTime(BOOKMARKLET_TIMEOUT_MS + 1000)
    await assertion
    expect(popup.location.href).toContain('captureError=timeout')
    const attempts = popup.postMessage.mock.calls.length
    vi.advanceTimersByTime(BOOKMARKLET_TIMEOUT_MS)
    expect(popup.postMessage).toHaveBeenCalledTimes(attempts)
    expect(decodeURIComponent(createBookmarklet())).not.toContain('fetch(')
  })
})
