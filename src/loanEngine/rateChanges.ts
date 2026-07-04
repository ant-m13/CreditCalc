import type { LoanConfig, RateChange } from './types'

export const sortRateChanges = (items: RateChange[]) =>
  [...items].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))

export const rateForNextPeriod = (config: LoanConfig, completedPaymentDate: string, currentAnnualRate: number) => {
  let nextRate = currentAnnualRate
  for (const change of sortRateChanges(config.rateChanges ?? [])) {
    if (change.date <= completedPaymentDate) nextRate = change.annualRate
    else break
  }
  return nextRate
}

export const rateForDate = (config: LoanConfig, date: string, fallbackAnnualRate = config.annualRate) => {
  let rate = fallbackAnnualRate
  for (const change of sortRateChanges(config.rateChanges ?? [])) {
    if (change.date <= date) rate = change.annualRate
    else break
  }
  return rate
}
