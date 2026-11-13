// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

const state = vi.hoisted(() => ({ pathname: '/recipes/example', user: null as null | { email: string } }))
vi.mock('next/navigation', () => ({ usePathname: () => state.pathname }))
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: state.user }) }))
vi.mock('@/components/AuthButton', () => ({ default: () => <button>Account</button> }))
vi.mock('@/components/AddRecipeModal', () => ({ default: () => <div role="dialog">Add recipe</div> }))
import Navigation from '@/components/Navigation'
import StarRating from '@/components/StarRating'

afterEach(() => { cleanup(); state.pathname = '/recipes/example'; state.user = null })

describe('Warm Pantry navigation', () => {
  it('keeps desktop destinations and marks the recipe detail route on both navigations', () => {
    render(<Navigation />)
    const desktop = screen.getByRole('navigation', { name: 'Main navigation' })
    for (const name of ['Recipes', 'Plan', 'Grocery', 'Nutrition', 'Favorites', 'History', 'Insights', 'Queue', 'Discover']) {
      expect(within(desktop).getByRole('link', { name })).toBeTruthy()
    }
    expect(within(desktop).getByRole('link', { name: 'Recipes' }).getAttribute('aria-current')).toBe('page')
    expect(within(desktop).getByRole('button', { name: 'Add Recipe' })).toBeTruthy()
    expect(within(desktop).getByRole('button', { name: 'Account' })).toBeTruthy()
    const mobile = screen.getByRole('navigation', { name: 'Mobile navigation' })
    expect(mobile.className).toContain('recipes-mobile-nav')
    expect(within(mobile).getByRole('link', { name: 'Recipes' }).getAttribute('aria-current')).toBe('page')
  })
  it('keeps mobile navigation warm and identifies pages in More', () => {
    state.pathname = '/history'
    render(<Navigation />)
    const mobile = screen.getByRole('navigation', { name: 'Mobile navigation' })
    expect(mobile.className).toContain('recipes-mobile-nav')
    expect(within(mobile).getByRole('button', { name: 'More' }).getAttribute('aria-current')).toBe('page')
    fireEvent.click(within(mobile).getByRole('button', { name: 'More' }))
    expect(within(screen.getByRole('dialog', { name: 'More navigation' })).getByRole('link', { name: 'History' }).getAttribute('aria-current')).toBe('page')
  })
  it('updates the current destination and keeps the admin item restricted', () => {
    state.pathname = '/grocery'
    const { rerender } = render(<Navigation />)
    const desktop = screen.getByRole('navigation', { name: 'Main navigation' })
    expect(within(desktop).getByRole('link', { name: 'Grocery' }).getAttribute('aria-current')).toBe('page')
    expect(within(desktop).queryByRole('link', { name: 'Mapping Review' })).toBeNull()
    state.user = { email: 'not-admin@example.test' }
    rerender(<Navigation />)
    expect(within(desktop).queryByRole('link', { name: 'Mapping Review' })).toBeNull()
  })
})

describe('rating accessibility', () => {
  it('names rating controls and lets keyboard users select whole and half stars', () => {
    const onChange = vi.fn()
    const { rerender } = render(<StarRating value={0} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Set rating to 3 stars' }), { detail: 0 })
    expect(onChange).toHaveBeenCalledWith(3)
    rerender(<StarRating value={3} onChange={onChange} />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Set rating to 3 stars' }), { key: 'ArrowRight' })
    expect(onChange).toHaveBeenCalledWith(3.5)
  })
})
