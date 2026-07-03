// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { defaultConfig, useLoanStore, type LoanProfile } from './store'

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
  localStorage.setItem('credit-calculator-seen-version', '1.5.8')
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

  it('добавляет выключенный досрочный платёж без попадания в календарь операций', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /Досрочный платёж/i }))
    await user.click(screen.getByRole('checkbox', { name: /Платёж включён/i }))
    await user.click(screen.getByRole('button', { name: 'Добавить и пересчитать' }))
    await user.click(screen.getByRole('button', { name: /^Досрочные/ }))

    expect(await screen.findByText('Временно отключено')).toBeTruthy()
    expect(screen.getByText('Добавьте разовый или регулярный платёж, чтобы увидеть общий календарь досрочных операций.')).toBeTruthy()
    expect(useLoanStore.getState().repayments[0]).toMatchObject({ amount: 100000, enabled: false })
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
