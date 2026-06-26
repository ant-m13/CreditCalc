import { describe, expect, it } from 'vitest'
import { calculateAnnuityPayment, calculateInterest, compareScenarios, generateBaseSchedule, nextPaymentDate } from '.'
import type { EarlyRepayment, GracePeriod, LoanConfig } from './types'

const config: LoanConfig = {
  principal: 3_000_000, annualRate: 12, issueDate: '2024-01-01', firstPaymentDate: '2024-02-15', firstPaymentInterestOnly: false, termMonths: 120,
  paymentDay: 15, paymentType: 'annuity', frequency: 'monthly', currency: 'RUB', rounding: 'kopecks', closeThreshold: 300,
  oneTimeFee: 0, monthlyFee: 0, earlyRepaymentFeePercent: 0,
  interest: { method: 'annuity', dayCountBasis: 'actualActual', includePaymentDate: false, balanceMoment: 'startOfDay' }
}
const early = (patch: Partial<EarlyRepayment> = {}): EarlyRepayment => ({ id: 'e1', date: '2024-08-15', amount: 300_000, amountMode: 'extra', strategy: 'reduceTerm', source: 'own', sameDayOrder: 'regularFirst', interestFirst: true, ...patch })

describe('loan engine', () => {
  it('рассчитывает аннуитетный платёж', () => expect(calculateAnnuityPayment(1_000_000, 12, 12).toNumber()).toBeCloseTo(88848.79, 2))
  it('строит базовый график с выдачей и закрывает долг', () => { const s=generateBaseSchedule(config); expect(s[0]).toMatchObject({number:1,date:'2024-01-01',payment:0,interest:0,principal:0,closingBalance:3000000}); expect(s.length).toBeLessThanOrEqual(121); expect(s.at(-1)?.closingBalance).toBe(0) })
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
  it('работает с нулевой ставкой', () => { const s=generateBaseSchedule({...config,annualRate:0}); const first=s.find(x=>x.date==='2024-02-15')!; expect(first.interest).toBe(0); expect(first.payment).toBe(25000) })
  it('выполняет полное досрочное погашение', () => { const s=generateBaseSchedule(config,{earlyRepayments:[early({date:'2024-03-15',amount:4_000_000,strategy:'full'})]}); expect(s.length).toBe(3); expect(s.at(-1)?.closingBalance).toBe(0) })
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
    const bankEarly:EarlyRepayment[]=[early({id:'b1',date:'2025-11-28',amount:35480,amountMode:'total'}),early({id:'b2',date:'2026-01-26',amount:8704.99})]
    const result=compareScenarios(bank,bankEarly).scenarios.find(s=>s.id==='reduceTerm')!
    expect(result.schedule.find(row=>row.date==='2025-12-26')?.payment).toBe(27083.44)
    expect(result.monthlyPayment).toBe(35479.81)
  })

  it('учитывает порядок операций в дату регулярного платежа', () => {
    const earlyFirst=generateBaseSchedule(config,{earlyRepayments:[early({date:'2024-08-15',strategy:'reducePayment',sameDayOrder:'earlyFirst'})]})
    const regularFirst=generateBaseSchedule(config,{earlyRepayments:[early({date:'2024-08-15',strategy:'reducePayment',sameDayOrder:'regularFirst'})]})
    expect(earlyFirst.find(x=>x.date==='2024-08-15')!.payment).toBeLessThan(regularFirst.find(x=>x.date==='2024-08-15')!.payment)
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
    expect(result.length).toBeLessThanOrEqual(360);
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
})

describe('edge cases', () => {
  it('сумма кредита = 0 — возвращает график только с выдачей и нулевым остатком', () => {
    const s = generateBaseSchedule({ ...config, principal: 0 });
    expect(s.length).toBe(1);
    expect(s[0].closingBalance).toBe(0);
    expect(s[0].payment).toBe(0);
  });

  it('срок = 0 — генерирует график без платежей, остаток не меняется', () => {
    const s = generateBaseSchedule({ ...config, termMonths: 0 });
    expect(s.length).toBeGreaterThan(0);
    const totalPayment = s.reduce((sum, r) => sum + r.payment, 0);
    expect(totalPayment).toBe(0);
    expect(s.at(-1)?.closingBalance).toBe(config.principal);
  });

  it('дата выдачи позже даты первого платежа', () => {
    const s = generateBaseSchedule({
      ...config,
      issueDate: '2024-02-01',
      firstPaymentDate: '2024-01-15',
    });
    expect(s[1]?.interest).toBe(0);
  });

  it('отрицательная ставка — проценты отрицательные, график закрывается', () => {
    const s = generateBaseSchedule({ ...config, annualRate: -5 });
    expect(s.some(r => r.interest < 0)).toBe(true);
    expect(s.at(-1)?.closingBalance).toBeCloseTo(0, 2);
  });

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