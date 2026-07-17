// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GracePeriod, LoanConfig } from '../loanEngine'
import { shortTestConfig } from '../testFixtures'
import { Empty } from './Empty'
import { GraceList } from './GraceList'
import { Settings } from './Settings'
import { Field, NumberInput } from './ui'
import { WhatsNewModal } from './WhatsNewModal'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const settings = (loanId: string, config: LoanConfig, update = vi.fn(), updateInterest = vi.fn(), pwa: { installAvailable?: boolean; iosInstallHint?: boolean; install?: () => Promise<'accepted' | 'dismissed' | 'unavailable'> } = {}) => <Settings
  key={loanId}
  config={config}
  update={update}
  updateInterest={updateInterest}
  termUnit="months"
  setTermUnit={vi.fn()}
  displayDecimals={2}
  setDisplayDecimals={vi.fn()}
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
  installAvailable={pwa.installAvailable ?? false}
  iosInstallHint={pwa.iosInstallHint ?? false}
  install={pwa.install ?? vi.fn(async () => 'unavailable' as const)}
/>

describe('basic UI components', () => {
  it('вызывает действие пустого состояния', async () => {
    const user = userEvent.setup()
    const open = vi.fn()
    render(<Empty title="Нет событий" action={open}/>)

    await user.click(screen.getByRole('button', { name: 'Добавить' }))
    expect(open).toHaveBeenCalledOnce()
  })

  it('renders grace periods and reports a failed removal without losing the list', async () => {
    const user = userEvent.setup()
    const open = vi.fn()
    const remove = vi.fn(() => { throw new Error('Период используется') })
    const item: GracePeriod = {
      id: 'grace-1',
      startDate: '2027-01-01',
      endDate: '2027-01-31',
      type: 'interestOnly',
      extendTerm: true,
      accrueInterest: true,
      capitalizeInterest: false
    }
    const { rerender } = render(<GraceList items={[]} open={open} remove={remove}/>)

    await user.click(screen.getAllByRole('button', { name: 'Добавить' })[0])
    expect(open).toHaveBeenCalledOnce()

    rerender(<GraceList items={[item]} open={open} remove={remove}/>)
    await user.click(screen.getByRole('button', { name: /Удалить льготный период/ }))
    expect(remove).toHaveBeenCalledWith(item.id)
    expect(screen.getByText('Период используется')).toBeTruthy()
    expect(screen.getByText(/с продлением срока/)).toBeTruthy()
  })

  it('normalizes number input and restores rejected or empty drafts', () => {
    const onCommit = vi.fn(() => true)
    const { rerender } = render(<Field label="Сумма" help="Подсказка"><NumberInput aria-label="Сумма" value={10} min={0} max={20} step={0.5} onCommit={onCommit}/></Field>)
    const input = screen.getByRole('spinbutton', { name: 'Сумма' }) as HTMLInputElement

    fireEvent.change(input, { target: { value: '21.8' } })
    fireEvent.blur(input)
    expect(onCommit).toHaveBeenLastCalledWith(20)
    expect(screen.getByLabelText('Что влияет: Сумма')).toBeTruthy()

    rerender(<NumberInput aria-label="Сумма" value={7} step="any" onCommit={() => false}/>)
    const rejected = screen.getByRole('spinbutton', { name: 'Сумма' }) as HTMLInputElement
    fireEvent.change(rejected, { target: { value: '12' } })
    fireEvent.blur(rejected)
    expect(rejected.value).toBe('7')
    fireEvent.change(rejected, { target: { value: '' } })
    fireEvent.blur(rejected)
    expect(rejected.value).toBe('7')
    fireEvent.change(rejected, { target: { value: '9' } })
    fireEvent.keyDown(rejected, { key: 'Escape' })
    expect(rejected.value).toBe('7')
  })

  it('opens the full changelog and closes the whats-new dialog', async () => {
    const user = userEvent.setup()
    const close = vi.fn()
    const openChanges = vi.fn()
    render(<WhatsNewModal close={close} openChanges={openChanges}/>)

    expect(screen.getByRole('dialog', { name: 'Что нового' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Вся история' }))
    await user.click(screen.getByRole('button', { name: 'Понятно' }))
    expect(openChanges).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })

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

  it('показывает режим первого платежа полностью по-русски', () => {
    render(settings('loan-a', { ...shortTestConfig, firstPaymentInterestOnly: true }))

    expect(screen.getByLabelText('Режим первого платежа только процентами')).toBeTruthy()
    expect(screen.queryByText('Масштаб текста')).toBeNull()
    expect(document.body.textContent).not.toMatch(/interest-only|stub/i)
  })

  it('оставляет ручную установку доступной в настройках', () => {
    const install = vi.fn(async () => 'accepted' as const)
    render(settings('loan-a', shortTestConfig, vi.fn(), vi.fn(), { installAvailable: true, install }))

    fireEvent.click(screen.getByRole('button', { name: 'Установить приложение' }))

    expect(install).toHaveBeenCalledOnce()
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
    const updateInterest = vi.fn()
    render(settings('loan-a', { ...shortTestConfig, rateChangeMode: 'exactDate' }, vi.fn(), updateInterest))

    expect(screen.getByText(/Дата, с которой новая ставка применяется внутри текущего процентного периода/)).toBeTruthy()
    expect(screen.getByText(/Годовая ставка, действующая точно с указанной даты/)).toBeTruthy()
    fireEvent.change(screen.getByDisplayValue('По фактическим дням'), { target: { value: 'annuity' } })
    expect(updateInterest).toHaveBeenCalledWith({ method: 'annuity' })
  })
})
