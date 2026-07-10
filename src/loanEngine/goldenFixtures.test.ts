import { describe, expect, it } from 'vitest'
import { generateBaseSchedule, type EarlyRepayment, type GracePeriod, type LoanConfig, type PaymentScheduleItem } from '.'
import annuityBasic from './__fixtures__/annuity-basic.json'
import differentiatedBasic from './__fixtures__/differentiated-basic.json'
import dailyActualActualLeapYear from './__fixtures__/daily-actual-actual-leap-year.json'
import earlyRepaymentBetweenPayments from './__fixtures__/early-repayment-between-payments.json'
import rateChangeExactDate from './__fixtures__/rate-change-exact-date.json'
import graceFullCapitalized from './__fixtures__/grace-full-capitalized.json'
import monthlyTotalWithFee from './__fixtures__/monthly-total-with-fee.json'
import firstInterestOnlyStub from './__fixtures__/first-interest-only-stub.json'

interface GoldenSummary {
  rowCount: number
  closingDate: string
  totalInterestPaid: number
  totalCashFlow: number
  totalFeePaid: number
}

interface GoldenRow {
  date: string
  number: number
  payment: number
  interestPaid: number
  principalPaid: number
  earlyPayment: number
  feePaid: number
  deferredInterestClosing: number
  cashFlowTotal: number
  closingBalance: number
  eventTypes: string[]
  paymentRecalculated: boolean
  isRegularPayment: boolean
}

interface GoldenFixture {
  description: string
  input: {
    config: LoanConfig
    repayments: EarlyRepayment[]
    gracePeriods: GracePeriod[]
  }
  expected: {
    summary: GoldenSummary
    rows: GoldenRow[]
  }
}

const fixtures = [
  annuityBasic,
  differentiatedBasic,
  dailyActualActualLeapYear,
  earlyRepaymentBetweenPayments,
  rateChangeExactDate,
  graceFullCapitalized,
  monthlyTotalWithFee,
  firstInterestOnlyStub
] as unknown as GoldenFixture[]

const round2 = (value: number) => {
  const rounded = Number(value.toFixed(2))
  return Object.is(rounded, -0) ? 0 : rounded
}

const summarize = (schedule: PaymentScheduleItem[]): GoldenSummary => ({
  rowCount: schedule.length,
  closingDate: schedule.at(-1)?.date ?? '',
  totalInterestPaid: round2(schedule.reduce((sum, row) => sum + row.interestPaid, 0)),
  totalCashFlow: round2(schedule.reduce((sum, row) => sum + row.cashFlowTotal, 0)),
  totalFeePaid: round2(schedule.reduce((sum, row) => sum + row.feePaid, 0))
})

const rowSnapshot = (row: PaymentScheduleItem): GoldenRow => ({
  date: row.date,
  number: row.number,
  payment: round2(row.payment),
  interestPaid: round2(row.interestPaid),
  principalPaid: round2(row.principalPaid),
  earlyPayment: round2(row.earlyPayment),
  feePaid: round2(row.feePaid),
  deferredInterestClosing: round2(row.deferredInterestClosing),
  cashFlowTotal: round2(row.cashFlowTotal),
  closingBalance: round2(row.closingBalance),
  eventTypes: row.eventTypes,
  paymentRecalculated: row.paymentRecalculated,
  isRegularPayment: row.isRegularPayment
})

describe('loan engine golden fixtures', () => {
  it.each(fixtures.map(fixture => [fixture.description, fixture] as const))('%s', (_, fixture) => {
    const schedule = generateBaseSchedule(fixture.input.config, {
      earlyRepayments: fixture.input.repayments,
      gracePeriods: fixture.input.gracePeriods
    })

    expect(summarize(schedule)).toEqual(fixture.expected.summary)
    expect(fixture.expected.rows.map(expected => {
      const row = schedule.find(item => item.date === expected.date)
      expect(row, `${fixture.description}: row ${expected.date}`).toBeDefined()
      return rowSnapshot(row!)
    })).toEqual(fixture.expected.rows)
  })
})
