import { addMonths, addWeeks, addYears, format, parseISO } from 'date-fns'
import { generateBaseSchedule, scheduledPaymentDates, sortRepaymentsByApplicationOrder, type EarlyRepayment, type GracePeriod, type LoanConfig, type PreparedPaymentCalendar } from './loanEngine'
import { MAX_GENERATED_REPAYMENTS, MAX_RULE_SKIP_MONTHS, MAX_TEXT_FIELD_LENGTH } from './loanEngine/limits'
import { num } from './loanEngine/rounding'
import { isISODate, isISOYearMonth } from './utils/dateValidation'

export type RepaymentRuleType =
  | 'weeklyFixed'
  | 'monthlyFixed'
  | 'bimonthlyFixed'
  | 'quarterlyFixed'
  | 'semiannualFixed'
  | 'annualFixed'
  | 'annualBonus'
  | 'paymentPercent'
  | 'monthlyTotalPayment'

export interface RepaymentRule {
  id: string
  name: string
  ruleSequence?: number
  type: RepaymentRuleType
  startDate: string
  endDate: string
  amount?: number
  percent?: number
  enabled?: boolean
  strategy: EarlyRepayment['strategy']
  source: EarlyRepayment['source']
  sameDayOrder: EarlyRepayment['sameDayOrder']
  interestFirst: boolean
  skipMonths: string[]
  comment?: string
}

const repaymentRuleTypes: readonly RepaymentRuleType[] = ['weeklyFixed', 'monthlyFixed', 'bimonthlyFixed', 'quarterlyFixed', 'semiannualFixed', 'annualFixed', 'annualBonus', 'paymentPercent', 'monthlyTotalPayment']
const repaymentStrategies = ['reduceTerm', 'reducePayment', 'full', 'custom'] as const
const repaymentSources = ['own', 'subsidy', 'insurance', 'other'] as const
const sameDayOrders = ['regularFirst', 'earlyFirst'] as const

const isOneOf = <T extends string>(value: unknown, values: readonly T[]): value is T =>
  typeof value === 'string' && values.includes(value as T)

export const validateRepaymentRuleStructure = (rule: RepaymentRule): string[] => {
  const errors: string[] = []
  const title = typeof rule.name === 'string' && rule.name.trim() ? `«${rule.name.trim().slice(0, MAX_TEXT_FIELD_LENGTH)}»` : 'без названия'
  const label = `Правило досрочных платежей ${title}`
  const type = isOneOf(rule.type, repaymentRuleTypes) ? rule.type : null

  if (typeof rule.id !== 'string' || !rule.id.trim()) errors.push(`${label}: ID повреждён`)
  if (typeof rule.name !== 'string' || !rule.name.trim()) errors.push(`${label}: название обязательно`)
  if (typeof rule.name === 'string' && rule.name.length > MAX_TEXT_FIELD_LENGTH) errors.push(`${label}: название слишком длинное`)
  if (!type) errors.push(`${label}: тип повреждён`)
  if (!isISODate(rule.startDate)) errors.push(`${label}: дата начала должна быть корректной`)
  if (!isISODate(rule.endDate)) errors.push(`${label}: дата окончания должна быть корректной`)
  if (isISODate(rule.startDate) && isISODate(rule.endDate) && rule.endDate < rule.startDate) errors.push(`${label}: окончание раньше начала`)
  if (rule.ruleSequence !== undefined && (!Number.isInteger(rule.ruleSequence) || rule.ruleSequence < 0)) errors.push(`${label}: порядок повреждён`)
  if (rule.enabled !== undefined && typeof rule.enabled !== 'boolean') errors.push(`${label}: признак активности повреждён`)
  if (!isOneOf(rule.strategy, repaymentStrategies)) errors.push(`${label}: стратегия повреждена`)
  if (!isOneOf(rule.source, repaymentSources)) errors.push(`${label}: источник повреждён`)
  if (!isOneOf(rule.sameDayOrder, sameDayOrders)) errors.push(`${label}: порядок в дату платежа повреждён`)
  if (typeof rule.interestFirst !== 'boolean') errors.push(`${label}: правило погашения процентов повреждено`)
  if (!Array.isArray(rule.skipMonths)) {
    errors.push(`${label}: месяцы пропуска повреждены`)
  } else {
    if (rule.skipMonths.length > MAX_RULE_SKIP_MONTHS) errors.push(`${label}: слишком много месяцев пропуска. Максимум: ${MAX_RULE_SKIP_MONTHS}`)
    if (!rule.skipMonths.every(isISOYearMonth)) errors.push(`${label}: месяц пропуска должен быть корректным`)
  }
  if (rule.comment !== undefined && typeof rule.comment !== 'string') errors.push(`${label}: комментарий повреждён`)
  if (typeof rule.comment === 'string' && rule.comment.length > MAX_TEXT_FIELD_LENGTH) errors.push(`${label}: комментарий слишком длинный`)

  if (type === 'paymentPercent') {
    if (typeof rule.percent !== 'number' || !Number.isFinite(rule.percent) || rule.percent < 0) errors.push(`${label}: процент должен быть неотрицательным числом`)
  } else if (type && (typeof rule.amount !== 'number' || !Number.isFinite(rule.amount) || rule.amount < 0)) {
    errors.push(`${label}: сумма должна быть неотрицательным числом`)
  }

  if (rule.amount !== undefined && (typeof rule.amount !== 'number' || !Number.isFinite(rule.amount) || rule.amount < 0)) errors.push(`${label}: сумма повреждена`)
  if (rule.percent !== undefined && (typeof rule.percent !== 'number' || !Number.isFinite(rule.percent) || rule.percent < 0)) errors.push(`${label}: процент повреждён`)

  return [...new Set(errors)]
}

const firstRegularPayment = (config: LoanConfig) => {
  const row = generateBaseSchedule(config).find(item => item.isRegularPayment)
  return row?.payment ?? 0
}

const ruleAmount = (rule: RepaymentRule, regularPayment: () => number, config: LoanConfig) => {
  if (rule.type === 'paymentPercent') return num(regularPayment() * Math.max(0, rule.percent ?? 0) / 100, config.rounding)
  return num(rule.amount ?? 0, config.rounding)
}

const nextRuleDate = (startDate: Date, type: RepaymentRuleType, guard: number) => {
  if (type === 'weeklyFixed') return addWeeks(startDate, guard)
  if (type === 'bimonthlyFixed') return addMonths(startDate, guard * 2)
  if (type === 'quarterlyFixed') return addMonths(startDate, guard * 3)
  if (type === 'semiannualFixed') return addMonths(startDate, guard * 6)
  if (type === 'annualFixed' || type === 'annualBonus') return addYears(startDate, guard)
  return addMonths(startDate, guard)
}

const ruleSequence = (rule: RepaymentRule, fallback: number) =>
  Number.isFinite(rule.ruleSequence) ? rule.ruleSequence! : fallback

const uniqueSkipMonths = (skipMonths: string[]) => [...new Set(skipMonths)]

export const sortRepaymentRulesByApplicationOrder = (rules: RepaymentRule[]) =>
  rules
    .map((rule, index) => ({ rule, index }))
    .sort((a, b) =>
      ruleSequence(a.rule, a.index) - ruleSequence(b.rule, b.index) ||
      a.index - b.index
    )
    .map(({ rule }) => rule)

const pushRuleRepayment = (result: EarlyRepayment[], rule: RepaymentRule, date: string, amount: number, sequence: number) => {
  result.push({
    id: `rule-${rule.id}-${date}`,
    date,
    amount,
    amountMode: rule.type === 'monthlyTotalPayment' ? 'totalWithFee' : 'extra',
    strategy: rule.strategy,
    source: rule.source,
    sameDayOrder: rule.type === 'monthlyTotalPayment' ? 'regularFirst' : rule.sameDayOrder,
    sameDaySequence: sequence,
    operationSource: 'rule',
    sourceRuleId: rule.id,
    interestFirst: rule.interestFirst,
    comment: rule.comment || rule.name
  })
  if (result.length > MAX_GENERATED_REPAYMENTS) throw new Error(`Правила создают слишком много досрочных операций. Максимум: ${MAX_GENERATED_REPAYMENTS}`)
}

export function expandRepaymentRules(config: LoanConfig, rules: RepaymentRule[], gracePeriods: GracePeriod[] = [], paymentCalendar?: PreparedPaymentCalendar): EarlyRepayment[] {
  if (rules.length === 0) return []
  let regularPayment: number | null = null
  let paymentDates: string[] | null = null
  const getRegularPayment = () => {
    regularPayment ??= firstRegularPayment(config)
    return regularPayment
  }
  const result: EarlyRepayment[] = []
  for (const [index, rule] of sortRepaymentRulesByApplicationOrder(rules).entries()) {
    const sequence = ruleSequence(rule, index)
    if (!isISODate(rule.startDate) || !isISODate(rule.endDate)) throw new Error(`Правило «${rule.name}» содержит некорректные даты`)
    if (rule.skipMonths.length > MAX_RULE_SKIP_MONTHS) throw new Error(`Правило «${rule.name}» содержит слишком много месяцев пропуска. Максимум: ${MAX_RULE_SKIP_MONTHS}`)
    const skipMonths = uniqueSkipMonths(rule.skipMonths)
    if (!skipMonths.every(isISOYearMonth)) throw new Error(`Правило «${rule.name}» содержит некорректный месяц пропуска`)
    const skipMonthSet = new Set(skipMonths)
    if (rule.enabled === false) continue
    const amount = ruleAmount(rule, getRegularPayment, config)
    if (amount <= 0 || rule.startDate > rule.endDate) continue
    if (rule.type === 'monthlyTotalPayment') {
      paymentDates ??= scheduledPaymentDates(config, gracePeriods, paymentCalendar)
      for (const date of paymentDates) {
        if (date < rule.startDate || date > rule.endDate) continue
        if (skipMonthSet.has(date.slice(0, 7))) continue
        pushRuleRepayment(result, rule, date, amount, sequence)
      }
      continue
    }
    const startDate = parseISO(rule.startDate)
    let guard = 0
    let cursor = startDate
    while (format(cursor, 'yyyy-MM-dd') <= rule.endDate) {
      const date = format(cursor, 'yyyy-MM-dd')
      const month = date.slice(0, 7)
      if (!skipMonthSet.has(month)) {
        pushRuleRepayment(result, rule, date, amount, sequence)
      }
      guard += 1
      cursor = nextRuleDate(startDate, rule.type, guard)
      if (guard > MAX_GENERATED_REPAYMENTS) throw new Error(`Правило досрочных платежей создаёт слишком много операций. Максимум: ${MAX_GENERATED_REPAYMENTS}`)
    }
  }
  return sortRepaymentsByApplicationOrder(result)
}
