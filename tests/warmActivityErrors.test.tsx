// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const mocks = vi.hoisted(() => ({ retryHistory: vi.fn().mockResolvedValue(undefined), retryRecipes: vi.fn().mockResolvedValue(undefined), retryMetas: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'synthetic-user' } }) }))
vi.mock('@/components/AppDataProvider', () => ({ useAppData: () => ({
  cookingHistory: [], cookingHistoryLoading: false, cookingHistoryError: 'synthetic read failure', refetchCookingHistory: mocks.retryHistory,
  recipes: [], recipesLoading: false, recipesError: null, refetchRecipes: mocks.retryRecipes,
  metas: {}, metasError: null, refetchMetas: mocks.retryMetas,
}) }))
import HistoryPage from '@/app/history/page'
import InsightsPage from '@/app/insights/page'

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Activity data errors', () => {
  it.each([[HistoryPage, 'cooking history'], [InsightsPage, 'cooking insights']] as const)(
    'shows an error and retries instead of displaying empty %s', (Page, label) => {
      render(<Page />)
      expect(screen.getByRole('alert').textContent).toContain(`Couldn’t load your ${label}`)
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
      expect(mocks.retryHistory).toHaveBeenCalledOnce()
      expect(mocks.retryRecipes).toHaveBeenCalledOnce()
      expect(mocks.retryMetas).toHaveBeenCalledOnce()
    },
  )
})
