import { describe, expect, it } from 'vitest'
import { defaultConfig } from './loanDefaults'
import { normalizePersistedState } from './storeNormalization'

describe('store normalization', () => {
  it('подставляет дефолты для legacy config без новых полей', () => {
    const normalized = normalizePersistedState({
      config: {
        principal: 1_500_000,
        annualRate: 9.5,
        issueDate: '2026-01-10',
        firstPaymentDate: '2026-02-10',
        termMonths: 120,
        paymentDay: 10
      },
      repayments: [],
      gracePeriods: [],
      selectedScenario: 'reducePayment',
      termUnit: 'years',
      displayDecimals: 0,
      theme: 'night'
    })

    expect(normalized.config).toMatchObject({
      principal: 1_500_000,
      annualRate: 9.5,
      issueDate: '2026-01-10',
      firstPaymentDate: '2026-02-10',
      paymentType: defaultConfig.paymentType,
      frequency: defaultConfig.frequency,
      currency: defaultConfig.currency,
      rounding: defaultConfig.rounding,
      firstPaymentInterestOnly: defaultConfig.firstPaymentInterestOnly,
      interest: defaultConfig.interest
    })
    expect(normalized.selectedScenario).toBe('reducePayment')
    expect(normalized.termUnit).toBe('years')
    expect(normalized.displayDecimals).toBe(0)
    expect(normalized.theme).toBe('night')
  })
})
