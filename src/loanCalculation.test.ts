import { describe, expect, it } from 'vitest'
import { buildLoanCalculation } from './loanCalculation'
import { defaultConfig } from './loanDefaults'

const MAX_CALCULATION_DURATION_MS = 4_000

describe('buildLoanCalculation', () => {
  it('строит четыре длинных сценария через путь для уже валидированных данных', () => {
    const startedAt = performance.now()
    const result = buildLoanCalculation({
      config: {
        ...defaultConfig,
        issueDate: '2025-01-01',
        firstPaymentDate: '2025-02-01',
        paymentDay: 1,
        firstPaymentInterestOnly: false,
        termMonths: 1200
      },
      repayments: [],
      repaymentRules: [],
      gracePeriods: [],
      selectedScenario: 'combined'
    })

    expect(result.errors).toEqual([])
    expect(result.comparison?.scenarios).toHaveLength(4)
    expect(result.selected?.schedule.length).toBeGreaterThan(700)
    expect(performance.now() - startedAt).toBeLessThan(MAX_CALCULATION_DURATION_MS)
  })
})
