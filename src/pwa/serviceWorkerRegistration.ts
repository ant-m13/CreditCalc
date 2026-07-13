export interface ServiceWorkerSnapshot {
  supported: boolean
  registered: boolean
  offlineReady: boolean
  updateAvailable: boolean
  error: string
}

const supported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator
let snapshot: ServiceWorkerSnapshot = { supported, registered: false, offlineReady: false, updateAvailable: false, error: '' }
let registration: ServiceWorkerRegistration | null = null
let reloadForUpdate = false
let started = false
const listeners = new Set<() => void>()

const publish = (patch: Partial<ServiceWorkerSnapshot>) => {
  snapshot = { ...snapshot, ...patch }
  listeners.forEach(listener => listener())
}

const watchInstallingWorker = (installing: ServiceWorker) => {
  installing.addEventListener('statechange', () => {
    if (installing.state !== 'installed') return
    if (navigator.serviceWorker.controller) publish({ updateAvailable: true })
    else publish({ offlineReady: true })
  })
}

export const getServiceWorkerSnapshot = () => snapshot
export const subscribeServiceWorker = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const registerPwaServiceWorker = async () => {
  if (started || !import.meta.env.PROD || !supported) return
  started = true
  try {
    const baseUrl = new URL(import.meta.env.BASE_URL, window.location.href)
    registration = await navigator.serviceWorker.register(new URL('service-worker.js', baseUrl), {
      scope: baseUrl.pathname,
      updateViaCache: 'none'
    })
    publish({ registered: true })
    if (registration.waiting && navigator.serviceWorker.controller) publish({ updateAvailable: true })
    if (registration.installing) watchInstallingWorker(registration.installing)
    registration.addEventListener('updatefound', () => {
      if (registration?.installing) watchInstallingWorker(registration.installing)
    })
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!reloadForUpdate) return
      reloadForUpdate = false
      window.location.reload()
    })
    window.setInterval(() => { void registration?.update() }, 60 * 60 * 1_000)
  } catch (error) {
    publish({ error: error instanceof Error ? error.message : 'Не удалось включить офлайн-режим' })
  }
}

export const activateWaitingServiceWorker = () => {
  if (!registration?.waiting) return false
  reloadForUpdate = true
  registration.waiting.postMessage({ type: 'SKIP_WAITING' })
  return true
}
