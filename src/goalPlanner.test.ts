import { describe, expect, it } from 'vitest'
import { addMonths, format, parseISO } from 'date-fns'
import { defaultConfig } from './loanDefaults'
import { buildGoalPlanPreview, buildGoalPlans, type GoalPlannerInput } from './goalPlanner'
import type { EarlyRepayment } from './loanEngine'

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

describe('goal planner', { timeout: 30_000 }, () => {
  it('подбирает четыре варианта закрытия и подтверждает копеечную границу', () => {
    const result = buildGoalPlans(input())

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
    const withoutExisting = buildGoalPlans(input())
    const withExisting = buildGoalPlans(input({ repayments: [repayment] }))

    expect(withExisting.current.closingDate < withoutExisting.current.closingDate).toBe(true)
    expect(withExisting.variants.find(item => item.kind === 'monthlyExtra')?.monthlyExtra).not.toBe(withoutExisting.variants.find(item => item.kind === 'monthlyExtra')?.monthlyExtra)
  })

  it('возвращает alreadyAchieved для более поздней целевой даты', () => {
    const result = buildGoalPlans(input({ goal: { type: 'targetDate', targetDate: '2035-01-01' } }))
    expect(result).toMatchObject({ status: 'alreadyAchieved', variants: [] })
  })

  it('ограничивает общий регулярный перевод заданным бюджетом', () => {
    const result = buildGoalPlans(input({ goal: { type: 'monthlyBudget', amount: 30_000 } }))
    const total = result.variants.find(item => item.kind === 'monthlyTotalPayment')

    expect(total?.status).toBe('achieved')
    expect(total?.totalMonthlyPayment).toBe(30_000)
    expect(total?.summary?.closingDate).toBeDefined()
    expect(total!.summary!.closingDate < result.current.closingDate).toBe(true)
  })

  it('подбирает вариант для ограничения общей переплаты с комиссиями', () => {
    const current = buildGoalPlans(input({ goal: { type: 'targetDate', targetDate: '2035-01-01' } })).current
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
    const result = buildGoalPlans(plannerInput)
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
