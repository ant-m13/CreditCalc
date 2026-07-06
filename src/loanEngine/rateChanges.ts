import type { LoanConfig, RateChange } from './types'

export const sortRateChanges = (items: RateChange[]) =>
  [...items].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))

export interface RateTimeline {
  sortedChanges: RateChange[]
  rateAt: (date: string, fallbackAnnualRate?: number) => number
}

export const createRateTimeline = (config: Pick<LoanConfig, 'annualRate' | 'rateChanges'>): RateTimeline => {
  const sortedChanges = sortRateChanges(config.rateChanges ?? [])
  const rateAt = (date: string, fallbackAnnualRate = config.annualRate) => {
    let low = 0
    let high = sortedChanges.length - 1
    let index = -1
    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      if (sortedChanges[middle].date <= date) {
        index = middle
        low = middle + 1
      } else {
        high = middle - 1
      }
    }
    return index >= 0 ? sortedChanges[index].annualRate : fallbackAnnualRate
  }
  return { sortedChanges, rateAt }
}

export const rateForNextPeriod = (config: LoanConfig, completedPaymentDate: string, currentAnnualRate: number) => {
  return createRateTimeline(config).rateAt(completedPaymentDate, currentAnnualRate)
}

export const rateForDate = (config: LoanConfig, date: string, fallbackAnnualRate = config.annualRate) => {
  return createRateTimeline(config).rateAt(date, fallbackAnnualRate)
}
