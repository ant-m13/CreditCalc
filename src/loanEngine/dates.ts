import { addDays, addMonths, format, getDaysInMonth, parseISO } from 'date-fns'
import { MAX_SCHEDULE_ROWS } from './limits'
import type { GracePeriod, LoanConfig } from './types'

export const iso = (date: Date) => format(date, 'yyyy-MM-dd')

export interface PreparedPaymentCalendar {
  dates: string[]
  extendedPeriods: number
}

export function nextPaymentDate(date: string, config: LoanConfig) {
  const parsed = parseISO(date)
  if (config.frequency === 'biweekly') return iso(addDays(parsed, 14))
  const offset = config.frequency === 'quarterly' ? 3 : 1
  const target = addMonths(parsed, offset)
  return iso(new Date(target.getFullYear(), target.getMonth(), Math.min(config.paymentDay, getDaysInMonth(target))))
}

export function isRegularPaymentDate(date: string, config: LoanConfig, maxSteps = 10000) {
  return regularPaymentDateMatches([date], config, maxSteps).has(date)
}

export function regularPaymentDateMatches(dates: Iterable<string>, config: LoanConfig, maxSteps = MAX_SCHEDULE_ROWS) {
  const targets = new Set([...dates].filter(date => date >= config.firstPaymentDate))
  const matches = new Set<string>()
  if (targets.size === 0) return matches
  const lastTarget = [...targets].sort().at(-1)!
  let cursor = config.firstPaymentDate
  for (let step = 0; step < maxSteps && cursor <= lastTarget; step += 1) {
    if (targets.has(cursor)) matches.add(cursor)
    cursor = nextPaymentDate(cursor, config)
  }
  return matches
}

export const totalPaymentPeriods = (config: LoanConfig) =>
  config.frequency === 'biweekly'
    ? Math.max(1, Math.round(config.termMonths * 26 / 12))
    : config.frequency === 'quarterly'
      ? Math.max(1, Math.round(config.termMonths / 3))
      : config.termMonths

const extendingIntervals = (gracePeriods: GracePeriod[]) =>
  gracePeriods
    .filter(period => period.extendTerm)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate))

export const preparePaymentCalendar = (config: LoanConfig, gracePeriods: GracePeriod[] = []): PreparedPaymentCalendar => {
  const configuredPeriods = totalPaymentPeriods(config)
  const intervals = extendingIntervals(gracePeriods)
  const dates: string[] = []
  let remainingContractualPayments = configuredPeriods
  let cursor = config.firstPaymentDate
  let intervalIndex = 0
  let isFirstPaymentDate = true
  const isExtendingGraceDate = (date: string) => {
    while (intervalIndex < intervals.length && intervals[intervalIndex].endDate < date) intervalIndex += 1
    const interval = intervals[intervalIndex]
    return Boolean(interval && interval.startDate <= date && date <= interval.endDate)
  }

  while (remainingContractualPayments > 0) {
    if (dates.length >= MAX_SCHEDULE_ROWS) {
      throw new Error(`Календарь платежей не помещается в допустимое количество строк (${MAX_SCHEDULE_ROWS})`)
    }
    dates.push(cursor)
    const isInterestOnlyStub = isFirstPaymentDate && config.firstPaymentInterestOnly
    if (!isInterestOnlyStub && !isExtendingGraceDate(cursor)) remainingContractualPayments -= 1
    isFirstPaymentDate = false
    cursor = nextPaymentDate(cursor, config)
  }
  return { dates, extendedPeriods: dates.length - configuredPeriods }
}

export const extendedPaymentPeriods = (config: LoanConfig, gracePeriods: GracePeriod[], calendar?: PreparedPaymentCalendar) =>
  (calendar ?? preparePaymentCalendar(config, gracePeriods)).extendedPeriods

export const scheduledPaymentDates = (config: LoanConfig, gracePeriods: GracePeriod[] = [], calendar?: PreparedPaymentCalendar) =>
  (calendar ?? preparePaymentCalendar(config, gracePeriods)).dates

export const contractualFinalPaymentDate = (config: LoanConfig, gracePeriods: GracePeriod[] = [], calendar?: PreparedPaymentCalendar) =>
  scheduledPaymentDates(config, gracePeriods, calendar).at(-1) ?? config.firstPaymentDate
