// @vitest-environment jsdom

import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import LoadingErrorRetry from '@/components/LoadingErrorRetry'
import { useAsyncState, type AsyncStateSource } from '@/lib/hooks/useAsyncState'

describe('useAsyncState', () => {
  it('moves from loading to error and retries a one-shot request', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce('ready')
    const source: AsyncStateSource<string> = { load }
    const { result } = renderHook(() => useAsyncState(source))

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.error).toBe('offline'))
    expect(result.current.loading).toBe(false)

    act(() => result.current.retry())
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.data).toBe('ready'))
    expect(result.current.error).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('wires subscription errors and reconnects on retry', () => {
    const dataCallbacks: Array<(value: number) => void> = []
    const errorCallbacks: Array<(error: unknown) => void> = []
    const unsubscribe = vi.fn()
    const source: AsyncStateSource<number> = {
      subscribe: vi.fn((onData, onError) => {
        dataCallbacks.push(onData)
        errorCallbacks.push(onError)
        return unsubscribe
      }),
    }
    const { result } = renderHook(() => useAsyncState(source))

    act(() => errorCallbacks[0](new Error('listener stopped')))
    expect(result.current.error).toBe('listener stopped')
    expect(result.current.loading).toBe(false)

    act(() => result.current.retry())
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(source.subscribe).toHaveBeenCalledTimes(2)

    act(() => dataCallbacks[1](42))
    expect(result.current.data).toBe(42)
    expect(result.current.error).toBeNull()
    expect(result.current.loading).toBe(false)
  })
})

describe('LoadingErrorRetry', () => {
  it('renders loading, error/retry, and content states', () => {
    const retry = vi.fn()
    const { rerender } = render(
      <LoadingErrorRetry loading error={null} retry={retry}>Loaded content</LoadingErrorRetry>,
    )
    expect(screen.getByRole('status').textContent).toContain('Loading…')

    rerender(
      <LoadingErrorRetry loading={false} error="network unavailable" retry={retry}>
        Loaded content
      </LoadingErrorRetry>,
    )
    expect(screen.getByRole('alert').textContent).toContain('network unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(retry).toHaveBeenCalledOnce()

    rerender(
      <LoadingErrorRetry loading={false} error={null} retry={retry}>Loaded content</LoadingErrorRetry>,
    )
    expect(screen.getByText('Loaded content')).not.toBeNull()
  })
})
