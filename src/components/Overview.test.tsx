// @vitest-environment jsdom
import type { PropsWithChildren } from 'react'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildLoanCalculation } from '../loanCalculation'
import { defaultConfig } from '../loanDefaults'
import { Overview } from './Overview'

vi.mock('recharts', () => {
  const Box = ({ children }: PropsWithChildren) => <div>{children}</div>
  const Empty = () => null
  return { Area: Empty, AreaChart: Box, CartesianGrid: Empty, ResponsiveContainer: Box, Tooltip: Empty, XAxis: Empty, YAxis: Empty }
})

afterEach(() => vi.useRealTimers())

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
})
