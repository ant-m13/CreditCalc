import Decimal from 'decimal.js'
import { MAX_FINANCIAL_RESULT } from './limits'
import type { PaymentScheduleItem, RepaymentApplicationOutcome } from './types'

export const assertFiniteFinancialNumber = (value: number, label: string, maximum = MAX_FINANCIAL_RESULT) => {
  if (!Number.isFinite(value) || Math.abs(value) > maximum) {
    throw new Error(`${label} выходит за допустимый финансовый диапазон`)
  }
  return value
}

export const finiteFinancialNumber = (value: Decimal.Value, label: string) =>
  assertFiniteFinancialNumber(new Decimal(value).toNumber(), label)

const outcomeValues = (outcome: RepaymentApplicationOutcome) => [
  outcome.requestedAmount,
  outcome.regularPaymentApplied ?? 0,
  outcome.appliedAmount,
  outcome.appliedInterest,
  outcome.appliedPrincipal,
  outcome.fee,
  outcome.unusedAmount
]

export const assertFiniteScheduleItem = (row: PaymentScheduleItem) => {
  const values = [
    row.openingBalance, row.payment, row.interest, row.principal, row.earlyPayment,
    row.interestAccrued, row.interestPaid, row.principalPaid, row.feePaid,
    row.deferredInterestOpening, row.deferredInterestClosing, row.cashFlowTotal,
    row.closingBalance, row.cumulativeInterest, row.cumulativeSavings, row.fee,
    row.audit?.interestBalance ?? 0, row.audit?.interestBeforeRounding ?? 0,
    ...(row.audit?.interestSegments.flatMap(segment => [segment.balance, segment.annualRate, segment.rawInterest]) ?? []),
    ...(row.repaymentOutcomes?.flatMap(outcomeValues) ?? [])
  ]
  values.forEach(value => assertFiniteFinancialNumber(value, `Строка графика ${row.date}`))
}
