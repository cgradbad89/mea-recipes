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
    const { onSaved } = renderModal('Seafood', { overrides: { category: 'Other' } })
    expect(categoryControl().value).toBe('Other')
    expect(categoryControl().selectedOptions[0]?.textContent).toBe('Legacy / unresolved: Other')

    fireEvent.change(titleControl(), {
      target: { value: 'Updated Recipe' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(mocks.saveRecipeMeta).toHaveBeenCalledTimes(1))
    expect(mocks.saveRecipeMeta.mock.calls[0][2]).toEqual({
      overrides: { title: 'Updated Recipe' },
    })
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({
      overrides: { title: 'Updated Recipe', category: 'Other' },
    }))
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

function contentControl(): HTMLTextAreaElement {
  return screen.getAllByRole('textbox').find(control => control.tagName === 'TEXTAREA') as HTMLTextAreaElement
}

async function saveModal() {
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  await waitFor(() => expect(mocks.saveRecipeMeta).toHaveBeenCalledTimes(1))
  return mocks.saveRecipeMeta.mock.calls[0][2] as Partial<RecipeMeta>
}

describe('RecipeEditModal explicit private patch intent', () => {
  it('saves new personal content without replaying snapshot metadata or servings', async () => {
    const meta = { recipeID: 'stale-id', note: 'Snapshot note', rating: 3, updatedAt: 'old-time', overrides: { servings: 2 } }
    const { onSaved } = renderModal('Seafood', meta)
    fireEvent.change(contentControl(), { target: { value: 'Personal content' } })

    expect(await saveModal()).toEqual({ overrides: { content: 'Personal content' } })
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({
      ...meta, overrides: { servings: 2, content: 'Personal content' },
    }))
    expect(mocks.updateRecipeServings).not.toHaveBeenCalled()
  })

  it('explicitly clears reverted content while retaining title and sibling overrides in clean callback metadata', async () => {
    const { recipe: shared, onSaved } = renderModal('Seafood', {
      overrides: { content: 'Personal content', title: 'Personal title', servings: 2, prepTime: '5 min' },
    })
    fireEvent.change(contentControl(), { target: { value: shared.content } })

    const patch = await saveModal()
    expect(patch).toEqual({ overrides: { content: undefined } })
    expect(Object.hasOwn(patch.overrides!, 'content')).toBe(true)
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({
      overrides: { title: 'Personal title', servings: 2, prepTime: '5 min' },
    }))
    expect(onSaved.mock.calls[0][0].overrides).not.toHaveProperty('content')
  })

  it('clears the final string override individually while retaining personal servings', async () => {
    const { recipe: shared, onSaved } = renderModal('Seafood', {
      overrides: { content: 'Only personal string', servings: 6 },
    })
    fireEvent.change(contentControl(), { target: { value: shared.content } })

    expect(await saveModal()).toEqual({ overrides: { content: undefined } })
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ overrides: { servings: 6 } }))
  })

  it('full reset requires confirmation, sends only whole-map clear intent, and preserves callback notes/ratings', async () => {
    const { onSaved, onClose } = renderModal('Seafood', {
      note: 'Keep note', rating: 4, overrides: { content: 'Personal', title: 'Personal title', servings: 2 },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reset to original' }))
    expect(mocks.saveRecipeMeta).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Click again to reset' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(mocks.saveRecipeMeta).toHaveBeenCalledExactlyOnceWith('user-1', 'test-recipe', { overrides: undefined })
    expect(Object.hasOwn(mocks.saveRecipeMeta.mock.calls[0][2], 'overrides')).toBe(true)
    expect(onSaved).toHaveBeenCalledWith({ note: 'Keep note', rating: 4, overrides: undefined })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(mocks.updateRecipeServings).not.toHaveBeenCalled()
  })

  it('returning all edited strings to shared values clears each field without an implicit full reset', async () => {
    const { recipe: shared, onSaved } = renderModal('Seafood', {
      overrides: {
        title: 'Personal title', cuisine: 'personal', category: 'Sides',
        content: 'Personal content', imageURL: 'https://example.test/personal.jpg',
        prepTime: '5 min', cookTime: '10 min',
      },
    })
    const textboxes = screen.getAllByRole('textbox')
    const values = [shared.title, shared.cuisine, '', '', '', shared.content]
    textboxes.forEach((control, index) => fireEvent.change(control, { target: { value: values[index] } }))
    fireEvent.change(categoryControl(), { target: { value: shared.category } })

    expect(await saveModal()).toEqual({ overrides: {
      title: undefined, cuisine: undefined, category: undefined, content: undefined,
      imageURL: undefined, prepTime: undefined, cookTime: undefined,
    } })
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ overrides: undefined }))
  })

  it('keeps the shared-default servings operation and label while omitting personal servings from the patch', async () => {
    const shared = recipe('Seafood')
    const macros = { calories: 100, protein_g: 10, carbs_g: 10, fat_g: 2, fiber_g: 1, sugar_g: 1 }
    shared.nutrition = { ...macros, servings: 4, total: macros }
    const updatedNutrition = { ...shared.nutrition, servings: 8 }
    mocks.updateRecipeServings.mockResolvedValueOnce(updatedNutrition)
    const onNutritionSaved = vi.fn()
    const onSaved = vi.fn()
    render(<RecipeEditModal recipe={shared} meta={{ overrides: { servings: 2 } }}
      onClose={vi.fn()} onSaved={onSaved} onNutritionSaved={onNutritionSaved} />)
    expect(screen.getByText('Recipe default servings · shared')).toBeTruthy()
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '8' } })

    expect(await saveModal()).toEqual({ overrides: {} })
    await waitFor(() => expect(onNutritionSaved).toHaveBeenCalledWith(updatedNutrition))
    expect(mocks.updateRecipeServings).toHaveBeenCalledExactlyOnceWith(shared.id, 8, shared.nutrition)
    expect(onSaved).toHaveBeenCalledWith({ overrides: { servings: 2 } })
  })
})
