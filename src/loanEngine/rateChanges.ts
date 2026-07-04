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
    let rate = fallbackAnnualRate
    for (const change of sortedChanges) {
      if (change.date <= date) rate = change.annualRate
      else break
    }
    return rate
  }
  return { sortedChanges, rateAt }
}

export const rateForNextPeriod = (config: LoanConfig, completedPaymentDate: string, currentAnnualRate: number) => {
  return createRateTimeline(config).rateAt(completedPaymentDate, currentAnnualRate)
}

export const rateForDate = (config: LoanConfig, date: string, fallbackAnnualRate = config.annualRate) => {
  return createRateTimeline(config).rateAt(date, fallbackAnnualRate)
}
