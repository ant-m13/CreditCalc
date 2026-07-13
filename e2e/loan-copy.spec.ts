import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const packageMetadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }

test.beforeEach(async ({ page }) => {
  await page.addInitScript((appVersion) => {
    window.localStorage.setItem('credit-calculator-onboarding-done', 'yes')
    window.localStorage.setItem('credit-calculator-seen-version', appVersion)
  }, packageMetadata.version)
})

test('копирует существующий кредит под новым именем без связи с исходником', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Параметры' }).click()

  const principal = page.getByRole('spinbutton', { name: 'Сумма кредита' })
  await principal.fill('7654321')
  await principal.press('Tab')
  await expect(principal).toHaveValue('7654321')

  await page.getByRole('button', { name: 'Добавить кредит' }).click()
  await page.getByRole('combobox', { name: 'Создать на основе' }).selectOption({ label: 'Мой кредит' })
  await page.getByRole('textbox', { name: 'Название' }).fill('Копия ипотеки')
  await page.getByRole('button', { name: 'Создать копию' }).click()

  const loanSelector = page.getByRole('combobox', { name: 'Кредит' })
  await expect(loanSelector).toHaveValue(/loan-/)
  await expect(loanSelector.locator('option:checked')).toHaveText('Копия ипотеки')
  await expect(page.getByRole('spinbutton', { name: 'Сумма кредита' })).toHaveValue('7654321')

  await page.getByRole('spinbutton', { name: 'Сумма кредита' }).fill('7000000')
  await page.getByRole('spinbutton', { name: 'Сумма кредита' }).press('Tab')
  await loanSelector.selectOption({ label: 'Мой кредит' })

  await expect(page.getByRole('spinbutton', { name: 'Сумма кредита' })).toHaveValue('7654321')
})
