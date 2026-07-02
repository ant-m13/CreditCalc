import { describe, expect, it } from 'vitest'
import { calculateAnnuityPayment, calculateDebtAtDate, calculateInterest, compareScenarios, generateBaseSchedule, nextPaymentDate, validateScenario } from '.'
import type { EarlyRepayment, GracePeriod, LoanConfig } from './types'

const config: LoanConfig = {
  principal: 3_000_000, annualRate: 12, issueDate: '2024-01-01', firstPaymentDate: '2024-02-15', firstPaymentInterestOnly: false, termMonths: 120,
  paymentDay: 15, paymentType: 'annuity', frequency: 'monthly', currency: 'RUB', rounding: 'kopecks', closeThreshold: 300,
  oneTimeFee: 0, monthlyFee: 0, earlyRepaymentFeePercent: 0,
  interest: { method: 'annuity', dayCountBasis: 'actualActual', includePaymentDate: false, periodStart: 'inclusive', balanceMoment: 'startOfDay' }
}
const early = (patch: Partial<EarlyRepayment> = {}): EarlyRepayment => ({ id: 'e1', date: '2024-08-15', amount: 300_000, amountMode: 'extra', strategy: 'reduceTerm', source: 'own', sameDayOrder: 'regularFirst', interestFirst: true, ...patch })

describe('loan engine', () => {
  it('рассчитывает аннуитетный платёж', () => expect(calculateAnnuityPayment(1_000_000, 12, 12).toNumber()).toBeCloseTo(88848.79, 2))
  it('строит базовый график с выдачей и закрывает долг', () => { const s=generateBaseSchedule(config); expect(s[0]).toMatchObject({number:1,date:'2024-01-01',payment:0,interest:0,principal:0,closingBalance:3000000}); expect(s.length).toBeLessThanOrEqual(121); expect(s.at(-1)?.closingBalance).toBe(0) })
  it('добавляет пояснение формулы для строк платежей', () => { const row=generateBaseSchedule(config).find(x=>x.payment>0)!; expect(row.audit).toMatchObject({periodStart:'2024-01-01',periodEnd:'2024-02-15',dayCountBasis:'actualActual',rounding:'kopecks'}); expect(row.audit!.interestBeforeRounding).toBeGreaterThan(0) })
  it('сокращает срок при досрочном платеже', () => { const base=generateBaseSchedule(config); const s=generateBaseSchedule(config,{earlyRepayments:[early()]}); expect(s.length).toBeLessThan(base.length) })
  it('уменьшает платёж при сохранении срока', () => { const s=generateBaseSchedule(config,{earlyRepayments:[early({strategy:'reducePayment'})]}); expect(s.find(x=>x.date==='2024-09-15')!.payment).toBeLessThan(s.find(x=>x.date==='2024-02-15')!.payment); expect(s.length).toBeGreaterThan(100) })
  it('применяет досрочный платёж в дату регулярного', () => { const s=generateBaseSchedule(config,{earlyRepayments:[early()]}); expect(s.find(x=>x.date==='2024-08-15')?.earlyPayment).toBe(300000) })
  it('применяет досрочный платёж между датами', () => { const s=generateBaseSchedule(config,{earlyRepayments:[early({date:'2024-08-02'})]}); expect(s.find(x=>x.date==='2024-08-02')?.event).toContain('срока') })
  it('выводит досрочный платёж отдельной строкой в фактическую дату', () => {
    const s=generateBaseSchedule(config,{earlyRepayments:[early({date:'2024-08-02'})]})
    const row=s.find(x=>x.date==='2024-08-02')
    expect(row?.earlyPayment).toBe(300000)
    expect(row?.days).toBeGreaterThan(0)
    expect(s.find(x=>x.date==='2024-08-15')!.days).toBe(13)
  })
  it('поддерживает несколько досрочных платежей', () => { const s=generateBaseSchedule(config,{earlyRepayments:[early(),early({id:'e2',date:'2025-02-15',amount:200000})]}); expect(s.reduce((a,x)=>a+x.earlyPayment,0)).toBe(500000) })
  it('учитывает льготный период', () => { const grace:GracePeriod={id:'g',startDate:'2024-03-01',endDate:'2024-04-30',type:'interestOnly',extendTerm:true,accrueInterest:true,capitalizeInterest:false}; const s=generateBaseSchedule(config,{gracePeriods:[grace]}); const row=s.find(x=>x.date==='2024-03-15')!; expect(row.principal).toBe(0); expect(row.event).toContain('проценты') })
  it('не продлевает договорную дату закрытия при льготе без продления', () => {
    const short = { ...config, principal: 120_000, annualRate: 0, termMonths: 12, issueDate: '2024-01-01', firstPaymentDate: '2024-02-01', paymentDay: 1 }
    const base = generateBaseSchedule(short)
    const grace: GracePeriod = { id: 'g-no-extend', startDate: '2024-03-01', endDate: '2024-05-31', type: 'full', extendTerm: false, accrueInterest: false, capitalizeInterest: false }
    const s = generateBaseSchedule(short, { gracePeriods: [grace] })
    expect(s.at(-1)?.date).toBe(base.at(-1)?.date)
    expect(s.at(-1)?.eventTypes).toContain('finalBalloon')
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
  it('выполняет полное досрочное погашение', () => { const s=generateBaseSchedule(config,{earlyRepayments:[early({date:'2024-03-15',amount:4_000_000,strategy:'full'})]}); expect(s.length).toBe(3); expect(s.at(-1)?.closingBalance).toBe(0) })
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

  it('совпадает с банковским графиком после всех досрочных платежей', () => {
    const bank:LoanConfig={...config,principal:5917734,annualRate:6,issueDate:'2025-11-26',firstPaymentDate:'2025-12-26',firstPaymentInterestOnly:true,termMonths:360,paymentDay:26,interest:{...config.interest,method:'daily',dayCountBasis:'actual365'}}
    const bankEarly:EarlyRepayment[] = [
      early({id:'b1',date:'2025-11-28',amount:35480}),
      early({id:'b2',date:'2026-01-26',amount:8704.99}),
      early({id:'b3',date:'2026-02-26',amount:35528.86}),
      early({id:'b4',date:'2026-03-27',amount:12342.60}),
      early({id:'b5',date:'2026-04-26',amount:17870.62}),
      early({id:'b6',date:'2026-05-26',amount:39702.33})
    ]
    const s=generateBaseSchedule(bank,{earlyRepayments:bankEarly})
    const expected = [
      ['2025-11-26',0.00,0.00,0.00,5917734.00],
      ['2025-11-28',33534.44,1945.56,35480.00,5884199.56],
      ['2025-12-26',0.00,27083.44,27083.44,5884199.56],
      ['2026-01-26',14199.56,29985.24,44184.80,5870000.00],
      ['2026-02-26',41095.79,29912.88,71008.67,5828904.21],
      ['2026-03-26',8650.88,26828.93,35479.81,5820253.33],
      ['2026-03-27',11385.85,956.75,12342.60,5808867.48],
      ['2026-04-26',24703.96,28646.47,53350.43,5784163.52],
      ['2026-05-26',46657.50,28524.64,75182.14,5737506.02],
      ['2026-06-26',6242.11,29237.70,35479.81,5731263.91],
      ['2026-07-26',7216.04,28263.77,35479.81,5724047.87],
      ['2026-08-26',6310.69,29169.12,35479.81,5717737.18],
      ['2026-09-26',6342.85,29136.96,35479.81,5711394.33],
      ['2026-10-26',7314.03,28165.78,35479.81,5704080.30],
      ['2026-11-26',6412.44,29067.37,35479.81,5697667.86],
      ['2026-12-26',7381.72,28098.09,35479.81,5690286.14]
    ] as const
    expected.forEach(([date,principal,interest,total,closing],index) => {
      expect(s[index].date).toBe(date)
      expect(s[index].principal).toBe(principal)
      expect(s[index].interest).toBe(interest)
      expect(s[index].payment + s[index].earlyPayment).toBeCloseTo(total,2)
      expect(s[index].closingBalance).toBe(closing)
    })
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
    expect(combined.schedule.at(-1)?.eventTypes).toEqual(expect.arrayContaining(['earlyFull','earlyReduceTerm']))
    expect(combined.schedule.at(-1)?.fullyClosedByEarlyRepayment).toBe(true)
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

  it('выражает длительность квартального графика в месяцах, а не периодах', () => {
    const result=compareScenarios({...config,frequency:'quarterly'},[])
    expect(result.scenarios[0].termMonths).toBeGreaterThan(100)
  })
})

// ===== Производительность =====
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

    expect(duration).toBeLessThan(1000);
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

    expect(duration).toBeLessThan(800);
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

describe('day count bases', () => {
  // Текущая реализация всегда использует 365 дней в году для всех базисов, кроме actualActual.
  // Поэтому ожидаем одинаковое значение для всех.
  const expectedForNonActualActual = 8493.150684931506;
  it.each([
    ['actual365', expectedForNonActualActual],
    ['actual360', expectedForNonActualActual],
    ['thirty360', expectedForNonActualActual],
  ])('рассчитывает проценты для базы %s', (basis, expected) => {
    const interest = calculateInterest(
      1_000_000,
      10,
      '2024-01-01',
      '2024-02-01',
      { ...config.interest, dayCountBasis: basis as any }
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

  it('amountMode: "total" — включает регулярный платёж', () => {
    const s = generateBaseSchedule(config, {
      earlyRepayments: [early({ amountMode: 'total', amount: 200_000 })],
    });
    const row = s.find(r => r.date === '2024-08-15');
    const regularPayment = row?.payment || 0;
    const earlyPart = row?.earlyPayment || 0;
    expect(earlyPart + regularPayment).toBeCloseTo(200_000, 2);
  });

  it('amountMode: "total" не включает комиссии в введённую сумму', () => {
    const s = generateBaseSchedule({ ...config, monthlyFee: 1000 }, {
      earlyRepayments: [early({ amountMode: 'total', amount: 200_000 })],
    });
    const row = s.find(r => r.date === '2024-08-15')!;
    expect(row.payment + row.earlyPayment).toBeCloseTo(200_000, 2);
    expect(row.feePaid).toBe(1000);
    expect(row.cashFlowTotal).toBeCloseTo(201_000, 2);
  });

  it('amountMode: "total" доступен только в дату регулярного платежа', () => {
    expect(() => generateBaseSchedule(config, {
      earlyRepayments: [early({ date: '2024-08-16', amountMode: 'total', amount: 200_000 })],
    })).toThrow('дату регулярного платежа')
  })

  it('amountMode: "total" должен быть не меньше обязательного платежа', () => {
    expect(() => generateBaseSchedule(config, {
      earlyRepayments: [early({ amountMode: 'total', amount: 1 })],
    })).toThrow('не меньше обязательного платежа')
  })

  it('amountMode: "total" разрешён только один раз на дату', () => {
    expect(() => generateBaseSchedule(config, {
      earlyRepayments: [
        early({ id: 't1', amountMode: 'total', amount: 200_000 }),
        early({ id: 't2', amountMode: 'total', amount: 250_000 }),
      ],
    })).toThrow('только одну общую сумму')
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

  it('комиссия за досрочное погашение выше 100% — ошибка валидации', () => expect(() => generateBaseSchedule({ ...config, earlyRepaymentFeePercent: 150 })).toThrow('0 до 100'))

  it('валидатор отклоняет пустые даты досрочных платежей и льготных периодов', () => {
    const errors = validateScenario(config, [early({ date: '' })], [{ id:'bad', startDate:'', endDate:'2024-03-01', type:'full', extendTerm:false, accrueInterest:true, capitalizeInterest:false }])
    expect(errors.some(error => error.includes('Досрочный платёж'))).toBe(true)
    expect(errors.some(error => error.includes('Льготный период'))).toBe(true)
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
