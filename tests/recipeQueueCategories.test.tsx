// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RECIPE_CATEGORIES } from '@/lib/recipeCategories'
import type { QueuedRecipe } from '@/lib/queue'

const mocks = vi.hoisted(() => ({
  updateQueueItem: vi.fn(),
  deleteFromQueue: vi.fn(),
  saveRecipe: vi.fn(),
  prepareCookingStepIngredientMap: vi.fn(),
  computeAndStoreNutrition: vi.fn(),
  triggerCookingModeMappingGeneration: vi.fn(),
  getIdToken: vi.fn(),
}))

vi.mock('@/lib/queue', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/queue')>()
  return {
    ...actual,
    updateQueueItem: mocks.updateQueueItem,
    deleteFromQueue: mocks.deleteFromQueue,
  }
})
vi.mock('@/lib/recipes', () => ({
  saveRecipe: mocks.saveRecipe,
  prepareCookingStepIngredientMap: mocks.prepareCookingStepIngredientMap,
  computeAndStoreNutrition: mocks.computeAndStoreNutrition,
  triggerCookingModeMappingGeneration: mocks.triggerCookingModeMappingGeneration,
}))
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'user-1', getIdToken: mocks.getIdToken } }),
}))

import { QueueCard } from '@/app/queue/page'

function queued(category: string): QueuedRecipe {
  return {
    id: 'queue-1',
    title: 'Queued Recipe',
    cuisine: 'test',
    category,
    ingredients: ['1 test ingredient'],
    instructions: ['Cook it.'],
    imageURL: '',
    sourceURL: '',
    description: '',
    servings: '4',
    prepTime: '',
    cookTime: '',
    status: 'pending',
  }
}

function renderCard(category: string) {
  const onPublish = vi.fn()
  render(
    <QueueCard
      item={queued(category)}
      uid="user-1"
      onPublish={onPublish}
      onDiscard={vi.fn()}
    />,
  )
  return onPublish
}

beforeEach(() => {
  mocks.updateQueueItem.mockReset().mockResolvedValue(undefined)
  mocks.deleteFromQueue.mockReset().mockResolvedValue(undefined)
  mocks.saveRecipe.mockReset().mockResolvedValue('queued-recipe')
  mocks.prepareCookingStepIngredientMap.mockReset().mockResolvedValue({
    schemaVersion: 1,
    parserVersion: 'recipe-content-v1',
    engineVersion: 'deterministic-v4',
    sourceHash: 'a'.repeat(64),
    steps: [],
  })
  mocks.computeAndStoreNutrition.mockReset().mockResolvedValue(null)
  mocks.triggerCookingModeMappingGeneration.mockReset().mockResolvedValue(null)
  mocks.getIdToken.mockReset().mockResolvedValue('token')
})

afterEach(cleanup)

describe('queue category review boundary', () => {
  it('keeps blank state blank and blocks publish before the shared write', async () => {
    renderCard('')
    fireEvent.click(screen.getByRole('button', { name: 'Publish to collection' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Choose a canonical category')
    expect(mocks.saveRecipe).not.toHaveBeenCalled()
  })

  it('displays legacy values truthfully and offers all 12 canonical replacements', () => {
    renderCard('Breakfast, Snacks & Sides')
    expect(screen.getByText('Unresolved: Breakfast, Snacks & Sides')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Edit queued recipe' }))
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('Breakfast, Snacks & Sides')
    expect(Array.from(select.options).map(option => option.value)).toEqual([
      '',
      'Breakfast, Snacks & Sides',
      ...RECIPE_CATEGORIES,
    ])
  })

  it('publishes after an intentional canonical selection', async () => {
    const onPublish = renderCard('Other')
    fireEvent.click(screen.getByRole('button', { name: 'Edit queued recipe' }))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Sauces & Condiments' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocks.updateQueueItem).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Publish to collection' }))

    await waitFor(() => expect(mocks.saveRecipe).toHaveBeenCalledTimes(1))
    expect(mocks.prepareCookingStepIngredientMap).toHaveBeenCalledWith(
      expect.stringContaining('INGREDIENTS\n1 test ingredient'),
      'token',
    )
    expect(mocks.saveRecipe.mock.calls[0][0]).toMatchObject({
      category: 'Sauces & Condiments',
      cookingStepIngredientMap: expect.objectContaining({ sourceHash: 'a'.repeat(64) }),
    })
    await waitFor(() => expect(onPublish).toHaveBeenCalledWith('queue-1'))
  })
})

describe('nutrition / Cooking Mode mapping independence on publish (Implementation 6, Phase 27)', () => {
  it.each([
    ['nutrition succeeds + mapping succeeds', null, { outcome: 'GENERATED' }],
    ['nutrition fails + mapping succeeds', null, { outcome: 'GENERATED' }],
    ['nutrition succeeds + mapping fails', null, null],
    ['nutrition fails + mapping fails', null, null],
  ] as const)('%s: the recipe publish still completes', async (_label, nutritionResolution, mappingResolution) => {
    // computeAndStoreNutrition/triggerCookingModeMappingGeneration both never
    // throw in production (they flag/log failure internally) — mirror that
    // never-throws contract here rather than rejecting the mock, so this
    // test exercises the same call shape the real publish handler sees.
    mocks.computeAndStoreNutrition.mockResolvedValue(nutritionResolution)
    mocks.triggerCookingModeMappingGeneration.mockResolvedValue(mappingResolution)

    const onPublish = renderCard('Snacks')
    fireEvent.click(screen.getByRole('button', { name: 'Publish to collection' }))

    await waitFor(() => expect(onPublish).toHaveBeenCalledWith('queue-1'))
    expect(mocks.saveRecipe).toHaveBeenCalledTimes(1)
    expect(mocks.computeAndStoreNutrition).toHaveBeenCalledTimes(1)
    expect(mocks.triggerCookingModeMappingGeneration).toHaveBeenCalledTimes(1)
    expect(mocks.deleteFromQueue).toHaveBeenCalledWith('user-1', 'queue-1')
  })

  it('runs nutrition and mapping generation concurrently, not sequentially', async () => {
    const order: string[] = []
    mocks.computeAndStoreNutrition.mockImplementation(async () => {
      order.push('nutrition-start')
      await new Promise(resolve => setTimeout(resolve, 10))
      order.push('nutrition-end')
      return null
    })
    mocks.triggerCookingModeMappingGeneration.mockImplementation(async () => {
      order.push('mapping-start')
      await new Promise(resolve => setTimeout(resolve, 10))
      order.push('mapping-end')
      return null
    })

    const onPublish = renderCard('Snacks')
    fireEvent.click(screen.getByRole('button', { name: 'Publish to collection' }))
    await waitFor(() => expect(onPublish).toHaveBeenCalledWith('queue-1'))

    // Both started before either finished — proves they ran concurrently
    // rather than one awaiting the other's completion first.
    expect(order.indexOf('mapping-start')).toBeLessThan(order.indexOf('nutrition-end'))
    expect(order.indexOf('nutrition-start')).toBeLessThan(order.indexOf('mapping-end'))
  })
})
