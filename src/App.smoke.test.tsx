// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { defaultConfig, useLoanStore, type LoanProfile } from './store'
import { APP_VERSION } from './version'

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const loan = (): LoanProfile => ({
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
  useCustomAccentColor: false
})

const resetStore = () => {
  const activeLoan = loan()
  useLoanStore.setState({
    ...activeLoan,
    loans: [activeLoan],
    activeLoanId: activeLoan.id
  })
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
    expect(await screen.findByText('Сумма кредита')).toBeTruthy()
    expect(screen.getByText('Данные сохранены')).toBeTruthy()
  })

  it('добавляет выключенный досрочный платёж и быстро включает его из календаря', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /Досрочный платёж/i }))
    await user.click(screen.getByRole('checkbox', { name: /Платёж включён/i }))
    await user.click(screen.getByRole('button', { name: 'Добавить и пересчитать' }))
    await user.click(screen.getByRole('button', { name: /^Досрочные/ }))

    expect(await screen.findByText('Временно отключено')).toBeTruthy()
    expect(useLoanStore.getState().repayments[0]).toMatchObject({ amount: 100000, enabled: false })

    const enableButtons = await screen.findAllByRole('button', { name: /Включить платёж/i })
    expect(enableButtons).toHaveLength(2)
    await user.click(enableButtons[1])

    expect(useLoanStore.getState().repayments[0]).toMatchObject({ amount: 100000, enabled: true })
    expect(screen.getAllByRole('button', { name: /Выключить платёж/i })).toHaveLength(2)
  })

  it('не включает конфликтующую total-операцию быстрой кнопкой', async () => {
    const user = userEvent.setup()
    const activeLoan = loan()
    activeLoan.repayments = [
      { id: 'total-active', date: defaultConfig.firstPaymentDate, amount: 120000, amountMode: 'total', strategy: 'reduceTerm', source: 'own', sameDayOrder: 'regularFirst', interestFirst: true, sameDaySequence: 0 },
      { id: 'total-disabled', date: defaultConfig.firstPaymentDate, amount: 130000, amountMode: 'total', enabled: false, strategy: 'reducePayment', source: 'own', sameDayOrder: 'regularFirst', interestFirst: true, sameDaySequence: 1 }
    ]
    useLoanStore.setState({ ...activeLoan, loans: [activeLoan], activeLoanId: activeLoan.id })
    render(<App />)

    await user.click(screen.getByRole('button', { name: /^Досрочные/ }))
    await user.click(screen.getAllByRole('button', { name: /Включить платёж/i }).at(-1)!)

    expect(useLoanStore.getState().repayments[1].enabled).toBe(false)
    expect(await screen.findByRole('dialog', { name: 'Досрочный платёж' })).toBeTruthy()
    expect(screen.getByText(/только одну общую сумму/i)).toBeTruthy()
  })

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
})
