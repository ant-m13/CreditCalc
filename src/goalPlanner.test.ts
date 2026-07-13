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

describe('goal planner', () => {
  it('подбирает четыре варианта закрытия и подтверждает копеечную границу', () => {
    const result = buildGoalPlans(input())

    expect(result.status).toBe('planned')
    expect(result.variants).toHaveLength(4)
    expect(result.variants.filter(item => item.status === 'achieved')).toHaveLength(4)
    expect(result.variants.every(item => item.status === 'infeasible' || item.boundaryVerified)).toBe(true)
    expect(result.variants.filter(item => item.summary).every(item => item.summary!.closingDate <= result.targetDate!)).toBe(true)
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

  it('строит новый график из выбранного плана', () => {
    const plannerInput = input()
    const result = buildGoalPlans(plannerInput)
    const variant = result.variants.find(item => item.kind === 'combined')!
    const preview = buildGoalPlanPreview(plannerInput, variant.operations)

    expect(preview.planned.closingDate).toBe(variant.summary?.closingDate)
    expect(preview.planned.closingDate < preview.current.closingDate).toBe(true)
  })

  it('не предлагает операции, начинающиеся после целевой даты', () => {
    const targetDate = format(addMonths(parseISO('2026-01-01'), 2), 'yyyy-MM-dd')
    const result = buildGoalPlans(input({ goal: { type: 'targetDate', targetDate }, planStartDate: '2026-08-01', oneTimeDate: '2026-07-15' }))

    expect(result.status).toBe('infeasible')
    expect(result.variants.every(item => item.status === 'infeasible')).toBe(true)
  })
})
