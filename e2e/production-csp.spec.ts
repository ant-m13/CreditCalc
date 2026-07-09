import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

declare global {
  interface Window {
    __cspViolations?: string[]
  }
}

const packageMetadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
const customAccent = '#c026d3'

test('production dist CSP позволяет рабочие inline styles приложения', async ({ page }) => {
  const cspConsoleErrors: string[] = []
  const pageErrors: string[] = []

  await page.addInitScript((appVersion) => {
    window.localStorage.setItem('credit-calculator-onboarding-done', 'yes')
    window.localStorage.setItem('credit-calculator-seen-version', appVersion)
    window.__cspViolations = []
    window.addEventListener('securitypolicyviolation', (event) => {
      window.__cspViolations?.push(`${event.violatedDirective}: ${event.blockedURI || event.sourceFile || 'inline'}`)
    })
  }, packageMetadata.version)

  page.on('console', (message) => {
    const text = message.text()
    if (message.type() === 'error' && /Content Security Policy|violates the following Content Security Policy|Refused to/i.test(text)) {
      cspConsoleErrors.push(text)
    }
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Ваш кредит' })).toBeVisible()
  await expect(page.getByText('Сумма кредита')).toBeVisible()

  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
  expect(csp).toContain("default-src 'self'")
  expect(csp).toContain("style-src-elem 'self'")
  expect(csp).toContain("style-src-attr 'unsafe-inline'")

  await expect(page.locator('.progress-panel .progress-item em').first()).toHaveAttribute('style', /width:\s*\d+(\.\d+)?%;/)
  const progressTrack = await page.locator('.progress-panel .progress-item i').first().boundingBox()
  expect(progressTrack?.width ?? 0).toBeGreaterThan(40)

  const chart = page.locator('.chart-panel .recharts-wrapper svg').first()
  await expect(chart).toBeVisible()
  expect(await page.locator('.chart-panel .recharts-area-curve').count()).toBeGreaterThan(0)

  await page.getByRole('button', { name: 'Параметры' }).click()
  const accentInput = page.getByLabel('Свой акцентный цвет')
  await accentInput.fill(customAccent)
  await expect(accentInput).toHaveValue(customAccent)

  await expect(page.locator('.app-shell')).toHaveJSProperty('dataset.theme', 'emerald')
  await expect.poll(async () => page.locator('.app-shell').evaluate((shell) =>
    getComputedStyle(shell).getPropertyValue('--green').trim().toLowerCase()
  )).toBe(customAccent)

  await page.getByRole('button', { name: 'Обзор' }).click()
  const primaryButtonColor = await page.locator('.add-payment-action').evaluate((button) =>
    getComputedStyle(button).backgroundColor
  )
  expect(primaryButtonColor).toBe('rgb(192, 38, 211)')

  await page.waitForTimeout(250)
  const browserViolations = await page.evaluate(() => window.__cspViolations ?? [])
  expect(browserViolations).toEqual([])
  expect(cspConsoleErrors).toEqual([])
  expect(pageErrors).toEqual([])
})
