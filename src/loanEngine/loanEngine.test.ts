import { describe, expect, it } from 'vitest'
import { calculateAnnuityPayment, calculateDebtAtDate, calculateInterest, compareScenarios, createRateTimeline, extendedPaymentPeriods, generateBaseSchedule, nextPaymentDate, preparePaymentCalendar, scheduledPaymentDates, sortRepaymentsByApplicationOrder, validateScenario } from '.'
import { MAX_FINANCIAL_RESULT, MAX_MONEY_AMOUNT, MAX_RATE_CHANGES } from './limits'
import { assertFiniteFinancialNumber } from './financialSafety'
import type { EarlyRepayment, GracePeriod, LoanConfig } from './types'

const config: LoanConfig = {
  principal: 3_000_000, annualRate: 12, rateChanges: [], rateChangeMode: 'nextPeriod', issueDate: '2024-01-01', firstPaymentDate: '2024-02-15', firstPaymentInterestOnly: false, termMonths: 120,
  paymentDay: 15, paymentType: 'annuity', frequency: 'monthly', currency: 'RUB', rounding: 'kopecks', closeThreshold: 300,
  oneTimeFee: 0, monthlyFee: 0, earlyRepaymentFeePercent: 0,
  interest: { method: 'annuity', dayCountBasis: 'actualActual', includePaymentDate: false, periodStart: 'inclusive', balanceMoment: 'startOfDay' }
}
const early = (patch: Partial<EarlyRepayment> = {}): EarlyRepayment => ({ id: 'e1', date: '2024-08-15', amount: 300_000, amountMode: 'extra', strategy: 'reduceTerm', source: 'own', sameDayOrder: 'regularFirst', interestFirst: true, ...patch })
type BaseScheduleOptions = NonNullable<Parameters<typeof generateBaseSchedule>[1]>
const basePaymentCalendar = preparePaymentCalendar(config)
const generateConfigSchedule = (options: BaseScheduleOptions = {}) => generateBaseSchedule(config, { ...options, paymentCalendar: basePaymentCalendar })
const compareConfigScenarios = (repayments: EarlyRepayment[]) => compareScenarios(config, repayments, [], basePaymentCalendar)
const baseSchedule = generateConfigSchedule()

describe('loan engine', () => {
  it('отклоняет нефинитные и чрезмерные денежные значения до построения графика', () => {
    expect(validateScenario({ ...config, principal: Number.MAX_VALUE }, [], []).join(' ')).toContain(String(MAX_MONEY_AMOUNT))
    expect(validateScenario(config, [early({ amount: MAX_MONEY_AMOUNT + 1 })], []).join(' ')).toContain(String(MAX_MONEY_AMOUNT))
    expect(validateScenario(config, [early({ amount: Number.POSITIVE_INFINITY })], []).join(' ')).toContain('сумма')
    expect(() => generateBaseSchedule({ ...config, principal: Number.MAX_VALUE })).toThrow(String(MAX_MONEY_AMOUNT))
  })

  it('не возвращает нефинитные числа в допустимом граничном графике', () => {
    const schedule = generateBaseSchedule({ ...config, principal: MAX_MONEY_AMOUNT, annualRate: 100, termMonths: 12 })
    const serialized = JSON.stringify(schedule)
    expect(serialized).not.toMatch(/(?:NaN|Infinity)/)
    expect(schedule.every(row => [row.payment, row.interest, row.principal, row.cashFlowTotal, row.closingBalance].every(Number.isFinite))).toBe(true)
  })
  it('ограничивает агрегаты безопасным диапазоном целых копеек', () => {
    expect(Number.isSafeInteger(MAX_FINANCIAL_RESULT * 100)).toBe(true)
    expect(MAX_FINANCIAL_RESULT * 100).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER)
    expect(() => assertFiniteFinancialNumber(MAX_FINANCIAL_RESULT + 0.01, 'Итог')).toThrow('допустимый финансовый диапазон')
  })
  it('рассчитывает аннуитетный платёж', () => expect(calculateAnnuityPayment(1_000_000, 12, 12).toNumber()).toBeCloseTo(88848.79, 2))
  it('строит базовый график с выдачей и закрывает долг', () => { const s=baseSchedule; expect(s[0]).toMatchObject({number:1,date:'2024-01-01',payment:0,interest:0,principal:0,closingBalance:3000000}); expect(s.length).toBeLessThanOrEqual(121); expect(s.at(-1)?.closingBalance).toBe(0) })
  it('добавляет пояснение формулы для строк платежей', () => { const row=baseSchedule.find(x=>x.payment>0)!; expect(row.audit).toMatchObject({periodStart:'2024-01-01',periodEnd:'2024-02-15',dayCountBasis:'actualActual',rounding:'kopecks'}); expect(row.audit!.interestBeforeRounding).toBeGreaterThan(0) })
  it('сокращает срок при досрочном платеже', () => { const s=generateConfigSchedule({earlyRepayments:[early()]}); expect(s.length).toBeLessThan(baseSchedule.length) })
  it('уменьшает платёж при сохранении срока', () => { const s=generateConfigSchedule({earlyRepayments:[early({strategy:'reducePayment'})]}); expect(s.find(x=>x.date==='2024-09-15')!.payment).toBeLessThan(s.find(x=>x.date==='2024-02-15')!.payment); expect(s.length).toBeGreaterThan(100) })
  it('применяет досрочный платёж в дату регулярного', () => { const s=generateConfigSchedule({earlyRepayments:[early()]}); expect(s.find(x=>x.date==='2024-08-15')?.earlyPayment).toBe(300000) })
  it('применяет досрочный платёж между датами', () => { const s=generateConfigSchedule({earlyRepayments:[early({date:'2024-08-02'})]}); expect(s.find(x=>x.date==='2024-08-02')?.event).toContain('срока') })
  it('выводит досрочный платёж отдельной строкой в фактическую дату', () => {
    const s=generateConfigSchedule({earlyRepayments:[early({date:'2024-08-02'})]})
    const row=s.find(x=>x.date==='2024-08-02')
    expect(row?.earlyPayment).toBe(300000)
    expect(row?.days).toBeGreaterThan(0)
    expect(s.find(x=>x.date==='2024-08-15')!.days).toBe(13)
  })
  it('поддерживает несколько досрочных платежей', () => { const s=generateConfigSchedule({earlyRepayments:[early(),early({id:'e2',date:'2025-02-15',amount:200000})]}); expect(s.reduce((a,x)=>a+x.earlyPayment,0)).toBe(500000) })
  it('не меняет финансовый результат same-day операций при изменении технических ID', () => {
    const repaymentA = early({ id: 'a', date: '2024-08-15', amount: 100_000, strategy: 'reduceTerm', sameDaySequence: 0 })
    const repaymentB = early({ id: 'b', date: '2024-08-15', amount: 100_000, strategy: 'reducePayment', sameDaySequence: 1 })
    const renamedA = { ...repaymentA, id: 'z' }
    const renamedB = { ...repaymentB, id: 'm' }
    const first = compareConfigScenarios(sortRepaymentsByApplicationOrder([repaymentA, repaymentB])).scenarios.find(s => s.id === 'combined')!
    const second = compareConfigScenarios(sortRepaymentsByApplicationOrder([renamedA, renamedB])).scenarios.find(s => s.id === 'combined')!
    expect(second.monthlyPayment).toBe(first.monthlyPayment)
    expect(second.closingDate).toBe(first.closingDate)
    expect(second.totalInterest).toBe(first.totalInterest)
  })
  it('сохраняет sequence same-day операций при перестановке JSON-массива', () => {
    const repaymentA = early({ id: 'late-id', date: '2024-08-15', amount: 100_000, strategy: 'reduceTerm', sameDaySequence: 0 })
    const repaymentB = early({ id: 'early-id', date: '2024-08-15', amount: 100_000, strategy: 'reducePayment', sameDaySequence: 1 })
    const first = generateConfigSchedule({ earlyRepayments: sortRepaymentsByApplicationOrder([repaymentA, repaymentB]) })
    const second = generateConfigSchedule({ earlyRepayments: sortRepaymentsByApplicationOrder([repaymentB, repaymentA]) })
    expect(second.map(row => [row.date, row.payment, row.earlyPayment, row.closingBalance])).toEqual(first.map(row => [row.date, row.payment, row.earlyPayment, row.closingBalance]))
  })
  it('учитывает льготный период', () => { const grace:GracePeriod={id:'g',startDate:'2024-03-01',endDate:'2024-04-30',type:'interestOnly',extendTerm:true,accrueInterest:true,capitalizeInterest:false}; const s=generateBaseSchedule(config,{gracePeriods:[grace]}); const row=s.find(x=>x.date==='2024-03-15')!; expect(row.principal).toBe(0); expect(row.event).toContain('проценты') })
  it('продлевает льготу дольше исходного срока до устойчивой даты закрытия', () => {
    const short = { ...config, principal: 30_000, annualRate: 0, termMonths: 3, issueDate: '2024-01-01', firstPaymentDate: '2024-02-01', paymentDay: 1 }
    const grace: GracePeriod = { id: 'g-long', startDate: '2024-02-01', endDate: '2025-01-31', type: 'full', extendTerm: true, accrueInterest: false, capitalizeInterest: false }
    const s = generateBaseSchedule(short, { gracePeriods: [grace] })
    const balloonInsideGrace = s.some(row => row.date <= grace.endDate && row.eventTypes.includes('materialBalloon'))
    expect(balloonInsideGrace).toBe(false)
    expect(s.at(-1)!.date > grace.endDate).toBe(true)
    expect(s.filter(row => row.isRegularPayment)).toHaveLength(3)
  })
  it('строит длинный календарь льготы линейным проходом', () => {
    const onePeriod = { ...config, principal: 10_000, annualRate: 0, termMonths: 1, issueDate: '2024-01-01', firstPaymentDate: '2024-02-01', paymentDay: 1 }
    let graceEnd = onePeriod.firstPaymentDate
    for (let index = 1; index < 5000; index += 1) graceEnd = nextPaymentDate(graceEnd, onePeriod)
    const grace: GracePeriod = { id: 'g-5000', startDate: onePeriod.firstPaymentDate, endDate: graceEnd, type: 'full', extendTerm: true, accrueInterest: false, capitalizeInterest: false }
    const dates = scheduledPaymentDates(onePeriod, [grace])

    expect(dates).toHaveLength(5001)
    expect(extendedPaymentPeriods(onePeriod, [grace])).toBe(5000)
    expect(dates.at(-1)! > grace.endDate).toBe(true)
  })

  it('строит календарь продления для нескольких intervals и разных частот', () => {
    const monthly = { ...config, principal: 100_000, annualRate: 0, termMonths: 3, issueDate: '2024-01-01', firstPaymentDate: '2024-02-01', paymentDay: 1 }
    const first: GracePeriod = { id: 'g1', startDate: '2024-02-01', endDate: '2024-02-01', type: 'full', extendTerm: true, accrueInterest: false, capitalizeInterest: false }
    const second: GracePeriod = { id: 'g2', startDate: '2024-04-01', endDate: '2024-04-01', type: 'full', extendTerm: true, accrueInterest: false, capitalizeInterest: false }
    const biweekly = { ...monthly, termMonths: 1, frequency: 'biweekly' as const, firstPaymentDate: '2024-01-15', paymentDay: 15 }
    const quarterly = { ...monthly, termMonths: 6, frequency: 'quarterly' as const, firstPaymentDate: '2024-01-15', paymentDay: 15 }

    expect(scheduledPaymentDates(monthly, [second, first])).toEqual(['2024-02-01', '2024-03-01', '2024-04-01', '2024-05-01', '2024-06-01'])
    expect(scheduledPaymentDates(biweekly, [{ ...first, startDate: '2024-01-15', endDate: '2024-01-15' }])).toEqual(['2024-01-15', '2024-01-29', '2024-02-12'])
    expect(scheduledPaymentDates(quarterly, [{ ...first, startDate: '2024-01-15', endDate: '2024-01-15' }])).toEqual(['2024-01-15', '2024-04-15', '2024-07-15'])
  })
  it('капитализирует непогашенные проценты при уменьшенном льготном платеже', () => {
    const short = { ...config, principal: 120_000, annualRate: 12, termMonths: 12, issueDate: '2024-01-01', firstPaymentDate: '2024-02-01', paymentDay: 1 }
    const grace: GracePeriod = { id: 'g-reduced-cap', startDate: '2024-02-01', endDate: '2024-02-01', type: 'reduced', paymentAmount: 0, extendTerm: true, accrueInterest: true, capitalizeInterest: true }
    const row = generateBaseSchedule(short, { gracePeriods: [grace] }).find(item => item.date === '2024-02-01')!
    expect(row.deferredInterestClosing).toBe(0)
    expect(row.closingBalance).toBeGreaterThan(row.openingBalance)
  })
  it('капитализирует непогашенные проценты при индивидуальном льготном платеже', () => {
    const short = { ...config, principal: 120_000, annualRate: 12, termMonths: 12, issueDate: '2024-01-01', firstPaymentDate: '2024-02-01', paymentDay: 1 }
    const grace: GracePeriod = { id: 'g-custom-cap', startDate: '2024-02-01', endDate: '2024-02-01', type: 'custom', paymentAmount: 0, extendTerm: true, accrueInterest: true, capitalizeInterest: true }
    const row = generateBaseSchedule(short, { gracePeriods: [grace] }).find(item => item.date === '2024-02-01')!
    expect(row.deferredInterestClosing).toBe(0)
    expect(row.closingBalance).toBeGreaterThan(row.openingBalance)
  })
  it('не продлевает договорную дату закрытия при льготе без продления', () => {
    const short = { ...config, principal: 120_000, annualRate: 0, termMonths: 12, issueDate: '2024-01-01', firstPaymentDate: '2024-02-01', paymentDay: 1 }
    const base = generateBaseSchedule(short)
    const grace: GracePeriod = { id: 'g-no-extend', startDate: '2024-03-01', endDate: '2024-05-31', type: 'full', extendTerm: false, accrueInterest: false, capitalizeInterest: false }
    const s = generateBaseSchedule(short, { gracePeriods: [grace] })
    expect(s.at(-1)?.date).toBe(base.at(-1)?.date)
    expect(s.at(-1)?.eventTypes).toContain('materialBalloon')
    expect(s.at(-1)?.payment).toBeGreaterThan(base.at(-1)!.payment)
  })
  it('продлевает льготу в платёжных периодах для двухнедельного графика', () => {
    const biweekly = { ...config, principal: 260_000, annualRate: 0, termMonths: 12, frequency: 'biweekly' as const, issueDate: '2024-01-01', firstPaymentDate: '2024-01-15', paymentDay: 15 }
    const grace: GracePeriod = { id: 'g-biweekly', startDate: '2024-04-01', endDate: '2024-06-30', type: 'full', extendTerm: true, accrueInterest: false, capitalizeInterest: false }
    const base = generateBaseSchedule(biweekly)
    const s = generateBaseSchedule(biweekly, { gracePeriods: [grace] })
    expect(s.length - base.length).toBe(6)
  })
  it('продлевает льготу в платёжных периодах для квартального графика', () => {
    const quarterly = { ...config, principal: 120_000, annualRate: 0, termMonths: 12, frequency: 'quarterly' as const, issueDate: '2024-01-01', firstPaymentDate: '2024-01-15', paymentDay: 15 }
    const grace: GracePeriod = { id: 'g-quarterly', startDate: '2024-04-01', endDate: '2024-06-30', type: 'full', extendTerm: true, accrueInterest: false, capitalizeInterest: false }
    const base = generateBaseSchedule(quarterly)
    const s = generateBaseSchedule(quarterly, { gracePeriods: [grace] })
    expect(s.length - base.length).toBe(1)
  })
  it('работает с нулевой ставкой', () => { const s=generateBaseSchedule({...config,annualRate:0}); const first=s.find(x=>x.date==='2024-02-15')!; expect(first.interest).toBe(0); expect(first.payment).toBe(25000) })
  it('считает обычное финальное округление сверкой, а не balloon-платежом', () => {
    const ordinary = { ...config, principal: 120_000, annualRate: 12, issueDate: '2024-01-01', firstPaymentDate: '2024-02-01', firstPaymentInterestOnly: false, paymentDay: 1, termMonths: 12, closeThreshold: 0 }
    const finalRow = generateBaseSchedule(ordinary).at(-1)!
    expect(finalRow.eventTypes).toContain('finalReconciliation')
    expect(finalRow.eventTypes).not.toContain('materialBalloon')
    expect(finalRow.isRegularPayment).toBe(true)
  })
  it('пересчитывает платёж при нулевой ставке после сокращения срока', () => {
    const zeroRate = { ...config, principal: 120_000, annualRate: 0, termMonths: 12, issueDate: '2024-01-01', firstPaymentDate: '2024-02-01', paymentDay: 1, closeThreshold: 0 }
    const s = generateBaseSchedule(zeroRate, { earlyRepayments: [
      early({ id: 'term', date: '2024-03-01', amount: 20_000, strategy: 'reduceTerm' }),
      early({ id: 'payment', date: '2024-04-01', amount: 10_000, strategy: 'reducePayment' })
    ] })
    const nextRegular = s.find(row => row.date === '2024-05-01')!

    expect(nextRegular.payment).toBe(8571.43)
    expect(s.every(row => row.closingBalance >= 0)).toBe(true)
    expect(s.at(-1)?.closingBalance).toBe(0)
  })
  it('после сокращения срока уменьшает платёж на аннуитетную долю reducePayment', () => {
    const short = { ...config, principal: 1_000_000, annualRate: 12, termMonths: 24, issueDate: '2024-01-01', firstPaymentDate: '2024-02-01', paymentDay: 1, closeThreshold: 0 }
    const reduceTerm = early({ id: 'term-first', date: '2024-03-01', amount: 300_000, strategy: 'reduceTerm' })
    const reducePayment = early({ id: 'payment-second', date: '2024-04-01', amount: 100_000, strategy: 'reducePayment' })
    const contractualRemaining = generateBaseSchedule(short).filter(row => row.isRegularPayment && row.date > reducePayment.date).length
    const termOnly = generateBaseSchedule(short, { earlyRepayments: [reduceTerm] })
    const actualRemaining = termOnly.filter(row => row.isRegularPayment && row.date > reducePayment.date).length
    const mixed = generateBaseSchedule(short, { earlyRepayments: [reduceTerm, reducePayment] })
    const reducePaymentRow = mixed.find(row => row.date === reducePayment.date)!
    const nextRegular = mixed.find(row => row.date === '2024-05-01')!
    const appliedPrincipal = reducePaymentRow.repaymentOutcomes?.find(outcome => outcome.repaymentId === reducePayment.id)?.appliedPrincipal ?? reducePayment.amount
    const expectedPayment = reducePaymentRow.payment - calculateAnnuityPayment(appliedPrincipal, short.annualRate, actualRemaining, 12, short.rounding).toNumber()
    const fullRecalculatedPayment = calculateAnnuityPayment(reducePaymentRow.closingBalance, short.annualRate, actualRemaining, 12, short.rounding).toNumber()
    const contractualTermPayment = reducePaymentRow.payment - calculateAnnuityPayment(appliedPrincipal, short.annualRate, contractualRemaining, 12, short.rounding).toNumber()

    expect(actualRemaining).toBeLessThan(contractualRemaining)
    expect(nextRegular.payment).toBeCloseTo(expectedPayment, 2)
    expect(nextRegular.payment).toBeGreaterThan(fullRecalculatedPayment)
    expect(nextRegular.payment).toBeLessThan(contractualTermPayment)
  })
  it('не допускает отрицательный остаток при переплате досрочным погашением', () => {
    const zeroRate = { ...config, principal: 100_000, annualRate: 0, termMonths: 12, issueDate: '2024-01-01', firstPaymentDate: '2024-02-01', paymentDay: 1, closeThreshold: 0 }
    const s = generateBaseSchedule(zeroRate, { earlyRepayments: [early({ id: 'overpay', date: '2024-01-15', amount: 150_000, strategy: 'full', interestFirst: false })] })
    const row = s.find(item => item.date === '2024-01-15')!

    expect(row.closingBalance).toBe(0)
    expect(row.repaymentOutcomes?.[0]).toMatchObject({ appliedPrincipal: 100_000, unusedAmount: 50_000 })
    expect(s.every(item => item.closingBalance >= 0)).toBe(true)
  })
  it('выполняет полное досрочное погашение', () => { const s=generateBaseSchedule(config,{earlyRepayments:[early({date:'2024-03-15',amount:4_000_000,strategy:'full'})]}); expect(s.length).toBe(3); expect(s.at(-1)?.closingBalance).toBe(0) })
  it('считает кредит закрытым при фактическом погашении через reducePayment', () => {
    const closingConfig: LoanConfig = { ...config, principal: 100_000, annualRate: 0, termMonths: 12, issueDate: '2024-01-01', firstPaymentDate: '2024-02-01', paymentDay: 1, firstPaymentInterestOnly: false }
    const result = compareScenarios(closingConfig, [early({ date: '2024-01-15', amount: 100_000, strategy: 'reducePayment', interestFirst: false })])
    const paymentScenario = result.scenarios.find(scenario => scenario.id === 'reducePayment')!
    const closingRow = paymentScenario.schedule.at(-1)!

    expect(closingRow.closingBalance).toBe(0)
    expect(closingRow.fullyClosedByEarlyRepayment).toBe(true)
    expect(paymentScenario.monthlyPayment).toBe(0)
  })
  it('не начисляет комиссию за последующую same-day операцию после полного закрытия', () => {
    const closingConfig: LoanConfig = { ...config, principal: 100_000, annualRate: 0, termMonths: 12, issueDate: '2024-01-01', firstPaymentDate: '2024-02-01', paymentDay: 1, earlyRepaymentFeePercent: 10 }
    const schedule = generateBaseSchedule(closingConfig, {
      earlyRepayments: [
        early({ id: 'full-close', date: '2024-01-15', amount: 111_111.12, strategy: 'full', sameDaySequence: 0 }),
        early({ id: 'ignored-extra', date: '2024-01-15', amount: 50_000, strategy: 'reduceTerm', sameDaySequence: 1, comment: 'Лишняя операция' })
      ]
    })
    const row = schedule.find(item => item.date === '2024-01-15')!

    expect(row.closingBalance).toBe(0)
    expect(row.earlyPayment).toBe(100000)
    expect(row.feePaid).toBe(11111.11)
    expect(row.cashFlowTotal).toBe(111111.11)
    expect(row.eventTypes).toContain('earlyIgnored')
    expect(row.comment).toContain('долг уже закрыт')
  })

  it('не начисляет комиссию за total operation после закрывающего регулярного платежа', () => {
    const closingConfig: LoanConfig = { ...config, principal: 100_000, annualRate: 0, termMonths: 1, issueDate: '2024-01-01', firstPaymentDate: '2024-02-01', paymentDay: 1, firstPaymentInterestOnly: false, earlyRepaymentFeePercent: 10 }
    const schedule = generateBaseSchedule(closingConfig, {
      earlyRepayments: [early({ id: 'ignored-total', date: '2024-02-01', amount: 150_000, amountMode: 'totalWithFee', strategy: 'reduceTerm', sameDaySequence: 0, sameDayOrder: 'regularFirst' })]
    })
    const row = schedule.find(item => item.date === '2024-02-01')!

    expect(row.closingBalance).toBe(0)
    expect(row.payment).toBe(100000)
    expect(row.earlyPayment).toBe(0)
    expect(row.feePaid).toBe(0)
    expect(row.cashFlowTotal).toBe(100000)
    expect(row.eventTypes).toContain('earlyIgnored')
  })

  it('сохраняет операции после даты закрытия в outcomes закрывающей строки', () => {
    const closingConfig: LoanConfig = { ...config, principal: 100_000, annualRate: 0, termMonths: 1, issueDate: '2024-01-01', firstPaymentDate: '2024-02-01', paymentDay: 1, firstPaymentInterestOnly: false }
    const schedule = generateBaseSchedule(closingConfig, {
      earlyRepayments: [early({ id: 'late-after-close', date: '2024-03-01', amount: 50_000, strategy: 'reduceTerm' })]
    })
    const row = schedule.at(-1)!

    expect(row.date).toBe('2024-02-01')
    expect(schedule.some(item => item.eventTypes.length > 0 && item.eventTypes.every(type => type === 'earlyIgnored'))).toBe(false)
    expect(row.repaymentOutcomes).toEqual([expect.objectContaining({ repaymentId: 'late-after-close', requestedAmount: 50_000, appliedAmount: 0, unusedAmount: 50_000, reason: 'debtClosed' })])
  })

  it('сохраняет regularPaymentApplied для totalWithFee после даты закрытия', () => {
    const closingConfig: LoanConfig = { ...config, principal: 120_000, annualRate: 0, termMonths: 12, issueDate: '2024-01-01', firstPaymentDate: '2024-02-01', paymentDay: 1, firstPaymentInterestOnly: false }
    const schedule = generateBaseSchedule(closingConfig, {
      earlyRepayments: [
        early({ id: 'full-close', date: '2024-01-15', amount: 120_000, strategy: 'full', interestFirst: false, sameDaySequence: 0 }),
        early({ id: 'late-total-after-close', date: '2024-02-01', amount: 50_000, amountMode: 'totalWithFee', strategy: 'reduceTerm', sameDayOrder: 'regularFirst', sameDaySequence: 1 })
      ]
    })
    const row = schedule.at(-1)!
    const outcome = row.repaymentOutcomes?.find(item => item.repaymentId === 'late-total-after-close')

    expect(row.date).toBe('2024-01-15')
    expect(outcome).toMatchObject({ requestedAmount: 50_000, regularPaymentApplied: 10_000, appliedAmount: 0, fee: 0, unusedAmount: 40_000, reason: 'debtClosed' })
  })
  it('не закрывает кредит, если основной долг погашен, но остались отложенные проценты', () => {
    const c = { ...config, principal: 1_000_000, termMonths: 12, firstPaymentDate: '2024-02-01', paymentDay: 1 }
    const s = generateBaseSchedule(c, {
      earlyRepayments: [early({ date: '2024-01-15', amount: 1_000_000, strategy: 'full', interestFirst: false, sameDayOrder: 'regularFirst' })]
    })
    const earlyRow = s.find(row => row.date === '2024-01-15')!
    const interestRow = s.find(row => row.event === 'Погашение отложенных процентов')!
    expect(earlyRow.closingBalance).toBe(0)
    expect(interestRow.payment).toBeGreaterThan(0)
    expect(s.at(-1)?.closingBalance).toBe(0)
    expect(s.at(-1)?.payment).toBeGreaterThan(0)
  })
  it('автоматически закрывает остаток меньше порога', () => { const c={...config,principal:1000,termMonths:3,closeThreshold:500}; const s=generateBaseSchedule(c); expect(s.at(-1)?.closingBalance).toBe(0) })
  it('считает actual/actual в високосном году', () => { const i=calculateInterest(1_000_000,10,'2024-02-01','2024-03-01',config.interest); expect(i.toNumber()).toBeCloseTo(7923.5,0) })
  it('корректирует 31 число для короткого месяца', () => { expect(nextPaymentDate('2024-01-31',{...config,paymentDay:31})).toBe('2024-02-29') })
  it('сравнивает сценарии и находит лучшую экономию', () => { const result=compareScenarios(config,[early()]); expect(result.scenarios).toHaveLength(4); expect(result.bestSavings.interestSavings).toBeGreaterThan(0); expect(result.fastest.termMonths).toBeLessThanOrEqual(result.scenarios[0].termMonths) })

  it('не закрывает кредит недостаточным полным погашением', () => {
    const s=generateBaseSchedule(config,{earlyRepayments:[early({date:'2024-03-15',amount:1,strategy:'full'})]})
    expect(s.length).toBeGreaterThan(2)
    const row=s.find(x=>x.date==='2024-03-15')!
    expect(row.closingBalance).toBeGreaterThan(0)
    expect(row.event).toContain('недостаточно средств')
  })

  it('учитывает реальную дату досрочного платежа внутри периода', () => {
    const daily={...config,interest:{...config.interest,method:'daily' as const,dayCountBasis:'actual365' as const}}
    const earlier=generateBaseSchedule(daily,{earlyRepayments:[early({date:'2024-03-01'})]})
    const later=generateBaseSchedule(daily,{earlyRepayments:[early({date:'2024-03-14'})]})
    expect(earlier.reduce((s,x)=>s+x.interest,0)).toBeLessThan(later.reduce((s,x)=>s+x.interest,0))
  })

  it('начисляет end-of-day процент после досрочной операции между платежами', () => {
    const dailyEnd: LoanConfig = {
      ...config,
      principal: 365_000,
      annualRate: 10,
      termMonths: 12,
      issueDate: '2024-01-01',
      firstPaymentDate: '2024-02-01',
      paymentDay: 1,
      firstPaymentInterestOnly: false,
      interest: { method: 'daily', dayCountBasis: 'actual365', includePaymentDate: true, periodStart: 'exclusive', balanceMoment: 'endOfDay' }
    }
    const schedule = generateBaseSchedule(dailyEnd, {
      earlyRepayments: [early({ date: '2024-01-15', amount: 65_000, strategy: 'reduceTerm', interestFirst: false })]
    })
    const row = schedule.find(item => item.date === '2024-01-15')!
    const endDaySegment = row.audit!.interestSegments.find(segment => segment.reason === 'Начисление на конец дня')!

    expect(endDaySegment).toMatchObject({ from: '2024-01-15', to: '2024-01-15', days: 1, balance: 300_000 })
    expect(endDaySegment.rawInterest).toBeCloseTo(300_000 * 0.10 / 365, 6)
    expect(row.interest).toBeCloseTo((365_000 * 0.10 * 13 / 365) + (300_000 * 0.10 / 365), 2)
    expect(row.days).toBe(row.audit!.interestSegments.reduce((sum, segment) => sum + segment.days, 0))
  })

  it('совпадает с банковским графиком после всех досрочных платежей', () => {
    const bank:LoanConfig={...config,principal:5917734,annualRate:6,issueDate:'2025-11-26',firstPaymentDate:'2025-12-26',firstPaymentInterestOnly:true,termMonths:360,paymentDay:26,interest:{...config.interest,method:'daily',dayCountBasis:'actualActual',includePaymentDate:true,periodStart:'exclusive',balanceMoment:'startOfDay'}}
    const bankEarly:EarlyRepayment[] = [
      early({id:'b1',date:'2025-11-28',amount:35480,amountMode:'extra'}),
      early({id:'b2',date:'2026-01-26',amount:8704.99,amountMode:'extra'}),
      early({id:'b3',date:'2026-02-26',amount:35528.86,amountMode:'extra'}),
      early({id:'b4',date:'2026-03-27',amount:12342.60,amountMode:'extra'}),
      early({id:'b5',date:'2026-04-26',amount:53350.43,amountMode:'totalWithFee'}),
      early({id:'b6',date:'2026-05-26',amount:75182.14,amountMode:'totalWithFee'}),
      early({id:'b7',date:'2026-06-26',amount:36153.56,amountMode:'extra'})
    ]
    const s=generateBaseSchedule(bank,{earlyRepayments:bankEarly})
    const expected = [
      [1,'2025-11-26',0.00,0.00,0.00,5917734.00],
      [2,'2025-11-28',33534.44,1945.56,35480.00,5884199.56],
      [3,'2025-12-26',0.00,27083.44,27083.44,5884199.56],
      [4,'2026-01-26',14199.56,29985.24,44184.80,5870000.00],
      [5,'2026-02-26',41095.79,29912.88,71008.67,5828904.21],
      [6,'2026-03-26',8650.88,26828.93,35479.81,5820253.33],
      [7,'2026-03-27',11385.85,956.75,12342.60,5808867.48],
      [8,'2026-04-26',24703.96,28646.47,53350.43,5784163.52],
      [9,'2026-05-26',46657.50,28524.64,75182.14,5737506.02],
      [10,'2026-06-26',42395.67,29237.70,71633.37,5695110.35],
      [11,'2026-07-26',7394.33,28085.48,35479.81,5687716.02],
      [12,'2026-08-26',6495.83,28983.98,35479.81,5681220.19],
      [13,'2026-09-26',6528.93,28950.88,35479.81,5674691.26],
      [14,'2026-10-26',7495.03,27984.78,35479.81,5667196.23],
      [15,'2026-11-26',6600.40,28879.41,35479.81,5660595.83],
      [16,'2026-12-26',7564.54,27915.27,35479.81,5653031.29],
      [17,'2027-01-26',6672.58,28807.23,35479.81,5646358.71],
      [18,'2027-02-26',6706.58,28773.23,35479.81,5639652.13],
      [19,'2027-03-26',9521.96,25957.85,35479.81,5630130.17],
      [20,'2027-04-26',6789.28,28690.53,35479.81,5623340.89],
      [224,'2044-04-26',20010.84,15468.97,35479.81,3023883.18],
      [225,'2044-05-26',20608.25,14871.56,35479.81,3003274.93],
      [226,'2044-06-26',20217.27,15262.54,35479.81,2983057.66],
      [262,'2047-06-26',24278.11,11201.70,35479.81,2173904.80],
      [263,'2047-07-26',24759.18,10720.63,35479.81,2149145.62],
      [264,'2047-08-26',24528.00,10951.81,35479.81,2124617.62],
      [336,'2053-08-26',12310.61,62.73,12373.34,0.00]
    ] as const
    expected.forEach(([number,date,principal,interest,total,closing]) => {
      const row = s[number - 1]
      expect(row.date).toBe(date)
      expect(Math.abs(row.principal-principal)).toBeLessThanOrEqual(0.021)
      expect(Math.abs(row.interest-interest)).toBeLessThanOrEqual(0.021)
      expect(Math.abs(row.payment + row.earlyPayment-total)).toBeLessThanOrEqual(0.021)
      expect(Math.abs(row.closingBalance-closing)).toBeLessThanOrEqual(0.021)
    })
    expect(s).toHaveLength(336)
    expect(s[226].date).toBe('2044-07-26')
    expect(s[226].principal).toBe(20809.03)
    expect(s[226].interest).toBe(14670.78)
    expect(s[226].payment).toBe(35479.81)
    expect(s[226].closingBalance).toBe(2962248.64)
  })

  it('не принимает первый платёж только по процентам за обычный ежемесячный платёж', () => {
    const bank:LoanConfig={...config,principal:5917734,annualRate:6,issueDate:'2025-11-26',firstPaymentDate:'2025-12-26',firstPaymentInterestOnly:true,termMonths:360,paymentDay:26,interest:{...config.interest,method:'daily',dayCountBasis:'actualActual'}}
    const bankEarly:EarlyRepayment[]=[early({id:'b1',date:'2025-11-28',amount:35480,amountMode:'extra'}),early({id:'b2',date:'2026-01-26',amount:8704.99})]
    const result=compareScenarios(bank,bankEarly).scenarios.find(s=>s.id==='reduceTerm')!
    expect(result.schedule.find(row=>row.date==='2025-12-26')?.payment).toBe(27083.44)
    expect(result.monthlyPayment).toBe(35479.81)
  })

  it('сверяет первый аннуитетный платёж с выпиской банка', () => {
    const bank:LoanConfig={...config,principal:2375000,annualRate:8.1,issueDate:'2020-11-21',firstPaymentDate:'2020-12-21',firstPaymentInterestOnly:false,termMonths:240,paymentDay:21,interest:{...config.interest,method:'daily',dayCountBasis:'actualActual'}}
    const first=generateBaseSchedule(bank).find(row=>row.date==='2020-12-21')!
    expect(first.payment).toBe(20013.52)
    expect(first.interest).toBe(15768.44)
    expect(first.principal).toBe(4245.08)
    expect(first.closingBalance).toBe(2370754.92)
    expect(first.eventTypes).not.toContain('firstInterestOnly')
    const interestOnlyFirst=generateBaseSchedule({...bank,firstPaymentInterestOnly:true}).find(row=>row.date==='2020-12-21')!
    expect(interestOnlyFirst.payment).toBe(15768.44)
    expect(interestOnlyFirst.principal).toBe(0)
    expect(interestOnlyFirst.eventTypes).toContain('firstInterestOnly')
  })

  it('считает первый процентный аннуитетный платёж дополнительным stub-периодом', () => {
    const stubConfig: LoanConfig = { ...config, principal: 120_000, annualRate: 12, termMonths: 12, issueDate: '2024-01-01', firstPaymentDate: '2024-02-01', paymentDay: 1, firstPaymentInterestOnly: true, firstPaymentInterestOnlyMode: 'addToTerm' }
    const schedule = generateBaseSchedule(stubConfig)
    const amortizingRows = schedule.filter(row => row.principalPaid > 0)
    const finalRow = schedule.at(-1)!

    expect(scheduledPaymentDates(stubConfig)).toHaveLength(13)
    expect(finalRow.date).toBe('2025-02-01')
    expect(amortizingRows).toHaveLength(12)
    expect(finalRow.principalPaid).toBeLessThanOrEqual(Math.max(...amortizingRows.slice(0, -1).map(row => row.payment)))
    expect(finalRow.closingBalance).toBe(0)
  })

  it('включает первый interest-only платёж в договорный срок без balloon', () => {
    const withinTerm: LoanConfig = { ...config, principal: 120_000, annualRate: 12, termMonths: 12, issueDate: '2024-01-01', firstPaymentDate: '2024-02-01', paymentDay: 1, firstPaymentInterestOnly: true, firstPaymentInterestOnlyMode: 'withinTerm' }
    const schedule = generateBaseSchedule(withinTerm)
    const first = schedule.find(row => row.date === withinTerm.firstPaymentDate)!
    const amortizingRows = schedule.filter(row => row.principalPaid > 0)
    const finalRow = schedule.at(-1)!

    expect(scheduledPaymentDates(withinTerm)).toHaveLength(12)
    expect(extendedPaymentPeriods(withinTerm, [])).toBe(0)
    expect(first.eventTypes).toContain('firstInterestOnly')
    expect(first.principalPaid).toBe(0)
    expect(amortizingRows).toHaveLength(11)
    expect(finalRow.date).toBe('2025-01-01')
    expect(finalRow.eventTypes).not.toContain('materialBalloon')
    expect(finalRow.closingBalance).toBe(0)
  })

  it('отклоняет interest-only внутри срока из одного платёжного периода', () => {
    const invalid = { ...config, termMonths: 1, firstPaymentInterestOnly: true, firstPaymentInterestOnlyMode: 'withinTerm' as const }
    expect(validateScenario(invalid, [], []).join(' ')).toContain('не менее двух платёжных периодов')
  })

  it('не создаёт скрытый balloon для daily accrual после процентного stub-периода', () => {
    const stubConfig: LoanConfig = { ...config, principal: 365_000, annualRate: 10, termMonths: 12, issueDate: '2024-01-15', firstPaymentDate: '2024-02-01', paymentDay: 1, firstPaymentInterestOnly: true, interest: { ...config.interest, method: 'daily', dayCountBasis: 'actualActual', includePaymentDate: true, periodStart: 'exclusive' } }
    const schedule = generateBaseSchedule(stubConfig)
    const regularPayment = schedule.find(row => row.isRegularPayment)?.payment ?? 0
    const finalRow = schedule.at(-1)!

    expect(finalRow.date).toBe('2025-02-01')
    expect(finalRow.principalPaid).toBeLessThanOrEqual(regularPayment * 1.05)
    expect(finalRow.closingBalance).toBe(0)
  })

  it('совпадает с банковским графиком при начислении со следующего дня по дату платежа', () => {
    const bank:LoanConfig={...config,principal:2375000,annualRate:8.1,issueDate:'2020-11-21',firstPaymentDate:'2020-12-21',firstPaymentInterestOnly:false,termMonths:240,paymentDay:21,interest:{...config.interest,method:'daily',dayCountBasis:'actualActual',includePaymentDate:true,periodStart:'exclusive',balanceMoment:'startOfDay'}}
    const expected = [
      ['2020-11-21',0,0,0,2375000],
      ['2020-12-21',4245.08,15768.44,20013.52,2370754.92],
      ['2021-01-21',3718.40,16295.12,20013.52,2367036.52],
      ['2021-02-21',3729.60,16283.92,20013.52,2363306.92],
      ['2021-03-21',5328.65,14684.87,20013.52,2357978.27],
      ['2021-04-21',3791.92,16221.60,20013.52,2354186.35],
      ['2021-05-21',4340.44,15673.08,20013.52,2349845.91],
      ['2021-06-21',3847.87,16165.65,20013.52,2345998.04],
      ['2021-07-21',4394.96,15618.56,20013.52,2341603.08],
      ['2021-08-21',3904.57,16108.95,20013.52,2337698.51],
      ['2021-09-21',3931.44,16082.08,20013.52,2333767.07],
      ['2021-10-21',4476.38,15537.14,20013.52,2329290.69],
      ['2021-11-21',3989.28,16024.24,20013.52,2325301.41],
      ['2021-12-21',4532.74,15480.78,20013.52,2320768.67],
      ['2022-01-21',4047.91,15965.61,20013.52,2316720.76],
      ['2022-02-21',4075.75,15937.77,20013.52,2312645.01]
    ] as const
    const schedule=generateBaseSchedule(bank)
    expected.forEach(([date,principal,interest,total,closing],index) => {
      const row=schedule[index]
      expect(row.date).toBe(date)
      expect(Math.abs(row.principal-principal)).toBeLessThanOrEqual(0.021)
      expect(Math.abs(row.interest-interest)).toBeLessThanOrEqual(0.021)
      expect(Math.abs(row.payment-total)).toBeLessThanOrEqual(0.001)
      expect(Math.abs(row.closingBalance-closing)).toBeLessThanOrEqual(0.021)
    })
    expect(schedule[1].audit?.interestSegments[0]).toMatchObject({ from:'2020-11-22', to:'2020-12-21', days:30 })
    expect(schedule[2].audit?.interestSegments).toEqual([
      expect.objectContaining({ from:'2020-12-22', to:'2020-12-31', days:10 }),
      expect.objectContaining({ from:'2021-01-01', to:'2021-01-21', days:21 })
    ])
  })

  it('уменьшает платёж по банковскому графику после смешанных стратегий', () => {
    const bank:LoanConfig={...config,principal:2375000,annualRate:8.1,issueDate:'2020-11-21',firstPaymentDate:'2020-12-21',firstPaymentInterestOnly:false,termMonths:240,paymentDay:21,interest:{...config.interest,method:'daily',dayCountBasis:'actualActual',includePaymentDate:true,periodStart:'exclusive',balanceMoment:'startOfDay'}}
    const repayments: EarlyRepayment[] = [
      early({id:'mix-1',date:'2026-03-22',amount:11944,strategy:'reduceTerm'}),
      early({id:'mix-2',date:'2026-04-21',amount:26069.87,amountMode:'totalWithFee',strategy:'reduceTerm'}),
      early({id:'mix-3',date:'2026-05-21',amount:26073.59,strategy:'reduceTerm'}),
      early({id:'mix-4',date:'2026-05-21',amount:10,strategy:'reducePayment'})
    ]
    const expectMoneyClose = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(0.051)
    const s=generateBaseSchedule(bank,{earlyRepayments:repayments})
    const april=s.find(row=>row.date==='2026-04-21')!
    const may=s.find(row=>row.date==='2026-05-21')!
    const june=s.find(row=>row.date==='2026-06-21')!
    const july=s.find(row=>row.date==='2026-07-21')!
    const december2030=s.find(row=>row.date==='2030-12-21')!
    const debt=calculateDebtAtDate(bank,s,[],'2026-07-08')
    expect(april.principal).toBe(12455.14)
    expect(april.interest).toBe(13614.73)
    expect(april.payment + april.earlyPayment).toBeCloseTo(26069.87, 2)
    expect(april.closingBalance).toBe(2032555.26)
    expect(may.eventTypes).toEqual(expect.arrayContaining(['earlyReduceTerm','earlyReducePayment']))
    expect(may.paymentRecalculated).toBe(true)
    expect(may.payment).toBe(20013.52)
    expect(may.earlyPayment).toBe(26083.59)
    expect(may.principal).toBe(32565.30)
    expect(may.interest).toBe(13531.81)
    expect(june.payment).toBe(20013.42)
    expect(june.interest).toBe(13758.84)
    expect(june.principal).toBe(6254.58)
    expectMoneyClose(june.closingBalance, 1993735.42)
    expect(july.payment).toBe(20013.42)
    expect(july.interest).toBe(13273.36)
    expect(july.principal).toBe(6740.06)
    expectMoneyClose(july.closingBalance, 1986995.36)
    expect(december2030.payment).toBe(20013.42)
    expect(december2030.principal).toBe(9507.18)
    expect(december2030.interest).toBe(10506.24)
    expect(december2030.closingBalance).toBe(1568590.22)
    expectMoneyClose(debt.principal, 1993735.42)
    expectMoneyClose(debt.interest, 7521.58)
    expectMoneyClose(debt.total, 2001257)
    expect(s.at(-1)?.date).toBe('2040-04-21')
  })

  it('уменьшает платёж после сокращения срока на долю операции', () => {
    const short: LoanConfig = { ...config, principal: 1_000_000, annualRate: 12, termMonths: 60, issueDate: '2024-01-01', firstPaymentDate: '2024-02-01', paymentDay: 1, interest: { ...config.interest, method: 'annuity', includePaymentDate: false } }
    const termReduction = early({ id: 'term-first', date: '2024-08-01', amount: 300_000, strategy: 'reduceTerm' })
    const paymentReduction = early({ id: 'payment-second', date: '2024-09-01', amount: 100_000, strategy: 'reducePayment' })
    const termOnly = generateBaseSchedule(short, { earlyRepayments: [termReduction] })
    const termOnlySecondIndex = termOnly.findIndex(row => row.date === paymentReduction.date)
    const actualRemainingPeriods = termOnly.slice(termOnlySecondIndex + 1).filter(row => row.isRegularPayment).length
    const originalRemainingPeriods = generateBaseSchedule(short).filter(row => row.isRegularPayment && row.date > paymentReduction.date).length
    const mixed = generateBaseSchedule(short, { earlyRepayments: [termReduction, paymentReduction] })
    const secondIndex = mixed.findIndex(row => row.date === paymentReduction.date)
    const secondRow = mixed[secondIndex]
    const nextRegular = mixed.slice(secondIndex + 1).find(row => row.isRegularPayment)!
    const appliedPrincipal = secondRow.repaymentOutcomes?.find(outcome => outcome.repaymentId === paymentReduction.id)?.appliedPrincipal ?? paymentReduction.amount
    const expectedPayment = secondRow.payment - calculateAnnuityPayment(appliedPrincipal, short.annualRate, actualRemainingPeriods).toNumber()
    const fullRecalculatedPayment = calculateAnnuityPayment(secondRow.closingBalance, short.annualRate, actualRemainingPeriods).toNumber()
    const originalTermPayment = secondRow.payment - calculateAnnuityPayment(appliedPrincipal, short.annualRate, originalRemainingPeriods).toNumber()
    expect(actualRemainingPeriods).toBeLessThan(short.termMonths - 8)
    expect(nextRegular.payment).toBeCloseTo(expectedPayment, 2)
    expect(nextRegular.payment).toBeGreaterThan(fullRecalculatedPayment)
    expect(nextRegular.payment).toBeLessThan(originalTermPayment)
  })

  it('учитывает порядок операций в дату регулярного платежа', () => {
    const earlyFirst=generateBaseSchedule(config,{earlyRepayments:[early({date:'2024-08-15',strategy:'reducePayment',sameDayOrder:'earlyFirst'})]})
    const regularFirst=generateBaseSchedule(config,{earlyRepayments:[early({date:'2024-08-15',strategy:'reducePayment',sameDayOrder:'regularFirst'})]})
    expect(earlyFirst.find(x=>x.date==='2024-08-15')!.payment).toBeLessThan(regularFirst.find(x=>x.date==='2024-08-15')!.payment)
  })

  it('не даёт earlyFirst погасить проценты, отменённые беспроцентной льготой', () => {
    const grace:GracePeriod={id:'g-free',startDate:'2024-01-01',endDate:'2024-08-31',type:'full',extendTerm:true,accrueInterest:false,capitalizeInterest:false}
    const s=generateBaseSchedule(config,{gracePeriods:[grace],earlyRepayments:[early({date:'2024-08-15',amount:10000,sameDayOrder:'earlyFirst',interestFirst:true})]})
    const row=s.find(x=>x.date==='2024-08-15')!
    expect(row.interestAccrued).toBe(0)
    expect(row.interestPaid).toBe(0)
    expect(row.principalPaid).toBe(10000)
  })

  it('не начисляет проценты по беспроцентной льготе для досрочного платежа между регулярными датами', () => {
    const grace:GracePeriod={id:'g-free-between',startDate:'2024-01-01',endDate:'2024-08-31',type:'full',extendTerm:true,accrueInterest:false,capitalizeInterest:false}
    const s=generateBaseSchedule(config,{gracePeriods:[grace],earlyRepayments:[early({date:'2024-08-10',amount:10000,sameDayOrder:'regularFirst',interestFirst:true})]})
    const row=s.find(x=>x.date==='2024-08-10')!
    expect(row.interestAccrued).toBe(0)
    expect(row.interestPaid).toBe(0)
    expect(row.principalPaid).toBe(10000)
  })

  it('считает текущий долг с учётом беспроцентной льготы', () => {
    const grace:GracePeriod={id:'g-current',startDate:'2024-01-01',endDate:'2024-01-31',type:'full',extendTerm:true,accrueInterest:false,capitalizeInterest:false}
    const s=generateBaseSchedule(config,{gracePeriods:[grace]})
    const debt=calculateDebtAtDate(config,s,[grace],'2024-01-20')
    expect(debt.principal).toBe(config.principal)
    expect(debt.interest).toBe(0)
    expect(debt.total).toBe(config.principal)
  })

  it('считает текущий долг периодическим методом пропорционально платёжному периоду', () => {
    const periodic={...config,principal:1_000_000,annualRate:12,issueDate:'2024-01-01',firstPaymentDate:'2024-02-01',paymentDay:1,interest:{...config.interest,method:'annuity' as const,includePaymentDate:false}}
    const s=generateBaseSchedule(periodic)
    const debt=calculateDebtAtDate(periodic,s,[],'2024-01-16')
    expect(debt.interest).toBeCloseTo(4838.71,2)
  })

  it('считает текущий долг периодическим методом по полному периоду перед промежуточной досрочкой', () => {
    const periodic={...config,principal:1_000_000,annualRate:12,issueDate:'2024-01-01',firstPaymentDate:'2024-02-01',paymentDay:1,interest:{...config.interest,method:'annuity' as const,includePaymentDate:false}}
    const s=generateBaseSchedule(periodic,{earlyRepayments:[early({date:'2024-01-11',amount:100_000})]})
    const earlyRow=s.find(row=>row.date==='2024-01-11')!
    expect(earlyRow.audit?.regularPeriodDays).toBe(31)
    expect(earlyRow.audit?.segmentDays).toBe(10)
    const debt=calculateDebtAtDate(periodic,s,[],'2024-01-06')
    expect(debt.interest).toBeCloseTo(1612.90,2)
  })

  it('учитывает момент остатка в день досрочного платежа', () => {
    const baseDaily={...config,interest:{...config.interest,method:'daily' as const,dayCountBasis:'actual365' as const,includePaymentDate:true}}
    const start=generateBaseSchedule({...baseDaily,interest:{...baseDaily.interest,balanceMoment:'startOfDay' as const}},{earlyRepayments:[early({date:'2024-03-01'})]})
    const end=generateBaseSchedule({...baseDaily,interest:{...baseDaily.interest,balanceMoment:'endOfDay' as const}},{earlyRepayments:[early({date:'2024-03-01'})]})
    expect(start.reduce((s,x)=>s+x.interest,0)).toBeGreaterThan(end.reduce((s,x)=>s+x.interest,0))
  })

  it('раскрывает начисление на конец дня отдельным сегментом audit', () => {
    const daily={...config,interest:{...config.interest,method:'daily' as const,dayCountBasis:'actual365' as const,includePaymentDate:true,balanceMoment:'endOfDay' as const}}
    const row=generateBaseSchedule(daily).find(item=>item.payment>0)!
    const rawTotal=row.audit!.interestSegments.reduce((sum, segment)=>sum+segment.rawInterest,0)
    expect(row.audit!.interestSegments.some(segment=>segment.reason==='Начисление на конец дня')).toBe(true)
    expect(row.audit!.days).toBe(row.audit!.interestSegments.reduce((sum, segment)=>sum+segment.days,0))
    expect(row.interest).toBeCloseTo(Math.round(rawTotal*100)/100,2)
  })

  it('показывает беспроцентные льготные дни отдельным нулевым сегментом audit', () => {
    const daily={...config,interest:{...config.interest,method:'daily' as const,dayCountBasis:'actual365' as const}}
    const grace:GracePeriod={id:'g-audit-free',startDate:'2024-01-10',endDate:'2024-01-20',type:'full',extendTerm:true,accrueInterest:false,capitalizeInterest:false}
    const row=generateBaseSchedule(daily,{gracePeriods:[grace]}).find(item=>item.date==='2024-02-15')!
    const freeSegment=row.audit!.interestSegments.find(segment=>segment.reason==='Беспроцентная льгота')!
    expect(freeSegment.rawInterest).toBe(0)
    expect(freeSegment.days).toBe(11)
  })

  it('делит Actual/Actual по календарным годам', () => {
    const interest=calculateInterest(1_000_000,10,'2023-12-15','2024-01-15',{...config.interest,dayCountBasis:'actualActual',includePaymentDate:false})
    const expected=1_000_000*.10*(17/365+14/366)
    expect(interest.toNumber()).toBeCloseTo(expected,8)
  })

  it('учитывает единовременную комиссию ровно один раз', () => {
    const result=compareScenarios({...config,principal:120000,annualRate:0,termMonths:12,oneTimeFee:1000},[])
    expect(result.scenarios[0].overpayment).toBe(1000)
    expect(result.scenarios[0].totalPaid).toBe(121000)
  })

  it('учитывает единовременную комиссию даже при закрытии до первого платежа', () => {
    const result=compareScenarios({...config,principal:120000,annualRate:0,termMonths:12,oneTimeFee:1000},[early({date:'2024-01-15',amount:120000,strategy:'full'})])
    const combined=result.scenarios.find(s=>s.id==='combined')!
    expect(combined.totalPaid).toBe(121000)
    expect(combined.overpayment).toBe(1000)
    expect(combined.schedule[0].feePaid).toBe(1000)
  })

  it('показывает будущий платёж 0 после полного досрочного закрытия', () => {
    const result=compareScenarios(config,[early({date:'2024-03-15',amount:4_000_000,strategy:'full'})])
    const combined=result.scenarios.find(s=>s.id==='combined')!
    expect(combined.monthlyPayment).toBe(0)
  })

  it('не учитывает операции после закрытия в метриках срока', () => {
    const closingConfig: LoanConfig = { ...config, principal: 100_000, annualRate: 0, termMonths: 24, issueDate: '2024-01-01', firstPaymentDate: '2024-02-01', paymentDay: 1, firstPaymentInterestOnly: false }
    const close = early({ id: 'full-close', date: '2024-03-01', amount: 100_000, strategy: 'full' })
    const future = early({ id: 'late-after-close', date: '2025-03-01', amount: 50_000, strategy: 'reduceTerm' })
    const closedOnly = compareScenarios(closingConfig, [close]).scenarios.find(s => s.id === 'combined')!
    const withFuture = compareScenarios(closingConfig, [close, future]).scenarios.find(s => s.id === 'combined')!

    expect(withFuture.monthlyPayment).toBe(0)
    expect(withFuture.closingDate).toBe(closedOnly.closingDate)
    expect(withFuture.termDays).toBe(closedOnly.termDays)
    expect(withFuture.daysSaved).toBe(closedOnly.daysSaved)
    expect(withFuture.monthsSaved).toBe(closedOnly.monthsSaved)
    expect(withFuture.schedule.at(-1)?.date).toBe(closedOnly.closingDate)
    expect(withFuture.schedule.some(row => row.eventTypes.length > 0 && row.eventTypes.every(type => type === 'earlyIgnored'))).toBe(false)
    expect(withFuture.schedule.at(-1)?.repaymentOutcomes).toEqual(expect.arrayContaining([expect.objectContaining({ repaymentId: 'late-after-close', date: '2025-03-01', appliedAmount: 0, unusedAmount: 50_000, reason: 'debtClosed' })]))
  })

  it('сохраняет пересчёт платежа, если в ту же дату есть другая стратегия', () => {
    const result=compareScenarios(config,[
      early({id:'same-payment',strategy:'reducePayment'}),
      early({id:'same-term',amount:50_000,strategy:'reduceTerm'})
    ])
    const combined=result.scenarios.find(s=>s.id==='combined')!
    const rowIndex=combined.schedule.findIndex(row=>row.date==='2024-08-15')
    const row=combined.schedule[rowIndex]
    const nextRegular=combined.schedule.slice(rowIndex+1).find(item=>item.isRegularPayment)!
    expect(row.eventTypes).toEqual(expect.arrayContaining(['earlyReducePayment','earlyReduceTerm']))
    expect(combined.monthlyPayment).toBe(nextRegular.payment)
    expect(combined.monthlyPayment).toBeLessThan(result.scenarios[0].monthlyPayment)
  })

  it('определяет полное досрочное закрытие структурным флагом, даже если в дату есть вторая операция', () => {
    const result=compareScenarios(config,[
      early({id:'full-close',date:'2024-03-15',amount:4_000_000,strategy:'full'}),
      early({id:'after-full',date:'2024-03-15',amount:1000,strategy:'reduceTerm'})
    ])
    const combined=result.scenarios.find(s=>s.id==='combined')!
    expect(combined.schedule.at(-1)?.eventTypes).toEqual(expect.arrayContaining(['earlyFull','earlyIgnored']))
    expect(combined.schedule.at(-1)?.fullyClosedByEarlyRepayment).toBe(true)
    expect(combined.schedule.at(-1)?.earlyPayment).toBeLessThan(4_001_000)
    expect(combined.monthlyPayment).toBe(0)
  })

  it('каждая строка бухгалтерски сходится по денежному потоку', () => {
    const s = generateBaseSchedule({ ...config, oneTimeFee: 1000, monthlyFee: 50, earlyRepaymentFeePercent: 1 }, { earlyRepayments: [early()] })
    s.forEach(row => {
      expect(row.cashFlowTotal).toBeCloseTo(row.principalPaid + row.interestPaid + row.feePaid, 2)
      expect(row.interestAccrued).toBe(row.interest)
      expect(row.principalPaid).toBe(row.principal)
      expect(row.feePaid).toBe(row.fee)
    })
  })

  it('показывает новый платёж и накопленную экономию', () => {
    const result=compareScenarios(config,[early({strategy:'reducePayment'})])
    const reduced=result.scenarios.find(s=>s.id==='reducePayment')!
    expect(reduced.monthlyPayment).toBeLessThan(result.scenarios[0].monthlyPayment)
    expect(reduced.schedule.some(x=>x.cumulativeSavings>0)).toBe(true)
  })

  it('считает срок и выигрыш в днях', () => {
    const result = compareScenarios({ ...config, frequency: 'biweekly', termMonths: 24, issueDate: '2024-01-01', firstPaymentDate: '2024-01-15', paymentDay: 15 }, [early({ date: '2024-03-11', amount: 500_000 })])
    const reduced = result.scenarios.find(s => s.id === 'reduceTerm')!
    expect(reduced.termDays).toBeGreaterThan(0)
    expect(reduced.daysSaved).toBeGreaterThanOrEqual(reduced.monthsSaved * 28)
    expect(result.fastest.termDays).toBe(Math.min(...result.scenarios.map(s => s.termDays)))
  })

  it('выражает длительность квартального графика в месяцах, а не периодах', () => {
    const result=compareScenarios({...config,frequency:'quarterly'},[])
    expect(result.scenarios[0].termMonths).toBeGreaterThan(100)
  })

  it('не раздувает двухнедельный график на коротком сроке', () => {
    const shortBiweekly = { ...config, principal: 100_000, annualRate: 0, termMonths: 1, frequency: 'biweekly' as const, issueDate: '2024-01-01', firstPaymentDate: '2024-01-15', paymentDay: 15 }
    const s = generateBaseSchedule(shortBiweekly)
    expect(s.filter(row => row.isRegularPayment)).toHaveLength(2)
    expect(s.at(-1)?.closingBalance).toBe(0)
  })
})

// ===== Производительность =====
const MAX_ANNUITY_SCHEDULE_DURATION_MS = 1_000
const MAX_DIFFERENTIATED_SCHEDULE_DURATION_MS = 800

describe('performance', () => {
  it('генерирует 30-летний аннуитетный график с досрочными погашениями менее чем за 1 секунду', () => {
    const configWithEarly: LoanConfig = {
      ...config,
      principal: 5_000_000,
      termMonths: 360,
    };

    const earlyRepayments: EarlyRepayment[] = Array.from({ length: 30 }, (_, i) => ({
      id: `e${i + 1}`,
      date: `202${Math.floor(i / 10) + 4}-${String((i % 12) + 1).padStart(2, '0')}-15`,
      amount: 50_000,
      strategy: 'reducePayment',
      amountMode: 'extra',
      source: 'own',
      sameDayOrder: 'regularFirst',
      interestFirst: true,
    }));

    const start = performance.now();
    const result = generateBaseSchedule(configWithEarly, { earlyRepayments });
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(MAX_ANNUITY_SCHEDULE_DURATION_MS);
    expect(result.length).toBeGreaterThanOrEqual(360);
    expect(result.at(-1)?.closingBalance).toBeCloseTo(0, 2);
    expect(result.reduce((sum, row) => sum + row.interest, 0)).toBeGreaterThan(0);
  });

  it('быстро строит дифференцированный график на 30 лет с досрочками (с сокращением срока)', () => {
    const diffConfig: LoanConfig = {
      ...config,
      principal: 3_000_000,
      annualRate: 12,
      termMonths: 360,
      paymentType: 'differentiated',
      interest: { ...config.interest, method: 'daily', dayCountBasis: 'actual365' },
    };

    const earlyRepayments: EarlyRepayment[] = [
      { id: 'd1', date: '2026-01-01', amount: 200_000, strategy: 'reduceTerm', amountMode: 'extra', source: 'own', sameDayOrder: 'regularFirst', interestFirst: true },
      { id: 'd2', date: '2028-07-01', amount: 150_000, strategy: 'reducePayment', amountMode: 'extra', source: 'own', sameDayOrder: 'regularFirst', interestFirst: true },
    ];

    const start = performance.now();
    const result = generateBaseSchedule(diffConfig, { earlyRepayments });
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(MAX_DIFFERENTIATED_SCHEDULE_DURATION_MS);
    expect(result.length).toBeLessThanOrEqual(363);
    expect(result.length).toBeGreaterThan(0);
    expect(result.at(-1)?.closingBalance).toBeCloseTo(0, 2);
  });
})

// ===== Дополнительные тесты для существующей функциональности =====
describe('differentiated payments', () => {
  it('рассчитывает дифференцированный график с постоянным погашением основного долга', () => {
    const diffConfig: LoanConfig = {
      ...config,
      paymentType: 'differentiated',
      principal: 1_200_000,
      termMonths: 12,
      annualRate: 12,
    };
    const s = generateBaseSchedule(diffConfig);
    const principalPart = 1_200_000 / 12;
    s.slice(1).forEach((row, i) => {
      expect(row.principal).toBeCloseTo(principalPart, 2);
      if (i > 0) {
        expect(row.interest).toBeLessThan(s[i].interest);
      }
    });
    expect(s.at(-1)?.closingBalance).toBeCloseTo(0, 2);
  });

  it('общая переплата по дифференцированному графику меньше, чем по аннуитетному', () => {
    const baseConfig = { ...config, principal: 1_000_000, termMonths: 12, annualRate: 12 };
    const annuity = generateBaseSchedule({ ...baseConfig, paymentType: 'annuity' });
    const diff = generateBaseSchedule({ ...baseConfig, paymentType: 'differentiated' });
    const annuityInterest = annuity.reduce((sum, r) => sum + r.interest, 0);
    const diffInterest = diff.reduce((sum, r) => sum + r.interest, 0);
    expect(diffInterest).toBeLessThan(annuityInterest);
  });

  it('уменьшает основной платёж после досрочного погашения со стратегией reducePayment', () => {
    const diffConfig = { ...config, paymentType: 'differentiated' as const, principal: 1_200_000, termMonths: 12, annualRate: 12 }
    const s = generateBaseSchedule(diffConfig, {
      earlyRepayments: [early({ date: '2024-03-15', amount: 300_000, strategy: 'reducePayment' })]
    })
    const before = s.find(row => row.date === '2024-02-15')!
    const after = s.find(row => row.date === '2024-04-15')!
    expect(after.principal).toBeLessThan(before.principal)
    expect(s.length).toBeGreaterThan(10)
  })
})

describe('variable rate history', () => {
  it('строит timeline ставок один раз и отдаёт ставку на границах дат', () => {
    const timeline = createRateTimeline({
      annualRate: 12,
      rateChanges: [
        { id: 'late', date: '2024-06-01', annualRate: 7 },
        { id: 'early', date: '2024-03-01', annualRate: 9 }
      ]
    })

    expect(timeline.sortedChanges.map(change => change.id)).toEqual(['early', 'late'])
    expect(timeline.rateAt('2024-02-29')).toBe(12)
    expect(timeline.rateAt('2024-03-01')).toBe(9)
    expect(timeline.rateAt('2024-07-01')).toBe(7)
  })

  it('пересчитывает аннуитетный платёж со следующего платёжного периода', () => {
    const variable: LoanConfig = {
      ...config,
      principal: 1_000_000,
      annualRate: 12,
      rateChanges: [{ id: 'rate-1', date: '2024-06-20', annualRate: 6 }],
      termMonths: 12,
      issueDate: '2024-01-01',
      firstPaymentDate: '2024-02-01',
      paymentDay: 1,
      interest: { ...config.interest, method: 'annuity', includePaymentDate: false }
    }
    const schedule = generateBaseSchedule(variable)
    const july = schedule.find(row => row.date === '2024-07-01')!
    const august = schedule.find(row => row.date === '2024-08-01')!
    expect(july.audit?.interestSegments[0].annualRate).toBe(12)
    expect(august.audit?.interestSegments[0].annualRate).toBe(6)
    expect(august.eventTypes).toContain('rateChange')
    expect(august.paymentRecalculated).toBe(true)
    expect(august.payment).toBeLessThan(july.payment)
  })

  it('для дифференцированного графика меняет только процентную часть', () => {
    const variable: LoanConfig = {
      ...config,
      principal: 1_200_000,
      annualRate: 12,
      rateChanges: [{ id: 'rate-1', date: '2024-03-20', annualRate: 6 }],
      paymentType: 'differentiated',
      termMonths: 12,
      issueDate: '2024-01-01',
      firstPaymentDate: '2024-02-01',
      paymentDay: 1,
      interest: { ...config.interest, method: 'annuity', includePaymentDate: false }
    }
    const schedule = generateBaseSchedule(variable)
    const before = schedule.find(row => row.date === '2024-04-01')!
    const after = schedule.find(row => row.date === '2024-05-01')!
    expect(after.audit?.interestSegments[0].annualRate).toBe(6)
    expect(after.eventTypes).toContain('rateChange')
    expect(after.paymentRecalculated).toBe(false)
    expect(after.principal).toBe(before.principal)
    expect(after.interest).toBeLessThan(before.interest)
  })

  it('считает текущий долг по ставке действующего периода', () => {
    const variable: LoanConfig = {
      ...config,
      principal: 1_000_000,
      annualRate: 12,
      rateChanges: [{ id: 'rate-1', date: '2024-06-20', annualRate: 6 }],
      termMonths: 12,
      issueDate: '2024-01-01',
      firstPaymentDate: '2024-02-01',
      paymentDay: 1,
      interest: { ...config.interest, method: 'annuity', includePaymentDate: false }
    }
    const fixed = { ...variable, rateChanges: [] }
    const variableDebt = calculateDebtAtDate(variable, generateBaseSchedule(variable), [], '2024-07-16')
    const fixedDebt = calculateDebtAtDate(fixed, generateBaseSchedule(fixed), [], '2024-07-16')
    expect(variableDebt.interest).toBeLessThan(fixedDebt.interest)
  })

  it('режет процентный период по точной дате изменения ставки', () => {
    const variable: LoanConfig = {
      ...config,
      principal: 1_000_000,
      annualRate: 12,
      rateChanges: [{ id: 'rate-1', date: '2024-01-16', annualRate: 6 }],
      rateChangeMode: 'exactDate',
      termMonths: 12,
      issueDate: '2024-01-01',
      firstPaymentDate: '2024-02-01',
      paymentDay: 1,
      interest: { ...config.interest, method: 'daily', dayCountBasis: 'actual365', includePaymentDate: false, periodStart: 'inclusive' }
    }
    const first = generateBaseSchedule(variable).find(row => row.date === '2024-02-01')!
    expect(first.audit?.interestSegments).toEqual([
      expect.objectContaining({ from: '2024-01-01', to: '2024-01-15', days: 15, annualRate: 12 }),
      expect.objectContaining({ from: '2024-01-16', to: '2024-01-31', days: 16, annualRate: 6 })
    ])
    expect(first.interest).toBeCloseTo(1_000_000 * 0.12 * 15 / 365 + 1_000_000 * 0.06 * 16 / 365, 2)
  })

  it('пересчитывает reducePayment между точным изменением ставки и регулярной датой по действующей ставке', () => {
    const variable: LoanConfig = {
      ...config,
      principal: 1_000_000,
      annualRate: 12,
      rateChanges: [{ id: 'rate-1', date: '2024-01-16', annualRate: 6 }],
      rateChangeMode: 'exactDate',
      termMonths: 12,
      issueDate: '2024-01-01',
      firstPaymentDate: '2024-02-01',
      paymentDay: 1,
      interest: { ...config.interest, method: 'daily', dayCountBasis: 'actual365', includePaymentDate: false, periodStart: 'inclusive' }
    }
    const schedule = generateBaseSchedule(variable, {
      earlyRepayments: [early({ date: '2024-01-20', amount: 100_000, strategy: 'reducePayment', interestFirst: false })]
    })
    const earlyRow = schedule.find(row => row.date === '2024-01-20')!
    const february = schedule.find(row => row.date === '2024-02-01')!
    const expected = calculateAnnuityPayment(900_000, 6, 12, 12, variable.rounding).toNumber()
    const staleRatePayment = calculateAnnuityPayment(900_000, 12, 12, 12, variable.rounding).toNumber()
    expect(earlyRow.paymentRecalculated).toBe(true)
    expect(february.payment).toBeCloseTo(expected, 2)
    expect(february.payment).toBeLessThan(staleRatePayment)
  })

  it('после reduceTerm применяет последующий exactDate reducePayment по ставке на дату операции', () => {
    const variable: LoanConfig = {
      ...config,
      principal: 1_000_000,
      annualRate: 12,
      rateChanges: [{ id: 'rate-1', date: '2024-01-16', annualRate: 6 }],
      rateChangeMode: 'exactDate',
      termMonths: 12,
      issueDate: '2024-01-01',
      firstPaymentDate: '2024-02-01',
      paymentDay: 1,
      interest: { ...config.interest, method: 'daily', dayCountBasis: 'actual365', includePaymentDate: false, periodStart: 'inclusive' }
    }
    const first = early({ id: 'term-first', date: '2024-01-20', amount: 200_000, strategy: 'reduceTerm', interestFirst: false })
    const second = early({ id: 'payment-second', date: '2024-01-25', amount: 100_000, strategy: 'reducePayment', interestFirst: false })
    const termOnly = generateBaseSchedule(variable, { earlyRepayments: [first] })
    const remainingPeriods = termOnly.filter(row => row.isRegularPayment && row.date > second.date).length
    const mixed = generateBaseSchedule(variable, { earlyRepayments: [first, second] })
    const secondRow = mixed.find(row => row.date === second.date)!
    const nextRegular = mixed.find(row => row.date === '2024-02-01')!
    const expectedPayment = calculateAnnuityPayment(secondRow.closingBalance, 6, remainingPeriods, 12, variable.rounding)
    expect(remainingPeriods).toBeLessThan(12)
    expect(nextRegular.payment).toBeCloseTo(expectedPayment.toNumber(), 2)
  })

  it('помечает первую досрочную строку нового периода после изменения ставки', () => {
    const variable: LoanConfig = {
      ...config,
      principal: 1_000_000,
      annualRate: 12,
      rateChanges: [{ id: 'rate-1', date: '2024-06-20', annualRate: 6 }],
      termMonths: 12,
      issueDate: '2024-01-01',
      firstPaymentDate: '2024-02-01',
      paymentDay: 1,
      interest: { ...config.interest, method: 'annuity', includePaymentDate: false }
    }
    const schedule = generateBaseSchedule(variable, { earlyRepayments: [early({ date: '2024-07-10', amount: 10_000 })] })
    const earlyRow = schedule.find(row => row.date === '2024-07-10')!
    expect(earlyRow.audit?.interestSegments[0].annualRate).toBe(6)
    expect(earlyRow.eventTypes).toContain('rateChange')
    expect(earlyRow.paymentRecalculated).toBe(true)
  })

  it('отклоняет некорректную дату или ставку в истории ставок', () => {
    expect(() => generateBaseSchedule({ ...config, rateChanges: [{ id: 'bad-rate', date: '2024-03-01', annualRate: 101 }] })).toThrow('Изменение ставки')
    const errors = validateScenario({ ...config, rateChanges: [{ id: 'bad-date', date: '', annualRate: 10 }] }, [], [])
    expect(errors.some(error => error.includes('Изменение ставки'))).toBe(true)
  })

  it('ограничивает количество изменений ставки', () => {
    const rateChanges = Array.from({ length: MAX_RATE_CHANGES + 1 }, (_, index) => ({ id: `rate-${index}`, date: `2026-${String(Math.floor(index / 28) % 12 + 1).padStart(2, '0')}-${String(index % 28 + 1).padStart(2, '0')}`, annualRate: 5 }))
    const errors = validateScenario({ ...config, rateChanges }, [], [])
    expect(errors.some(error => error.includes(String(MAX_RATE_CHANGES)))).toBe(true)
  })
})

describe('day count bases', () => {
  it.each([
    ['360', 1_000_000 * 0.10 * 31 / 360],
    ['366', 1_000_000 * 0.10 * 31 / 366],
    ['actual365', 1_000_000 * 0.10 * 31 / 365],
    ['actualActual', 1_000_000 * 0.10 * 31 / 366],
  ])('рассчитывает проценты для базы %s', (basis, expected) => {
    const interest = calculateInterest(
      1_000_000,
      10,
      '2024-01-01',
      '2024-02-01',
      { ...config.interest, dayCountBasis: basis as LoanConfig['interest']['dayCountBasis'] }
    );
    expect(interest.toNumber()).toBeCloseTo(expected, 2);
  });
})

describe('early repayment amount modes', () => {
  it('amountMode: "extra" — только сверх платежа', () => {
    const s = generateBaseSchedule(config, {
      earlyRepayments: [early({ amountMode: 'extra', amount: 100_000 })],
    });
    const row = s.find(r => r.earlyPayment === 100_000);
    expect(row?.earlyPayment).toBe(100_000);
  });

  it('amountMode: "totalWithFee" — включает регулярный платёж', () => {
    const s = generateBaseSchedule(config, {
      earlyRepayments: [early({ amountMode: 'totalWithFee', amount: 200_000 })],
    });
    const row = s.find(r => r.date === '2024-08-15');
    const regularPayment = row?.payment || 0;
    const earlyPart = row?.earlyPayment || 0;
    expect(earlyPart + regularPayment).toBeCloseTo(200_000, 2);
  });

  it('amountMode: "totalWithFee" включает комиссию досрочного погашения в введённую сумму', () => {
    const s = generateBaseSchedule({ ...config, earlyRepaymentFeePercent: 10 }, {
      earlyRepayments: [early({ amountMode: 'totalWithFee', amount: 200_000 })],
    });
    const row = s.find(r => r.date === '2024-08-15')!;
    expect(row.cashFlowTotal).toBeCloseTo(200_000, 2);
    expect(row.payment + row.earlyPayment).toBeLessThan(200_000);
    expect(row.feePaid).toBeGreaterThan(0);
  });

  it('amountMode: "totalWithFee" раскладывает outcome на регулярный платёж, досрочную часть, комиссию и остаток', () => {
    const s = generateBaseSchedule({ ...config, earlyRepaymentFeePercent: 10 }, {
      earlyRepayments: [early({ amountMode: 'totalWithFee', amount: 200_000 })],
    })
    const row = s.find(r => r.date === '2024-08-15')!
    const outcome = row.repaymentOutcomes?.[0]

    expect(outcome).toMatchObject({ requestedAmount: 200_000, regularPaymentApplied: row.payment })
    expect(outcome!.requestedAmount).toBeCloseTo(
      (outcome!.regularPaymentApplied ?? 0) + outcome!.appliedAmount + outcome!.fee + outcome!.unusedAmount,
      2
    )
  })

  it('amountMode: "totalWithFee" не включает ежемесячную комиссию в введённую сумму', () => {
    const s = generateBaseSchedule({ ...config, monthlyFee: 1000 }, {
      earlyRepayments: [early({ amountMode: 'totalWithFee', amount: 200_000 })],
    });
    const row = s.find(r => r.date === '2024-08-15')!;
    expect(row.payment + row.earlyPayment).toBeCloseTo(200_000, 2);
    expect(row.feePaid).toBe(1000);
    expect(row.cashFlowTotal).toBeCloseTo(201_000, 2);
  });

  it('amountMode: "totalWithFee" доступен только в дату регулярного платежа', () => {
    expect(() => generateBaseSchedule(config, {
      earlyRepayments: [early({ date: '2024-08-16', amountMode: 'totalWithFee', amount: 200_000 })],
    })).toThrow('дату регулярного платежа')
  })

  it('amountMode: "totalWithFee" должен быть не меньше обязательного платежа', () => {
    expect(() => generateBaseSchedule(config, {
      earlyRepayments: [early({ amountMode: 'totalWithFee', amount: 1 })],
    })).toThrow('не меньше обязательного платежа')
  })

  it('amountMode: "totalWithFee" разрешён только один раз на дату', () => {
    expect(() => generateBaseSchedule(config, {
      earlyRepayments: [
        early({ id: 't1', amountMode: 'totalWithFee', amount: 200_000 }),
        early({ id: 't2', amountMode: 'totalWithFee', amount: 250_000 }),
      ],
    })).toThrow('только одну общую сумму')
  })

  it('нулевая сумма временно отключает разовый досрочный платёж', () => {
    const s = generateBaseSchedule(config, {
      earlyRepayments: [early({ amount: 0 })],
    })
    expect(s.reduce((sum, row) => sum + row.earlyPayment, 0)).toBe(0)
    expect(s.some(row => row.eventTypes.includes('earlyReduceTerm'))).toBe(false)
  })

  it('явный флаг enabled=false временно отключает разовый досрочный платёж', () => {
    const s = generateBaseSchedule(config, {
      earlyRepayments: [early({ amount: 300_000, enabled: false })],
    })
    expect(s.reduce((sum, row) => sum + row.earlyPayment, 0)).toBe(0)
    expect(s.some(row => row.eventTypes.includes('earlyReduceTerm'))).toBe(false)
  })

  it('отрицательная сумма досрочного платежа остаётся ошибкой', () => {
    expect(() => generateBaseSchedule(config, {
      earlyRepayments: [early({ amount: -1 })],
    })).toThrow('не может быть отрицательной')
  })
})

describe('edge cases', () => {
  it('сумма кредита = 0 — ошибка валидации', () => expect(() => generateBaseSchedule({ ...config, principal: 0 })).toThrow('Сумма кредита'))

  it('срок = 0 — ошибка валидации', () => expect(() => generateBaseSchedule({ ...config, termMonths: 0 })).toThrow('Срок'))

  it('дата выдачи позже даты первого платежа — ошибка валидации', () => expect(() => generateBaseSchedule({ ...config, issueDate: '2024-02-01', firstPaymentDate: '2024-01-15' })).toThrow('Первый платёж'))

  it('пустая дата первого платежа — ошибка валидации', () => expect(() => generateBaseSchedule({ ...config, firstPaymentDate: '' })).toThrow('Дата первого платежа'))

  it('невозможная календарная дата — ошибка валидации', () => expect(() => generateBaseSchedule({ ...config, issueDate: '2024-02-31' })).toThrow('Дата выдачи'))

  it('отрицательная ставка — ошибка валидации', () => expect(() => generateBaseSchedule({ ...config, annualRate: -5 })).toThrow('Ставка'))

  it('слишком длинный срок — ошибка валидации', () => expect(() => generateBaseSchedule({ ...config, termMonths: 1201 })).toThrow('1200'))

  it('слишком большой календарный горизонт — ошибка валидации', () => {
    const errors = validateScenario({ ...config, issueDate: '1000-01-01', firstPaymentDate: '9999-12-31' }, [], [])
    expect(errors.some(error => error.includes('120 лет'))).toBe(true)
    expect(() => generateBaseSchedule({ ...config, issueDate: '1000-01-01', firstPaymentDate: '9999-12-31' })).toThrow('120 лет')
  })

  it('отклоняет договорную дату закрытия за пределами четырёхзначного календаря', () => {
    const errors = validateScenario({ ...config, issueDate: '9999-01-01', firstPaymentDate: '9999-02-01', termMonths: 12, paymentDay: 1 }, [], [])
    expect(errors.some(error => error.includes('четырёхзначном календаре'))).toBe(true)
  })

  it('комиссия за досрочное погашение выше 100% — ошибка валидации', () => expect(() => generateBaseSchedule({ ...config, earlyRepaymentFeePercent: 150 })).toThrow('0 до 100'))

  it('валидатор отклоняет пустые даты досрочных платежей и льготных периодов', () => {
    const errors = validateScenario(config, [early({ date: '' })], [{ id:'bad', startDate:'', endDate:'2024-03-01', type:'full', extendTerm:false, accrueInterest:true, capitalizeInterest:false }])
    expect(errors.some(error => error.includes('Досрочный платёж'))).toBe(true)
    expect(errors.some(error => error.includes('Льготный период'))).toBe(true)
  })

  it('валидатор не падает, если дата первого платежа повреждена при существующей досрочке', () => {
    const errors = validateScenario({ ...config, firstPaymentDate: '' }, [early({ amountMode: 'totalWithFee' })], [])
    expect(errors.some(error => error.includes('Дата первого платежа'))).toBe(true)
    expect(errors.some(error => error.includes('дату регулярного платежа'))).toBe(true)
  })

  it('валидатор отклоняет повреждённые enum-поля ядра', () => {
    const brokenConfig = {
      ...config,
      firstPaymentInterestOnly: 'yes',
      firstPaymentInterestOnlyMode: 'outsideContract',
      paymentType: 'broken',
      frequency: 'weekly',
      rounding: 'ceil',
      interest: {
        ...config.interest,
        method: 'compound',
        dayCountBasis: 'actual360',
        includePaymentDate: 'yes',
        periodStart: 'middle',
        balanceMoment: 'noon'
      }
    } as unknown as LoanConfig
    const brokenRepayment = {
      ...early(),
      amountMode: 'bankRow',
      strategy: 'wrong',
      source: 'unknown',
      sameDayOrder: 'middle',
      interestFirst: 'yes'
    } as unknown as EarlyRepayment
    const brokenGrace = {
      id: 'bad-grace',
      startDate: '2024-03-01',
      endDate: '2024-03-31',
      type: 'pause',
      extendTerm: 'yes',
      accrueInterest: 'yes',
      capitalizeInterest: 'yes'
    } as unknown as GracePeriod
    const errors = validateScenario(brokenConfig, [brokenRepayment], [brokenGrace])
    expect(errors).toEqual(expect.arrayContaining([
      'Настройка первого платежа повреждена',
      'Режим первого платежа повреждён',
      'Тип платежа повреждён',
      'Частота платежей повреждена',
      'Округление повреждено',
      'Метод начисления процентов повреждён',
      'База года повреждена',
      'Правило включения даты платежа повреждено',
      'Начало процентного периода повреждено',
      'Момент остатка для процентов повреждён',
      'Досрочный платёж №1: режим суммы повреждён',
      'Досрочный платёж №1: стратегия повреждена',
      'Досрочный платёж №1: источник повреждён',
      'Досрочный платёж №1: порядок в дату платежа повреждён',
      'Досрочный платёж №1: правило погашения процентов повреждено',
      'Льготный период №1: режим повреждён',
      'Льготный период №1: правило продления срока повреждено',
      'Льготный период №1: правило начисления процентов повреждено',
      'Льготный период №1: правило капитализации процентов повреждено'
    ]))
  })

  it('очень большая сумма (10 млрд) — нет переполнения', () => {
    const s = generateBaseSchedule({ ...config, principal: 10_000_000_000, termMonths: 120 });
    expect(s.at(-1)?.closingBalance).toBeCloseTo(0, 2);
  });
})

it('повторный расчёт даёт тот же график', () => {
  const params = { ...config, principal: 2_000_000 };
  const first = generateBaseSchedule(params);
  const second = generateBaseSchedule(params);
  expect(first).toEqual(second);
});
