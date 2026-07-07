// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { defaultConfig, useLoanStore, type LoanProfile } from './store'
import { APP_VERSION } from './version'

const sharedLinkMock = vi.hoisted(() => ({
  payload: 'test-shared-payload',
  data: null as unknown
}))

vi.mock('./shareCalculation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./shareCalculation')>()
  return {
    ...actual,
    readSharedCalculationFromLocation: vi.fn((location: Pick<Location, 'hash'>) => {
      const hash = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash
      return hash === `calc=${sharedLinkMock.payload}` ? sharedLinkMock.payload : null
    }),
    decodeSharedCalculation: vi.fn(async (payload: string) => {
      if (payload === sharedLinkMock.payload) return sharedLinkMock.data
      return actual.decodeSharedCalculation(payload)
    })
  }
})

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const loan = (patch: Partial<LoanProfile> = {}): LoanProfile => ({
  id: 'loan-smoke',
  name: 'Мой кредит',
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
  useCustomAccentColor: false,
  ...patch
})

const resetStore = () => {
  const activeLoan = loan()
  useLoanStore.setState({
    ...activeLoan,
    loans: [activeLoan],
    activeLoanId: activeLoan.id,
    storageRecoveryReport: []
  })
}

const sharedLoan = () => ({
  name: 'Кредит из ссылки',
  config: {
    ...defaultConfig,
    principal: 3_210_000,
    annualRate: 8.4
  },
  repayments: [],
  repaymentRules: [],
  gracePeriods: [],
  selectedScenario: 'reducePayment',
  termUnit: 'months' as const,
  displayDecimals: 2 as const,
  appFontSize: 'normal' as const,
  scheduleFontSize: 'large' as const,
  theme: 'ocean' as const
})

const openSharedCalculation = async (data = sharedLoan()) => {
  sharedLinkMock.data = data
  window.history.replaceState(null, '', `/#calc=${sharedLinkMock.payload}`)
  return data
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('credit-calculator-onboarding-done', 'yes')
  localStorage.setItem('credit-calculator-seen-version', APP_VERSION)
  window.history.replaceState(null, '', '/')
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
    matches: false,
    media: '',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  }))
  vi.stubGlobal('scrollTo', vi.fn())
  sharedLinkMock.data = null
  resetStore()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('App smoke tests', () => {
  it('открывает приложение и показывает обзор кредита', async () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Ваш кредит' })).toBeTruthy()
    expect(screen.getAllByText('Кредитный калькулятор').length).toBeGreaterThan(0)
    expect(await screen.findByText('Сумма кредита', {}, { timeout: 10000 })).toBeTruthy()
    expect(screen.getByText('Данные сохранены')).toBeTruthy()
  })

  it('монтирует печатный отчёт только на время печати', async () => {
    const user = userEvent.setup()
    const print = vi.fn()
    vi.stubGlobal('print', print)
    render(<App />)

    expect(await screen.findByText('Сумма кредита', {}, { timeout: 10000 })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Расчёт кредита' })).toBeNull()

    fireEvent(window, new Event('beforeprint'))
    expect(screen.getByRole('heading', { name: 'Расчёт кредита' })).toBeTruthy()

    fireEvent(window, new Event('afterprint'))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Расчёт кредита' })).toBeNull())

    await user.click(screen.getByRole('button', { name: /Печать/i }))
    expect(screen.getByRole('heading', { name: 'Расчёт кредита' })).toBeTruthy()
    expect(print).toHaveBeenCalledTimes(1)
  })

  it('добавляет выключенный досрочный платёж и быстро включает его из календаря', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /Досрочный платёж/i }))
    await user.click(screen.getByRole('checkbox', { name: /Платёж включён/i }))
    await user.click(screen.getByRole('button', { name: 'Добавить и пересчитать' }))
    await user.click(screen.getByRole('button', { name: /^Досрочные/ }))

    expect(await screen.findByText('Временно отключено', {}, { timeout: 10000 })).toBeTruthy()
    expect(useLoanStore.getState().repayments[0]).toMatchObject({ amount: 100000, enabled: false })

    const enableButtons = await screen.findAllByRole('button', { name: /Включить платёж/i })
    expect(enableButtons).toHaveLength(2)
    await user.click(enableButtons[1])

    expect(useLoanStore.getState().repayments[0]).toMatchObject({ amount: 100000, enabled: true })
    expect(screen.getAllByRole('button', { name: /Выключить платёж/i })).toHaveLength(2)
  }, 15000)

  it('на первом запуске без ссылки показывает знакомство', async () => {
    localStorage.clear()
    render(<App />)

    expect(await screen.findByRole('dialog', { name: 'Короткое знакомство' })).toBeTruthy()
  })

  it('на первом запуске по ссылке сначала предлагает загрузить кредит из ссылки', async () => {
    localStorage.clear()
    await openSharedCalculation()
    render(<App />)

    expect(await screen.findByRole('dialog', { name: 'Загрузить кредит из ссылки?' })).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Короткое знакомство' })).toBeNull()
  })

  it('после принятия кредита из ссылки на первом запуске не открывает знакомство и пример', async () => {
    const user = userEvent.setup()
    localStorage.clear()
    const data = await openSharedCalculation()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Заменить текущий' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Загрузить кредит из ссылки?' })).toBeNull())
    expect(screen.queryByRole('dialog', { name: 'Короткое знакомство' })).toBeNull()
    expect(useLoanStore.getState().config.principal).toBe(data.config.principal)
    expect(useLoanStore.getState().loans[0].name).toBe(data.name)
    expect(localStorage.getItem('credit-calculator-onboarding-done')).toBe('yes')
  })

  it('после отказа от ссылки на первом запуске показывает знакомство', async () => {
    const user = userEvent.setup()
    localStorage.clear()
    await openSharedCalculation()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Отказаться' }))

    expect(await screen.findByRole('dialog', { name: 'Короткое знакомство' })).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Загрузить кредит из ссылки?' })).toBeNull()
  })

  it('не включает конфликтующую total-операцию быстрой кнопкой', async () => {
    const user = userEvent.setup()
    const activeLoan = loan()
    activeLoan.repayments = [
      { id: 'total-active', date: defaultConfig.firstPaymentDate, amount: 120000, amountMode: 'totalWithFee', strategy: 'reduceTerm', source: 'own', sameDayOrder: 'regularFirst', interestFirst: true, sameDaySequence: 0 },
      { id: 'total-disabled', date: defaultConfig.firstPaymentDate, amount: 130000, amountMode: 'totalWithFee', enabled: false, strategy: 'reducePayment', source: 'own', sameDayOrder: 'regularFirst', interestFirst: true, sameDaySequence: 1 }
    ]
    useLoanStore.setState({ ...activeLoan, loans: [activeLoan], activeLoanId: activeLoan.id })
    render(<App />)

    await user.click(screen.getByRole('button', { name: /^Досрочные/ }))
    await user.click((await screen.findAllByRole('button', { name: /Включить платёж/i }, { timeout: 10000 })).at(-1)!)

    expect(useLoanStore.getState().repayments[1].enabled).toBe(false)
    expect(await screen.findByRole('dialog', { name: 'Досрочный платёж' })).toBeTruthy()
    expect(screen.getByText(/только одну общую сумму/i)).toBeTruthy()
  }, 15000)

  it('открывает раздел импорта и экспорта', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Импорт/экспорт' }))

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Импорт/экспорт расчёта' })).toBeTruthy())
    expect(screen.getByRole('button', { name: /CSV/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Excel/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Сохранить JSON/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Код параметров/i })).toBeTruthy()
  })

  it('сбрасывает черновик изменения ставки при переключении кредита', async () => {
    const user = userEvent.setup()
    const first = loan({ id: 'loan-a', name: 'Первый' })
    const second = loan({ id: 'loan-b', name: 'Второй', config: { ...defaultConfig, currency: 'USD' } })
    useLoanStore.setState({ ...first, loans: [first, second], activeLoanId: first.id })
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Параметры' }))
    const settingsSection = await screen.findByText('Изменение ставки')
    const rateDate = settingsSection.closest('section')?.querySelector('input[type="date"]') as HTMLInputElement | null
    if (!rateDate) throw new Error('Не найден input даты изменения ставки')
    await user.clear(rateDate)
    await user.type(rateDate, '2030-09-01')
    expect(rateDate!.value).toBe('2030-09-01')

    await user.selectOptions(screen.getByRole('combobox', { name: 'Кредит' }), 'loan-b')

    await waitFor(() => {
      const nextRateDate = screen.getByText('Изменение ставки').closest('section')?.querySelector('input[type="date"]') as HTMLInputElement | null
      expect(nextRateDate?.value).toBe('')
    })
  })

  it('не применяет промежуточный год даты выдачи во время редактирования', async () => {
    const user = userEvent.setup()
    const activeLoan = loan({
      config: {
        ...defaultConfig,
        issueDate: '2025-11-26',
        firstPaymentDate: '2025-12-26',
        paymentDay: 26
      }
    })
    useLoanStore.setState({ ...activeLoan, loans: [activeLoan], activeLoanId: activeLoan.id })
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Параметры' }))
    const settingsSection = (await screen.findByRole('heading', { level: 3, name: 'Параметры кредита' })).closest('section')
    const issueDate = settingsSection?.querySelector('input[type="date"]') as HTMLInputElement | null
    if (!issueDate) throw new Error('Не найден input даты выдачи')
    const applyIssueDate = screen.getByRole('button', { name: 'Применить дату выдачи' }) as HTMLButtonElement

    fireEvent.change(issueDate, { target: { value: '0002-11-26' } })

    expect(issueDate.value).toBe('0002-11-26')
    expect(applyIssueDate.disabled).toBe(true)
    expect(useLoanStore.getState().config.issueDate).toBe('2025-11-26')
    expect(screen.getByText(/год не раньше 1900/i)).toBeTruthy()

    fireEvent.change(issueDate, { target: { value: '2024-11-26' } })

    expect(applyIssueDate.disabled).toBe(false)
    expect(useLoanStore.getState().config.issueDate).toBe('2025-11-26')
    await user.click(applyIssueDate)

    await waitFor(() => expect(useLoanStore.getState().config.issueDate).toBe('2024-11-26'))
    expect(screen.queryByText(/год не раньше 1900/i)).toBeNull()
  })

  it('показывает отказ при несовместимом изменении параметров', async () => {
    const user = userEvent.setup()
    const activeLoan = loan({
      config: {
        ...defaultConfig,
        issueDate: '2026-06-23',
        firstPaymentDate: '2026-07-15',
        paymentDay: 15,
        frequency: 'monthly'
      },
      repayments: [{
        id: 'total-with-fee',
        date: '2026-08-15',
        amount: 500000,
        amountMode: 'totalWithFee',
        strategy: 'reduceTerm',
        source: 'own',
        sameDayOrder: 'regularFirst',
        interestFirst: true,
        sameDaySequence: 0
      }]
    })
    useLoanStore.setState({ ...activeLoan, loans: [activeLoan], activeLoanId: activeLoan.id })
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Параметры' }))
    const frequency = await screen.findByDisplayValue('Ежемесячно') as HTMLSelectElement
    await user.selectOptions(frequency, 'quarterly')

    expect(useLoanStore.getState().config.frequency).toBe('monthly')
    expect(frequency.value).toBe('monthly')
    expect((await screen.findByRole('alert')).textContent).toMatch(/общую сумму списания/i)
  })

  it('закрывает модалку и сбрасывает draft регулярного правила при переключении кредита', async () => {
    const user = userEvent.setup()
    const first = loan({ id: 'loan-a', name: 'Первый' })
    const second = loan({ id: 'loan-b', name: 'Второй' })
    useLoanStore.setState({ ...first, loans: [first, second], activeLoanId: first.id })
    render(<App />)

    await user.click(screen.getByRole('button', { name: /^Досрочные/ }))
    const rulesPanel = await screen.findByText('Регулярные досрочные платежи')
    const amount = rulesPanel.closest('section')?.querySelector('input[type="number"]') as HTMLInputElement | null
    if (!amount) throw new Error('Не найден input суммы регулярного правила')
    await user.clear(amount)
    await user.type(amount, '77777')
    await user.click(screen.getByRole('button', { name: /Досрочный платёж/i }))
    expect(await screen.findByRole('dialog', { name: 'Досрочный платёж' })).toBeTruthy()

    await act(async () => {
      useLoanStore.getState().switchLoan('loan-b')
    })

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Досрочный платёж' })).toBeNull())
    const nextAmount = screen.getByText('Регулярные досрочные платежи').closest('section')?.querySelector('input[type="number"]') as HTMLInputElement | null
    expect(nextAmount?.value).toBe('20000')
  })
})
