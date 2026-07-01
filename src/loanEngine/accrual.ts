import Decimal from 'decimal.js'
import { addDays, parseISO } from 'date-fns'
import { calculateInterest, periodDays } from './calculateInterest'
import { iso } from './dates'
import type { GracePeriod, LoanConfig } from './types'

export const periodsPerYear = (frequency: LoanConfig['frequency']) =>
  frequency === 'biweekly' ? 26 : frequency === 'quarterly' ? 4 : 12

export function accrueInterestRaw(
  config: LoanConfig,
  currentBalance: Decimal,
  from: string,
  to: string,
  includeTo: boolean,
  periodCalendarDays: number,
  gracePeriods: GracePeriod[] = []
) {
  const accrueRawSegment = (segmentFrom: string, segmentTo: string, segmentIncludeTo: boolean) => {
    if (segmentTo < segmentFrom || currentBalance.lte(0)) return new Decimal(0)
    if (config.interest.method === 'daily') {
      return calculateInterest(currentBalance, config.annualRate, segmentFrom, segmentTo, { ...config.interest, includePaymentDate: segmentIncludeTo })
    }
    const segmentDays = periodDays(segmentFrom, segmentTo, segmentIncludeTo)
    return currentBalance
      .mul(config.annualRate)
      .div(100)
      .div(periodsPerYear(config.frequency))
      .mul(segmentDays)
      .div(Math.max(1, periodCalendarDays))
  }

  const days = periodDays(from, to, includeTo)
  const noAccrualGracePeriods = gracePeriods.filter(period => period.accrueInterest === false)
  if (days === 0 || noAccrualGracePeriods.length === 0) return accrueRawSegment(from, to, includeTo)

  let result = new Decimal(0)
  let segmentStart: string | null = null
  let segmentEnd = from
  const closeSegment = () => {
    if (!segmentStart) return
    result = result.add(accrueRawSegment(segmentStart, segmentEnd, true))
    segmentStart = null
  }

  for (let day = 0; day < days; day += 1) {
    const currentDate = iso(addDays(parseISO(from), day))
    const shouldAccrue = !noAccrualGracePeriods.some(period => period.startDate <= currentDate && currentDate <= period.endDate)
    if (shouldAccrue) {
      if (!segmentStart) segmentStart = currentDate
      segmentEnd = currentDate
    } else {
      closeSegment()
    }
  }
  closeSegment()
  return result
}
