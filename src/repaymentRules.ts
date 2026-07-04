import { addMonths, addWeeks, addYears, format, parseISO } from 'date-fns'
import { generateBaseSchedule, type EarlyRepayment, type LoanConfig } from './loanEngine'
import { MAX_GENERATED_REPAYMENTS } from './loanEngine/limits'
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

const pushRuleRepayment = (result: EarlyRepayment[], rule: RepaymentRule, date: string, amount: number) => {
  result.push({
    id: `rule-${rule.id}-${date}`,
    date,
    amount,
    amountMode: rule.type === 'monthlyTotalPayment' ? 'total' : 'extra',
    strategy: rule.strategy,
    source: rule.source,
    sameDayOrder: rule.type === 'monthlyTotalPayment' ? 'regularFirst' : rule.sameDayOrder,
    interestFirst: rule.interestFirst,
    comment: rule.comment || rule.name
  })
  if (result.length > MAX_GENERATED_REPAYMENTS) throw new Error(`Правила создают слишком много досрочных операций. Максимум: ${MAX_GENERATED_REPAYMENTS}`)
}

export function expandRepaymentRules(config: LoanConfig, rules: RepaymentRule[]): EarlyRepayment[] {
  if (rules.length === 0) return []
  let regularPayment: number | null = null
  let schedule: ReturnType<typeof generateBaseSchedule> | null = null
  const baseSchedule = () => {
    schedule ??= generateBaseSchedule(config)
    return schedule
  }
  const getRegularPayment = () => {
    regularPayment ??= firstRegularPayment(config)
    return regularPayment
  }
  const result: EarlyRepayment[] = []
  for (const rule of rules) {
    if (!isISODate(rule.startDate) || !isISODate(rule.endDate)) throw new Error(`Правило «${rule.name}» содержит некорректные даты`)
    if (!rule.skipMonths.every(isISOYearMonth)) throw new Error(`Правило «${rule.name}» содержит некорректный месяц пропуска`)
    if (rule.enabled === false) continue
    const amount = ruleAmount(rule, getRegularPayment, config)
    if (amount <= 0 || rule.startDate > rule.endDate) continue
    if (rule.type === 'monthlyTotalPayment') {
      for (const row of baseSchedule()) {
        if (!row.isRegularPayment || row.date < rule.startDate || row.date > rule.endDate) continue
        if (rule.skipMonths.includes(row.date.slice(0, 7))) continue
        pushRuleRepayment(result, rule, row.date, amount)
      }
      continue
    }
    const startDate = parseISO(rule.startDate)
    let guard = 0
    let cursor = startDate
    while (format(cursor, 'yyyy-MM-dd') <= rule.endDate) {
      const date = format(cursor, 'yyyy-MM-dd')
      const month = date.slice(0, 7)
      if (!rule.skipMonths.includes(month)) {
        pushRuleRepayment(result, rule, date, amount)
      }
      guard += 1
      cursor = nextRuleDate(startDate, rule.type, guard)
      if (guard > 1200) throw new Error('Правило досрочных платежей создаёт слишком много операций')
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
}
