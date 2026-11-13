// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

const state = vi.hoisted(() => ({ user: null as null | { email: string | null } }))
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: state.user }) }))
import { ADMIN_EMAIL } from '@/lib/admin'
import HubBanner from '@/components/HubBanner'

afterEach(() => { cleanup(); state.user = null })

describe('site switcher', () => {
  it('remains hidden for signed-out and other users', () => {
    const view = render(<HubBanner />)
    expect(screen.queryByRole('navigation', { name: 'Switch apps' })).toBeNull()
    state.user = { email: 'other@example.test' }
    view.rerender(<HubBanner />)
    expect(screen.queryByRole('navigation', { name: 'Switch apps' })).toBeNull()
  })

  it('preserves the six destinations and marks Recipes as current for the existing admin', () => {
    state.user = { email: ADMIN_EMAIL }
    render(<HubBanner />)
    const nav = screen.getByRole('navigation', { name: 'Switch apps' })
    const destinations = [
      ['Hub', 'https://my-hub-drab.vercel.app/'],
      ['Budget', 'https://budget-web-rose.vercel.app'],
      ['Oracle', 'https://oracle-web-pied.vercel.app'],
      ['Recipes', '/'],
      ['DC Catz', 'https://dc-catz.vercel.app'],
      ['Training', 'https://training-web-rho.vercel.app'],
    ]
    expect(within(nav).getAllByRole('link')).toHaveLength(destinations.length)
    for (const [name, href] of destinations) {
      expect(within(nav).getByRole('link', { name }).getAttribute('href')).toBe(href)
    }
    expect(within(nav).getByRole('link', { name: 'Recipes' }).getAttribute('aria-current')).toBe('page')
  })
})
