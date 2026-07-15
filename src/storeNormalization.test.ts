import { describe, expect, it } from 'vitest'
import { defaultConfig } from './loanDefaults'
import type { EarlyRepayment } from './loanEngine'
import type { RepaymentRule } from './repaymentRules'
import { assertRepaymentPlanStructurallyValid, assertRepaymentRuleStructurallyValid, normalizePersistedState } from './storeNormalization'

const repayment = (patch: Partial<EarlyRepayment> = {}): EarlyRepayment => ({
  id: 'early-1',
  date: defaultConfig.firstPaymentDate,
  amount: 100_000,
  amountMode: 'totalWithFee',
  strategy: 'reduceTerm',
  source: 'own',
  sameDayOrder: 'regularFirst',
  interestFirst: true,
  ...patch
})

const rule = (patch: Partial<RepaymentRule> = {}): RepaymentRule => ({
  id: 'rule-1',
  name: 'Ежемесячное правило',
  type: 'monthlyFixed',
  startDate: defaultConfig.firstPaymentDate,
  endDate: defaultConfig.firstPaymentDate,
  amount: 10_000,
  strategy: 'reduceTerm',
  source: 'own',
  sameDayOrder: 'regularFirst',
  interestFirst: true,
  skipMonths: [],
  ...patch
})

describe('store normalization', () => {
  it('проверяет структурную валидность плана погашений', () => {
    expect(() => assertRepaymentPlanStructurallyValid(defaultConfig, [repayment()], [])).not.toThrow()
    expect(() => assertRepaymentPlanStructurallyValid(defaultConfig, [
      repayment({ id: 'total-1', sameDaySequence: 0 }),
      repayment({ id: 'total-2', sameDaySequence: 1 })
    ], [])).toThrow('только одну общую сумму')
  })

  it('проверяет структурную валидность правила досрочного погашения', () => {
    expect(() => assertRepaymentRuleStructurallyValid(rule())).not.toThrow()
    expect(() => assertRepaymentRuleStructurallyValid(rule({ name: '' }))).toThrow('название обязательно')
    expect(() => assertRepaymentRuleStructurallyValid(rule({ type: 'paymentPercent', amount: undefined, percent: -1 }))).toThrow('процент')
  })

  it('подставляет дефолты для legacy config без новых полей', () => {
    const normalized = normalizePersistedState({
      config: {
        principal: 1_500_000,
        annualRate: 9.5,
        issueDate: '2026-01-10',
        firstPaymentDate: '2026-02-10',
        termMonths: 12,
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
      firstPaymentInterestOnlyMode: 'addToTerm',
      interest: defaultConfig.interest
    })
    expect(normalized.selectedScenario).toBe('reducePayment')
    expect(normalized.termUnit).toBe('years')
    expect(normalized.displayDecimals).toBe(0)
    expect(normalized.theme).toBe('night')
  })
})
