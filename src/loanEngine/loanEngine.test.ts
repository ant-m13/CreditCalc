import { describe, expect, it } from 'vitest'
import { calculateAnnuityPayment, calculateInterest, compareScenarios, generateBaseSchedule, nextPaymentDate } from '.'
import type { EarlyRepayment, GracePeriod, LoanConfig } from './types'

const config: LoanConfig = {
  principal: 3_000_000, annualRate: 12, issueDate: '2024-01-01', firstPaymentDate: '2024-02-15', termMonths: 120,
  paymentDay: 15, paymentType: 'annuity', frequency: 'monthly', currency: 'RUB', rounding: 'kopecks', closeThreshold: 300,
  oneTimeFee: 0, monthlyFee: 0, earlyRepaymentFeePercent: 0,
  interest: { method: 'annuity', dayCountBasis: 'actualActual', includePaymentDate: false, balanceMoment: 'startOfDay' }
}
const early = (patch: Partial<EarlyRepayment> = {}): EarlyRepayment => ({ id: 'e1', date: '2024-08-15', amount: 300_000, strategy: 'reduceTerm', source: 'own', sameDayOrder: 'regularFirst', interestFirst: true, ...patch })

describe('loan engine', () => {
  it('рассчитывает аннуитетный платёж', () => expect(calculateAnnuityPayment(1_000_000, 12, 12).toNumber()).toBeCloseTo(88848.79, 2))
  it('строит базовый график и закрывает долг', () => { const s=generateBaseSchedule(config); expect(s.length).toBeLessThanOrEqual(120); expect(s.at(-1)?.closingBalance).toBe(0) })
  it('сокращает срок при досрочном платеже', () => { const base=generateBaseSchedule(config); const s=generateBaseSchedule(config,{earlyRepayments:[early()]}); expect(s.length).toBeLessThan(base.length) })
  it('уменьшает платёж при сохранении срока', () => { const s=generateBaseSchedule(config,{earlyRepayments:[early({strategy:'reducePayment'})]}); expect(s[7].payment).toBeLessThan(s[0].payment); expect(s.length).toBeGreaterThan(100) })
  it('применяет досрочный платёж в дату регулярного', () => { const s=generateBaseSchedule(config,{earlyRepayments:[early()]}); expect(s.find(x=>x.date==='2024-08-15')?.earlyPayment).toBe(300000) })
  it('применяет досрочный платёж между датами', () => { const s=generateBaseSchedule(config,{earlyRepayments:[early({date:'2024-08-02'})]}); expect(s.find(x=>x.date==='2024-08-15')?.event).toContain('срока') })
  it('поддерживает несколько досрочных платежей', () => { const s=generateBaseSchedule(config,{earlyRepayments:[early(),early({id:'e2',date:'2025-02-15',amount:200000})]}); expect(s.reduce((a,x)=>a+x.earlyPayment,0)).toBe(500000) })
  it('учитывает льготный период', () => { const grace:GracePeriod={id:'g',startDate:'2024-03-01',endDate:'2024-04-30',type:'interestOnly',extendTerm:true,accrueInterest:true,capitalizeInterest:false}; const s=generateBaseSchedule(config,{gracePeriods:[grace]}); expect(s[1].principal).toBe(0); expect(s[1].event).toContain('проценты') })
  it('работает с нулевой ставкой', () => { const s=generateBaseSchedule({...config,annualRate:0}); expect(s[0].interest).toBe(0); expect(s[0].payment).toBe(25000) })
  it('выполняет полное досрочное погашение', () => { const s=generateBaseSchedule(config,{earlyRepayments:[early({date:'2024-03-15',amount:4_000_000,strategy:'full'})]}); expect(s.length).toBe(2); expect(s.at(-1)?.closingBalance).toBe(0) })
  it('автоматически закрывает остаток меньше порога', () => { const c={...config,principal:1000,termMonths:3,closeThreshold:500}; const s=generateBaseSchedule(c); expect(s.at(-1)?.closingBalance).toBe(0) })
  it('считает actual/actual в високосном году', () => { const i=calculateInterest(1_000_000,10,'2024-02-01','2024-03-01',config.interest); expect(i.toNumber()).toBeCloseTo(7923.5,0) })
  it('корректирует 31 число для короткого месяца', () => { expect(nextPaymentDate('2024-01-31',{...config,paymentDay:31})).toBe('2024-02-29') })
  it('сравнивает сценарии и находит лучшую экономию', () => { const result=compareScenarios(config,[early()]); expect(result.scenarios).toHaveLength(4); expect(result.bestSavings.interestSavings).toBeGreaterThan(0); expect(result.fastest.termMonths).toBeLessThanOrEqual(result.scenarios[0].termMonths) })

  it('не закрывает кредит недостаточным полным погашением', () => {
    const s=generateBaseSchedule(config,{earlyRepayments:[early({date:'2024-03-15',amount:1,strategy:'full'})]})
    expect(s.length).toBeGreaterThan(2)
    expect(s[1].closingBalance).toBeGreaterThan(0)
    expect(s[1].event).toContain('недостаточно средств')
  })

  it('учитывает реальную дату досрочного платежа внутри периода', () => {
    const daily={...config,interest:{...config.interest,method:'daily' as const,dayCountBasis:'actual365' as const}}
    const earlier=generateBaseSchedule(daily,{earlyRepayments:[early({date:'2024-03-01'})]})
    const later=generateBaseSchedule(daily,{earlyRepayments:[early({date:'2024-03-14'})]})
    expect(earlier.reduce((s,x)=>s+x.interest,0)).toBeLessThan(later.reduce((s,x)=>s+x.interest,0))
  })

  it('учитывает порядок операций в дату регулярного платежа', () => {
    const earlyFirst=generateBaseSchedule(config,{earlyRepayments:[early({date:'2024-08-15',strategy:'reducePayment',sameDayOrder:'earlyFirst'})]})
    const regularFirst=generateBaseSchedule(config,{earlyRepayments:[early({date:'2024-08-15',strategy:'reducePayment',sameDayOrder:'regularFirst'})]})
    expect(earlyFirst[6].payment).toBeLessThan(regularFirst[6].payment)
  })

  it('учитывает момент остатка в день досрочного платежа', () => {
    const baseDaily={...config,interest:{...config.interest,method:'daily' as const,dayCountBasis:'actual365' as const,includePaymentDate:true}}
    const start=generateBaseSchedule({...baseDaily,interest:{...baseDaily.interest,balanceMoment:'startOfDay' as const}},{earlyRepayments:[early({date:'2024-03-01'})]})
    const end=generateBaseSchedule({...baseDaily,interest:{...baseDaily.interest,balanceMoment:'endOfDay' as const}},{earlyRepayments:[early({date:'2024-03-01'})]})
    expect(start.reduce((s,x)=>s+x.interest,0)).toBeGreaterThan(end.reduce((s,x)=>s+x.interest,0))
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

  it('показывает новый платёж и накопленную экономию', () => {
    const result=compareScenarios(config,[early({strategy:'reducePayment'})])
    const reduced=result.scenarios.find(s=>s.id==='reducePayment')!
    expect(reduced.monthlyPayment).toBeLessThan(result.scenarios[0].monthlyPayment)
    expect(reduced.schedule.some(x=>x.cumulativeSavings>0)).toBe(true)
  })

  it('выражает длительность квартального графика в месяцах, а не периодах', () => {
    const result=compareScenarios({...config,frequency:'quarterly'},[])
    expect(result.scenarios[0].termMonths).toBeGreaterThan(100)
  })
})
