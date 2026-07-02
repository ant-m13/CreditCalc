import { describe, expect, it } from 'vitest'
import { defaultConfig } from './loanDefaults'
import { expandRepaymentRules, type RepaymentRule } from './repaymentRules'

const rule = (patch: Partial<RepaymentRule>): RepaymentRule => ({
  id: 'rule-1',
  name: 'Правило',
  type: 'monthlyFixed',
  startDate: '2026-01-26',
  endDate: '2026-04-26',
  amount: 10000,
  strategy: 'reduceTerm',
  source: 'own',
  sameDayOrder: 'regularFirst',
  interestFirst: true,
  skipMonths: [],
  ...patch
})

describe('правила досрочных платежей', () => {
  it('создаёт ежемесячные досрочные платежи и пропускает выбранные месяцы', () => {
    const items = expandRepaymentRules(defaultConfig, [rule({ skipMonths: ['2026-03'] })])
    expect(items.map(item => item.date)).toEqual(['2026-01-26', '2026-02-26', '2026-04-26'])
    expect(items[0]).toMatchObject({ amount: 10000, strategy: 'reduceTerm', amountMode: 'extra' })
  })

  it('создаёт ежегодные премии', () => {
    const items = expandRepaymentRules(defaultConfig, [rule({ type: 'annualBonus', startDate: '2026-12-15', endDate: '2028-12-15', amount: 150000 })])
    expect(items.map(item => item.date)).toEqual(['2026-12-15', '2027-12-15', '2028-12-15'])
  })

  it('создаёт платёж как процент от регулярного платежа', () => {
    const items = expandRepaymentRules(defaultConfig, [rule({ type: 'paymentPercent', percent: 10, amount: undefined, startDate: '2026-08-15', endDate: '2026-08-15' })])
    expect(items).toHaveLength(1)
    expect(items[0].amount).toBeGreaterThan(0)
  })

  it('не сдвигает день правила после короткого месяца', () => {
    const items = expandRepaymentRules(defaultConfig, [rule({ startDate: '2026-01-31', endDate: '2026-04-30' })])
    expect(items.map(item => item.date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
  })

  it('округляет сумму правила согласно настройке кредита', () => {
    const items = expandRepaymentRules({ ...defaultConfig, rounding: 'rubles' }, [rule({ amount: 10000.49, startDate: '2026-01-26', endDate: '2026-01-26' })])
    expect(items[0].amount).toBe(10000)
  })

  it('пропускает временно отключенные правила с нулевой суммой или процентом', () => {
    expect(expandRepaymentRules(defaultConfig, [rule({ amount: 0 })])).toEqual([])
    expect(expandRepaymentRules(defaultConfig, [rule({ type: 'paymentPercent', amount: undefined, percent: 0 })])).toEqual([])
  })

  it('пропускает явно выключенное правило с ненулевой суммой', () => {
    expect(expandRepaymentRules(defaultConfig, [rule({ amount: 10000, enabled: false })])).toEqual([])
  })
})
