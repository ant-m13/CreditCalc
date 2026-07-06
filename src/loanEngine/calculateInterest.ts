import Decimal from 'decimal.js'
import { addDays, differenceInCalendarDays, isBefore, isLeapYear, min, parseISO, startOfYear, addYears } from 'date-fns'
import type { InterestConfig } from './types'

export function periodDays(from: string, to: string, includePaymentDate = false, excludeStartDate = false) {
  return Math.max(0, differenceInCalendarDays(parseISO(to), parseISO(from)) + (includePaymentDate ? 1 : 0) - (excludeStartDate ? 1 : 0))
}

export function calculateInterest(balance: Decimal.Value, annualRate: number, from: string, to: string, config: InterestConfig) {
  const excludeStartDate = config.periodStart === 'exclusive'
  const days = periodDays(from, to, config.includePaymentDate, excludeStartDate)
  if (annualRate === 0 || days === 0) return new Decimal(0)
  const start = addDays(parseISO(from), excludeStartDate ? 1 : 0)
  const annualFraction = new Decimal(annualRate).div(100)
  if (config.dayCountBasis === 'actualActual') {
    let result = new Decimal(0)
    let cursor = start
    const endExclusive = addDays(start, days)
    while (isBefore(cursor, endExclusive)) {
      const nextYear = addYears(startOfYear(cursor), 1)
      const segmentEnd = min([nextYear, endExclusive])
      const segmentDays = differenceInCalendarDays(segmentEnd, cursor)
      result = result.add(new Decimal(balance).mul(annualFraction).mul(segmentDays).div(isLeapYear(cursor) ? 366 : 365))
      cursor = segmentEnd
    }
    return result
  }
  let divisor = 365
  if (config.dayCountBasis === '360') divisor = 360
  if (config.dayCountBasis === '366') divisor = 366
  return new Decimal(balance).mul(annualFraction).mul(days).div(divisor)
}
