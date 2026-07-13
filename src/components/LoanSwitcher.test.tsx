// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { defaultConfig, type LoanProfile } from '../store'
import { LoanSwitcher } from './LoanSwitcher'

const loan = (id: string, name: string): LoanProfile => ({
  id,
  name,
  config: defaultConfig,
  repayments: [],
  repaymentRules: [],
  gracePeriods: [],
  selectedScenario: 'combined',
  termUnit: 'months',
  displayDecimals: 2,
  appFontSize: 'normal',
  scheduleFontSize: 'large',
  theme: 'emerald',
  customAccentColor: '#0b9873',
  useCustomAccentColor: false
})

describe('LoanSwitcher', () => {
  it('создаёт новый кредит как копию выбранного расчёта под новым именем', async () => {
    const user = userEvent.setup()
    const createLoan = vi.fn()
    const loans = [loan('loan-a', 'Ипотека'), loan('loan-b', 'Автокредит')]
    render(<LoanSwitcher loans={loans} activeLoanId="loan-a" switchLoan={vi.fn()} createLoan={createLoan} renameLoan={vi.fn()} removeLoan={vi.fn()}/>)

    await user.click(screen.getByRole('button', { name: 'Добавить кредит' }))
    expect(screen.getByRole('option', { name: 'Пустой кредит' })).toBeTruthy()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Создать на основе' }), 'loan-b')
    await user.clear(screen.getByRole('textbox', { name: 'Название' }))
    await user.type(screen.getByRole('textbox', { name: 'Название' }), 'Автокредит — новый сценарий')
    await user.click(screen.getByRole('button', { name: 'Создать копию' }))

    expect(createLoan).toHaveBeenCalledWith('Автокредит — новый сценарий', 'loan-b')
    expect(screen.queryByRole('dialog', { name: 'Добавить кредит' })).toBeNull()
  })
})
