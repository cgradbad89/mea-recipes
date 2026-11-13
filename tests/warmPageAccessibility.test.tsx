// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({ getGoals: vi.fn(), saveGoals: vi.fn() }))
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'synthetic-user' } }) }))
vi.mock('@/lib/consumptionLog', () => ({ getGoals: mocks.getGoals, saveGoals: mocks.saveGoals }))
import GoalsModal from '@/components/GoalsModal'

afterEach(() => { cleanup(); vi.resetAllMocks() })

describe('Nutrition goals dialog', () => {
  it('prevents saving empty goals when the existing goals fail to load', async () => {
    mocks.getGoals.mockRejectedValue(new Error('synthetic read failure'))
    render(<GoalsModal onClose={vi.fn()} />)
    expect((await screen.findByRole('alert')).textContent).toContain('Couldn’t load your goals')
    const save = screen.getByRole('button', { name: 'Save goals' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.click(save)
    expect(mocks.saveGoals).not.toHaveBeenCalled()
  })

  it('focuses the named dialog, dismisses on Escape, and restores the opening control', async () => {
    mocks.getGoals.mockResolvedValue(null)
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    const onClose = vi.fn()
    const view = render(<GoalsModal onClose={onClose} />)
    expect(screen.getByRole('dialog', { name: 'Daily goals' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Save goals' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    view.unmount()
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })
})
