import Decimal from 'decimal.js'
import { addDays, parseISO } from 'date-fns'
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
  const addIsoDays = (date: string, days: number) => iso(addDays(parseISO(date), days))
  const includedRange = () => {
    const days = periodDays(from, to, includeTo, excludeStartDate)
    if (days === 0) return null
    const start = addIsoDays(from, excludeStartDate ? 1 : 0)
    return { start, endExclusive: addIsoDays(start, days) }
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

  const range = includedRange()
  const noAccrualGracePeriods = gracePeriods
    .filter(period => period.accrueInterest === false)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate))
  if (!range) return []

  const boundaries = new Set<string>([range.start, range.endExclusive])
  sortedRateChanges.forEach(change => {
    if (change.date > range.start && change.date < range.endExclusive) boundaries.add(change.date)
  })
  noAccrualGracePeriods.forEach(period => {
    if (period.endDate < range.start || period.startDate >= range.endExclusive) return
    if (period.startDate > range.start) boundaries.add(period.startDate)
    const afterGrace = addIsoDays(period.endDate, 1)
    if (afterGrace > range.start && afterGrace < range.endExclusive) boundaries.add(afterGrace)
  })
  if (config.interest.method === 'daily' && config.interest.dayCountBasis === 'actualActual') {
    for (let year = Number(range.start.slice(0, 4)) + 1; ; year += 1) {
      const yearStart = `${String(year).padStart(4, '0')}-01-01`
      if (yearStart >= range.endExclusive) break
      if (yearStart > range.start) boundaries.add(yearStart)
    }
  }

  const sortedBoundaries = [...boundaries].sort()
  let rateIndex = 0
  let graceIndex = 0
  let currentAnnualRate = annualRate
  const segments: ReturnType<typeof segment>[] = []

  for (let index = 0; index < sortedBoundaries.length - 1; index += 1) {
    const segmentStart = sortedBoundaries[index]
    const segmentEndExclusive = sortedBoundaries[index + 1]
    if (segmentStart >= segmentEndExclusive) continue
    while (rateIndex < sortedRateChanges.length && sortedRateChanges[rateIndex].date <= segmentStart) {
      currentAnnualRate = sortedRateChanges[rateIndex].annualRate
      rateIndex += 1
    }
    while (graceIndex < noAccrualGracePeriods.length && noAccrualGracePeriods[graceIndex].endDate < segmentStart) graceIndex += 1
    const noAccrualGrace = noAccrualGracePeriods[graceIndex]
    const shouldAccrue = !(noAccrualGrace && noAccrualGrace.startDate <= segmentStart && segmentStart <= noAccrualGrace.endDate)
    const currentReason = shouldAccrue ? reason : 'Беспроцентная льгота'
    segments.push(segment(segmentStart, addIsoDays(segmentEndExclusive, -1), true, shouldAccrue, currentReason, currentAnnualRate))
  }
  return segments
}
