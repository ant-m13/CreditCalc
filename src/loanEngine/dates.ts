import { addDays, addMonths, format, getDaysInMonth, parseISO } from 'date-fns'
import { MAX_SCHEDULE_ROWS } from './limits'
import type { GracePeriod, LoanConfig } from './types'

export const iso = (date: Date) => format(date, 'yyyy-MM-dd')

export function nextPaymentDate(date: string, config: LoanConfig) {
  const parsed = parseISO(date)
  if (config.frequency === 'biweekly') return iso(addDays(parsed, 14))
  const offset = config.frequency === 'quarterly' ? 3 : 1
  const target = addMonths(parsed, offset)
  return iso(new Date(target.getFullYear(), target.getMonth(), Math.min(config.paymentDay, getDaysInMonth(target))))
}

export function isRegularPaymentDate(date: string, config: LoanConfig, maxSteps = 10000) {
  if (date < config.firstPaymentDate) return false
  let cursor = config.firstPaymentDate
  for (let step = 0; step < maxSteps && cursor <= date; step += 1) {
    if (cursor === date) return true
    cursor = nextPaymentDate(cursor, config)
  }
  return false
}

export const totalPaymentPeriods = (config: LoanConfig) =>
  config.frequency === 'biweekly'
    ? Math.max(1, Math.round(config.termMonths * 26 / 12))
    : config.frequency === 'quarterly'
      ? Math.max(1, Math.round(config.termMonths / 3))
      : config.termMonths

export const extendedPaymentPeriods = (config: LoanConfig, gracePeriods: GracePeriod[]) => {
  const extending = gracePeriods.filter(period => period.extendTerm)
  if (extending.length === 0) return 0
  const configuredPeriods = totalPaymentPeriods(config)
  let finalPeriods = configuredPeriods
  for (let pass = 0; pass < MAX_SCHEDULE_ROWS; pass += 1) {
    let deferredPeriods = 0
    let cursor = config.firstPaymentDate
    for (let index = 0; index < finalPeriods; index += 1) {
      if (extending.some(period => period.startDate <= cursor && cursor <= period.endDate)) deferredPeriods += 1
      cursor = nextPaymentDate(cursor, config)
    }
    const nextFinalPeriods = configuredPeriods + deferredPeriods
    if (nextFinalPeriods === finalPeriods) return deferredPeriods
    finalPeriods = nextFinalPeriods
    if (finalPeriods >= MAX_SCHEDULE_ROWS) break
  }
  return Math.max(0, finalPeriods - configuredPeriods)
}

export const scheduledPaymentDates = (config: LoanConfig, gracePeriods: GracePeriod[] = []) => {
  const periods = totalPaymentPeriods(config) + extendedPaymentPeriods(config, gracePeriods)
  const dates: string[] = []
  let cursor = config.firstPaymentDate
  for (let index = 0; index < periods; index += 1) {
    dates.push(cursor)
    cursor = nextPaymentDate(cursor, config)
  }
  return dates
}
