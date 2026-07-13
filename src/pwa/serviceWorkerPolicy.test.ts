import { describe, expect, it } from 'vitest'
import {
  buildCacheNames,
  CACHE_PREFIX,
  isAppEntryPath,
  isCacheableNavigationResponse,
  isPathInsideScope,
  isSuccessfulNavigationResponse,
  normalizedScopePath
} from './serviceWorkerPolicy'

describe('service worker cache policy', () => {
  it('создаёт стабильные build-specific имена только в namespace приложения', () => {
    const entries = [{ url: 'index.html', revision: 'one' }, { url: 'assets/app-123.js', revision: null }]
    const first = buildCacheNames(entries, '/CreditCalc/')
    const reordered = buildCacheNames([...entries].reverse(), '/CreditCalc/')
    const changed = buildCacheNames([{ url: 'index.html', revision: 'two' }, entries[1]], '/CreditCalc/')

    expect(first).toEqual(reordered)
    expect(first.static.startsWith(CACHE_PREFIX)).toBe(true)
    expect(first.pages.startsWith(CACHE_PREFIX)).toBe(true)
    expect(changed).not.toEqual(first)
    expect(buildCacheNames(entries, '/preview/').namespace).not.toBe(first.namespace)
  })

  it('не выпускает worker за пределы GitHub Pages scope', () => {
    const scope = normalizedScopePath('https://ant-m13.github.io/CreditCalc/')
    expect(scope).toBe('/CreditCalc/')
    expect(isPathInsideScope('/CreditCalc/assets/app.js', scope)).toBe(true)
    expect(isPathInsideScope('/AnotherProject/index.html', scope)).toBe(false)
    expect(isAppEntryPath('/CreditCalc/', scope)).toBe(true)
    expect(isAppEntryPath('/CreditCalc/index.html', scope)).toBe(true)
    expect(isAppEntryPath('/CreditCalc/export', scope)).toBe(false)
  })

  it('использует кеш для HTTP-ошибок и обновляет его только HTML-ответом', () => {
    const html = new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
    const json = new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    const unavailable = new Response('temporary failure', { status: 503 })

    expect(isSuccessfulNavigationResponse(html)).toBe(true)
    expect(isCacheableNavigationResponse(html)).toBe(true)
    expect(isSuccessfulNavigationResponse(json)).toBe(true)
    expect(isCacheableNavigationResponse(json)).toBe(false)
    expect(isSuccessfulNavigationResponse(unavailable)).toBe(false)
    expect(isCacheableNavigationResponse(unavailable)).toBe(false)
  })
})
