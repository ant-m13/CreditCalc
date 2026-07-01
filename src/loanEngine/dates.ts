import { addDays, addMonths, format, getDaysInMonth, parseISO } from 'date-fns'
import type { LoanConfig } from './types'

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
