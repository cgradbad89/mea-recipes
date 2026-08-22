// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
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
}))

import { AppDataProvider, useAppData } from '@/components/AppDataProvider'

function FavoritesProbe() {
  const { favorites, favoritesLoading } = useAppData()
  const ids = [...favorites].sort().join(',')
  return <div data-testid="favorites">{favoritesLoading ? 'loading' : 'ready'}:{ids}</div>
}

function provider() {
  return (
    <AppDataProvider>
      <FavoritesProbe />
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

describe('AppDataProvider favorites auth ownership', () => {
  beforeEach(() => {
    installLocalStorage()
    localStorage.clear()
    mocks.authState.user = null
    mocks.authState.loading = false
    mocks.fetchAllRecipes.mockReset().mockResolvedValue([])
    mocks.getDocs.mockReset().mockResolvedValue({ docs: [] })
    mocks.getFavoriteIDs.mockReset()
    mocks.addFavorite.mockReset()
    mocks.removeFavorite.mockReset()
  })

  afterEach(cleanup)

  it('loads the signed-in user favorites normally', async () => {
    mocks.authState.user = { uid: 'user-a' }
    mocks.getFavoriteIDs.mockResolvedValueOnce(new Set(['recipe-a', 'recipe-b']))

    render(provider())

    await waitFor(() => {
      expect(screen.getByTestId('favorites').textContent).toBe('ready:recipe-a,recipe-b')
    })
    expect(mocks.getFavoriteIDs).toHaveBeenCalledWith('user-a')
  })

  it('clears authenticated favorites on sign-out without clearing filter preferences', async () => {
    localStorage.setItem('mea_favorites_search', 'pasta')
    localStorage.setItem('mea_favorites_sort', 'az')
    mocks.authState.user = { uid: 'user-a' }
    mocks.getFavoriteIDs.mockResolvedValueOnce(new Set(['authenticated-recipe']))
    const { rerender } = render(provider())
    await waitFor(() => {
      expect(screen.getByTestId('favorites').textContent).toBe('ready:authenticated-recipe')
    })

    mocks.authState.user = null
    rerender(provider())

    expect(screen.getByTestId('favorites').textContent).not.toContain('authenticated-recipe')
    await waitFor(() => {
      expect(screen.getByTestId('favorites').textContent).toBe('ready:')
    })
    expect(localStorage.getItem('mea_favorites_search')).toBe('pasta')
    expect(localStorage.getItem('mea_favorites_sort')).toBe('az')
  })

  it('hydrates the supported anonymous source and ignores a late authenticated fetch', async () => {
    let resolveAuthenticated!: (ids: Set<string>) => void
    const authenticatedRequest = new Promise<Set<string>>(resolve => {
      resolveAuthenticated = resolve
    })
    localStorage.setItem('mea-favorites', JSON.stringify(['anonymous-recipe']))
    mocks.authState.user = { uid: 'user-a' }
    mocks.getFavoriteIDs.mockReturnValueOnce(authenticatedRequest)
    const { rerender } = render(provider())
    await waitFor(() => expect(mocks.getFavoriteIDs).toHaveBeenCalledWith('user-a'))

    mocks.authState.user = null
    rerender(provider())
    await waitFor(() => {
      expect(screen.getByTestId('favorites').textContent).toBe('ready:anonymous-recipe')
    })

    await act(async () => {
      resolveAuthenticated(new Set(['authenticated-recipe']))
      await authenticatedRequest
    })

    expect(screen.getByTestId('favorites').textContent).toBe('ready:anonymous-recipe')
  })
})
