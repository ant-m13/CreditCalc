// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('регистрация service worker', () => {
  it('не активирует ожидающее обновление без явной команды пользователя', async () => {
    const postMessage = vi.fn()
    const registration = {
      waiting: { postMessage },
      installing: null,
      addEventListener: vi.fn(),
      update: vi.fn()
    }
    const serviceWorker = {
      controller: {},
      register: vi.fn().mockResolvedValue(registration),
      addEventListener: vi.fn()
    }
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: serviceWorker })
    vi.spyOn(window, 'setInterval').mockReturnValue(1)
    const module = await import('./serviceWorkerRegistration')

    await module.registerPwaServiceWorker(true)
    expect(module.getServiceWorkerSnapshot().updateAvailable).toBe(true)
    expect(postMessage).not.toHaveBeenCalled()

    expect(module.activateWaitingServiceWorker()).toBe(true)
    expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
  })
})
