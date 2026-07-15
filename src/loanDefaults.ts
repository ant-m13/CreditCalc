import { addMonths, format, getDaysInMonth } from 'date-fns'
import type { LoanConfig } from './loanEngine'
import { MAX_PAYMENT_DAY } from './loanEngine/limits'

// Демонстрационные значения используются для первого кредита и как безопасные резервные значения при нормализации.
const immutableDefaultConfig: LoanConfig = {
  principal: 7_200_000, annualRate: 12.4, rateChanges: [], rateChangeMode: 'nextPeriod', issueDate: '2026-06-23', firstPaymentDate: '2026-07-15', firstPaymentInterestOnly: true, firstPaymentInterestOnlyMode: 'addToTerm', termMonths: 240,
  paymentDay: 15, paymentType: 'annuity', frequency: 'monthly', currency: 'RUB', rounding: 'kopecks', closeThreshold: 300,
  oneTimeFee: 0, monthlyFee: 0, earlyRepaymentFeePercent: 0,
  interest: { method: 'daily', dayCountBasis: 'actualActual', includePaymentDate: true, periodStart: 'exclusive', balanceMoment: 'startOfDay' }
}

const toLocalDate = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate())

export const createDefaultConfig = (today = new Date(), paymentDay = immutableDefaultConfig.paymentDay): LoanConfig => {
  const issue = toLocalDate(today)
  const next = addMonths(issue, 1)
  const normalizedPaymentDay = Math.min(MAX_PAYMENT_DAY, Math.max(1, Math.round(paymentDay)))
  const firstPayment = new Date(next.getFullYear(), next.getMonth(), Math.min(normalizedPaymentDay, getDaysInMonth(next)))
  return {
    ...immutableDefaultConfig,
    issueDate: format(issue, 'yyyy-MM-dd'),
    firstPaymentDate: format(firstPayment, 'yyyy-MM-dd'),
    paymentDay: normalizedPaymentDay,
    rateChanges: [],
    interest: { ...immutableDefaultConfig.interest }
  }
}

export const defaultConfig: LoanConfig = {
  ...immutableDefaultConfig,
  rateChanges: [],
  interest: { ...immutableDefaultConfig.interest }
}
