// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CookingMode from '@/components/CookingMode'
import { canonicalizeCookingMappingSource, computeCookingMappingSourceHash } from '@/lib/cookingStepMapping'
import type { CookingStepIngredientMap } from '@/types/recipe'

const baseProps = {
  title: 'Mapping Fixture',
  sourceURL: 'https://recipes.example/fixture',
  onClose: vi.fn(),
}

async function hybridIngredientMapFor(
  ingredients: string[],
  instructions: string[],
  ingredientIndex: number,
): Promise<CookingStepIngredientMap> {
  return {
    schemaVersion: 1,
    parserVersion: 'recipe-content-v1',
    engineVersion: 'hybrid-v3',
    sourceHash: await computeCookingMappingSourceHash(ingredients, instructions),
    steps: [{
      instructionIndex: 0,
      ingredients: [{ ingredientIndex, confidence: 'high', provenance: 'ai' }],
    }],
  }
}

async function hybridIngredientMap(): Promise<{
  ingredients: string[]
  instructions: string[]
  mapping: CookingStepIngredientMap
}> {
  const ingredients = ['For the sauce:', '1 tbsp olive oil']
  const instructions = ['Add the oil to the marinade.']
  return {
    ingredients,
    instructions,
    mapping: await hybridIngredientMapFor(ingredients, instructions, 1),
  }
}

async function preparedComponentMap(): Promise<{
  ingredients: string[]
  instructions: string[]
  mapping: CookingStepIngredientMap
}> {
  const ingredients = ['For the green sauce:', '1 cup parsley', '1 tbsp olive oil']
  const instructions = ['Toss with the prepared green sauce.']
  return {
    ingredients,
    instructions,
    mapping: {
      schemaVersion: 1,
      parserVersion: 'recipe-content-v1',
      engineVersion: 'hybrid-v3',
      sourceHash: await computeCookingMappingSourceHash(ingredients, instructions),
      steps: [{
        instructionIndex: 0,
        ingredients: [],
        preparedComponents: [{ label: 'Green sauce', confidence: 'high', provenance: 'ai' }],
      }],
    },
  }
}

function renderMode(ingredients: string[], instructions: string[], persistedMap?: CookingStepIngredientMap) {
  return render(
    <CookingMode
      {...baseProps}
      ingredients={ingredients}
      instructions={instructions}
      persistedMap={persistedMap}
    />,
  )
}

function allIngredientsModal(): HTMLElement {
  const modal = screen.getByRole('heading', { name: 'All Ingredients' }).closest('.bg-surface')
  if (!modal) throw new Error('All Ingredients modal not found')
  return modal as HTMLElement
}

describe('Cooking Mode mapping cutover', () => {
  beforeEach(() => {
    baseProps.onClose.mockReset()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    expect(fetch).not.toHaveBeenCalled()
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('shows deterministic safety first, then consumes a valid AI-only persisted relationship', async () => {
    const fixture = await hybridIngredientMap()
    renderMode(fixture.ingredients, fixture.instructions, fixture.mapping)

    expect(screen.queryByRole('button', { name: /1 Ingredient/ })).toBeNull()
    const toggle = await screen.findByRole('button', { name: /1 Ingredient/ })
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: '1 tbsp olive oil' })).not.toBeNull()
  })

  it('does not let a stale async resolution overwrite newer effective content', async () => {
    const first = await hybridIngredientMap()
    const secondIngredients = ['For the soup:', '1 tsp sesame oil']
    const secondInstructions = ['Add the oil to the marinade.']
    const secondMapping = await hybridIngredientMapFor(secondIngredients, secondInstructions, 1)
    const actualDigest = crypto.subtle.digest.bind(crypto.subtle)
    const firstBytes = new TextEncoder().encode(canonicalizeCookingMappingSource(first.ingredients, first.instructions))
    const firstDigest = await actualDigest('SHA-256', firstBytes)
    let releaseFirst!: () => void
    const delayedFirst = new Promise<ArrayBuffer>(resolve => {
      releaseFirst = () => resolve(firstDigest)
    })
    vi.spyOn(crypto.subtle, 'digest')
      .mockImplementationOnce(() => delayedFirst)
      .mockImplementation((algorithm, data) => actualDigest(algorithm, data))

    const { rerender } = render(
      <CookingMode {...baseProps} ingredients={first.ingredients} instructions={first.instructions} persistedMap={first.mapping} />,
    )
    rerender(
      <CookingMode {...baseProps} ingredients={secondIngredients} instructions={secondInstructions} persistedMap={secondMapping} />,
    )

    const toggle = await screen.findByRole('button', { name: /1 Ingredient/ })
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: '1 tsp sesame oil' })).not.toBeNull()
    await act(async () => { releaseFirst() })
    await waitFor(() => expect(screen.queryByRole('button', { name: '1 tbsp olive oil' })).toBeNull())
    expect(screen.getByRole('button', { name: '1 tsp sesame oil' })).not.toBeNull()
  })

  it('uses deterministic mapping for garlic and optional Parmesan without a stored map', async () => {
    renderMode(
      ['2 garlic cloves, minced', '¼ cup Parmesan cheese (optional)'],
      ['Add the garlic.', 'Sprinkle with Parmesan.'],
    )
    const toggles = screen.getAllByRole('button', { name: /1 Ingredient/ })
    fireEvent.click(toggles[0])
    fireEvent.click(toggles[1])
    expect(screen.getByRole('button', { name: '2 garlic cloves, minced' })).not.toBeNull()
    expect(screen.getByRole('button', { name: '¼ cup Parmesan cheese (optional)' })).not.toBeNull()
    await waitFor(() => expect(fetch).not.toHaveBeenCalled())
  })

  it('does not recreate the legacy terminal leaves collision', async () => {
    renderMode(['2 bay leaves', '1 cup mint leaves'], ['Add the bay leaves.'])
    fireEvent.click(screen.getByRole('button', { name: /1 Ingredient/ }))
    expect(screen.getByRole('button', { name: '2 bay leaves' })).not.toBeNull()
    expect(screen.queryByRole('button', { name: '1 cup mint leaves' })).toBeNull()
  })

  it('does not broadly match a raw sauce from a prepared sauce reference', () => {
    renderMode(['2 tbsp Worcestershire sauce'], ['Baste with the prepared sauce.'])
    expect(screen.queryByRole('button', { name: /^\d+ Ingredients?$/ })).toBeNull()
  })

  it('renders persisted prepared components as non-checkbox context and excludes them from All Ingredients', async () => {
    const fixture = await preparedComponentMap()
    renderMode(fixture.ingredients, fixture.instructions, fixture.mapping)

    const context = await screen.findByLabelText('Prepared components for step 1')
    expect(context.textContent).toContain('Prepared: Green sauce')
    expect(within(context).queryByRole('button')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'All Ingredients' }))
    expect(within(allIngredientsModal()).queryByText('Prepared: Green sauce')).toBeNull()
  })

  it('renders a remaining usage qualifier without changing raw ingredient text', () => {
    renderMode(['4 tbsp olive oil'], ['Add the remaining olive oil.'])
    fireEvent.click(screen.getByRole('button', { name: /1 Ingredient/ }))
    const ingredient = screen.getByRole('button', { name: '4 tbsp olive oil · remaining' })
    expect(ingredient.textContent).toContain('4 tbsp olive oil')
    expect(ingredient.textContent).toContain('remaining')
  })

  it('renders a partial quantity qualifier without doing quantity arithmetic', () => {
    renderMode(['1 cup Parmesan cheese'], ['Reserve ¼ cup of the cheese.'])
    fireEvent.click(screen.getByRole('button', { name: /1 Ingredient/ }))
    const ingredient = screen.getByRole('button', { name: '1 cup Parmesan cheese · use ¼ cup' })
    expect(ingredient.textContent).toBe('1 cup Parmesan cheese · use ¼ cup')
  })

  it('keeps duplicate identical ingredient rows separately checkable by index', () => {
    renderMode(
      ['For the marinade:', '1 tbsp olive oil', 'For the sauce:', '1 tbsp olive oil'],
      ['For the marinade, add the olive oil.'],
    )
    fireEvent.click(screen.getByRole('button', { name: /1 Ingredient/ }))
    fireEvent.click(screen.getByRole('button', { name: '1 tbsp olive oil' }))
    fireEvent.click(screen.getByRole('button', { name: 'All Ingredients' }))

    const duplicateRows = within(allIngredientsModal()).getAllByRole('button', { name: '1 tbsp olive oil' })
    expect(duplicateRows).toHaveLength(2)
    expect(duplicateRows[0].getAttribute('aria-pressed')).toBe('true')
    expect(duplicateRows[1].getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(duplicateRows[1])
    expect(duplicateRows[0].getAttribute('aria-pressed')).toBe('true')
    expect(duplicateRows[1].getAttribute('aria-pressed')).toBe('true')
  })

  it('shares checked state between a step and All Ingredients', () => {
    renderMode(['1 tsp salt'], ['Add salt.'])
    fireEvent.click(screen.getByRole('button', { name: /1 Ingredient/ }))
    fireEvent.click(screen.getByRole('button', { name: '1 tsp salt' }))
    fireEvent.click(screen.getByRole('button', { name: 'All Ingredients' }))
    expect(within(allIngredientsModal()).getByRole('button', { name: '1 tsp salt' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('keeps empty mapped steps navigable', () => {
    renderMode(['salt'], ['Preheat oven to 400°F.', 'Bake until golden.'])
    expect(screen.getByText('Step 1 of 2')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    expect(screen.getByText('Step 2 of 2')).not.toBeNull()
  })

  it('preserves tap-to-start timers', () => {
    renderMode([], ['Simmer for 1 minute.'])
    fireEvent.click(screen.getByRole('button', { name: 'Start 1m timer' }))
    expect(screen.getByText('1:00')).not.toBeNull()
  })

  it('preserves finish and cooked-capture behavior', async () => {
    const onMarkCooked = vi.fn().mockResolvedValue(undefined)
    render(
      <CookingMode
        {...baseProps}
        ingredients={['salt']}
        instructions={['Add salt.']}
        onMarkCooked={onMarkCooked}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Finish cooking' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mark cooked' }))
    await waitFor(() => expect(onMarkCooked).toHaveBeenCalledWith(1))
    expect(baseProps.onClose).toHaveBeenCalledOnce()
  })
})
