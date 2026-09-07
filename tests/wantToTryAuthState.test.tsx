// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authState: {
    user: null as { uid: string } | null,
    loading: false,
  },
  fetchAllRecipes: vi.fn(),
  getDocs: vi.fn(),
  getFavoriteIDs: vi.fn(),
  addFavorite: vi.fn(),
  removeFavorite: vi.fn(),
  getWantToTryIDs: vi.fn(),
  addWantToTry: vi.fn(),
  removeWantToTry: vi.fn(),
}))

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => mocks.authState,
}))
vi.mock('@/lib/firebase', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  getDocs: mocks.getDocs,
  orderBy: vi.fn(),
  query: vi.fn(),
}))
vi.mock('@/lib/recipes', () => ({
  getAllRecipes: mocks.fetchAllRecipes,
}))
vi.mock('@/lib/userdata', () => ({
  getFavoriteIDs: mocks.getFavoriteIDs,
  addFavorite: mocks.addFavorite,
  removeFavorite: mocks.removeFavorite,
  getWantToTryIDs: mocks.getWantToTryIDs,
  addWantToTry: mocks.addWantToTry,
  removeWantToTry: mocks.removeWantToTry,
}))

import { AppDataProvider, useAppData } from '@/components/AppDataProvider'

function WantToTryProbe() {
  const { wantToTry, wantToTryLoading, toggleWantToTry } = useAppData()
  const ids = [...wantToTry].sort().join(',')
  return (
    <>
      <div data-testid="want-to-try">{wantToTryLoading ? 'loading' : 'ready'}:{ids}</div>
      <button onClick={() => void toggleWantToTry('recipe-c')}>toggle</button>
    </>
  )
}

function provider() {
  return (
    <AppDataProvider>
      <WantToTryProbe />
    </AppDataProvider>
  )
}

function installLocalStorage() {
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, String(value)),
    },
  })
}

describe('AppDataProvider Want to Try auth ownership', () => {
  beforeEach(() => {
    installLocalStorage()
    localStorage.clear()
    mocks.authState.user = null
    mocks.authState.loading = false
    mocks.fetchAllRecipes.mockReset().mockResolvedValue([])
    mocks.getDocs.mockReset().mockResolvedValue({ docs: [] })
    mocks.getFavoriteIDs.mockReset().mockResolvedValue(new Set())
    mocks.addFavorite.mockReset()
    mocks.removeFavorite.mockReset()
    mocks.getWantToTryIDs.mockReset()
    mocks.addWantToTry.mockReset()
    mocks.removeWantToTry.mockReset()
  })

  afterEach(cleanup)

  it('loads the signed-in user Want to Try list from Firestore', async () => {
    mocks.authState.user = { uid: 'user-a' }
    mocks.getWantToTryIDs.mockResolvedValueOnce(new Set(['recipe-a', 'recipe-b']))

    render(provider())

    await waitFor(() => {
      expect(screen.getByTestId('want-to-try').textContent).toBe('ready:recipe-a,recipe-b')
    })
    expect(mocks.getWantToTryIDs).toHaveBeenCalledWith('user-a')
  })

  it('keeps an anonymous list local and toggles it without Firestore writes', async () => {
    localStorage.setItem('mea-want-to-try', JSON.stringify(['recipe-a']))
    render(provider())

    await waitFor(() => {
      expect(screen.getByTestId('want-to-try').textContent).toBe('ready:recipe-a')
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'toggle' }))
    })

    expect(screen.getByTestId('want-to-try').textContent).toBe('ready:recipe-a,recipe-c')
    expect(JSON.parse(localStorage.getItem('mea-want-to-try') || '[]')).toEqual(['recipe-a', 'recipe-c'])
    expect(mocks.addWantToTry).not.toHaveBeenCalled()
  })

  it('does not expose a late authenticated response after sign-out', async () => {
    let resolveAuthenticated!: (ids: Set<string>) => void
    const authenticatedRequest = new Promise<Set<string>>(resolve => {
      resolveAuthenticated = resolve
    })
    localStorage.setItem('mea-want-to-try', JSON.stringify(['anonymous-recipe']))
    mocks.authState.user = { uid: 'user-a' }
    mocks.getWantToTryIDs.mockReturnValueOnce(authenticatedRequest)
    const { rerender } = render(provider())
    await waitFor(() => expect(mocks.getWantToTryIDs).toHaveBeenCalledWith('user-a'))

    mocks.authState.user = null
    rerender(provider())
    await waitFor(() => {
      expect(screen.getByTestId('want-to-try').textContent).toBe('ready:anonymous-recipe')
    })

    await act(async () => {
      resolveAuthenticated(new Set(['authenticated-recipe']))
      await authenticatedRequest
    })

    expect(screen.getByTestId('want-to-try').textContent).toBe('ready:anonymous-recipe')
  })
})
