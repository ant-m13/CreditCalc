import { addMonths, addYears, format, parseISO } from 'date-fns'
import { generateBaseSchedule, type EarlyRepayment, type LoanConfig } from './loanEngine'
import { MAX_GENERATED_REPAYMENTS } from './loanEngine/limits'
import { num } from './loanEngine/rounding'
import { isISODate, isISOYearMonth } from './utils/dateValidation'

export type RepaymentRuleType = 'monthlyFixed' | 'annualBonus' | 'paymentPercent'

export interface RepaymentRule {
  id: string
  name: string
  type: RepaymentRuleType
  startDate: string
  endDate: string
  amount?: number
  percent?: number
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

const ruleAmount = (rule: RepaymentRule, regularPayment: number, config: LoanConfig) => {
  if (rule.type === 'paymentPercent') return num(regularPayment * Math.max(0, rule.percent ?? 0) / 100, config.rounding)
  return num(rule.amount ?? 0, config.rounding)
}

export function expandRepaymentRules(config: LoanConfig, rules: RepaymentRule[]): EarlyRepayment[] {
  const regularPayment = firstRegularPayment(config)
  const result: EarlyRepayment[] = []
  for (const rule of rules) {
    if (!isISODate(rule.startDate) || !isISODate(rule.endDate)) throw new Error(`Правило «${rule.name}» содержит некорректные даты`)
    if (!rule.skipMonths.every(isISOYearMonth)) throw new Error(`Правило «${rule.name}» содержит некорректный месяц пропуска`)
    const amount = ruleAmount(rule, regularPayment, config)
    if (amount <= 0 || rule.startDate > rule.endDate) continue
    const startDate = parseISO(rule.startDate)
    let guard = 0
    let cursor = startDate
    while (format(cursor, 'yyyy-MM-dd') <= rule.endDate) {
      const date = format(cursor, 'yyyy-MM-dd')
      const month = date.slice(0, 7)
      if (!rule.skipMonths.includes(month)) {
        result.push({
          id: `rule-${rule.id}-${date}`,
          date,
          amount,
          amountMode: 'extra',
          strategy: rule.strategy,
          source: rule.source,
          sameDayOrder: rule.sameDayOrder,
          interestFirst: rule.interestFirst,
          comment: rule.comment || rule.name
        })
        if (result.length > MAX_GENERATED_REPAYMENTS) throw new Error(`Правила создают слишком много досрочных операций. Максимум: ${MAX_GENERATED_REPAYMENTS}`)
      }
      guard += 1
      cursor = rule.type === 'annualBonus' ? addYears(startDate, guard) : addMonths(startDate, guard)
      if (guard > 1200) throw new Error('Правило досрочных платежей создаёт слишком много операций')
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
}
