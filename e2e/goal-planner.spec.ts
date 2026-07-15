import { expect, test } from '@playwright/test'

const GOAL_PLANNER_RESULT_TIMEOUT_MS = 30_000
import { readFileSync } from 'node:fs'

const packageMetadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }

test.beforeEach(async ({ page }) => {
  await page.addInitScript((appVersion) => {
    window.localStorage.setItem('credit-calculator-onboarding-done', 'yes')
    window.localStorage.setItem('credit-calculator-seen-version', appVersion)
  }, packageMetadata.version)
})

test('подбирает, сравнивает, показывает и применяет план цели', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Планировщик цели' }).click()
  await expect(page.getByRole('heading', { name: 'Планировщик цели', level: 1 })).toBeVisible()

  const calculate = page.getByRole('button', { name: 'Рассчитать план' })
  await expect(calculate).toBeEnabled()
  await calculate.click()

  await expect(page.getByRole('heading', { name: 'Варианты достижения цели' })).toBeVisible({ timeout: GOAL_PLANNER_RESULT_TIMEOUT_MS })
  await expect(page.locator('.goal-variant')).toHaveCount(4)
  await page.getByRole('button', { name: 'Сравнить варианты' }).click()
  await expect(page.getByRole('table', { name: 'Сравнение рассчитанных вариантов достижения цели.' })).toBeVisible()

  await page.getByRole('button', { name: 'Посмотреть новый график' }).first().click()
  const preview = page.getByRole('dialog', { name: 'Новый график платежей' })
  await expect(preview).toBeVisible({ timeout: GOAL_PLANNER_RESULT_TIMEOUT_MS })
  await expect(preview.getByText(/закрытие/i).first()).toBeVisible()
  await preview.getByRole('button', { name: 'Закрыть', exact: true }).click()

  await page.getByRole('button', { name: 'Добавить этот план в кредит' }).first().click()
  await expect(page.getByText(/добавлен в кредит/)).toBeVisible()
  await page.getByRole('button', { name: /^Досрочные/ }).click()
  await expect(page.getByText('Планировщик цели · ежемесячная доплата', { exact: true })).toBeVisible()
})
