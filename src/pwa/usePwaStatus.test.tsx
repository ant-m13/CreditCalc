// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePwaStatus, type BeforeInstallPromptEvent } from './usePwaStatus'

const originalStorage = Object.getOwnPropertyDescriptor(navigator, 'storage')
const originalOnLine = Object.getOwnPropertyDescriptor(navigator, 'onLine')

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  }))
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  if (originalStorage) Object.defineProperty(navigator, 'storage', originalStorage)
  else Reflect.deleteProperty(navigator, 'storage')
  if (originalOnLine) Object.defineProperty(navigator, 'onLine', originalOnLine)
})

describe('usePwaStatus', () => {
  it('предлагает нативную установку только после beforeinstallprompt', async () => {
    const prompt = vi.fn().mockResolvedValue(undefined)
    const event = new Event('beforeinstallprompt', { cancelable: true }) as BeforeInstallPromptEvent
    Object.assign(event, {
      prompt,
      userChoice: Promise.resolve({ outcome: 'accepted' as const, platform: 'web' })
    })
    const { result } = renderHook(() => usePwaStatus())

    expect(result.current.installAvailable).toBe(false)
    act(() => window.dispatchEvent(event))
    expect(event.defaultPrevented).toBe(true)
    expect(result.current.installAvailable).toBe(true)

    await act(async () => expect(await result.current.install()).toBe('accepted'))
    expect(prompt).toHaveBeenCalledTimes(1)
    expect(result.current.installAvailable).toBe(false)
  })

  it('обновляет индикатор по browser online/offline events', () => {
    const { result } = renderHook(() => usePwaStatus())

    act(() => window.dispatchEvent(new Event('offline')))
    expect(result.current.online).toBe(false)
    act(() => window.dispatchEvent(new Event('online')))
    expect(result.current.online).toBe(true)
  })

  it('запрашивает persistent storage только явным действием пользователя', async () => {
    const persist = vi.fn().mockResolvedValue(true)
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { persisted: vi.fn().mockResolvedValue(false), persist }
    })
    const { result } = renderHook(() => usePwaStatus())

    await waitFor(() => expect(result.current.browserPersistence).toBe('available'))
    expect(persist).not.toHaveBeenCalled()
    await act(async () => expect(await result.current.requestBrowserPersistence()).toBe(true))
    expect(result.current.browserPersistence).toBe('persisted')
  })
})
