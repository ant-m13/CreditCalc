import { addMonths, addYears, format, parseISO } from 'date-fns'
import { generateBaseSchedule, type EarlyRepayment, type LoanConfig } from './loanEngine'

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

const toMoney = (value: number) => Math.round(value * 100) / 100

const firstRegularPayment = (config: LoanConfig) => {
  const row = generateBaseSchedule(config).find(item => item.payment > 0 && !item.event.includes('Первый платёж · только проценты') && !item.event.includes('Льготный период'))
  return row?.payment ?? 0
}

const ruleAmount = (rule: RepaymentRule, regularPayment: number) => {
  if (rule.type === 'paymentPercent') return toMoney(regularPayment * Math.max(0, rule.percent ?? 0) / 100)
  return toMoney(rule.amount ?? 0)
}

export function expandRepaymentRules(config: LoanConfig, rules: RepaymentRule[]): EarlyRepayment[] {
  const regularPayment = firstRegularPayment(config)
  const result: EarlyRepayment[] = []
  for (const rule of rules) {
    const amount = ruleAmount(rule, regularPayment)
    if (amount <= 0 || rule.startDate > rule.endDate) continue
    const step = rule.type === 'annualBonus' ? addYears : addMonths
    let cursor = parseISO(rule.startDate)
    let guard = 0
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
      }
      cursor = step(cursor, 1)
      guard += 1
      if (guard > 1200) throw new Error('Правило досрочных платежей создаёт слишком много операций')
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
}
