// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Recipe } from '@/types/recipe'
import type { RecipeMeta } from '@/lib/userdata'
import { RECIPE_CATEGORIES } from '@/lib/recipeCategories'

const mocks = vi.hoisted(() => ({
  user: { uid: 'user-1' },
  saveRecipeMeta: vi.fn(),
  updateRecipeServings: vi.fn(),
}))

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ user: mocks.user }),
}))

vi.mock('@/lib/userdata', () => ({
  saveRecipeMeta: mocks.saveRecipeMeta,
}))

vi.mock('@/lib/recipes', () => ({
  updateRecipeServings: mocks.updateRecipeServings,
}))

import RecipeEditModal from '@/components/RecipeEditModal'

function recipe(category: string, id = 'test-recipe'): Recipe {
  return {
    id,
    recipeID: id,
    title: 'Test Recipe',
    content: 'INGREDIENTS\n1 test ingredient\n\nINSTRUCTIONS\nCook it.',
    category,
    cuisine: 'test',
    imageURL: '',
    sourceURL: '',
    sourceFile: '',
    labels: '',
    hasImage: 'false',
    created: '',
    modified: '',
  }
}

function renderModal(recipeCategory: string, meta: RecipeMeta | null = null, id = 'test-recipe') {
  const props = {
    recipe: recipe(recipeCategory, id),
    meta,
    onClose: vi.fn(),
    onSaved: vi.fn(),
  }
  render(<RecipeEditModal {...props} />)
  return props
}

function categoryControl(): HTMLSelectElement {
  return screen.getByRole('combobox') as HTMLSelectElement
}

function titleControl(): HTMLInputElement {
  return screen.getAllByRole('textbox')[0] as HTMLInputElement
}

beforeEach(() => {
  mocks.saveRecipeMeta.mockReset().mockResolvedValue(undefined)
  mocks.updateRecipeServings.mockReset()
})

afterEach(cleanup)

describe('RecipeEditModal category display and persistence', () => {
  it('renders the exact canonical taxonomy from the shared contract', () => {
    renderModal('')

    expect(Array.from(categoryControl().options).map(option => option.value)).toEqual([
      '',
      ...RECIPE_CATEGORIES,
    ])
  })

  it('offers Sides, separate Breakfast and Snacks, Drinks, and Sauces & Condiments', () => {
    renderModal('')
    const values = Array.from(categoryControl().options).map(option => option.value)

    expect(values).toEqual(expect.arrayContaining([
      'Sides', 'Breakfast', 'Snacks', 'Drinks', 'Sauces & Condiments',
    ]))
    expect(values).not.toContain('Breakfast, Snacks & Sides')
  })

  it('displays a listed shared category', () => {
    renderModal('Seafood')

    expect(categoryControl().value).toBe('Seafood')
  })

  it('displays the placeholder for a missing category', () => {
    renderModal('')

    const category = categoryControl()
    expect(category.value).toBe('')
    expect(category.selectedOptions[0]?.textContent).toBe('Select category')
    expect(category.value).not.toBe('Chicken & Poultry')
  })

  it('does not manufacture a category when an unrelated edit is saved', async () => {
    renderModal('')
    fireEvent.change(titleControl(), {
      target: { value: 'Updated Recipe' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(mocks.saveRecipeMeta).toHaveBeenCalledTimes(1))
    const savedMeta = mocks.saveRecipeMeta.mock.calls[0][2] as RecipeMeta
    expect(savedMeta.overrides).toEqual({ title: 'Updated Recipe' })
    expect(savedMeta.overrides).not.toHaveProperty('category')
    expect(JSON.stringify(savedMeta)).not.toContain('Chicken & Poultry')
  })

  it('saves an intentionally selected listed category', async () => {
    renderModal('')
    fireEvent.change(categoryControl(), { target: { value: 'Seafood' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(mocks.saveRecipeMeta).toHaveBeenCalledTimes(1))
    expect(mocks.saveRecipeMeta.mock.calls[0][2]).toMatchObject({
      overrides: { category: 'Seafood' },
    })
  })

  it('displays a recognized personal category override', () => {
    renderModal('Chicken & Poultry', { overrides: { category: 'Seafood' } })

    expect(categoryControl().value).toBe('Seafood')
  })

  it('displays canonical Sides and does not rewrite it on unrelated save', async () => {
    renderModal('Sides')
    expect(categoryControl().value).toBe('Sides')
    expect(categoryControl().selectedOptions[0]?.textContent).toBe('Sides')

    fireEvent.change(titleControl(), {
      target: { value: 'Updated Recipe' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(mocks.saveRecipeMeta).toHaveBeenCalledTimes(1))
    const savedMeta = mocks.saveRecipeMeta.mock.calls[0][2] as RecipeMeta
    expect(savedMeta.overrides).toEqual({ title: 'Updated Recipe' })
    expect(savedMeta.overrides).not.toHaveProperty('category')
  })

  it('displays and preserves an unlisted personal category override', async () => {
    renderModal('Seafood', { overrides: { category: 'Other' } })
    expect(categoryControl().value).toBe('Other')
    expect(categoryControl().selectedOptions[0]?.textContent).toBe('Legacy / unresolved: Other')

    fireEvent.change(titleControl(), {
      target: { value: 'Updated Recipe' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(mocks.saveRecipeMeta).toHaveBeenCalledTimes(1))
    expect(mocks.saveRecipeMeta.mock.calls[0][2]).toMatchObject({
      overrides: { title: 'Updated Recipe', category: 'Other' },
    })
  })

  it('shows a deterministic legacy alias canonically without saving that normalization', async () => {
    renderModal('Chicken')
    expect(categoryControl().value).toBe('Chicken & Poultry')

    fireEvent.change(titleControl(), { target: { value: 'Updated Recipe' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(mocks.saveRecipeMeta).toHaveBeenCalledTimes(1))
    expect(mocks.saveRecipeMeta.mock.calls[0][2]).toMatchObject({
      overrides: { title: 'Updated Recipe' },
    })
  })

  it('uses recipe-specific compatibility for a legacy personal override', () => {
    renderModal('Sides', { overrides: { category: 'Breakfast, Snacks & Sides' } }, 'bread')

    expect(categoryControl().value).toBe('Sides')
  })

  it('does not write when canceled', () => {
    const { onClose } = renderModal('Seafood')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(mocks.saveRecipeMeta).not.toHaveBeenCalled()
  })
})
