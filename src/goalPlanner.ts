import Decimal from 'decimal.js'
import { format, parseISO, subMonths } from 'date-fns'
import {
  compareScenarios,
  generateBaseSchedule,
  preparePaymentCalendar,
  sortRepaymentsByApplicationOrder,
  validateScenario,
  type EarlyRepayment,
  type PaymentScheduleItem,
  type PreparedPaymentCalendar,
  type ScenarioResult
} from './loanEngine'
import { MAX_FINANCIAL_RESULT, MAX_MONEY_AMOUNT } from './loanEngine/limits'
import type { LoanCalculationSource } from './loanCalculation'
import { expandRepaymentRules, type RepaymentRule } from './repaymentRules'
import { isISODate } from './utils/dateValidation'

export type GoalPlannerGoal =
  | { type: 'monthsEarlier'; months: 6 | 12 | 24 }
  | { type: 'targetDate'; targetDate: string }
  | { type: 'monthlyBudget'; amount: number }
  | { type: 'maxOverpayment'; amount: number }

export type GoalPlanVariantKind = 'monthlyExtra' | 'monthlyTotalPayment' | 'oneTime' | 'combined'

export interface GoalPlannerInput extends LoanCalculationSource {
  goal: GoalPlannerGoal
  planStartDate: string
  oneTimeDate: string
  availableNow: number
}

export interface GoalPlanOperations {
  repayments: EarlyRepayment[]
  repaymentRules: RepaymentRule[]
}

export interface GoalPlanBreakdown {
  bankTransfer: number
  principal: number
  interest: number
  fees: number
}

export interface GoalPlanContributionBreakdown extends GoalPlanBreakdown {
  regularPayment: number
  unused: number
  additionalInvestment: number
}

export interface GoalPlanSummary {
  closingDate: string
  totalPaid: number
  totalInterest: number
  overpayment: number
  interestSavings: number
  totalPaidDifference: number
  daysSaved: number
  total: GoalPlanBreakdown
  plannerContribution: GoalPlanContributionBreakdown
}

export interface GoalPlanVariant {
  kind: GoalPlanVariantKind
  title: string
  status: 'achieved' | 'infeasible'
  reason?: string
  monthlyExtra?: number
  totalMonthlyPayment?: number
  oneTimePayment?: number
  boundaryVerified: boolean
  operations: GoalPlanOperations
  summary?: GoalPlanSummary
}

export interface GoalPlannerResult {
  status: 'planned' | 'alreadyAchieved' | 'infeasible'
  targetDate?: string
  targetOverpayment?: number
  monthlyBudget?: number
  message?: string
  current: GoalPlanSummary
  variants: GoalPlanVariant[]
}

export interface GoalPlanPreview {
  current: ScenarioResult
  planned: ScenarioResult
}

interface PlannerContext {
  input: GoalPlannerInput
  calendar: PreparedPaymentCalendar
  existingRepayments: EarlyRepayment[]
  current: ScenarioResult
  maxSearchAmount: number
  nextSequence: number
}

interface EvaluatedPlan {
  schedule: PaymentScheduleItem[]
  plannerRepaymentIds: Set<string>
}

interface SearchResult {
  amount: number
  evaluated: EvaluatedPlan
  boundaryVerified: boolean
}

const variantTitles: Record<GoalPlanVariantKind, string> = {
  monthlyExtra: 'Ежемесячное увеличение',
  monthlyTotalPayment: 'Новый общий платёж',
  oneTime: 'Разовое погашение',
  combined: 'Комбинированный план'
}

const money = (value: Decimal.Value) => new Decimal(value).toDecimalPlaces(2).toNumber()
const sumRows = (schedule: PaymentScheduleItem[], field: keyof PaymentScheduleItem) =>
  money(schedule.reduce((sum, row) => sum.plus(row[field] as number), new Decimal(0)))

const emptyContribution = (): GoalPlanContributionBreakdown => ({
  bankTransfer: 0,
  principal: 0,
  interest: 0,
  fees: 0,
  regularPayment: 0,
  unused: 0,
  additionalInvestment: 0
})

const plannerContribution = (schedule: PaymentScheduleItem[], plannerRepaymentIds: Set<string>) => {
  const result = emptyContribution()
  for (const row of schedule) {
    for (const outcome of row.repaymentOutcomes ?? []) {
      if (!plannerRepaymentIds.has(outcome.repaymentId)) continue
      const regularPayment = outcome.regularPaymentApplied ?? 0
      result.regularPayment += regularPayment
      result.principal += outcome.appliedPrincipal
      result.interest += outcome.appliedInterest
      result.fees += outcome.fee
      result.unused += outcome.unusedAmount
      result.bankTransfer += regularPayment + outcome.appliedAmount + outcome.fee
      result.additionalInvestment += outcome.appliedAmount + outcome.fee
    }
  }
  return Object.fromEntries(Object.entries(result).map(([key, value]) => [key, money(value)])) as unknown as GoalPlanContributionBreakdown
}

const scheduleSummary = (
  schedule: PaymentScheduleItem[],
  principal: number,
  current: ScenarioResult | null,
  plannerRepaymentIds = new Set<string>()
): GoalPlanSummary => {
  const totalPaid = sumRows(schedule, 'cashFlowTotal')
  const totalInterest = sumRows(schedule, 'interest')
  const closingDate = schedule.at(-1)?.date ?? ''
  const currentClosing = current?.closingDate ?? closingDate
  const daysSaved = current ? Math.max(0, Math.round((parseISO(currentClosing).getTime() - parseISO(closingDate).getTime()) / 86_400_000)) : 0
  return {
    closingDate,
    totalPaid,
    totalInterest,
    overpayment: money(Decimal.max(0, new Decimal(totalPaid).minus(principal))),
    interestSavings: current ? money(new Decimal(current.totalInterest).minus(totalInterest)) : 0,
    totalPaidDifference: current ? money(new Decimal(totalPaid).minus(current.totalPaid)) : 0,
    daysSaved,
    total: {
      bankTransfer: totalPaid,
      principal: sumRows(schedule, 'principalPaid'),
      interest: sumRows(schedule, 'interestPaid'),
      fees: sumRows(schedule, 'feePaid')
    },
    plannerContribution: plannerContribution(schedule, plannerRepaymentIds)
  }
}

const validateMoney = (value: number, label: string, max = MAX_MONEY_AMOUNT) => {
  if (!Number.isFinite(value) || value < 0 || value > max) throw new Error(`${label}: укажите сумму от 0 до ${max}`)
}

const validateInput = (input: GoalPlannerInput) => {
  if (!isISODate(input.planStartDate)) throw new Error('Дата начала плана должна быть корректной')
  if (!isISODate(input.oneTimeDate)) throw new Error('Дата разового взноса должна быть корректной')
  if (input.planStartDate < input.config.issueDate) throw new Error('План не может начинаться раньше даты выдачи кредита')
  if (input.oneTimeDate < input.config.issueDate) throw new Error('Разовый взнос не может быть раньше даты выдачи кредита')
  validateMoney(input.availableNow, 'Доступный разовый взнос')
  if (input.goal.type === 'targetDate' && !isISODate(input.goal.targetDate)) throw new Error('Целевая дата должна быть корректной')
  if (input.goal.type === 'monthlyBudget') validateMoney(input.goal.amount, 'Ежемесячный бюджет')
  if (input.goal.type === 'maxOverpayment') validateMoney(input.goal.amount, 'Целевая переплата', MAX_FINANCIAL_RESULT)
}

const prepareContext = (input: GoalPlannerInput): PlannerContext => {
  validateInput(input)
  const calendar = preparePaymentCalendar(input.config, input.gracePeriods)
  const generated = expandRepaymentRules(input.config, input.repaymentRules, input.gracePeriods, calendar)
  const existingRepayments = sortRepaymentsByApplicationOrder([
    ...input.repayments.filter(item => item.enabled !== false && item.amount > 0),
    ...generated
  ])
  const errors = validateScenario(input.config, existingRepayments, input.gracePeriods)
  if (errors.length) throw new Error(errors.join(' · '))
  const comparison = compareScenarios(input.config, existingRepayments, input.gracePeriods, calendar, { scenarioAlreadyValidated: true })
  const current = comparison.scenarios.find(item => item.id === 'combined') ?? comparison.scenarios[0]
  const sequences = [
    ...existingRepayments.map(item => item.sameDaySequence ?? 0),
    ...input.repaymentRules.map(item => item.ruleSequence ?? 0)
  ]
  const nextSequence = Math.max(0, ...sequences) + 1
  const maxSearchAmount = Math.min(MAX_MONEY_AMOUNT, Math.max(100, input.config.principal, current.totalPaid))
  return { input, calendar, existingRepayments, current, maxSearchAmount, nextSequence }
}

const makeRule = (context: PlannerContext, type: 'monthlyFixed' | 'monthlyTotalPayment', amount: number, strategy: EarlyRepayment['strategy']): RepaymentRule => ({
  id: `goal-plan-${type}`,
  name: type === 'monthlyFixed' ? 'Планировщик цели · ежемесячная доплата' : 'Планировщик цели · общий платёж',
  ruleSequence: context.nextSequence,
  type,
  startDate: context.input.planStartDate,
  endDate: context.current.closingDate,
  amount,
  enabled: true,
  strategy,
  source: 'own',
  sameDayOrder: 'regularFirst',
  interestFirst: true,
  skipMonths: [],
  comment: 'Добавлено планировщиком цели'
})

const makeOneTime = (context: PlannerContext, amount: number, strategy: EarlyRepayment['strategy']): EarlyRepayment => ({
  id: 'goal-plan-one-time',
  date: context.input.oneTimeDate,
  amount,
  enabled: true,
  amountMode: 'extra',
  sameDaySequence: context.nextSequence + 1,
  operationSource: 'manual',
  strategy,
  source: 'own',
  sameDayOrder: 'regularFirst',
  interestFirst: true,
  comment: 'Добавлено планировщиком цели'
})

const evaluateOperations = (context: PlannerContext, operations: GoalPlanOperations): EvaluatedPlan => {
  const generated = expandRepaymentRules(context.input.config, operations.repaymentRules, context.input.gracePeriods, context.calendar)
  const plannerRepayments = [...operations.repayments, ...generated]
  const allRepayments = sortRepaymentsByApplicationOrder([...context.existingRepayments, ...plannerRepayments])
  const errors = validateScenario(context.input.config, allRepayments, context.input.gracePeriods)
  if (errors.length) throw new Error(errors.join(' · '))
  return {
    schedule: generateBaseSchedule(context.input.config, {
      earlyRepayments: allRepayments,
      gracePeriods: context.input.gracePeriods,
      paymentCalendar: context.calendar,
      scenarioAlreadyValidated: true
    }),
    plannerRepaymentIds: new Set(plannerRepayments.map(item => item.id))
  }
}

const toCents = (value: number) => Math.max(0, Math.round(value * 100))
const fromCents = (value: number) => value / 100

const searchMinimum = (
  context: PlannerContext,
  operationsAt: (amount: number) => GoalPlanOperations,
  predicate: (schedule: PaymentScheduleItem[]) => boolean
): SearchResult | null => {
  const cache = new Map<number, EvaluatedPlan>()
  const failed = new Set<number>()
  const evaluate = (cents: number) => {
    const normalized = Math.max(0, cents)
    const cached = cache.get(normalized)
    if (cached) return cached
    if (failed.has(normalized)) return null
    try {
      const evaluated = evaluateOperations(context, operationsAt(fromCents(normalized)))
      cache.set(normalized, evaluated)
      return evaluated
    } catch {
      failed.add(normalized)
      return null
    }
  }
  const satisfies = (cents: number) => {
    const evaluated = evaluate(cents)
    return evaluated ? predicate(evaluated.schedule) : false
  }
  const zero = evaluate(0)
  if (zero && predicate(zero.schedule)) return { amount: 0, evaluated: zero, boundaryVerified: true }

  const maxCents = toCents(context.maxSearchAmount)
  let low = 0
  let high = Math.min(100, maxCents)
  while (high < maxCents && !satisfies(high)) {
    low = high
    high = Math.min(maxCents, high * 2)
  }
  if (!satisfies(high)) return null

  while (low + 1 < high) {
    const middle = low + Math.floor((high - low) / 2)
    if (satisfies(middle)) high = middle
    else low = middle
  }
  const evaluated = evaluate(high)
  if (!evaluated) return null
  const boundaryVerified = predicate(evaluated.schedule) && (high === 0 || !satisfies(high - 1))
  if (!boundaryVerified) throw new Error('Не удалось подтвердить минимальную сумму с точностью до копейки')
  return { amount: fromCents(high), evaluated, boundaryVerified }
}

const targetDateFor = (context: PlannerContext) => {
  const { goal } = context.input
  if (goal.type === 'targetDate') return goal.targetDate
  if (goal.type === 'monthsEarlier') return format(subMonths(parseISO(context.current.closingDate), goal.months), 'yyyy-MM-dd')
  return undefined
}

const overpaymentFor = (schedule: PaymentScheduleItem[], principal: number) =>
  money(Decimal.max(0, new Decimal(sumRows(schedule, 'cashFlowTotal')).minus(principal)))

const maxRegularTransfer = (schedule: PaymentScheduleItem[], startDate: string) =>
  Math.max(0, ...schedule.filter(row => row.isRegularPayment && row.date >= startDate).map(row => row.cashFlowTotal))

const infeasibleVariant = (kind: GoalPlanVariantKind, reason: string): GoalPlanVariant => ({
  kind,
  title: variantTitles[kind],
  status: 'infeasible',
  reason,
  boundaryVerified: false,
  operations: { repayments: [], repaymentRules: [] }
})

const achievedVariant = (
  context: PlannerContext,
  kind: GoalPlanVariantKind,
  operations: GoalPlanOperations,
  evaluated: EvaluatedPlan,
  boundaryVerified: boolean,
  amounts: Pick<GoalPlanVariant, 'monthlyExtra' | 'totalMonthlyPayment' | 'oneTimePayment'>
): GoalPlanVariant => ({
  kind,
  title: variantTitles[kind],
  status: 'achieved',
  boundaryVerified,
  operations,
  ...amounts,
  summary: scheduleSummary(evaluated.schedule, context.input.config.principal, context.current, evaluated.plannerRepaymentIds)
})

const searchVariant = (
  context: PlannerContext,
  kind: GoalPlanVariantKind,
  operationsAt: (amount: number) => GoalPlanOperations,
  predicate: (schedule: PaymentScheduleItem[]) => boolean,
  amountField: 'monthlyExtra' | 'totalMonthlyPayment' | 'oneTimePayment'
) => {
  try {
    const result = searchMinimum(context, operationsAt, predicate)
    if (!result) return infeasibleVariant(kind, 'Цель недостижима в допустимом диапазоне сумм')
    const operations = operationsAt(result.amount)
    return achievedVariant(context, kind, operations, result.evaluated, result.boundaryVerified, { [amountField]: result.amount })
  } catch (error) {
    return infeasibleVariant(kind, error instanceof Error ? error.message : 'Не удалось рассчитать вариант')
  }
}

const planTargetGoal = (context: PlannerContext, predicate: (schedule: PaymentScheduleItem[]) => boolean, targetDate?: string) => {
  const monthlyStartTooLate = Boolean(targetDate && context.input.planStartDate > targetDate)
  const oneTimeTooLate = Boolean(targetDate && context.input.oneTimeDate > targetDate)
  const monthlyExtra = monthlyStartTooLate
    ? infeasibleVariant('monthlyExtra', 'Дата начала ежемесячных платежей позже целевой даты')
    : searchVariant(context, 'monthlyExtra', amount => ({ repayments: [], repaymentRules: amount > 0 ? [makeRule(context, 'monthlyFixed', amount, 'reduceTerm')] : [] }), predicate, 'monthlyExtra')
  const monthlyTotalPayment = monthlyStartTooLate
    ? infeasibleVariant('monthlyTotalPayment', 'Дата начала общего платежа позже целевой даты')
    : searchVariant(context, 'monthlyTotalPayment', amount => ({ repayments: [], repaymentRules: amount > 0 ? [makeRule(context, 'monthlyTotalPayment', amount, 'reduceTerm')] : [] }), predicate, 'totalMonthlyPayment')
  const oneTime = oneTimeTooLate
    ? infeasibleVariant('oneTime', 'Дата разового взноса позже целевой даты')
    : searchVariant(context, 'oneTime', amount => ({ repayments: amount > 0 ? [makeOneTime(context, amount, 'reduceTerm')] : [], repaymentRules: [] }), predicate, 'oneTimePayment')
  const combined = context.input.availableNow <= 0
    ? infeasibleVariant('combined', 'Укажите сумму, доступную для разового взноса')
    : monthlyStartTooLate || oneTimeTooLate
      ? infeasibleVariant('combined', 'Дата одной из операций позже целевой даты')
      : searchVariant(context, 'combined', amount => ({
        repayments: [makeOneTime(context, context.input.availableNow, 'reduceTerm')],
        repaymentRules: amount > 0 ? [makeRule(context, 'monthlyFixed', amount, 'reduceTerm')] : []
      }), predicate, 'monthlyExtra')
  if (combined.status === 'achieved') combined.oneTimePayment = context.input.availableNow
  return [monthlyExtra, monthlyTotalPayment, oneTime, combined]
}

const planBudgetGoal = (context: PlannerContext, budget: number) => {
  const predicate = (schedule: PaymentScheduleItem[]) => maxRegularTransfer(schedule, context.input.planStartDate) <= budget
  const monthlyOperations: GoalPlanOperations = {
    repayments: [],
    repaymentRules: budget > 0 ? [makeRule(context, 'monthlyTotalPayment', budget, 'reduceTerm')] : []
  }
  let monthly: GoalPlanVariant
  try {
    const evaluated = evaluateOperations(context, monthlyOperations)
    monthly = predicate(evaluated.schedule)
      ? achievedVariant(context, 'monthlyTotalPayment', monthlyOperations, evaluated, true, { totalMonthlyPayment: budget })
      : infeasibleVariant('monthlyTotalPayment', 'Обязательные или уже запланированные платежи превышают бюджет')
  } catch (error) {
    monthly = infeasibleVariant('monthlyTotalPayment', error instanceof Error ? error.message : 'Не удалось применить ежемесячный бюджет')
  }
  const oneTime = searchVariant(context, 'oneTime', amount => ({
    repayments: amount > 0 ? [makeOneTime(context, amount, 'reducePayment')] : [],
    repaymentRules: []
  }), predicate, 'oneTimePayment')
  let combined = infeasibleVariant('combined', 'Укажите сумму, доступную для разового взноса')
  if (context.input.availableNow > 0) {
    const operations: GoalPlanOperations = {
      repayments: [makeOneTime(context, context.input.availableNow, 'reducePayment')],
      repaymentRules: budget > 0 ? [makeRule(context, 'monthlyTotalPayment', budget, 'reduceTerm')] : []
    }
    try {
      const evaluated = evaluateOperations(context, operations)
      combined = predicate(evaluated.schedule)
        ? achievedVariant(context, 'combined', operations, evaluated, true, { oneTimePayment: context.input.availableNow, totalMonthlyPayment: budget })
        : infeasibleVariant('combined', 'Даже комбинированный план превышает заданный бюджет')
    } catch (error) {
      combined = infeasibleVariant('combined', error instanceof Error ? error.message : 'Не удалось рассчитать комбинированный вариант')
    }
  }
  return [infeasibleVariant('monthlyExtra', 'Для ограничения бюджета используется общий ежемесячный платёж'), monthly, oneTime, combined]
}

export function buildGoalPlans(input: GoalPlannerInput): GoalPlannerResult {
  const context = prepareContext(input)
  const current = scheduleSummary(context.current.schedule, input.config.principal, null)
  const targetDate = targetDateFor(context)
  const goal = input.goal

  if (targetDate && targetDate >= context.current.closingDate) {
    return { status: 'alreadyAchieved', targetDate, message: 'Текущий план уже закрывает кредит не позже целевой даты', current, variants: [] }
  }
  if (goal.type === 'maxOverpayment' && context.current.overpayment <= goal.amount) {
    return { status: 'alreadyAchieved', targetOverpayment: goal.amount, message: 'Текущая переплата уже не превышает цель', current, variants: [] }
  }

  let variants: GoalPlanVariant[]
  if (targetDate) {
    variants = planTargetGoal(context, schedule => (schedule.at(-1)?.date ?? input.config.issueDate) <= targetDate, targetDate)
  } else if (goal.type === 'maxOverpayment') {
    variants = planTargetGoal(context, schedule => overpaymentFor(schedule, input.config.principal) <= goal.amount)
  } else if (goal.type === 'monthlyBudget') {
    variants = planBudgetGoal(context, goal.amount)
  } else {
    throw new Error('Не удалось определить цель планировщика')
  }
  const feasible = variants.some(item => item.status === 'achieved')
  return {
    status: feasible ? 'planned' : 'infeasible',
    targetDate,
    targetOverpayment: goal.type === 'maxOverpayment' ? goal.amount : undefined,
    monthlyBudget: goal.type === 'monthlyBudget' ? goal.amount : undefined,
    message: feasible ? undefined : 'Не найдено ни одного выполнимого варианта',
    current,
    variants
  }
}

export function buildGoalPlanPreview(input: GoalPlannerInput, operations: GoalPlanOperations): GoalPlanPreview {
  const context = prepareContext(input)
  const generated = expandRepaymentRules(input.config, operations.repaymentRules, input.gracePeriods, context.calendar)
  const repayments = sortRepaymentsByApplicationOrder([...context.existingRepayments, ...operations.repayments, ...generated])
  const errors = validateScenario(input.config, repayments, input.gracePeriods)
  if (errors.length) throw new Error(errors.join(' · '))
  const comparison = compareScenarios(input.config, repayments, input.gracePeriods, context.calendar, { scenarioAlreadyValidated: true })
  const planned = comparison.scenarios.find(item => item.id === 'combined') ?? comparison.scenarios[0]
  return { current: context.current, planned }
}
