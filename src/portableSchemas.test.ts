import { describe, expect, it } from 'vitest'
import { parseLoanBackupObject } from './importExport'
import { defaultConfig } from './loanDefaults'
import { validateLoan, validateScenario } from './loanEngine'
import type { EarlyRepayment, LoanConfig } from './loanEngine'
import {
  balanceMoments,
  dayCountBases,
  fontSizes,
  frequencies,
  graceTypes,
  interestMethods,
  paymentTypes,
  periodStarts,
  rateChangeModes,
  repaymentRuleTypes,
  repaymentSources,
  repaymentStrategies,
  roundingModes,
  sameDayOrders,
  scenarioIds,
  termUnits,
  themeNames
} from './portableSchemas'
import { validateRepaymentRuleStructure, type RepaymentRule } from './repaymentRules'
import { normalizeLoanData } from './storeNormalization'

describe('portable schemas', () => {
  it('сохраняет все допустимые значения конфигурации при нормализации и валидации', () => {
    for (const paymentType of paymentTypes) expect(normalizeLoanData({ config: { ...defaultConfig, paymentType } }).config.paymentType).toBe(paymentType)
    for (const frequency of frequencies) expect(normalizeLoanData({ config: { ...defaultConfig, frequency } }).config.frequency).toBe(frequency)
    for (const rounding of roundingModes) expect(normalizeLoanData({ config: { ...defaultConfig, rounding } }).config.rounding).toBe(rounding)
    for (const rateChangeMode of rateChangeModes) expect(normalizeLoanData({ config: { ...defaultConfig, rateChangeMode } }).config.rateChangeMode).toBe(rateChangeMode)

    for (const method of interestMethods) expect(validateLoan({ ...defaultConfig, interest: { ...defaultConfig.interest, method } })).toEqual([])
    for (const dayCountBasis of dayCountBases) expect(validateLoan({ ...defaultConfig, interest: { ...defaultConfig.interest, dayCountBasis } })).toEqual([])
    for (const periodStart of periodStarts) expect(validateLoan({ ...defaultConfig, interest: { ...defaultConfig.interest, periodStart } })).toEqual([])
    for (const balanceMoment of balanceMoments) expect(validateLoan({ ...defaultConfig, interest: { ...defaultConfig.interest, balanceMoment } })).toEqual([])
  })

  it('использует одинаковые enum-границы в import, store и engine validation', () => {
    const invalid = { ...defaultConfig, paymentType: 'unknown-payment-type' as LoanConfig['paymentType'] }

    expect(() => parseLoanBackupObject({ version: 1, config: invalid })).toThrow('Тип платежа содержит недопустимое значение')
    expect(normalizeLoanData({ config: invalid }).config.paymentType).toBe(defaultConfig.paymentType)
    expect(validateLoan(invalid)).toContain('Тип платежа повреждён')
  })

  it('принимает общие схемы операций, правил и UI-настроек без изменения значений', () => {
    const baseRepayment: EarlyRepayment = {
      id: 'schema-early',
      date: defaultConfig.firstPaymentDate,
      amount: 1000,
      amountMode: 'extra',
      strategy: 'reduceTerm',
      source: 'own',
      sameDayOrder: 'regularFirst',
      interestFirst: true
    }
    for (const strategy of repaymentStrategies) expect(validateScenario(defaultConfig, [{ ...baseRepayment, strategy }], [])).not.toContain('Досрочный платёж №1: стратегия повреждена')
    for (const source of repaymentSources) expect(validateScenario(defaultConfig, [{ ...baseRepayment, source }], [])).not.toContain('Досрочный платёж №1: источник повреждён')
    for (const sameDayOrder of sameDayOrders) expect(validateScenario(defaultConfig, [{ ...baseRepayment, sameDayOrder }], [])).not.toContain('Досрочный платёж №1: порядок в дату платежа повреждён')
    for (const type of graceTypes) expect(validateScenario(defaultConfig, [], [{ id: `grace-${type}`, startDate: defaultConfig.issueDate, endDate: defaultConfig.issueDate, type, extendTerm: true, accrueInterest: true, capitalizeInterest: false }])).not.toContain('Льготный период №1: режим повреждён')

    for (const type of repaymentRuleTypes) {
      const rule: RepaymentRule = { id: `rule-${type}`, name: type, type, startDate: defaultConfig.firstPaymentDate, endDate: defaultConfig.firstPaymentDate, amount: 1000, percent: 10, strategy: 'reduceTerm', source: 'own', sameDayOrder: 'regularFirst', interestFirst: true, skipMonths: [] }
      expect(validateRepaymentRuleStructure(rule)).toEqual([])
    }

    const normalized = normalizeLoanData({ selectedScenario: scenarioIds.at(-1), termUnit: termUnits.at(-1), appFontSize: fontSizes.at(-1), scheduleFontSize: fontSizes[0], theme: themeNames.at(-1) })
    expect(normalized).toMatchObject({ selectedScenario: 'combined', termUnit: 'years', appFontSize: 'xlarge', scheduleFontSize: 'normal', theme: 'night' })
  })
})
