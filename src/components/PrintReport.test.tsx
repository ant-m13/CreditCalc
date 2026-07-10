// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { buildLoanCalculation } from '../loanCalculation'
import { defaultConfig } from '../loanDefaults'
import { PrintReport } from './PrintReport'

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
})
