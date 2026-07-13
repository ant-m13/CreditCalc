// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { buildLoanCalculation } from '../loanCalculation'
import { defaultConfig } from '../loanDefaults'
import { PrintReport } from './PrintReport'

afterEach(() => cleanup())

describe('PrintReport', () => {
  it('отличает выключенные операции и правила от применённых', () => {
    const result = buildLoanCalculation({ config: defaultConfig, repayments: [], repaymentRules: [], gracePeriods: [], selectedScenario: 'combined' })
    render(<PrintReport
      config={defaultConfig}
      displayDecimals={2}
      repayments={[{ id: 'disabled', date: defaultConfig.firstPaymentDate, amount: 10_000, enabled: false, amountMode: 'extra', strategy: 'reduceTerm', source: 'own', sameDayOrder: 'regularFirst', interestFirst: true }]}
      repaymentRules={[{ id: 'disabled-rule', name: 'Пауза', enabled: false, type: 'monthlyFixed', startDate: defaultConfig.firstPaymentDate, endDate: defaultConfig.firstPaymentDate, amount: 20_000, strategy: 'reduceTerm', source: 'own', sameDayOrder: 'regularFirst', interestFirst: true, skipMonths: [] }]}
      gracePeriods={[]}
      comparison={result.comparison!}
      selected={result.selected!}
    />)

    expect(screen.getAllByText('Выключено')).toHaveLength(2)
    expect(screen.queryByText('Применяется')).toBeNull()
  })

  it('выводит только существенный final balloon в печатной сводке', () => {
    const balloonConfig = { ...defaultConfig, principal: 120_000, annualRate: 0, issueDate: '2024-01-01', firstPaymentDate: '2024-02-01', firstPaymentInterestOnly: false, paymentDay: 1, termMonths: 12, closeThreshold: 0 }
    const gracePeriods = [{ id: 'g-no-extend', startDate: '2024-03-01', endDate: '2024-05-31', type: 'full' as const, extendTerm: false, accrueInterest: false, capitalizeInterest: false }]
    const result = buildLoanCalculation({ config: balloonConfig, repayments: [], repaymentRules: [], gracePeriods, selectedScenario: 'combined' })
    render(<PrintReport config={balloonConfig} displayDecimals={2} repayments={[]} repaymentRules={[]} gracePeriods={gracePeriods} comparison={result.comparison!} selected={result.selected!}/>)

    expect(screen.getByRole('heading', { name: 'Финальный платёж' })).toBeTruthy()
    expect(screen.getByText(/Закрывает остаток долга и процентов/)).toBeTruthy()
  })
})
