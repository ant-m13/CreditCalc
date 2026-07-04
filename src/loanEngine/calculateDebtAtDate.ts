import Decimal from 'decimal.js'
import { addDays, parseISO } from 'date-fns'
import { accrueInterestRaw } from './accrual'
import { periodDays } from './calculateInterest'
import { iso, nextPaymentDate } from './dates'
import { createRateTimeline } from './rateChanges'
import { money, num } from './rounding'
import type { GracePeriod, LoanConfig, PaymentScheduleItem } from './types'

export interface DebtAtDate {
  date: string
  principal: number
  interest: number
  total: number
  fromDate: string
}

const fallbackAccrualStart = (date: string, config: LoanConfig) =>
  config.interest.includePaymentDate && config.interest.balanceMoment === 'startOfDay' && config.interest.periodStart !== 'exclusive'
    ? iso(addDays(parseISO(date), 1))
    : date

export function calculateDebtAtDate(
  config: LoanConfig,
  schedule: PaymentScheduleItem[],
  gracePeriods: GracePeriod[] = [],
  targetDate: string
): DebtAtDate {
  if (!schedule.length || targetDate < config.issueDate) {
    return { date: targetDate, principal: 0, interest: 0, total: 0, fromDate: config.issueDate }
  }

  let lastIndex = 0
  for (let index = 0; index < schedule.length; index += 1) {
    if (schedule[index].date > targetDate) break
    lastIndex = index
  }

  const lastRow = schedule[lastIndex]
  const nextRow = schedule[lastIndex + 1]
  const principal = Math.max(0, lastRow.closingBalance)
  const deferredInterest = Math.max(0, lastRow.deferredInterestClosing ?? 0)
  if (principal <= 0 || targetDate <= lastRow.date) {
    const interest = targetDate <= lastRow.date ? deferredInterest : deferredInterest
    return { date: targetDate, principal, interest, total: principal + interest, fromDate: lastRow.date }
  }

  const accrualStart = nextRow?.audit?.periodStart && nextRow.audit.periodStart >= lastRow.date
    ? nextRow.audit.periodStart
    : fallbackAccrualStart(lastRow.date, config)
  if (targetDate < accrualStart) {
    return { date: targetDate, principal, interest: deferredInterest, total: principal + deferredInterest, fromDate: accrualStart }
  }

  const periodStart = nextRow?.audit?.regularPeriodStart ?? nextRow?.audit?.periodStart ?? accrualStart
  const periodEnd = nextRow?.audit?.regularPeriodEnd ?? nextRow?.audit?.periodEnd ?? nextPaymentDate(lastRow.date, config)
  const periodCalendarDays = nextRow?.audit?.regularPeriodDays ?? Math.max(1, periodDays(periodStart, periodEnd, false))
  const includeTargetDate = config.interest.includePaymentDate && config.interest.balanceMoment === 'startOfDay'
  const annualRate = nextRow?.audit?.interestSegments[0]?.annualRate ?? config.annualRate
  const rateTimeline = createRateTimeline(config)
  const exactRateChanges = config.rateChangeMode === 'exactDate' ? rateTimeline.sortedChanges : []
  const accruedInterest = money(
    accrueInterestRaw(config, new Decimal(principal), accrualStart, targetDate, includeTargetDate, periodCalendarDays, gracePeriods, annualRate, exactRateChanges, true),
    config.rounding
  )
  const interest = num(new Decimal(deferredInterest).add(accruedInterest), config.rounding)
  return { date: targetDate, principal, interest, total: principal + interest, fromDate: accrualStart }
}
