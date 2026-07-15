// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LoanConfig } from '../loanEngine'
import { shortTestConfig } from '../testFixtures'
import { Settings } from './Settings'

afterEach(cleanup)

const settings = (loanId: string, config: LoanConfig, update = vi.fn()) => <Settings
  key={loanId}
  config={config}
  update={update}
  updateInterest={vi.fn()}
  termUnit="months"
  setTermUnit={vi.fn()}
  displayDecimals={2}
  setDisplayDecimals={vi.fn()}
  appFontSize="normal"
  setAppFontSize={vi.fn()}
  theme="emerald"
  setTheme={vi.fn()}
  customAccentColor="#0b9873"
  useCustomAccentColor={false}
  setCustomAccentColor={vi.fn()}
  setUseCustomAccentColor={vi.fn()}
  resetCustomAccentColor={vi.fn()}
  persistentStorageEnabled
  setPersistentStorageEnabled={vi.fn()}
  browserPersistence="available"
  requestBrowserPersistence={vi.fn(async () => true)}
/>

describe('Settings', () => {
  it('сбрасывает черновик изменения ставки при смене кредита', () => {
    const { rerender } = render(settings('loan-a', shortTestConfig))
    const section = screen.getByText('Изменение ставки').closest('section')
    const rateDate = section?.querySelector('input[type="date"]') as HTMLInputElement | null
    if (!rateDate) throw new Error('Не найден input даты изменения ставки')

    fireEvent.change(rateDate, { target: { value: '2030-09-01' } })
    expect(rateDate.value).toBe('2030-09-01')

    rerender(settings('loan-b', { ...shortTestConfig, currency: 'USD' }))

    const nextSection = screen.getByText('Изменение ставки').closest('section')
    const nextRateDate = nextSection?.querySelector('input[type="date"]') as HTMLInputElement | null
    expect(nextRateDate?.value).toBe('')
  })

  it('не применяет промежуточный год даты выдачи во время редактирования', () => {
    const update = vi.fn()
    const config = {
      ...shortTestConfig,
      issueDate: '2025-11-26',
      firstPaymentDate: '2025-12-26',
      paymentDay: 26
    }
    render(settings('loan-a', config, update))
    const section = screen.getByRole('heading', { level: 3, name: 'Параметры кредита' }).closest('section')
    const issueDate = section?.querySelector('input[type="date"]') as HTMLInputElement | null
    if (!issueDate) throw new Error('Не найден input даты выдачи')
    const applyIssueDate = screen.getByRole('button', { name: 'Применить дату выдачи' }) as HTMLButtonElement

    fireEvent.change(issueDate, { target: { value: '0002-11-26' } })

    expect(issueDate.value).toBe('0002-11-26')
    expect(applyIssueDate.disabled).toBe(true)
    expect(update).not.toHaveBeenCalled()
    expect(screen.getByText(/год не раньше 1900/i)).toBeTruthy()

    fireEvent.change(issueDate, { target: { value: '2024-11-26' } })
    expect(applyIssueDate.disabled).toBe(false)
    fireEvent.click(applyIssueDate)

    expect(update).toHaveBeenCalledWith({ issueDate: '2024-11-26' })
    expect(screen.queryByText(/год не раньше 1900/i)).toBeNull()
  })

  it('показывает отказ и возвращает значение при несовместимом изменении параметров', () => {
    const update = vi.fn((patch: Partial<LoanConfig>) => {
      if (patch.frequency === 'quarterly') throw new Error('общую сумму списания можно указать только в дату регулярного платежа')
    })
    render(settings('loan-a', shortTestConfig, update))
    const frequency = screen.getByDisplayValue('Ежемесячно') as HTMLSelectElement

    fireEvent.change(frequency, { target: { value: 'quarterly' } })

    expect(update).toHaveBeenCalledWith({ frequency: 'quarterly' })
    expect(frequency.value).toBe('monthly')
    expect(screen.getByText(/изменение отклонено:.*общую сумму списания/i)).toBeTruthy()
  })

  it('поясняет точную дату ставки без обещания следующего платёжного периода', () => {
    render(settings('loan-a', { ...shortTestConfig, rateChangeMode: 'exactDate' }))

    expect(screen.getByText(/Дата, с которой новая ставка применяется внутри текущего процентного периода/)).toBeTruthy()
    expect(screen.getByText(/Годовая ставка, действующая точно с указанной даты/)).toBeTruthy()
  })
})
