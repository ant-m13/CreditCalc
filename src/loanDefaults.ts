import type { LoanConfig } from './loanEngine'

export const defaultConfig: LoanConfig = {
  principal: 7200000, annualRate: 12.4, issueDate: '2026-06-23', firstPaymentDate: '2026-07-15', firstPaymentInterestOnly: true, termMonths: 240,
  paymentDay: 15, paymentType: 'annuity', frequency: 'monthly', currency: 'RUB', rounding: 'kopecks', closeThreshold: 300,
  oneTimeFee: 0, monthlyFee: 0, earlyRepaymentFeePercent: 0,
  interest: { method: 'daily', dayCountBasis: 'actualActual', includePaymentDate: true, periodStart: 'exclusive', balanceMoment: 'startOfDay' }
}
