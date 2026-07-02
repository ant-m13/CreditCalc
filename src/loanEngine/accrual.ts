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
  return accrueInterestSegmentsRaw(config, currentBalance, from, to, includeTo, periodCalendarDays, gracePeriods)
    .reduce((sum, segment) => sum.add(segment.rawInterest), new Decimal(0))
}

export function accrueInterestSegmentsRaw(
  config: LoanConfig,
  currentBalance: Decimal,
  from: string,
  to: string,
  includeTo: boolean,
  periodCalendarDays: number,
  gracePeriods: GracePeriod[] = [],
  reason = 'Начисление процентов'
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
  const segment = (segmentFrom: string, segmentTo: string, segmentIncludeTo: boolean, shouldAccrue: boolean, segmentReason: string) => {
    const segmentDays = periodDays(segmentFrom, segmentTo, segmentIncludeTo)
    return {
      from: segmentFrom,
      to: segmentTo,
      days: segmentDays,
      balance: currentBalance,
      rawInterest: shouldAccrue ? accrueRawSegment(segmentFrom, segmentTo, segmentIncludeTo) : new Decimal(0),
      reason: segmentReason
    }
  }

  const days = periodDays(from, to, includeTo)
  const noAccrualGracePeriods = gracePeriods.filter(period => period.accrueInterest === false)
  if (days === 0) return []
  if (noAccrualGracePeriods.length === 0) return [segment(from, to, includeTo, true, reason)]

  let segmentStart: string | null = null
  let segmentAccrues = false
  let segmentEnd = from
  const segments: ReturnType<typeof segment>[] = []
  const closeSegment = () => {
    if (!segmentStart) return
    segments.push(segment(segmentStart, segmentEnd, true, segmentAccrues, segmentAccrues ? reason : 'Беспроцентная льгота'))
    segmentStart = null
  }

  for (let day = 0; day < days; day += 1) {
    const currentDate = iso(addDays(parseISO(from), day))
    const shouldAccrue = !noAccrualGracePeriods.some(period => period.startDate <= currentDate && currentDate <= period.endDate)
    if (!segmentStart || segmentAccrues !== shouldAccrue) {
      closeSegment()
      if (!segmentStart) segmentStart = currentDate
      segmentAccrues = shouldAccrue
    }
    segmentEnd = currentDate
  }
  closeSegment()
  return segments
}
