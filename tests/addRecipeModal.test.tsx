// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RECIPE_CATEGORIES } from '@/lib/recipeCategories'

const mocks = vi.hoisted(() => ({
  addToQueue: vi.fn(),
  push: vi.fn(),
  getIdToken: vi.fn(),
}))

vi.mock('@/lib/queue', () => ({ addToQueue: mocks.addToQueue }))
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'user-1', getIdToken: mocks.getIdToken } }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }))

import AddRecipeModal from '@/components/AddRecipeModal'

function aiResult(category: unknown) {
  return {
    title: 'Test Recipe',
    cuisine: 'test',
    category,
    imageURL: '',
    description: '',
    servings: '4',
    prepTime: '',
    cookTime: '',
    ingredients: ['1 test ingredient'],
    instructions: ['Cook it.'],
  }
}

async function openPreview(category: unknown) {
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(aiResult(category))))
  render(<AddRecipeModal onClose={vi.fn()} />)
  fireEvent.change(screen.getByPlaceholderText('https://www.seriouseats.com/recipes/...'), {
    target: { value: 'https://recipes.example/test' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Fetch & Parse Recipe' }))
  await screen.findByText('Review & Edit')
  return screen.getByRole('combobox') as HTMLSelectElement
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  mocks.getIdToken.mockReset().mockResolvedValue('token')
  mocks.addToQueue.mockReset().mockResolvedValue('queue-1')
  mocks.push.mockReset()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('AddRecipeModal category review', () => {
  it('keeps missing or invalid AI categories unresolved instead of defaulting to Chicken', async () => {
    const select = await openPreview('Chicken')

    expect(select.value).toBe('')
    expect(select.selectedOptions[0]?.textContent).toBe('Select category')
    expect(select.value).not.toBe('Chicken & Poultry')
  })

  it('uses the exact canonical choices', async () => {
    const select = await openPreview('')

    expect(Array.from(select.options).map(option => option.value)).toEqual([
      '',
      ...RECIPE_CATEGORIES,
    ])
  })

  it('stages an intentional canonical selection without inventing a default', async () => {
    const select = await openPreview('')
    fireEvent.change(select, { target: { value: 'Sides' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to review queue' }))

    await waitFor(() => expect(mocks.addToQueue).toHaveBeenCalledTimes(1))
    expect(mocks.addToQueue.mock.calls[0][1]).toMatchObject({ category: 'Sides' })
  })
})
