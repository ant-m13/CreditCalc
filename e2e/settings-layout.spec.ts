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
  await page.goto('./')
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

test('desktop-меню сворачивается до панели иконок и разворачивается обратно', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('./')

  await page.getByRole('button', { name: 'Свернуть меню' }).click()
  await expect(page.locator('.app-shell')).toHaveClass(/sidebar-collapsed/)
  await expect(page.getByRole('button', { name: 'Параметры' })).toHaveAttribute('title', 'Параметры')
  await expect.poll(async () => (await page.locator('aside.sidebar').boundingBox())?.width).toBe(76)
  await page.getByRole('button', { name: 'Параметры' }).click()
  await expect(page.getByRole('heading', { name: 'Параметры', level: 1 })).toBeVisible()

  await page.getByRole('button', { name: 'Развернуть меню' }).click()
  await expect(page.locator('.app-shell')).not.toHaveClass(/sidebar-collapsed/)
  await expect.poll(async () => (await page.locator('aside.sidebar').boundingBox())?.width).toBe(238)

  await page.setViewportSize({ width: 900, height: 720 })
  await expect(page.getByRole('button', { name: 'Свернуть меню' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Открыть меню' })).toBeVisible()
})
