import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const packageMetadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }

test.beforeEach(async ({ page }) => {
  await page.addInitScript((appVersion) => {
    window.localStorage.setItem('credit-calculator-onboarding-done', 'yes')
    window.localStorage.setItem('credit-calculator-seen-version', appVersion)
  }, packageMetadata.version)
})

test('desktop-подсказка даты платежа не перекрывается боковым меню', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Параметры' }).click()

  const setting = page.locator('.interest-settings-panel .toggle-row').filter({ hasText: 'Включать дату платежа' })
  await setting.locator('summary').click()

  const sidebarBox = await page.locator('aside.sidebar').boundingBox()
  const helpBox = await setting.locator('.field-help p').boundingBox()
  expect(sidebarBox).not.toBeNull()
  expect(helpBox).not.toBeNull()
  expect(helpBox!.x).toBeGreaterThanOrEqual(sidebarBox!.x + sidebarBox!.width)
  expect(helpBox!.x + helpBox!.width).toBeLessThanOrEqual(1280)
})
