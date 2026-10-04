// @vitest-environment jsdom
import { StrictMode, useLayoutEffect } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecipeMeta } from '@/lib/userdata'

const mocks = vi.hoisted(() => ({
  auth: { user: { uid: 'owner-a' } as { uid: string } | null, loading: false },
  read: vi.fn(),
}))
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => mocks.auth }))
vi.mock('@/lib/firebase', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => path.join('/'),
  getDocs: (path: string) => path.endsWith('/meta') ? mocks.read(path) : Promise.resolve({ docs: [] }),
  orderBy: vi.fn(), query: (path: string) => path,
}))
vi.mock('@/lib/recipes', () => ({ getAllRecipes: vi.fn().mockResolvedValue([]) }))
vi.mock('@/lib/userdata', () => ({
  getFavoriteIDs: vi.fn().mockResolvedValue(new Set()),
  getWantToTryIDs: vi.fn().mockResolvedValue(new Set()),
}))
import { AppDataProvider, useAppData } from '@/components/AppDataProvider'
let current: ReturnType<typeof useAppData>
function Probe() {
  const data = useAppData()
  useLayoutEffect(() => { current = data }, [data])
  return <output data-testid="meta">{JSON.stringify({
    data: data.metas, loading: data.metasLoading, error: data.metasError,
  })}</output>
}
function provider(strict = false) {
  const element = <AppDataProvider><Probe /></AppDataProvider>
  return strict ? <StrictMode>{element}</StrictMode> : element
}
function snapshot(note: string) {
  return { docs: [{ id: 'recipe', data: () => ({ note, overrides: { content: note } }) }] }
}
function deferred() {
  let resolve!: (value: ReturnType<typeof snapshot>) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<ReturnType<typeof snapshot>>((yes, no) => { resolve = yes; reject = no })
  return { resolve, reject, promise }
}
function visible() { return JSON.parse(screen.getByTestId('meta').textContent!) as {
  data: Record<string, RecipeMeta>; loading: boolean; error: string | null
} }
beforeEach(() => {
  mocks.auth.user = { uid: 'owner-a' }
  mocks.auth.loading = false
  mocks.read.mockReset().mockResolvedValue(snapshot('initial'))
})
afterEach(cleanup)

describe('RecipeMeta provider request and owner boundaries', () => {
  it.each(['new-first', 'old-first'])('latest request wins when completion is %s', async order => {
    render(provider())
    await waitFor(() => expect(visible().data.recipe?.note).toBe('initial'))
    const old = deferred(), fresh = deferred()
    mocks.read.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    let requestA!: Promise<void>, requestB!: Promise<void>
    await act(async () => {
      requestA = current.refetchMetas()
      requestB = current.refetchMetas()
    })
    const rejectedA = expect(requestA).rejects.toThrow('superseded')
    if (order === 'new-first') {
      await act(async () => { fresh.resolve(snapshot('NEW')); await requestB })
      expect(visible().data.recipe.note).toBe('NEW')
      await act(async () => { old.resolve(snapshot('OLD')); await rejectedA })
    } else {
      await act(async () => { old.resolve(snapshot('OLD')); await rejectedA })
      expect(visible().loading).toBe(true)
      expect(visible().data.recipe.note).toBe('initial')
      await act(async () => { fresh.resolve(snapshot('NEW')); await requestB })
    }
    expect(visible()).toMatchObject({ data: { recipe: { note: 'NEW' } }, loading: false, error: null })
  })

  it('discards a pending A read after sign-out', async () => {
    const a = deferred()
    mocks.read.mockReturnValueOnce(a.promise)
    const view = render(provider())
    mocks.auth.user = null
    view.rerender(provider())
    expect(visible().data).toEqual({})
    await act(async () => { a.resolve(snapshot('A')); await a.promise })
    expect(visible()).toEqual({ data: {}, loading: false, error: null })
  })

  it('discards late A data while B loads and then publishes B normally', async () => {
    const a = deferred(), b = deferred()
    mocks.read.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
    const view = render(provider())
    mocks.auth.user = { uid: 'owner-b' }
    view.rerender(provider())
    expect(visible()).toEqual({ data: {}, loading: true, error: null })
    await act(async () => { a.resolve(snapshot('A')); await a.promise })
    expect(visible()).toEqual({ data: {}, loading: true, error: null })
    await act(async () => { b.resolve(snapshot('B')); await b.promise })
    expect(visible().data.recipe.note).toBe('B')
    expect(mocks.read.mock.calls.map(call => call[0])).toEqual([
      'users/owner-a/recipes/root/meta', 'users/owner-b/recipes/root/meta',
    ])
  })

  it('hides already-loaded A data and errors on the first B render', async () => {
    const view = render(provider())
    await waitFor(() => expect(visible().data.recipe?.note).toBe('initial'))
    mocks.read.mockRejectedValueOnce(new Error('A failure'))
    await act(async () => { await expect(current.refetchMetas()).rejects.toThrow('A failure') })
    const b = deferred()
    mocks.read.mockReturnValueOnce(b.promise)
    mocks.auth.user = { uid: 'owner-b' }
    view.rerender(provider())
    expect(visible()).toEqual({ data: {}, loading: true, error: null })
    await act(async () => { b.resolve(snapshot('B')); await b.promise })
  })

  it('rejects an imperative failed read, exposes the error, and successfully retries', async () => {
    render(provider())
    await waitFor(() => expect(visible().loading).toBe(false))
    const failure = new Error('metadata offline')
    mocks.read.mockRejectedValueOnce(failure)
    await act(async () => { await expect(current.refetchMetas()).rejects.toBe(failure) })
    expect(visible()).toMatchObject({ loading: false, error: 'metadata offline' })
    mocks.read.mockResolvedValueOnce(snapshot('retry'))
    await act(async () => { await expect(current.refetchMetas()).resolves.toBeUndefined() })
    expect(visible()).toMatchObject({ data: { recipe: { note: 'retry' } }, error: null, loading: false })
  })

  it('handles a passive load rejection without an unhandled promise', async () => {
    mocks.read.mockRejectedValueOnce(new Error('passive offline'))
    render(provider())
    await waitFor(() => expect(visible().error).toBe('passive offline'))
    expect(visible().loading).toBe(false)
  })

  it('retires the first Strict Mode effect request', async () => {
    const replayed = deferred(), active = deferred()
    mocks.read.mockReturnValueOnce(replayed.promise).mockReturnValueOnce(active.promise)
    const view = render(provider(true))
    expect(mocks.read).toHaveBeenCalledTimes(2)
    await act(async () => { active.resolve(snapshot('current')); await active.promise })
    await act(async () => { replayed.resolve(snapshot('retired')); await replayed.promise })
    expect(visible().data.recipe.note).toBe('current')
    mocks.auth.user = null
    view.rerender(provider(true))
    expect(visible().data).toEqual({})
  })

  it('retires an unmounted instance and rejects its imperative pending read', async () => {
    const view = render(provider())
    await waitFor(() => expect(visible().loading).toBe(false))
    const pending = deferred()
    mocks.read.mockReturnValueOnce(pending.promise)
    let request!: Promise<void>
    await act(async () => { request = current.refetchMetas() })
    const rejected = expect(request).rejects.toThrow('superseded')
    view.unmount()
    render(provider())
    await waitFor(() => expect(visible().loading).toBe(false))
    await act(async () => { pending.resolve(snapshot('retired')); await rejected })
    expect(visible().data.recipe.note).toBe('initial')
  })

  it('rejects callbacks captured for a previous owner without starting another read', async () => {
    const view = render(provider())
    await waitFor(() => expect(visible().loading).toBe(false))
    const staleRefetch = current.refetchMetas
    mocks.auth.user = { uid: 'owner-b' }
    view.rerender(provider())
    await waitFor(() => expect(visible().loading).toBe(false))
    await expect(staleRefetch()).rejects.toThrow('no longer current')
    expect(mocks.read).toHaveBeenCalledTimes(2)
  })
})

describe('retired metadata failures and owner generations', () => {
  it('does not let an older failed read replace a newer successful state or error', async () => {
    const old = deferred(), fresh = deferred()
    mocks.read.mockReturnValueOnce(old.promise)
    render(provider())
    mocks.read.mockReturnValueOnce(fresh.promise)
    let request!: Promise<void>
    await act(async () => { request = current.refetchMetas() })
    await act(async () => { fresh.resolve(snapshot('saved')); await request })
    await act(async () => { old.reject(new Error('old failure')); await old.promise.catch(() => {}) })
    expect(visible()).toMatchObject({ data: { recipe: { note: 'saved' } }, loading: false, error: null })
  })

  it('does not revive the first A request after A → B → A', async () => {
    const aOld = deferred(), b = deferred(), aCurrent = deferred()
    mocks.read.mockReturnValueOnce(aOld.promise).mockReturnValueOnce(b.promise).mockReturnValueOnce(aCurrent.promise)
    const view = render(provider(true))
    // Strict Mode consumed the first two requests for A; switching owners retires both.
    mocks.auth.user = { uid: 'owner-b' }
    view.rerender(provider(true))
    mocks.auth.user = { uid: 'owner-a' }
    view.rerender(provider(true))
    await waitFor(() => expect(visible().data.recipe?.note).toBe('initial'))
    await act(async () => {
      aOld.resolve(snapshot('retired A')); b.resolve(snapshot('retired replay')); aCurrent.resolve(snapshot('retired B'))
      await Promise.all([aOld.promise, b.promise, aCurrent.promise])
    })
    expect(visible().data.recipe.note).toBe('initial')
  })
})
