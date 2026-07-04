import { describe, expect, it } from 'vitest'
import { defaultConfig } from './loanDefaults'
import { expandRepaymentRules, type RepaymentRule } from './repaymentRules'
import type { GracePeriod } from './loanEngine'

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
  it('не строит базовый график, если правил нет', () => {
    expect(expandRepaymentRules({ ...defaultConfig, firstPaymentDate: defaultConfig.issueDate }, [])).toEqual([])
  })

  it('создаёт ежемесячные досрочные платежи и пропускает выбранные месяцы', () => {
    const items = expandRepaymentRules(defaultConfig, [rule({ skipMonths: ['2026-03'] })])
    expect(items.map(item => item.date)).toEqual(['2026-01-26', '2026-02-26', '2026-04-26'])
    expect(items[0]).toMatchObject({ amount: 10000, strategy: 'reduceTerm', amountMode: 'extra' })
  })

  it('создаёт ежегодные премии', () => {
    const items = expandRepaymentRules(defaultConfig, [rule({ type: 'annualBonus', startDate: '2026-12-15', endDate: '2028-12-15', amount: 150000 })])
    expect(items.map(item => item.date)).toEqual(['2026-12-15', '2027-12-15', '2028-12-15'])
  })

  it('создаёт платежи с расширенными интервалами', () => {
    expect(expandRepaymentRules(defaultConfig, [rule({ type: 'weeklyFixed', startDate: '2026-01-05', endDate: '2026-01-26' })]).map(item => item.date)).toEqual(['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26'])
    expect(expandRepaymentRules(defaultConfig, [rule({ type: 'bimonthlyFixed', startDate: '2026-01-26', endDate: '2026-07-26' })]).map(item => item.date)).toEqual(['2026-01-26', '2026-03-26', '2026-05-26', '2026-07-26'])
    expect(expandRepaymentRules(defaultConfig, [rule({ type: 'quarterlyFixed', startDate: '2026-01-26', endDate: '2026-10-26' })]).map(item => item.date)).toEqual(['2026-01-26', '2026-04-26', '2026-07-26', '2026-10-26'])
    expect(expandRepaymentRules(defaultConfig, [rule({ type: 'semiannualFixed', startDate: '2026-01-26', endDate: '2027-01-26' })]).map(item => item.date)).toEqual(['2026-01-26', '2026-07-26', '2027-01-26'])
    expect(expandRepaymentRules(defaultConfig, [rule({ type: 'annualFixed', startDate: '2026-01-26', endDate: '2028-01-26' })]).map(item => item.date)).toEqual(['2026-01-26', '2027-01-26', '2028-01-26'])
  })

  it('создаёт платёж как процент от регулярного платежа', () => {
    const items = expandRepaymentRules(defaultConfig, [rule({ type: 'paymentPercent', percent: 10, amount: undefined, startDate: '2026-08-15', endDate: '2026-08-15' })])
    expect(items).toHaveLength(1)
    expect(items[0].amount).toBeGreaterThan(0)
  })

  it('создаёт общий ежемесячный платёж на регулярных датах', () => {
    const items = expandRepaymentRules(defaultConfig, [rule({ type: 'monthlyTotalPayment', amount: 100000, startDate: '2026-08-15', endDate: '2026-10-15', sameDayOrder: 'earlyFirst' })])
    expect(items.map(item => item.date)).toEqual(['2026-08-15', '2026-09-15', '2026-10-15'])
    expect(items[0]).toMatchObject({ amount: 100000, amountMode: 'total', sameDayOrder: 'regularFirst' })
  })

  it('создаёт общий ежемесячный платёж на первой дате с платежом только по процентам', () => {
    const items = expandRepaymentRules(defaultConfig, [rule({ type: 'monthlyTotalPayment', amount: 100000, startDate: defaultConfig.firstPaymentDate, endDate: defaultConfig.firstPaymentDate })])
    expect(items.map(item => item.date)).toEqual([defaultConfig.firstPaymentDate])
    expect(items[0]).toMatchObject({ amountMode: 'total', sameDayOrder: 'regularFirst' })
  })

  it('создаёт общий ежемесячный платёж на продлённых датах после длинной льготы', () => {
    const short = { ...defaultConfig, principal: 30_000, annualRate: 0, termMonths: 3, issueDate: '2026-01-01', firstPaymentDate: '2026-02-01', paymentDay: 1, firstPaymentInterestOnly: false }
    const grace: GracePeriod = { id: 'g-long', startDate: '2026-02-01', endDate: '2027-01-31', type: 'full', extendTerm: true, accrueInterest: false, capitalizeInterest: false }
    const items = expandRepaymentRules(short, [rule({ type: 'monthlyTotalPayment', amount: 10000, startDate: '2027-02-01', endDate: '2027-04-01' })], [grace])
    expect(items.map(item => item.date)).toEqual(['2027-02-01', '2027-03-01', '2027-04-01'])
  })

  it('создаёт общий платёж на продлённых двухнедельных и квартальных датах', () => {
    const grace: GracePeriod = { id: 'g', startDate: '2026-02-01', endDate: '2026-03-31', type: 'full', extendTerm: true, accrueInterest: false, capitalizeInterest: false }
    const quarterlyGrace: GracePeriod = { ...grace, id: 'g-quarter', startDate: '2026-04-01', endDate: '2026-06-30' }
    const biweekly = { ...defaultConfig, principal: 260_000, annualRate: 0, termMonths: 3, frequency: 'biweekly' as const, issueDate: '2026-01-01', firstPaymentDate: '2026-01-15', paymentDay: 15, firstPaymentInterestOnly: false }
    const quarterly = { ...defaultConfig, principal: 90_000, annualRate: 0, termMonths: 6, frequency: 'quarterly' as const, issueDate: '2026-01-01', firstPaymentDate: '2026-01-15', paymentDay: 15, firstPaymentInterestOnly: false }
    expect(expandRepaymentRules(biweekly, [rule({ type: 'monthlyTotalPayment', amount: 10000, startDate: '2026-04-09', endDate: '2026-04-23' })], [grace]).map(item => item.date)).toEqual(['2026-04-09', '2026-04-23'])
    expect(expandRepaymentRules(quarterly, [rule({ type: 'monthlyTotalPayment', amount: 10000, startDate: '2026-07-15', endDate: '2026-07-15' })], [quarterlyGrace]).map(item => item.date)).toEqual(['2026-07-15'])
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
