import { describe, expect, it } from 'vitest'
import { parseLoanBackup } from './importExport'
import { MAX_REPAYMENT_RULES } from './loanEngine/limits'
import { defaultConfig } from './store'

const repayment = { id: 'early-1', date: '2026-01-26', amount: 8704.99, amountMode: 'extra', strategy: 'reduceTerm', source: 'own', sameDayOrder: 'regularFirst', interestFirst: true }

describe('импорт резервной копии', () => {
  it('восстанавливает расчёт и настройки интерфейса', () => {
    const result = parseLoanBackup(JSON.stringify({ config: defaultConfig, repayments: [repayment], gracePeriods: [], selectedScenario: 'reducePayment', settings: { termUnit: 'years', displayDecimals: 0, theme: 'ocean' } }))
    expect(result.repayments[0].amount).toBe(8704.99)
    expect(result.selectedScenario).toBe('reducePayment')
    expect(result.repaymentRules).toEqual([])
    expect(result.termUnit).toBe('years')
    expect(result.displayDecimals).toBe(0)
    expect(result.theme).toBe('ocean')
  })

  it('поддерживает JSON старого формата', () => {
    const result = parseLoanBackup(JSON.stringify({ config: defaultConfig, repayments: [repayment], scenario: { id: 'reduceTerm', schedule: [] } }))
    expect(result.selectedScenario).toBe('reduceTerm')
    expect(result.gracePeriods).toEqual([])
    expect(result.repaymentRules).toEqual([])
  })

  it('восстанавливает правила досрочных платежей', () => {
    const rule = { id: 'rule-1', name: 'Ежемесячно', type: 'monthlyFixed', startDate: '2026-02-26', endDate: '2026-12-26', amount: 20000, strategy: 'reduceTerm', source: 'own', sameDayOrder: 'regularFirst', interestFirst: true, skipMonths: ['2026-05'] }
    const result = parseLoanBackup(JSON.stringify({ config: defaultConfig, repayments: [], repaymentRules: [rule], gracePeriods: [], selectedScenario: 'combined' }))
    expect(result.repaymentRules[0]).toMatchObject(rule)
  })

  it('отклоняет импорт с количеством правил сверх лимита', () => {
    const rules = Array.from({ length: MAX_REPAYMENT_RULES + 1 }, (_, index) => ({ id: `rule-${index}`, name: 'Ежемесячно', type: 'monthlyFixed', startDate: '2026-02-26', endDate: '2026-12-26', amount: 20000, strategy: 'reduceTerm', source: 'own', sameDayOrder: 'regularFirst', interestFirst: true, skipMonths: [] }))
    expect(() => parseLoanBackup(JSON.stringify({ config: defaultConfig, repayments: [], repaymentRules: rules, gracePeriods: [], selectedScenario: 'combined' }))).toThrow('Слишком много правил')
  })

  it('отклоняет повреждённый файл', () => {
    expect(() => parseLoanBackup('{broken')).toThrow('корректным JSON')
    expect(() => parseLoanBackup(JSON.stringify({ repayments: [] }))).toThrow('параметры кредита')
  })

  it('отклоняет неподдерживаемую валюту', () => {
    expect(() => parseLoanBackup(JSON.stringify({ config: { ...defaultConfig, currency: 'NOT-A-CURRENCY' }, repayments: [], gracePeriods: [] }))).toThrow('валюту')
  })

  it('отклоняет невозможные календарные даты', () => {
    expect(() => parseLoanBackup(JSON.stringify({ config: { ...defaultConfig, issueDate: '2024-02-31' }, repayments: [], gracePeriods: [] }))).toThrow('даты')
  })

  it('отклоняет слишком длинный срок', () => {
    expect(() => parseLoanBackup(JSON.stringify({ config: { ...defaultConfig, termMonths: 1201 }, repayments: [], gracePeriods: [] }))).toThrow('недопустимые числа')
  })

  it('отклоняет нулевую сумму кредита и дробные календарные поля', () => {
    expect(() => parseLoanBackup(JSON.stringify({ config: { ...defaultConfig, principal: 0 }, repayments: [], gracePeriods: [] }))).toThrow('недопустимые числа')
    expect(() => parseLoanBackup(JSON.stringify({ config: { ...defaultConfig, termMonths: 12.5 }, repayments: [], gracePeriods: [] }))).toThrow('недопустимые числа')
    expect(() => parseLoanBackup(JSON.stringify({ config: { ...defaultConfig, paymentDay: 15.7 }, repayments: [], gracePeriods: [] }))).toThrow('недопустимые числа')
  })

  it('отклоняет комиссию за досрочное погашение выше 100%', () => {
    expect(() => parseLoanBackup(JSON.stringify({ config: { ...defaultConfig, earlyRepaymentFeePercent: 150 }, repayments: [], gracePeriods: [] }))).toThrow('недопустимые числа')
  })

  it('отклоняет неизвестный выбранный сценарий', () => {
    expect(() => parseLoanBackup(JSON.stringify({ config: defaultConfig, repayments: [], gracePeriods: [], selectedScenario: 'broken' }))).toThrow('неизвестный сценарий')
  })

  it('отклоняет общую сумму строки банка с порядком earlyFirst', () => {
    expect(() => parseLoanBackup(JSON.stringify({ config: defaultConfig, repayments: [{ ...repayment, amountMode: 'total', sameDayOrder: 'earlyFirst' }], gracePeriods: [] }))).toThrow('общая сумма')
  })

  it('отклоняет общую сумму строки банка не в дату регулярного платежа', () => {
    const config = { ...defaultConfig, issueDate: '2026-01-01', firstPaymentDate: '2026-01-26', paymentDay: 26 }
    expect(() => parseLoanBackup(JSON.stringify({ config, repayments: [{ ...repayment, date: '2026-01-27', amountMode: 'total', sameDayOrder: 'regularFirst' }], gracePeriods: [] }))).toThrow('дату регулярного платежа')
  })

  it('нормализует legacy amountMode до preview и не допускает две общие суммы на дату', () => {
    const config = { ...defaultConfig, issueDate: '2026-01-01', firstPaymentDate: '2026-01-26', paymentDay: 26 }
    const legacy = parseLoanBackup(JSON.stringify({ config, repayments: [{ ...repayment, date: '2026-01-26', amountMode: undefined }], gracePeriods: [] }))
    expect(legacy.repayments[0]).toMatchObject({ amountMode: 'total', sameDayOrder: 'regularFirst' })
    expect(() => parseLoanBackup(JSON.stringify({ config, repayments: [
      { ...repayment, id: 'total-1', date: '2026-01-26', amountMode: 'total', sameDayOrder: 'regularFirst' },
      { ...repayment, id: 'total-2', date: '2026-01-26', amountMode: 'total', sameDayOrder: 'regularFirst' }
    ], gracePeriods: [] }))).toThrow('дублирующийся ID: 2026-01-26')
  })

  it('отклоняет дублирующиеся ID в импортируемых коллекциях', () => {
    const grace = { id: 'same', startDate: '2026-05-01', endDate: '2026-05-31', type: 'full', extendTerm: true, accrueInterest: true, capitalizeInterest: false }
    expect(() => parseLoanBackup(JSON.stringify({ config: defaultConfig, repayments: [{ ...repayment, id: 'same' }, { ...repayment, id: 'same' }], gracePeriods: [] }))).toThrow('дублирующийся ID')
    expect(() => parseLoanBackup(JSON.stringify({ config: defaultConfig, repayments: [], gracePeriods: [grace, grace] }))).toThrow('дублирующийся ID')
  })

  it('отклоняет обратный льготный период', () => {
    const grace = { id: 'g1', startDate: '2026-05-01', endDate: '2026-04-01', type: 'full', extendTerm: true, accrueInterest: true, capitalizeInterest: false }
    expect(() => parseLoanBackup(JSON.stringify({ config: defaultConfig, repayments: [], gracePeriods: [grace] }))).toThrow('окончание раньше начала')
  })

  it('отклоняет пересекающиеся льготные периоды в preview импорта', () => {
    const first = { id: 'g1', startDate: '2026-05-01', endDate: '2026-05-31', type: 'full', extendTerm: true, accrueInterest: true, capitalizeInterest: false }
    const second = { id: 'g2', startDate: '2026-05-15', endDate: '2026-06-15', type: 'interestOnly', extendTerm: false, accrueInterest: true, capitalizeInterest: false }
    expect(() => parseLoanBackup(JSON.stringify({ config: defaultConfig, repayments: [], gracePeriods: [first, second] }))).toThrow('не должны пересекаться')
  })
})
