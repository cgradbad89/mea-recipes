// @vitest-environment jsdom

// Presentation-only boundary. Responsive CSS, actual keyboard activation and
// visual wrapping are verified in a browser, not inferred from jsdom layout.
import type { ComponentProps } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import GroceryRecipeSources from '@/components/GroceryRecipeSources'

type SourceProps = ComponentProps<typeof GroceryRecipeSources>
type Reference = SourceProps['display']['references'][number]

function reference(index: number, title = `Recipe ${index}`): Reference {
  return { recipeID: `recipe-${index}`, title, href: `https://mea-recipes.vercel.app/recipes/recipe-${index}` }
}

function props(overrides: Partial<SourceProps> = {}): SourceProps {
  return {
    ingredientName: 'olive oil', isManual: false, sourceCount: 1,
    display: { references: [reference(1)], unresolvedCount: 0 }, catalogState: 'ready',
    ...overrides,
  }
}

afterEach(cleanup)

describe('grocery recipe sources', () => {
  it('renders one contextual new-tab link with safe attributes and no parent-row activation', () => {
    const onRowClick = vi.fn()
    const onRowKeyDown = vi.fn()
    render(<div onClick={onRowClick} onKeyDown={onRowKeyDown}><GroceryRecipeSources {...props()} /></div>)
    const link = screen.getByRole('link', { name: 'Recipe 1 — recipe for olive oil (opens in a new tab)' })
    expect(link.getAttribute('href')).toBe('https://mea-recipes.vercel.app/recipes/recipe-1')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(screen.getByRole('group', { name: 'Used in recipes for olive oil' })).toBeTruthy()
    fireEvent.click(link)
    expect(onRowClick).not.toHaveBeenCalled()
    // Check event boundaries only; native keyboard navigation/activation is
    // exercised in the browser. Escape must still reach an open page picker.
    fireEvent.keyDown(link, { key: 'Escape' })
    expect(onRowKeyDown).toHaveBeenCalledTimes(1)
    expect(onRowKeyDown.mock.calls[0][0].key).toBe('Escape')
    fireEvent.keyDown(link, { key: 'Enter' })
    fireEvent.keyDown(link, { key: ' ' })
    expect(onRowKeyDown).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders two supplied references in order without a disclosure', () => {
    render(<GroceryRecipeSources {...props({
      sourceCount: 2, display: { references: [reference(2), reference(1)], unresolvedCount: 0 },
    })} />)
    expect(screen.getAllByRole('link').map(link => link.textContent)).toEqual(['Recipe 2', 'Recipe 1'])
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('reveals all five references and collapses through the same focused disclosure button', () => {
    const references = Array.from({ length: 5 }, (_, index) => reference(index + 1))
    render(<GroceryRecipeSources {...props({ sourceCount: 5, display: { references, unresolvedCount: 0 } })} />)
    expect(screen.getAllByRole('link')).toHaveLength(2)
    const toggle = screen.getByRole('button', { name: 'Show 3 more recipes for olive oil' })
    expect(toggle.textContent).toBe('+3 more')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    const region = document.getElementById(toggle.getAttribute('aria-controls')!)!
    expect(region.hidden).toBe(true)

    toggle.focus()
    fireEvent.click(toggle)
    expect(screen.getAllByRole('link').map(link => link.textContent)).toEqual(references.map(value => value.title))
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(region.hidden).toBe(false)
    expect(screen.getByRole('button', { name: 'Show fewer recipes for olive oil' })).toBe(toggle)
    expect(toggle.compareDocumentPosition(screen.getByRole('link', { name: /Recipe 3/ })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(toggle.textContent).toBe('Show less')
    fireEvent.click(screen.getByRole('link', { name: /Recipe 5/ }))
    expect(screen.getAllByRole('link')).toHaveLength(5)

    fireEvent.click(toggle)
    expect(document.activeElement).toBe(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getAllByRole('link')).toHaveLength(2)
    expect(region.hidden).toBe(true)
  })

  it('identifies manual items without sources independently of catalog loading', () => {
    render(<GroceryRecipeSources {...props({
      isManual: true, sourceCount: 0, display: { references: [], unresolvedCount: 0 }, catalogState: 'loading',
    })} />)
    expect(screen.getByText('Added manually')).toBeTruthy()
    expect(screen.queryByText('Loading recipes…')).toBeNull()
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })

  it('identifies source-less recipe items without inferring manual entry even when catalog loading failed', () => {
    render(<GroceryRecipeSources {...props({
      sourceCount: 0, display: { references: [], unresolvedCount: 0 }, catalogState: 'error',
    })} />)
    expect(screen.getByText('No recipe linked')).toBeTruthy()
    expect(screen.queryByText('Added manually')).toBeNull()
    expect(screen.queryByText('Recipe links unavailable')).toBeNull()
  })

  it('preserves manual origin alongside a recorded recipe association', () => {
    render(<GroceryRecipeSources {...props({ isManual: true })} />)
    expect(screen.getByText('Added manually · linked to')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Recipe 1/ })).toBeTruthy()
  })

  it('shows neutral unavailable text without links when all recorded references are absent', () => {
    const view = render(<GroceryRecipeSources {...props({
      display: { references: [], unresolvedCount: 1 },
    })} />)
    expect(screen.getByText('Recipe unavailable')).toBeTruthy()
    expect(screen.queryAllByRole('link')).toHaveLength(0)
    view.rerender(<GroceryRecipeSources {...props({
      sourceCount: 2, display: { references: [], unresolvedCount: 2 },
    })} />)
    expect(screen.getByText('2 recipes unavailable')).toBeTruthy()
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })

  it('keeps unavailable counts separate from valid overflow references', () => {
    render(<GroceryRecipeSources {...props({
      sourceCount: 5,
      display: { references: [reference(1), reference(2), reference(3)], unresolvedCount: 2 },
    })} />)
    expect(screen.getByText('+2 recipes unavailable')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Show 1 more recipe for olive oil' }).textContent).toBe('+1 more')
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getAllByRole('link')).toHaveLength(3)
    expect(screen.getAllByRole('link').every(link => link.getAttribute('href')?.includes('/recipes/recipe-'))).toBe(true)
  })

  it('retains known links while unresolved recipe metadata is loading', () => {
    render(<GroceryRecipeSources {...props({
      sourceCount: 2, display: { references: [reference(1)], unresolvedCount: 1 }, catalogState: 'loading',
    })} />)
    expect(screen.getByRole('link', { name: /Recipe 1/ })).toBeTruthy()
    expect(screen.getByText('Loading recipes…')).toBeTruthy()
    expect(screen.queryByText(/unavailable/i)).toBeNull()
  })

  it('retains usable cached links during catalog errors without offering individual fetches', () => {
    render(<GroceryRecipeSources {...props({
      sourceCount: 2, display: { references: [reference(1)], unresolvedCount: 1 }, catalogState: 'error',
    })} />)
    expect(screen.getByRole('link', { name: /Recipe 1/ })).toBeTruthy()
    expect(screen.getByText('Recipe links unavailable')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByText('Recipe unavailable')).toBeNull()
  })

  it('retains the complete long title and stable destination for keyboard and assistive technology access', () => {
    const title = 'Slow-roasted autumn vegetables with toasted walnuts, lemon dressing, and fresh garden herbs'
    render(<GroceryRecipeSources {...props({
      display: { references: [reference(17, title)], unresolvedCount: 0 },
    })} />)
    const link = screen.getByRole('link', { name: `${title} — recipe for olive oil (opens in a new tab)` })
    expect(link.textContent).toBe(title)
    expect(link.getAttribute('title')).toBe(title)
    expect(link.getAttribute('href')).toBe('https://mea-recipes.vercel.app/recipes/recipe-17')
    link.focus()
    expect(document.activeElement).toBe(link)
    expect(link.textContent).toBe(title)
  })
})
