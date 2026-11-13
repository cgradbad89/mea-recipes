// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import Loading from '@/app/loading'

afterEach(cleanup)

it('announces the app loading state with the warm loading canvas', () => {
  render(<Loading />)
  const status = screen.getByRole('status', { name: 'Loading MEA Recipes' })
  expect(status.getAttribute('aria-busy')).toBe('true')
  expect(status.className).toContain('app-loading')
})
