/// <reference lib="webworker" />
import { buildCacheNames, isAppEntryPath, isPathInsideScope, normalizedScopePath, type PrecacheEntry } from './pwa/serviceWorkerPolicy'

const worker = self as unknown as ServiceWorkerGlobalScope
const precacheEntries = (self as unknown as { __WB_MANIFEST: PrecacheEntry[] }).__WB_MANIFEST
const scopeUrl = new URL(worker.registration.scope)
const scopePath = normalizedScopePath(worker.registration.scope)
const cacheNames = buildCacheNames(precacheEntries, scopePath)
const appEntryUrl = new URL('./', scopeUrl).href
const indexUrl = new URL('index.html', scopeUrl).href
const offlineUrl = new URL('offline.html', scopeUrl).href
const precacheUrls = precacheEntries.map(entry => new URL(entry.url, scopeUrl).href)
const precacheUrlSet = new Set(precacheUrls)
const currentCaches = new Set(Object.values(cacheNames))

const cacheFirstAsset = async (request: Request) => {
  const cache = await caches.open(cacheNames.static)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok && response.type !== 'opaque') await cache.put(request, response.clone())
  return response
}

const fetchWithTimeout = async (request: Request, timeoutMs = 5_000) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(new Request(request, { signal: controller.signal }))
  } finally {
    clearTimeout(timeout)
  }
}

const navigationFallback = async () => {
  const pages = await caches.open(cacheNames.pages)
  const precache = await caches.open(cacheNames.static)
  return await pages.match(appEntryUrl)
    ?? await precache.match(indexUrl)
    ?? await precache.match(offlineUrl)
    ?? Response.error()
}

const networkFirstEntry = async (request: Request) => {
  try {
    const response = await fetchWithTimeout(request)
    if (response.ok && response.type !== 'opaque') {
      const pages = await caches.open(cacheNames.pages)
      await pages.put(appEntryUrl, response.clone())
    }
    return response
  } catch {
    return navigationFallback()
  }
}

const networkWithOfflineFallback = async (request: Request) => {
  try {
    return await fetch(request)
  } catch {
    const cache = await caches.open(cacheNames.static)
    return await cache.match(offlineUrl) ?? Response.error()
  }
}

worker.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheNames.static).then(cache => cache.addAll(
    precacheUrls.map(url => new Request(url, { cache: 'reload', credentials: 'same-origin' }))
  )))
})

worker.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names
      .filter(name => name.startsWith(cacheNames.namespace) && !currentCaches.has(name))
      .map(name => caches.delete(name)))
    await worker.clients.claim()
  })())
})

worker.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') void worker.skipWaiting()
})

worker.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== scopeUrl.origin || !isPathInsideScope(url.pathname, scopePath)) return

  if (request.mode === 'navigate') {
    event.respondWith(isAppEntryPath(url.pathname, scopePath)
      ? networkFirstEntry(request)
      : networkWithOfflineFallback(request))
    return
  }

  if (precacheUrlSet.has(url.href)) event.respondWith(cacheFirstAsset(request))
})
