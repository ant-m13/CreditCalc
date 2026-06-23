import Decimal from 'decimal.js'
import { addDays, differenceInCalendarDays, isLeapYear, parseISO } from 'date-fns'
import type { InterestConfig } from './types'

export function periodDays(from: string, to: string, includePaymentDate = false) {
  return Math.max(0, differenceInCalendarDays(parseISO(to), parseISO(from)) + (includePaymentDate ? 1 : 0))
}

export function calculateInterest(balance: Decimal.Value, annualRate: number, from: string, to: string, config: InterestConfig) {
  const days = periodDays(from, to, config.includePaymentDate)
  if (annualRate === 0 || days === 0) return new Decimal(0)
  const start = parseISO(from)
  const annualFraction = new Decimal(annualRate).div(100)
  if (config.dayCountBasis === 'actualActual') {
    let result = new Decimal(0)
    for (let day = 0; day < days; day++) {
      const date = addDays(start, day)
      result = result.add(new Decimal(balance).mul(annualFraction).div(isLeapYear(date) ? 366 : 365))
    }
    return result
  }
  let divisor = 365
  if (config.dayCountBasis === '360') divisor = 360
  if (config.dayCountBasis === '366') divisor = 366
  return new Decimal(balance).mul(annualFraction).mul(days).div(divisor)
}
