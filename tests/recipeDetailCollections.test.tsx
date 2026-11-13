// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  favorite: vi.fn(), wanted: vi.fn(),
  recipe: { id: 'sample', recipeID: 'sample', title: 'Sample Recipe', content: 'INGREDIENTS\nSalt\n\nINSTRUCTIONS\nAdd salt.', category: 'Sides', cuisine: 'american', imageURL: '', sourceURL: '', sourceFile: '', labels: '', hasImage: '', created: '', modified: '' },
}))
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'sample' }), useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }))
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('@/components/AppDataProvider', () => ({ useAppData: () => ({
  metas: {}, metasError: null, favoritesError: null, toggleFavorite: mocks.favorite,
  isFavorite: () => false, toggleWantToTry: mocks.wanted, isWantToTry: () => false,
  refetchMetas: vi.fn(), refetchFavorites: vi.fn(), refetchRecipes: vi.fn(), refetchCookingHistory: vi.fn(),
}) }))
vi.mock('@/lib/recipes', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/recipes')>(), getRecipeById: vi.fn().mockResolvedValue(mocks.recipe) }))
vi.mock('@/components/NutritionSection', () => ({ default: () => null }))
vi.mock('@/components/RecipeImage', () => ({ default: () => null }))
import RecipeDetailPage from '@/app/recipes/[id]/page'

afterEach(() => { cleanup(); vi.clearAllMocks() })

it('keeps the two icon-only collection actions adjacent and independent', async () => {
  render(<RecipeDetailPage />)
  const favorite = await screen.findByRole('button', { name: 'Add to favorites' })
  const wanted = screen.getByRole('button', { name: 'Add to Want to Try' })
  expect(favorite.nextElementSibling).toBe(wanted)
  expect(wanted.textContent).toBe('')
  expect(wanted.getAttribute('aria-pressed')).toBe('false')
  fireEvent.click(wanted)
  expect(mocks.wanted).toHaveBeenCalledWith('sample')
  expect(mocks.favorite).not.toHaveBeenCalled()
  fireEvent.click(favorite)
  expect(mocks.favorite).toHaveBeenCalledWith('sample')
  expect(mocks.wanted).toHaveBeenCalledTimes(1)
})
