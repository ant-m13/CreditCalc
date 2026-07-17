import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import {
  activateWaitingServiceWorker,
  getServiceWorkerSnapshot,
  subscribeServiceWorker,
  type ServiceWorkerSnapshot
} from './serviceWorkerRegistration'
import { isNativeApp } from '../platform'

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

export type BrowserPersistenceStatus = 'unsupported' | 'checking' | 'available' | 'requesting' | 'persisted' | 'denied' | 'failed'

export interface PwaStatus {
  serviceWorker: ServiceWorkerSnapshot
  online: boolean
  installed: boolean
  installAvailable: boolean
  iosInstallHint: boolean
  browserPersistence: BrowserPersistenceStatus
  install: () => Promise<'accepted' | 'dismissed' | 'unavailable'>
  activateUpdate: () => boolean
  requestBrowserPersistence: () => Promise<boolean>
}

const isStandalone = () => {
  if (isNativeApp()) return true
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  const iosNavigator = navigator as Navigator & { standalone?: boolean }
  return iosNavigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true
}

const isIos = () => typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent)

export function usePwaStatus(): PwaStatus {
  const nativeApp = isNativeApp()
  const serviceWorker = useSyncExternalStore(subscribeServiceWorker, getServiceWorkerSnapshot, getServiceWorkerSnapshot)
  const [online, setOnline] = useState(() => nativeApp || typeof navigator === 'undefined' || navigator.onLine !== false)
  const [installed, setInstalled] = useState(isStandalone)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [browserPersistence, setBrowserPersistence] = useState<BrowserPersistenceStatus>(nativeApp ? 'persisted' : 'checking')

  useEffect(() => {
    if (nativeApp) return
    const displayMode = window.matchMedia?.('(display-mode: standalone)')
    const updateDisplayMode = () => setInstalled(isStandalone())
    const captureInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
    }
    const markInstalled = () => {
      setInstallPrompt(null)
      setInstalled(true)
    }
    const markOnline = () => setOnline(true)
    const markOffline = () => setOnline(false)

    setOnline(navigator.onLine !== false)
    window.addEventListener('beforeinstallprompt', captureInstallPrompt)
    window.addEventListener('appinstalled', markInstalled)
    window.addEventListener('online', markOnline)
    window.addEventListener('offline', markOffline)
    displayMode?.addEventListener?.('change', updateDisplayMode)
    return () => {
      window.removeEventListener('beforeinstallprompt', captureInstallPrompt)
      window.removeEventListener('appinstalled', markInstalled)
      window.removeEventListener('online', markOnline)
      window.removeEventListener('offline', markOffline)
      displayMode?.removeEventListener?.('change', updateDisplayMode)
    }
  }, [nativeApp])

  useEffect(() => {
    if (nativeApp) return
    let cancelled = false
    if (!navigator.storage?.persisted) {
      setBrowserPersistence('unsupported')
      return
    }
    void navigator.storage.persisted()
      .then(persisted => {
        if (!cancelled) setBrowserPersistence(persisted ? 'persisted' : 'available')
      })
      .catch(() => {
        if (!cancelled) setBrowserPersistence('failed')
      })
    return () => { cancelled = true }
  }, [nativeApp])

  const install = useCallback(async () => {
    if (!installPrompt) return 'unavailable' as const
    const prompt = installPrompt
    setInstallPrompt(null)
    try {
      await prompt.prompt()
      const choice = await prompt.userChoice
      return choice.outcome
    } catch {
      return 'dismissed' as const
    }
  }, [installPrompt])

  const requestBrowserPersistence = useCallback(async () => {
    if (nativeApp) return true
    if (!navigator.storage?.persist) {
      setBrowserPersistence('unsupported')
      return false
    }
    setBrowserPersistence('requesting')
    try {
      const persisted = await navigator.storage.persist()
      setBrowserPersistence(persisted ? 'persisted' : 'denied')
      return persisted
    } catch {
      setBrowserPersistence('failed')
      return false
    }
  }, [nativeApp])

  return {
    serviceWorker,
    online,
    installed,
    installAvailable: !nativeApp && Boolean(installPrompt) && !installed,
    iosInstallHint: !nativeApp && isIos() && !installed && !installPrompt,
    browserPersistence,
    install,
    activateUpdate: activateWaitingServiceWorker,
    requestBrowserPersistence
  }
}
