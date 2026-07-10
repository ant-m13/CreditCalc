// @vitest-environment jsdom
import type { PropsWithChildren } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildLoanCalculation } from '../loanCalculation'
import { defaultConfig } from '../loanDefaults'
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
    const result = buildLoanCalculation({ config: defaultConfig, repayments: [], repaymentRules: [], gracePeriods: [], selectedScenario: 'combined' })
    render(<Overview config={defaultConfig} displayDecimals={2} repayments={[]} gracePeriods={[]} comparison={result.comparison!} selected={result.selected!} chartData={[]} onSelect={vi.fn()} onOpen={vi.fn()}/>)

    expect(screen.getByText(/Общая текущая задолженность/)).toBeTruthy()
    expect(screen.getByText('Тело кредита')).toBeTruthy()
    expect(screen.getByText(/Основной долг \+ начисленные и отложенные проценты/)).toBeTruthy()
  })

  it('показывает principal, а не ноль, для ещё не выданного кредита', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-10T12:00:00Z'))
    const futureConfig = { ...defaultConfig, issueDate: '2027-01-01', firstPaymentDate: '2027-02-01', paymentDay: 1 }
    const result = buildLoanCalculation({ config: futureConfig, repayments: [], repaymentRules: [], gracePeriods: [], selectedScenario: 'combined' })
    render(<Overview config={futureConfig} displayDecimals={2} repayments={[]} gracePeriods={[]} comparison={result.comparison!} selected={result.selected!} chartData={[]} onSelect={vi.fn()} onOpen={vi.fn()}/>)

    const principalCard = screen.getByText('Тело кредита').closest('.current-debt')!
    expect(principalCard.querySelector('b')?.textContent).toContain('7')
    expect(principalCard.textContent).toContain('Будущий основной долг после выдачи')
  })
})
