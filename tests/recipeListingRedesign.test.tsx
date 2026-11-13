// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import type { Recipe } from '@/types/recipe'

const mocks = vi.hoisted(() => ({ toggleWant: vi.fn(), recipes: [
  { id: 'soup', recipeID: 'soup', title: 'Black Bean Soup', content: 'black beans onion', category: 'Soups, Stews & Chili', cuisine: 'mexican', imageURL: '', sourceURL: '', sourceFile: '', labels: '', hasImage: '', created: '', modified: '', prepTime: '10 min', cookTime: '20 min' },
  { id: 'noodles', recipeID: 'noodles', title: 'Noodles', content: 'noodles garlic', category: 'Pasta, Noodles & Rice', cuisine: 'asian', imageURL: '', sourceURL: '', sourceFile: '', labels: '', hasImage: '', created: '', modified: '', prepTime: '15 min' },
] as Recipe[] }))
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('@/components/AppDataProvider', () => ({ useAppData: () => ({ recipes: mocks.recipes, metas: {}, recipesLoading: false, recipesError: '', metasError: '', wantToTry: new Set(['soup']), wantToTryLoading: false, wantToTryError: '', refetchWantToTry: vi.fn(), refetchRecipes: vi.fn(), refetchMetas: vi.fn(), isWantToTry: (id: string) => id === 'soup', toggleWantToTry: mocks.toggleWant }) }))
vi.mock('@/lib/userdata', () => ({ getAllWeekPlans: vi.fn(), addRecipeToWeekPlan: vi.fn(), weekIDFromDate: vi.fn(), resolveRecipeRole: vi.fn() }))
vi.mock('@/components/AddRecipeModal', () => ({ default: () => null }))
import RecipesPage from '@/app/recipes/page'

afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks() })

describe('Recipes listing redesign', () => {
  it('hydrates persisted collection and sort selections without stale server attributes', async () => {
    localStorage.setItem('mea_recipes_filter', 'wantToTry')
    localStorage.setItem('mea_recipes_sort', 'az')
    const container = document.createElement('div')
    document.body.appendChild(container)
    container.innerHTML = renderToString(<RecipesPage />)
    const errors = vi.fn()
    let root: ReturnType<typeof hydrateRoot>
    await act(async () => { root = hydrateRoot(container, <RecipesPage />, { onRecoverableError: errors }) })
    expect(within(container).getByRole('button', { name: 'Want to Try' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(container).getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('false')
    expect((within(container).getByRole('combobox', { name: 'Sort recipes' }) as HTMLSelectElement).value).toBe('az')
    expect(within(container).queryByRole('link', { name: /Noodles/ })).toBeNull()
    expect(errors).not.toHaveBeenCalled()
    await act(async () => root.unmount())
    container.remove()
  })

  it('searches ingredients, reports empty results, and clears search independently', async () => {
    render(<RecipesPage />)
    const search = screen.getByRole('textbox', { name: 'Search recipes and ingredients' })
    fireEvent.change(search, { target: { value: 'garlic' } })
    await waitFor(() => expect(screen.queryByRole('link', { name: /Black Bean Soup/ })).toBeNull())
    expect(screen.getByRole('link', { name: /Noodles/ })).toBeTruthy()
    fireEvent.change(search, { target: { value: 'zzzzzzzz' } })
    await waitFor(() => expect(screen.getByText('No recipes found')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect((search as HTMLInputElement).value).toBe('')
    await waitFor(() => expect(screen.getByRole('link', { name: /Black Bean Soup/ })).toBeTruthy())
  })
  it('exposes sorting and independent resettable filters', () => {
    render(<RecipesPage />)
    const sort = screen.getByRole('combobox', { name: 'Sort recipes' }) as HTMLSelectElement
    fireEvent.change(sort, { target: { value: 'az' } })
    expect(sort.value).toBe('az')
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), { target: { value: 'Soups, Stews & Chili' } })
    expect(screen.getByRole('button', { name: 'Filters (1)' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.queryByRole('link', { name: /Noodles/ })).toBeNull()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search recipes and ingredients' }), { target: { value: 'soup' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }))
    expect((screen.getByRole('textbox', { name: 'Search recipes and ingredients' }) as HTMLInputElement).value).toBe('soup')
    expect(sort.value).toBe('az')
  })
  it('keeps Want to Try separate from recipe navigation and links to Favorites', () => {
    render(<RecipesPage />)
    expect(screen.getByRole('link', { name: 'Favorites' }).getAttribute('href')).toBe('/favorites')
    fireEvent.click(screen.getByRole('button', { name: 'Want to Try' }))
    expect(screen.getByRole('button', { name: 'Want to Try' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('link', { name: /Noodles/ })).toBeNull()
    const card = screen.getByRole('link', { name: /Black Bean Soup/ }).closest('article')!
    expect(within(card).getByRole('link').querySelector('button')).toBeNull()
    fireEvent.click(within(card).getByRole('button', { name: /Remove Black Bean Soup from Want to Try/ }))
    expect(mocks.toggleWant).toHaveBeenCalledWith('soup')
  })
  it('shows a calculated time only when both components are available', () => {
    render(<RecipesPage />)
    expect(screen.getByText('30 min')).toBeTruthy()
    expect(screen.queryByText('15 min')).toBeNull()
  })
})
