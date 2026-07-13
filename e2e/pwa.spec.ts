import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const packageMetadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }

test.beforeEach(async ({ page }) => {
  await page.addInitScript((appVersion) => {
    window.localStorage.setItem('credit-calculator-onboarding-done', 'yes')
    window.localStorage.setItem('credit-calculator-seen-version', appVersion)
  }, packageMetadata.version)
})

const prepareControlledPage = async (page: Page) => {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Ваш кредит' })).toBeVisible()
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await page.reload()
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
}

test('service worker остаётся в scope приложения и не кеширует пользовательские данные', async ({ page }) => {
  await prepareControlledPage(page)
  const sentinel = 'PRIVATE-LOAN-DATA-MUST-NOT-BE-CACHED'
  const audit = await page.evaluate(async (privateSentinel) => {
    window.localStorage.setItem('pwa-private-sentinel', privateSentinel)
    const registration = await navigator.serviceWorker.ready
    const scope = new URL(registration.scope)
    const names = await caches.keys()
    const urls: string[] = []
    let bodies = ''
    for (const name of names) {
      const cache = await caches.open(name)
      for (const request of await cache.keys()) {
        urls.push(request.url)
        const response = await cache.match(request)
        bodies += await response?.text() ?? ''
      }
    }
    return { names, urls, bodies, scope: scope.pathname }
  }, sentinel)

  expect(audit.names.length).toBeGreaterThan(0)
  expect(audit.names.every(name => /^creditcalc-[a-z0-9]+-(static|pages)-[a-z0-9]+$/.test(name))).toBe(true)
  expect(audit.urls.every(url => new URL(url).pathname.startsWith(audit.scope))).toBe(true)
  expect(audit.bodies).not.toContain(sentinel)
})

test('приложение перезагружается офлайн и показывает fallback для неизвестного маршрута', async ({ page, context }) => {
  await prepareControlledPage(page)
  await context.setOffline(true)
  try {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'Ваш кредит' })).toBeVisible()
    await expect(page.getByText('Нет сети', { exact: true })).toBeVisible()

    await page.goto('./offline-check', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'Нет подключения к сети' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Повторить' })).toBeVisible()
  } finally {
    await context.setOffline(false)
  }
})
