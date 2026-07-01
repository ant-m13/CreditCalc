import { differenceInCalendarMonths, parseISO } from 'date-fns'
import { generateBaseSchedule } from './generateBaseSchedule'
import type { ComparisonResult, EarlyRepayment, GracePeriod, LoanConfig, RepaymentStrategy, ScenarioResult } from './types'

function toResult(id: string, name: string, strategy: ScenarioResult['strategy'], schedule: ReturnType<typeof generateBaseSchedule>, config: LoanConfig, base?: ScenarioResult): ScenarioResult {
  const last = schedule.at(-1)
  const totalInterest = schedule.reduce((s, x) => s + x.interest, 0)
  const totalPaid = schedule.reduce((s, x) => s + (x.cashFlowTotal ?? x.payment + x.earlyPayment + x.fee), 0)
  const closingDate = last?.date ?? config.issueDate
  let recalculationIndex = -1
  schedule.forEach((row, index) => { if (row.event.includes('уменьшение платежа')) recalculationIndex = index })
  const isRegularPayment = (row: (typeof schedule)[number]) => row.payment > 0 && !row.event.includes('Первый платёж · только проценты') && !row.event.includes('Льготный период')
  const paymentAfterRecalculation = recalculationIndex >= 0 ? schedule.slice(recalculationIndex + 1).find(isRegularPayment)?.payment : undefined
  const monthlyPayment = paymentAfterRecalculation ?? schedule.find(isRegularPayment)?.payment ?? schedule.find(x => x.payment > 0)?.payment ?? 0
  const termMonths = Math.max(0, differenceInCalendarMonths(parseISO(closingDate), parseISO(config.issueDate)))
  return { id, name, strategy, schedule, monthlyPayment, totalPaid, totalInterest, overpayment: Math.max(0, totalPaid - config.principal), closingDate, termMonths, interestSavings: base ? base.totalInterest - totalInterest : 0, monthsSaved: base ? Math.max(0, differenceInCalendarMonths(parseISO(base.closingDate), parseISO(closingDate))) : 0 }
}

function addCumulativeSavings(schedule: ReturnType<typeof generateBaseSchedule>, baseSchedule: ReturnType<typeof generateBaseSchedule>) {
  const baseByDate = new Map(baseSchedule.map(row => [row.date, row.cumulativeInterest]))
  let lastBaseInterest = 0
  return schedule.map(row => {
    lastBaseInterest = baseByDate.get(row.date) ?? lastBaseInterest
    return { ...row, cumulativeSavings: Math.max(0, lastBaseInterest - row.cumulativeInterest) }
  })
}

export function compareScenarios(config: LoanConfig, repayments: EarlyRepayment[], gracePeriods: GracePeriod[] = []): ComparisonResult {
  const base = toResult('base', 'Без досрочных', 'base', generateBaseSchedule(config, { gracePeriods }), config)
  const make = (strategy: RepaymentStrategy, name: string) => {
    const mapped = repayments.map(r => ({ ...r, strategy }))
    const schedule = addCumulativeSavings(generateBaseSchedule(config, { earlyRepayments: mapped, gracePeriods, forcedStrategy: strategy }), base.schedule)
    return toResult(strategy, name, strategy, schedule, config, base)
  }
  const term = make('reduceTerm', 'Сократить срок')
  const payment = make('reducePayment', 'Снизить платёж')
  const combinedSchedule = addCumulativeSavings(generateBaseSchedule(config, { earlyRepayments: repayments, gracePeriods }), base.schedule)
  const combined = toResult('combined', 'Комбинированный', 'combined', combinedSchedule, config, base)
  const scenarios = [base, term, payment, combined]
  return {
    scenarios,
    bestSavings: [...scenarios].sort((a, b) => b.interestSavings - a.interestSavings)[0],
    fastest: [...scenarios].sort((a, b) => a.termMonths - b.termMonths)[0],
    lowestPayment: [...scenarios].filter(s => s.id !== 'base').sort((a, b) => a.monthlyPayment - b.monthlyPayment)[0]
  }
}
