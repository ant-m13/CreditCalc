import type { EarlyRepayment } from './types'

const sequenceOf = (repayment: EarlyRepayment, fallback: number) =>
  Number.isFinite(repayment.sameDaySequence) ? repayment.sameDaySequence! : fallback

export const sortRepaymentsByApplicationOrder = (repayments: EarlyRepayment[]) =>
  repayments
    .map((repayment, index) => ({ repayment, index }))
    .sort((a, b) =>
      a.repayment.date.localeCompare(b.repayment.date) ||
      sequenceOf(a.repayment, a.index) - sequenceOf(b.repayment, b.index) ||
      a.index - b.index
    )
    .map(({ repayment }) => repayment)

export const nextSameDaySequence = (repayments: EarlyRepayment[], date: string) =>
  repayments
    .filter(repayment => repayment.date === date)
    .reduce((max, repayment, index) => Math.max(max, sequenceOf(repayment, index)), -1) + 1
