import { beforeAll, describe, expect, it } from 'vitest'
import { addMonths, format, parseISO } from 'date-fns'
import { defaultConfig } from './loanDefaults'
import { buildGoalPlanPreview, buildGoalPlans, type GoalPlannerInput } from './goalPlanner'
import type { EarlyRepayment } from './loanEngine'
import type { RepaymentRule } from './repaymentRules'

const GOAL_PLANNER_TEST_TIMEOUT_MS = 30_000
const RANDOMIZED_SEARCH_TEST_TIMEOUT_MS = 90_000

const input = (patch: Partial<GoalPlannerInput> = {}): GoalPlannerInput => ({
  config: { ...defaultConfig, principal: 1_000_000, annualRate: 12, issueDate: '2026-01-01', firstPaymentDate: '2026-02-01', paymentDay: 1, termMonths: 60, firstPaymentInterestOnly: false, earlyRepaymentFeePercent: 1 },
  repayments: [],
  repaymentRules: [],
  gracePeriods: [],
  selectedScenario: 'combined',
  goal: { type: 'monthsEarlier', months: 12 },
  planStartDate: '2026-08-01',
  oneTimeDate: '2026-07-15',
  availableNow: 100_000,
  ...patch
})

const seededRandom = (seed: number) => () => {
  // Фиксированные коэффициенты алгоритма Mulberry32 дают воспроизводимые случайные сценарии.
  seed |= 0
  seed = seed + 0x6D2B79F5 | 0
  let value = Math.imul(seed ^ seed >>> 15, 1 | seed)
  value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value
  return ((value ^ value >>> 14) >>> 0) / 4_294_967_296
}

const operationsWithVariantAmount = (
  variant: ReturnType<typeof buildGoalPlans>['variants'][number],
  amount: number
) => {
  if (variant.kind === 'oneTime') {
    return {
      repayments: amount > 0 ? variant.operations.repayments.map(repayment => ({ ...repayment, amount })) : [],
      repaymentRules: variant.operations.repaymentRules
    }
  }
  return {
    repayments: variant.operations.repayments,
    repaymentRules: amount > 0 ? variant.operations.repaymentRules.map(rule => ({ ...rule, amount })) : []
  }
}

let baselinePlans: ReturnType<typeof buildGoalPlans>

beforeAll(() => {
  baselinePlans = buildGoalPlans(input())
})

describe('goal planner', { timeout: GOAL_PLANNER_TEST_TIMEOUT_MS }, () => {
  it('подбирает четыре варианта закрытия и подтверждает копеечную границу', () => {
    const result = baselinePlans

    expect(result.status).toBe('planned')
    expect(result.variants).toHaveLength(4)
    expect(result.variants.filter(item => item.status === 'achieved')).toHaveLength(4)
    expect(result.variants.every(item => item.status === 'infeasible' || item.boundaryVerified)).toBe(true)
    expect(result.variants.filter(item => item.summary).every(item => item.summary!.closingDate <= result.targetDate!)).toBe(true)

    const monthly = result.variants.find(item => item.kind === 'monthlyExtra')!
    expect(monthly.summary!.plannerContribution.unused).toBe(0)
    const previousOperations = {
      repayments: monthly.operations.repayments,
      repaymentRules: monthly.operations.repaymentRules.map(rule => ({ ...rule, amount: Math.max(0, (rule.amount ?? 0) - 0.01) }))
    }
    expect(buildGoalPlanPreview(input(), previousOperations).planned.closingDate > result.targetDate!).toBe(true)
    expect(result.variants.some(item => (item.summary?.plannerContribution.fees ?? 0) > 0)).toBe(true)
  })

  it('учитывает существующие операции как текущий план', () => {
    const repayment: EarlyRepayment = {
      id: 'existing', date: '2026-03-15', amount: 400_000, amountMode: 'extra', strategy: 'reduceTerm', source: 'own', sameDayOrder: 'regularFirst', interestFirst: true
    }
    const withoutExisting = baselinePlans
    const withExisting = buildGoalPlans(input({ repayments: [repayment] }))

    expect(withExisting.current.closingDate < withoutExisting.current.closingDate).toBe(true)
    expect(withExisting.variants.find(item => item.kind === 'monthlyExtra')?.monthlyExtra).not.toBe(withoutExisting.variants.find(item => item.kind === 'monthlyExtra')?.monthlyExtra)
  })

  it('учитывает существующие правила досрочного погашения при подборе цели', () => {
    const repaymentRule: RepaymentRule = {
      id: 'existing-rule',
      name: 'Уже запланированная доплата',
      type: 'monthlyFixed',
      startDate: '2026-03-01',
      endDate: '2030-12-01',
      amount: 1_000,
      enabled: true,
      strategy: 'reduceTerm',
      source: 'own',
      sameDayOrder: 'regularFirst',
      interestFirst: true,
      skipMonths: []
    }
    const withoutExisting = baselinePlans
    const withExisting = buildGoalPlans(input({ repaymentRules: [repaymentRule] }))

    expect(withExisting.current.closingDate < withoutExisting.current.closingDate).toBe(true)
    expect(withExisting.current.totalInterest).toBeLessThan(withoutExisting.current.totalInterest)
    expect(withExisting.variants.find(item => item.kind === 'monthlyExtra')?.monthlyExtra)
      .not.toBe(withoutExisting.variants.find(item => item.kind === 'monthlyExtra')?.monthlyExtra)
  })

  it('возвращает alreadyAchieved для более поздней целевой даты', () => {
    const result = buildGoalPlans(input({ goal: { type: 'targetDate', targetDate: '2035-01-01' } }))
    expect(result).toMatchObject({ status: 'alreadyAchieved', variants: [] })
  })

  it('отклоняет неподдерживаемый срок сокращения из повреждённого снимка', () => {
    const goal = { type: 'monthsEarlier', months: 48 } as unknown as GoalPlannerInput['goal']
    expect(() => buildGoalPlans(input({ goal }))).toThrow('доступному варианту цели')
  })

  it('ограничивает общий регулярный перевод заданным бюджетом', () => {
    const plannerInput = input({ goal: { type: 'monthlyBudget', amount: 18_000 } })
    const result = buildGoalPlans(plannerInput)
    const oneTime = result.variants.find(item => item.kind === 'oneTime')!

    expect(oneTime.status).toBe('achieved')
    expect(oneTime.oneTimePayment).toBeGreaterThan(0)
    const preview = buildGoalPlanPreview(plannerInput, oneTime.operations)
    expect(Math.max(...preview.planned.schedule.filter(row => row.isRegularPayment && row.date >= plannerInput.planStartDate).map(row => row.cashFlowTotal))).toBeLessThanOrEqual(18_000)
  })

  it('не предлагает пустой план, если текущий платёж уже укладывается в бюджет', () => {
    const result = buildGoalPlans(input({ goal: { type: 'monthlyBudget', amount: 30_000 } }))

    expect(result).toMatchObject({
      status: 'alreadyAchieved',
      monthlyBudget: 30_000,
      variants: [],
      message: expect.stringContaining('уже укладывается')
    })
  })

  it('не рекомендует комбинированный план с разовым взносом после закрытия кредита', () => {
    const plannerInput = input({ goal: { type: 'maxOverpayment', amount: 150_000 }, oneTimeDate: '2035-01-01', availableNow: 100_000 })
    const result = buildGoalPlans(plannerInput)
    const combined = result.variants.find(item => item.kind === 'combined')!

    expect(combined.status).toBe('infeasible')
    expect(combined.operations.repayments).toEqual([])
    expect(combined.oneTimePayment).toBeUndefined()
    expect(combined.reason).toContain('раньше')
  })

  it('отбрасывает будущий разовый взнос, когда ежемесячный бюджет достигается без него', () => {
    const plannerInput = input({
      config: {
        ...input().config,
        annualRate: 5,
        rateChangeMode: 'nextPeriod',
        rateChanges: [{ id: 'late-rate', date: '2029-01-01', annualRate: 30 }]
      },
      goal: { type: 'monthlyBudget', amount: 23_000 },
      planStartDate: '2026-03-01',
      oneTimeDate: '2035-01-01',
      availableNow: 100_000
    })
    const result = buildGoalPlans(plannerInput)
    const combined = result.variants.find(item => item.kind === 'combined')!
    expect(result.status).toBe('planned')
    expect(combined).toMatchObject({
      status: 'infeasible',
      operations: { repayments: [], repaymentRules: [] }
    })
    expect(combined.reason).toContain('раньше')
  })

  it('подбирает вариант для ограничения общей переплаты с комиссиями', () => {
    const current = baselinePlans.current
    const result = buildGoalPlans(input({ goal: { type: 'maxOverpayment', amount: Math.round(current.overpayment * 0.8 * 100) / 100 } }))

    expect(result.status).toBe('planned')
    expect(result.variants.some(item => item.status === 'achieved' && item.summary!.overpayment <= result.targetOverpayment!)).toBe(true)
  })

  it('не пропускает узкое достижимое окно переплаты при высокой комиссии', () => {
    const plannerInput = input({
      config: { ...input().config, earlyRepaymentFeePercent: 20 },
      goal: { type: 'maxOverpayment', amount: 234_473.37 }
    })
    const result = buildGoalPlans(plannerInput)
    const oneTime = result.variants.find(item => item.kind === 'oneTime')!

    expect(result.status).toBe('planned')
    expect(oneTime.status).toBe('achieved')
    expect(oneTime.boundaryVerified).toBe(true)
    expect(oneTime.summary!.overpayment).toBeLessThanOrEqual(234_473.37)

    const previousOperations = {
      repayments: oneTime.operations.repayments.map(repayment => ({ ...repayment, amount: repayment.amount - 0.01 })),
      repaymentRules: oneTime.operations.repaymentRules
    }
    expect(buildGoalPlanPreview(plannerInput, previousOperations).planned.overpayment).toBeGreaterThan(234_473.37)
  })

  it('подтверждает глобальную границу на случайных финансовых сценариях', { timeout: RANDOMIZED_SEARCH_TEST_TIMEOUT_MS }, () => {
    const random = seededRandom(1_703_2026)
    const frequencies = ['monthly', 'quarterly', 'monthly'] as const

    for (let index = 0; index < frequencies.length; index += 1) {
      const frequency = frequencies[index]
      const principal = 80_000 + Math.floor(random() * 40_000)
      const plannerInput = input({
        config: {
          ...input().config,
          principal,
          annualRate: 5 + Math.floor(random() * 1_500) / 100,
          firstPaymentDate: frequency === 'quarterly' ? '2026-04-01' : '2026-02-01',
          termMonths: frequency === 'quarterly' ? 36 : 24,
          frequency,
          rounding: random() > 0.5 ? 'kopecks' : 'rubles',
          earlyRepaymentFeePercent: Math.floor(random() * 1_500) / 100,
          rateChangeMode: index % 2 === 0 ? 'nextPeriod' : 'exactDate',
          rateChanges: [{ id: `property-rate-${index}`, date: '2027-01-15', annualRate: 8 + Math.floor(random() * 2_000) / 100 }]
        },
        repayments: index === 1 ? [{
          id: 'property-existing',
          date: '2026-05-15',
          amount: 5_000,
          amountMode: 'extra',
          strategy: 'reduceTerm',
          source: 'own',
          sameDayOrder: 'regularFirst',
          interestFirst: true
        }] : [],
        gracePeriods: index === 2 ? [{
          id: 'property-grace',
          startDate: '2027-04-01',
          endDate: '2027-05-31',
          type: 'interestOnly',
          extendTerm: true,
          accrueInterest: true,
          capitalizeInterest: false
        }] : [],
        planStartDate: frequency === 'quarterly' ? '2026-07-01' : '2026-03-01',
        oneTimeDate: '2026-02-15',
        availableNow: Math.floor(principal * (0.08 + random() * 0.12)),
        goal: { type: 'maxOverpayment', amount: 0 }
      })
      const current = buildGoalPlanPreview(plannerInput, { repayments: [], repaymentRules: [] }).current
      plannerInput.goal = { type: 'maxOverpayment', amount: Math.round(current.overpayment * (0.9 + random() * 0.06) * 100) / 100 }
      const result = buildGoalPlans(plannerInput)

      expect(result.status).toBe('planned')
      for (const variant of result.variants.filter(item => item.status === 'achieved')) {
        const amount = variant.kind === 'combined'
          ? variant.monthlyExtra ?? variant.totalMonthlyPayment ?? 0
          : variant.oneTimePayment ?? variant.monthlyExtra ?? variant.totalMonthlyPayment ?? 0
        expect(variant.boundaryVerified).toBe(true)
        expect(variant.summary!.overpayment).toBeLessThanOrEqual(plannerInput.goal.amount)
        if (amount <= 0) continue

        const earlierAmounts = new Set([
          0,
          Math.max(0, amount - 0.01),
          ...Array.from({ length: 6 }, () => Math.floor(random() * amount * 100) / 100)
        ])
        for (const earlierAmount of earlierAmounts) {
          const reachesGoal = (() => {
            try {
              return buildGoalPlanPreview(plannerInput, operationsWithVariantAmount(variant, earlierAmount)).planned.overpayment <= plannerInput.goal.amount
            } catch {
              return false
            }
          })()
          expect(reachesGoal, `${variant.kind}: ${earlierAmount} не должна достигать цели раньше ${amount}`).toBe(false)
        }
      }
    }
  })

  it('расширяет диапазон подбора срока с учётом высокой комиссии', () => {
    const plannerInput = input({
      config: { ...input().config, principal: 100_000, earlyRepaymentFeePercent: 90 },
      goal: { type: 'targetDate', targetDate: '2026-08-01' },
      availableNow: 0
    })
    const result = buildGoalPlans(plannerInput)
    const oneTime = result.variants.find(item => item.kind === 'oneTime')!

    expect(oneTime.status).toBe('achieved')
    expect(oneTime.oneTimePayment).toBeGreaterThan(result.current.totalPaid)
    expect(oneTime.summary!.closingDate <= '2026-08-01').toBe(true)
    expect(oneTime.boundaryVerified).toBe(true)
  })

  it('строит новый график из выбранного плана', () => {
    const plannerInput = input()
    const result = baselinePlans
    const variant = result.variants.find(item => item.kind === 'combined')!
    const preview = buildGoalPlanPreview(plannerInput, variant.operations)

    expect(preview.planned.closingDate).toBe(variant.summary?.closingDate)
    expect(preview.planned.closingDate < preview.current.closingDate).toBe(true)
    expect(preview.repayments.some(repayment => repayment.id.startsWith('rule-goal-plan-'))).toBe(true)
    expect(preview.repayments.every(repayment => preview.planned.schedule.some(row => row.date === repayment.date))).toBe(true)
  })

  it('не предлагает операции, начинающиеся после целевой даты', () => {
    const targetDate = format(addMonths(parseISO('2026-01-01'), 2), 'yyyy-MM-dd')
    const result = buildGoalPlans(input({ goal: { type: 'targetDate', targetDate }, planStartDate: '2026-08-01', oneTimeDate: '2026-07-15' }))

    expect(result.status).toBe('infeasible')
    expect(result.variants.every(item => item.status === 'infeasible')).toBe(true)
  })

  it('использует тот же движок для квартальных платежей, изменения ставки, льготы и округления до рублей', () => {
    const result = buildGoalPlans(input({
      config: {
        ...defaultConfig,
        principal: 600_000,
        annualRate: 9,
        issueDate: '2026-01-01',
        firstPaymentDate: '2026-04-01',
        paymentDay: 1,
        termMonths: 60,
        frequency: 'quarterly',
        rounding: 'rubles',
        firstPaymentInterestOnly: false,
        rateChanges: [{ id: 'rate-1', date: '2027-01-01', annualRate: 11 }]
      },
      gracePeriods: [{ id: 'grace-1', startDate: '2027-04-01', endDate: '2027-06-30', type: 'interestOnly', extendTerm: true, accrueInterest: true, capitalizeInterest: false }],
      goal: { type: 'monthsEarlier', months: 6 },
      planStartDate: '2026-10-01',
      oneTimeDate: '2026-07-15'
    }))

    expect(result.status).toBe('planned')
    expect(result.variants.some(item => item.status === 'achieved' && item.boundaryVerified)).toBe(true)
  })

  it('не завышает общий платёж будущим ростом обязательного платежа после целевой даты', () => {
    const plannerInput = input({
      config: {
        ...defaultConfig,
        principal: 1_000_000,
        annualRate: 5,
        issueDate: '2026-01-01',
        firstPaymentDate: '2026-02-01',
        paymentDay: 1,
        termMonths: 60,
        firstPaymentInterestOnly: false,
        rateChangeMode: 'exactDate',
        rateChanges: [{ id: 'late-rate', date: '2030-08-01', annualRate: 100 }]
      },
      planStartDate: '2026-03-01',
      oneTimeDate: '2026-02-15',
      goal: { type: 'monthsEarlier', months: 6 }
    })
    const current = buildGoalPlanPreview(plannerInput, { repayments: [], repaymentRules: [] }).current
    const highestCurrentPayment = Math.max(...current.schedule.filter(row => row.isRegularPayment).map(row => row.payment))
    const result = buildGoalPlans(plannerInput)
    const total = result.variants.find(item => item.kind === 'monthlyTotalPayment')!

    expect(total.status).toBe('achieved')
    expect(total.totalMonthlyPayment).toBeLessThan(highestCurrentPayment)
    expect(total.summary!.closingDate < '2030-08-01').toBe(true)
  })
})
