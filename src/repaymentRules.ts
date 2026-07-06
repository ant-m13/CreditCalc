import { addMonths, addWeeks, addYears, format, parseISO } from 'date-fns'
import { generateBaseSchedule, scheduledPaymentDates, sortRepaymentsByApplicationOrder, type EarlyRepayment, type GracePeriod, type LoanConfig, type PreparedPaymentCalendar } from './loanEngine'
import { MAX_GENERATED_REPAYMENTS, MAX_RULE_SKIP_MONTHS } from './loanEngine/limits'
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
    amountMode: rule.type === 'monthlyTotalPayment' ? 'total' : 'extra',
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
