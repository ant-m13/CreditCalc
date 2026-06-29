import { describe, expect, it } from 'vitest'
import { parseLoanBackup } from './importExport'
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

  it('отклоняет повреждённый файл', () => {
    expect(() => parseLoanBackup('{broken')).toThrow('корректным JSON')
    expect(() => parseLoanBackup(JSON.stringify({ repayments: [] }))).toThrow('параметры кредита')
  })
})
