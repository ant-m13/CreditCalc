import Decimal from 'decimal.js'
import { addDays, differenceInCalendarDays, parseISO } from 'date-fns'
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
  const excludeStartDate = config.interest.periodStart === 'exclusive'
  const includedDates = () => {
    const dates: string[] = []
    const calendarDays = differenceInCalendarDays(parseISO(to), parseISO(from))
    const startOffset = excludeStartDate ? 1 : 0
    const endOffset = calendarDays + (includeTo ? 1 : 0)
    for (let day = startOffset; day < endOffset; day += 1) {
      dates.push(iso(addDays(parseISO(from), day)))
    }
    return dates
  }
  const accrueRawSegment = (segmentFrom: string, segmentTo: string, segmentIncludeTo: boolean, segmentExcludeStartDate: boolean) => {
    if (segmentTo < segmentFrom || currentBalance.lte(0)) return new Decimal(0)
    if (config.interest.method === 'daily') {
      return calculateInterest(currentBalance, config.annualRate, segmentFrom, segmentTo, {
        ...config.interest,
        includePaymentDate: segmentIncludeTo,
        periodStart: segmentExcludeStartDate ? 'exclusive' : 'inclusive'
      })
    }
    const segmentDays = periodDays(segmentFrom, segmentTo, segmentIncludeTo, segmentExcludeStartDate)
    return currentBalance
      .mul(config.annualRate)
      .div(100)
      .div(periodsPerYear(config.frequency))
      .mul(segmentDays)
      .div(Math.max(1, periodCalendarDays))
  }
  const segment = (segmentFrom: string, segmentTo: string, segmentIncludeTo: boolean, shouldAccrue: boolean, segmentReason: string, segmentExcludeStartDate = false) => {
    const segmentDays = periodDays(segmentFrom, segmentTo, segmentIncludeTo, segmentExcludeStartDate)
    return {
      from: segmentFrom,
      to: segmentTo,
      days: segmentDays,
      balance: currentBalance,
      rawInterest: shouldAccrue ? accrueRawSegment(segmentFrom, segmentTo, segmentIncludeTo, segmentExcludeStartDate) : new Decimal(0),
      reason: segmentReason
    }
  }

  const dates = includedDates()
  const days = dates.length
  const noAccrualGracePeriods = gracePeriods.filter(period => period.accrueInterest === false)
  if (days === 0) return []

  let segmentStart: string | null = null
  let segmentAccrues = false
  let segmentReason = reason
  let segmentYear = ''
  let segmentEnd = dates[0]
  const segments: ReturnType<typeof segment>[] = []
  const closeSegment = () => {
    if (!segmentStart) return
    segments.push(segment(segmentStart, segmentEnd, true, segmentAccrues, segmentReason))
    segmentStart = null
  }

  for (const currentDate of dates) {
    const shouldAccrue = !noAccrualGracePeriods.some(period => period.startDate <= currentDate && currentDate <= period.endDate)
    const currentReason = shouldAccrue ? reason : 'Беспроцентная льгота'
    const currentYear = shouldAccrue && config.interest.dayCountBasis === 'actualActual' ? currentDate.slice(0, 4) : ''
    if (!segmentStart || segmentAccrues !== shouldAccrue || segmentReason !== currentReason || segmentYear !== currentYear) {
      closeSegment()
      if (!segmentStart) segmentStart = currentDate
      segmentAccrues = shouldAccrue
      segmentReason = currentReason
      segmentYear = currentYear
    }
    segmentEnd = currentDate
  }
  closeSegment()
  return segments
}
