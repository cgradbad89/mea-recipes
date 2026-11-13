// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const data = vi.hoisted(() => ({
  favoritesError: 'Could not load favorites', recipesError: null as string | null,
  refetchFavorites: vi.fn().mockResolvedValue(undefined), refetchRecipes: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'synthetic-user' } }) }))
vi.mock('@/components/AppDataProvider', () => ({ useAppData: () => ({
  favorites: new Set(), favoritesLoading: false, favoritesError: data.favoritesError,
  refetchFavorites: data.refetchFavorites, metas: {}, recipes: [], recipesLoading: false,
  recipesError: data.recipesError, refetchRecipes: data.refetchRecipes,
}) }))
vi.mock('@/components/RecipeCard', () => ({ default: () => null }))
vi.mock('@/components/SignInOptions', () => ({ default: () => null }))
vi.mock('@/lib/userdata', () => ({ getAllWeekPlans: vi.fn() }))
import FavoritesPage from '@/app/favorites/page'

afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks() })

describe('Favorites loading errors', () => {
  it('shows a retry instead of an empty collection when favorites cannot load', () => {
    render(<FavoritesPage />)
    expect(screen.getByRole('alert').textContent).toContain('Couldn’t load your favorites')
    expect(screen.queryByText('No favorites yet')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(data.refetchFavorites).toHaveBeenCalledOnce()
    expect(data.refetchRecipes).toHaveBeenCalledOnce()
  })
})
