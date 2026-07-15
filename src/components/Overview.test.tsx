// @vitest-environment jsdom
import type { PropsWithChildren } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildLoanCalculation } from '../loanCalculation'
import { defaultConfig } from '../loanDefaults'
import { shortTestConfig } from '../testFixtures'
import { Overview } from './Overview'

vi.mock('recharts', () => {
  const Box = ({ children }: PropsWithChildren) => <div>{children}</div>
  const SvgBox = ({ children }: PropsWithChildren) => <svg>{children}</svg>
  const Empty = () => null
  return { Area: Empty, AreaChart: SvgBox, CartesianGrid: Empty, ResponsiveContainer: Box, Tooltip: Empty, XAxis: Empty, YAxis: Empty }
})

afterEach(() => { cleanup(); vi.useRealTimers() })

describe('Overview debt metrics', () => {
  it('отличает общую текущую задолженность от остатка основного долга', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-10T12:00:00Z'))
    const result = buildLoanCalculation({ config: shortTestConfig, repayments: [], repaymentRules: [], gracePeriods: [], selectedScenario: 'combined' })
    render(<Overview config={shortTestConfig} displayDecimals={2} repayments={[]} gracePeriods={[]} comparison={result.comparison!} selected={result.selected!} chartData={[]} onSelect={vi.fn()} onOpen={vi.fn()}/>)

    expect(screen.getByText(/Общая текущая задолженность/)).toBeTruthy()
    expect(screen.getByText('Тело кредита')).toBeTruthy()
    expect(screen.getByText(/Основной долг \+ начисленные и отложенные проценты/)).toBeTruthy()
  })

  it('показывает principal, а не ноль, для ещё не выданного кредита', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-10T12:00:00Z'))
    const futureConfig = { ...shortTestConfig, issueDate: '2027-01-01', firstPaymentDate: '2027-02-01', paymentDay: 1 }
    const result = buildLoanCalculation({ config: futureConfig, repayments: [], repaymentRules: [], gracePeriods: [], selectedScenario: 'combined' })
    render(<Overview config={futureConfig} displayDecimals={2} repayments={[]} gracePeriods={[]} comparison={result.comparison!} selected={result.selected!} chartData={[]} onSelect={vi.fn()} onOpen={vi.fn()}/>)

    const principalCard = screen.getByText('Тело кредита').closest('.current-debt')!
    expect(principalCard.querySelector('b')?.textContent).toContain('7')
    expect(principalCard.textContent).toContain('Будущий основной долг после выдачи')
  })

  it('не показывает обычное финальное округление как balloon-платёж', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'))
    const balloonConfig = { ...defaultConfig, principal: 120_000, annualRate: 12, issueDate: '2024-01-01', firstPaymentDate: '2024-02-01', firstPaymentInterestOnly: false, paymentDay: 1, termMonths: 12, closeThreshold: 0, interest: { ...defaultConfig.interest, method: 'annuity' as const } }
    const result = buildLoanCalculation({ config: balloonConfig, repayments: [], repaymentRules: [], gracePeriods: [], selectedScenario: 'combined' })
    render(<Overview config={balloonConfig} displayDecimals={2} repayments={[]} gracePeriods={[]} comparison={result.comparison!} selected={result.selected!} chartData={[]} onSelect={vi.fn()} onOpen={vi.fn()}/>)

    expect(screen.queryByText(/Финальный платёж по выбранным настройкам/)).toBeNull()
  })

  it('показывает существенный balloon из льготы без продления', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'))
    const balloonConfig = { ...defaultConfig, principal: 120_000, annualRate: 0, issueDate: '2024-01-01', firstPaymentDate: '2024-02-01', firstPaymentInterestOnly: false, paymentDay: 1, termMonths: 12, closeThreshold: 0 }
    const gracePeriods = [{ id: 'g-no-extend', startDate: '2024-03-01', endDate: '2024-05-31', type: 'full' as const, extendTerm: false, accrueInterest: false, capitalizeInterest: false }]
    const result = buildLoanCalculation({ config: balloonConfig, repayments: [], repaymentRules: [], gracePeriods, selectedScenario: 'combined' })
    render(<Overview config={balloonConfig} displayDecimals={2} repayments={[]} gracePeriods={gracePeriods} comparison={result.comparison!} selected={result.selected!} chartData={[]} onSelect={vi.fn()} onOpen={vi.fn()}/>)

    expect(screen.getByText(/Финальный платёж по выбранным настройкам/)).toBeTruthy()
  })
})
