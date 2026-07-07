import { differenceInCalendarDays, differenceInCalendarMonths, parseISO } from 'date-fns'
import { preparePaymentCalendar, type PreparedPaymentCalendar } from './dates'
import { generateBaseSchedule } from './generateBaseSchedule'
import type { ComparisonResult, EarlyRepayment, GracePeriod, LoanConfig, PaymentScheduleItem, RepaymentStrategy, ScenarioResult } from './types'
import { validateScenario } from './validation'
import { periodDays } from './calculateInterest'

const isIgnoredOnlyRow = (row: PaymentScheduleItem) => row.eventTypes.length > 0 && row.eventTypes.every(type => type === 'earlyIgnored')
const isDebtClosedRow = (row: PaymentScheduleItem) => row.closingBalance === 0 && (row.deferredInterestClosing ?? 0) === 0
const financialClosingRow = (schedule: PaymentScheduleItem[]) => [...schedule].reverse().find(row => isDebtClosedRow(row) && !isIgnoredOnlyRow(row))

function toResult(id: string, name: string, strategy: ScenarioResult['strategy'], schedule: ReturnType<typeof generateBaseSchedule>, config: LoanConfig, base?: ScenarioResult): ScenarioResult {
  const last = schedule.at(-1)
  const closingRow = financialClosingRow(schedule) ?? last
  const totalInterest = schedule.reduce((s, x) => s + x.interest, 0)
  const totalPaid = schedule.reduce((s, x) => s + (x.cashFlowTotal ?? x.payment + x.earlyPayment + x.fee), 0)
  const closingDate = closingRow?.date ?? config.issueDate
  let recalculationIndex = -1
  schedule.forEach((row, index) => { if (row.paymentRecalculated) recalculationIndex = index })
  const isRegularPayment = (row: (typeof schedule)[number]) => row.isRegularPayment
  const paymentAfterRecalculation = recalculationIndex >= 0 ? schedule.slice(recalculationIndex + 1).find(isRegularPayment)?.payment : undefined
  const closedByEarlyRepayment = Boolean(closingRow && isDebtClosedRow(closingRow) && (closingRow.earlyPayment > 0 || closingRow.fullyClosedByEarlyRepayment))
  const monthlyPayment = closedByEarlyRepayment ? 0 : paymentAfterRecalculation ?? schedule.find(isRegularPayment)?.payment ?? schedule.find(x => x.payment > 0)?.payment ?? 0
  const termMonths = Math.max(0, differenceInCalendarMonths(parseISO(closingDate), parseISO(config.issueDate)))
  const termDays = Math.max(0, differenceInCalendarDays(parseISO(closingDate), parseISO(config.issueDate)))
  return {
    id,
    name,
    strategy,
    schedule,
    monthlyPayment,
    totalPaid,
    totalInterest,
    overpayment: Math.max(0, totalPaid - config.principal),
    closingDate,
    termMonths,
    termDays,
    interestSavings: base ? base.totalInterest - totalInterest : 0,
    monthsSaved: base ? Math.max(0, differenceInCalendarMonths(parseISO(base.closingDate), parseISO(closingDate))) : 0,
    daysSaved: base ? Math.max(0, differenceInCalendarDays(parseISO(base.closingDate), parseISO(closingDate))) : 0
  }
}

function addCumulativeSavings(schedule: ReturnType<typeof generateBaseSchedule>, baseSchedule: ReturnType<typeof generateBaseSchedule>) {
  const baseInterestAt = (date: string) => {
    let previous = baseSchedule[0]
    for (const row of baseSchedule) {
      if (row.date === date) return row.cumulativeInterest
      if (row.date > date) {
        if (!previous || !row.audit) return previous?.cumulativeInterest ?? 0
        const accruedInsideRow = row.audit.interestSegments.reduce((sum, segment) => {
          if (date < segment.from) return sum
          const segmentEnd = date < segment.to ? date : segment.to
          const elapsedDays = Math.min(segment.days, periodDays(segment.from, segmentEnd, true, false))
          return sum + (segment.days > 0 ? segment.rawInterest * elapsedDays / segment.days : 0)
        }, 0)
        return Math.max(previous.cumulativeInterest, previous.cumulativeInterest + accruedInsideRow)
      }
      previous = row
    }
    return baseSchedule.at(-1)?.cumulativeInterest ?? 0
  }
  return schedule.map(row => {
    return { ...row, cumulativeSavings: Math.max(0, baseInterestAt(row.date) - row.cumulativeInterest) }
  })
}

export function compareScenarios(config: LoanConfig, repayments: EarlyRepayment[], gracePeriods: GracePeriod[] = [], preparedCalendar?: PreparedPaymentCalendar): ComparisonResult {
  const validationErrors = validateScenario(config, repayments, gracePeriods)
  if (validationErrors.length > 0) throw new Error(validationErrors.join(' · '))
  const paymentCalendar = preparedCalendar ?? preparePaymentCalendar(config, gracePeriods)
  const base = toResult('base', 'Без досрочных', 'base', generateBaseSchedule(config, { gracePeriods, paymentCalendar }), config)
  const make = (strategy: RepaymentStrategy, name: string) => {
    const mapped = repayments.map(r => ({ ...r, strategy }))
    const schedule = addCumulativeSavings(generateBaseSchedule(config, { earlyRepayments: mapped, gracePeriods, forcedStrategy: strategy, paymentCalendar }), base.schedule)
    return toResult(strategy, name, strategy, schedule, config, base)
  }
  const term = make('reduceTerm', 'Сократить срок')
  const payment = make('reducePayment', 'Снизить платёж')
  const combinedSchedule = addCumulativeSavings(generateBaseSchedule(config, { earlyRepayments: repayments, gracePeriods, paymentCalendar }), base.schedule)
  const combined = toResult('combined', 'По операциям', 'combined', combinedSchedule, config, base)
  const scenarios = [base, term, payment, combined]
  return {
    scenarios,
    bestSavings: [...scenarios].sort((a, b) => b.interestSavings - a.interestSavings)[0],
    fastest: [...scenarios].sort((a, b) => a.termDays - b.termDays || a.closingDate.localeCompare(b.closingDate))[0],
    lowestPayment: [...scenarios].filter(s => s.id !== 'base').sort((a, b) => a.monthlyPayment - b.monthlyPayment)[0]
  }
}
