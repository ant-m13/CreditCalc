import Decimal from 'decimal.js'
import { addDays, differenceInCalendarDays, parseISO } from 'date-fns'
import { calculateInterest, periodDays } from './calculateInterest'
import { iso } from './dates'
import { sortRateChanges } from './rateChanges'
import type { GracePeriod, LoanConfig, RateChange } from './types'

export const periodsPerYear = (frequency: LoanConfig['frequency']) =>
  frequency === 'biweekly' ? 26 : frequency === 'quarterly' ? 4 : 12

export function accrueInterestRaw(
  config: LoanConfig,
  currentBalance: Decimal,
  from: string,
  to: string,
  includeTo: boolean,
  periodCalendarDays: number,
  gracePeriods: GracePeriod[] = [],
  annualRate = config.annualRate,
  rateChanges: RateChange[] = [],
  rateChangesAreSorted = false
) {
  return accrueInterestSegmentsRaw(config, currentBalance, from, to, includeTo, periodCalendarDays, gracePeriods, 'Начисление процентов', annualRate, rateChanges, rateChangesAreSorted)
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
  reason = 'Начисление процентов',
  annualRate = config.annualRate,
  rateChanges: RateChange[] = [],
  rateChangesAreSorted = false
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
  const sortedRateChanges = rateChangesAreSorted ? rateChanges : sortRateChanges(rateChanges)
  const accrueRawSegment = (segmentFrom: string, segmentTo: string, segmentIncludeTo: boolean, segmentExcludeStartDate: boolean, segmentAnnualRate: number) => {
    if (segmentTo < segmentFrom || currentBalance.lte(0)) return new Decimal(0)
    if (config.interest.method === 'daily') {
      return calculateInterest(currentBalance, segmentAnnualRate, segmentFrom, segmentTo, {
        ...config.interest,
        includePaymentDate: segmentIncludeTo,
        periodStart: segmentExcludeStartDate ? 'exclusive' : 'inclusive'
      })
    }
    const segmentDays = periodDays(segmentFrom, segmentTo, segmentIncludeTo, segmentExcludeStartDate)
    return currentBalance
      .mul(segmentAnnualRate)
      .div(100)
      .div(periodsPerYear(config.frequency))
      .mul(segmentDays)
      .div(Math.max(1, periodCalendarDays))
  }
  const segment = (segmentFrom: string, segmentTo: string, segmentIncludeTo: boolean, shouldAccrue: boolean, segmentReason: string, segmentAnnualRate: number, segmentExcludeStartDate = false) => {
    const segmentDays = periodDays(segmentFrom, segmentTo, segmentIncludeTo, segmentExcludeStartDate)
    return {
      from: segmentFrom,
      to: segmentTo,
      days: segmentDays,
      balance: currentBalance,
      annualRate: segmentAnnualRate,
      rawInterest: shouldAccrue ? accrueRawSegment(segmentFrom, segmentTo, segmentIncludeTo, segmentExcludeStartDate, segmentAnnualRate) : new Decimal(0),
      reason: segmentReason
    }
  }

  const dates = includedDates()
  const days = dates.length
  const noAccrualGracePeriods = gracePeriods
    .filter(period => period.accrueInterest === false)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate))
  if (days === 0) return []

  let segmentStart: string | null = null
  let segmentAccrues = false
  let segmentReason = reason
  let segmentYear = ''
  let segmentAnnualRate = annualRate
  let segmentEnd = dates[0]
  let rateIndex = 0
  let graceIndex = 0
  let currentAnnualRate = annualRate
  const segments: ReturnType<typeof segment>[] = []
  const closeSegment = () => {
    if (!segmentStart) return
    segments.push(segment(segmentStart, segmentEnd, true, segmentAccrues, segmentReason, segmentAnnualRate))
    segmentStart = null
  }

  for (const currentDate of dates) {
    while (rateIndex < sortedRateChanges.length && sortedRateChanges[rateIndex].date <= currentDate) {
      currentAnnualRate = sortedRateChanges[rateIndex].annualRate
      rateIndex += 1
    }
    while (graceIndex < noAccrualGracePeriods.length && noAccrualGracePeriods[graceIndex].endDate < currentDate) graceIndex += 1
    const noAccrualGrace = noAccrualGracePeriods[graceIndex]
    const shouldAccrue = !(noAccrualGrace && noAccrualGrace.startDate <= currentDate && currentDate <= noAccrualGrace.endDate)
    const currentReason = shouldAccrue ? reason : 'Беспроцентная льгота'
    const currentYear = shouldAccrue && config.interest.dayCountBasis === 'actualActual' ? currentDate.slice(0, 4) : ''
    if (!segmentStart || segmentAccrues !== shouldAccrue || segmentReason !== currentReason || segmentYear !== currentYear || segmentAnnualRate !== currentAnnualRate) {
      closeSegment()
      if (!segmentStart) segmentStart = currentDate
      segmentAccrues = shouldAccrue
      segmentReason = currentReason
      segmentYear = currentYear
      segmentAnnualRate = currentAnnualRate
    }
    segmentEnd = currentDate
  }
  closeSegment()
  return segments
}
