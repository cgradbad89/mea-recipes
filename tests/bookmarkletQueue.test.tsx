// @vitest-environment jsdom
import { StrictMode } from 'react'
import { JSDOM } from 'jsdom'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createBookmarklet, BOOKMARKLET_ORIGIN } from '@/lib/bookmarklet'
import { nachosHtml, nachosQueue } from './helpers/bookmarkletFixture'

const mocks = vi.hoisted(() => ({
  user: null as null | { uid: string; getIdToken: () => Promise<string> },
  getQueue: vi.fn(), addToQueue: vi.fn(), safeFetchText: vi.fn(), generateAIObject: vi.fn(),
}))
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }))
vi.mock('@/lib/queue', () => ({ getQueue: mocks.getQueue, addToQueue: mocks.addToQueue }))
vi.mock('@/components/QueueCard', () => ({ QueueCard: () => <div>Reviewed recipe</div> }))
vi.mock('@/lib/firebaseAdmin', () => ({ verifyAuthToken: async () => 'synthetic-user' }))
vi.mock('@/lib/ai', () => ({ generateAIObject: mocks.generateAIObject }))
vi.mock('@/lib/safeFetch', () => ({ safeFetchText: mocks.safeFetchText }))
vi.mock('@/lib/flavorPairings', () => ({ getComplementaryIngredients: () => [] }))
import QueuePage from '@/app/queue/page'
import { POST } from '@/app/api/ai-ingest/route'

let source: JSDOM | undefined
beforeEach(() => {
  mocks.user = null
  mocks.getQueue.mockResolvedValue([])
  mocks.addToQueue.mockResolvedValue('synthetic-queue')
  window.history.replaceState({}, '', '/queue')
  Object.defineProperty(window, 'opener', { configurable: true, value: null })
})
afterEach(() => { cleanup(); source?.window.close(); source = undefined; vi.unstubAllGlobals(); vi.useRealTimers() })

it('executes production bookmarklet → Queue listener → authenticated route → queue with complete 13/7 before auth is ready', async () => {
  vi.useFakeTimers()
  source = new JSDOM(nachosHtml, { url: nachosQueue.sourceURL, runScripts: 'outside-only' })
  Object.defineProperty(source.window, 'TextEncoder', { value: TextEncoder })
  Object.defineProperty(window, 'opener', { configurable: true, value: source.window })
  const popup = { closed: false, location: { href: '' }, postMessage: (data: unknown, origin: string) => {
    expect(origin).toBe(BOOKMARKLET_ORIGIN)
    window.dispatchEvent(new MessageEvent('message', { data, source: source!.window as never, origin: new URL(nachosQueue.sourceURL).origin }))
  } }
  vi.spyOn(source.window, 'open').mockImplementation(url => {
    window.history.replaceState({}, '', new URL(String(url)).pathname + new URL(String(url)).search)
    return popup as never
  })
  const ack = vi.spyOn(source.window, 'postMessage').mockImplementation((data, origin) => {
    expect(origin).toBe(new URL(nachosQueue.sourceURL).origin)
    source!.window.dispatchEvent(new source!.window.MessageEvent('message', { data, origin: BOOKMARKLET_ORIGIN, source: popup as never }))
  })
  const request = vi.fn(async (_url, init) => POST(new NextRequest('http://localhost/api/ai-ingest', init)))
  vi.stubGlobal('fetch', request)
  mocks.generateAIObject.mockResolvedValue({ ...nachosQueue, ingredients: ['refried beans'], instructions: ['Cook a different dish.'] })
  source.window.eval(decodeURIComponent(createBookmarklet().replace(/^javascript:/, '')))
  const view = render(<StrictMode><QueuePage /></StrictMode>)
  await act(async () => { vi.advanceTimersByTime(500) })
  expect(request).not.toHaveBeenCalled()
  expect(ack).toHaveBeenCalledTimes(1)
  expect(window.location.search).toBe('')
  mocks.user = { uid: 'synthetic-user', getIdToken: async () => 'MEA-only-token' }
  vi.useRealTimers()
  view.rerender(<StrictMode><QueuePage /></StrictMode>)
  await waitFor(() => expect(mocks.addToQueue).toHaveBeenCalledTimes(1))
  const body = JSON.parse(request.mock.calls[0][1].body)
  expect(body.url).toBeUndefined()
  expect(body.sourceURL).toBe(nachosQueue.sourceURL)
  expect(body.html).toContain('scallions')
  expect(mocks.safeFetchText).not.toHaveBeenCalled()
  expect(mocks.addToQueue.mock.calls[0][1]).toMatchObject({ ingredients: nachosQueue.ingredients, instructions: nachosQueue.instructions, sourceURL: nachosQueue.sourceURL })
  expect(JSON.stringify(ack.mock.calls)).not.toContain('MEA-only-token')
})

it('uses the existing Queue error for missing opener and refuses outdated URL-only bookmarklets', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  mocks.user = { uid: 'synthetic-user', getIdToken: async () => 'token' }
  window.history.replaceState({}, '', `/queue?capture=1&nonce=${'a'.repeat(32)}`)
  const view = render(<QueuePage />)
  expect((await screen.findByRole('alert')).textContent).toContain('source window is unavailable')
  view.unmount()
  window.history.replaceState({}, '', '/queue?ingest=https://recipes.example/old')
  render(<QueuePage />)
  expect((await screen.findByRole('alert')).textContent).toContain('outdated')
  expect(fetch).not.toHaveBeenCalled()
  expect(mocks.addToQueue).not.toHaveBeenCalled()
})
