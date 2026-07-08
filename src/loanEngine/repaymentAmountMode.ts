import { isRegularPaymentDate } from './dates'
import type { EarlyRepayment, LoanConfig } from './types'

export const repaymentAmountModes = ['extra', 'totalWithFee'] as const
export const legacyRepaymentAmountModes = ['total'] as const

export const isRepaymentAmountMode = (value: unknown) =>
  typeof value === 'string' && repaymentAmountModes.includes(value as typeof repaymentAmountModes[number])

export const isLegacyRepaymentAmountMode = (value: unknown) =>
  typeof value === 'string' && legacyRepaymentAmountModes.includes(value as typeof legacyRepaymentAmountModes[number])

export const isTotalWithFeeAmountMode = (value: unknown) =>
  value === 'totalWithFee' || value === 'total'

export const normalizeRepaymentAmountMode = (value: unknown, isRegularDate: boolean): EarlyRepayment['amountMode'] | null => {
  if (value === undefined) return isRegularDate ? 'totalWithFee' : 'extra'
  if (isTotalWithFeeAmountMode(value)) return 'totalWithFee'
  if (value === 'extra') return 'extra'
  return null
}

const hasZeroAmount = (amount: unknown) =>
  typeof amount === 'number' && Number.isFinite(amount) && amount === 0

export interface RepaymentAmountModeContext {
  disabled: boolean
  isExplicitTotalWithFee: boolean
  isRegularDate: boolean
  normalizedAmountMode: EarlyRepayment['amountMode'] | null
  totalBeforeRegularPayment: boolean
  totalOnNonRegularDate: boolean
  countsAsTotalWithFee: boolean
}

interface RepaymentAmountModeValidationOptions {
  includeTotalDateErrors?: boolean
  invalidMode?: string
  totalBeforeRegularPayment?: string
  totalOnNonRegularDate?: string
}

export const normalizeStoredRepaymentAmountMode = (context: RepaymentAmountModeContext): EarlyRepayment['amountMode'] =>
  context.normalizedAmountMode === 'totalWithFee' && context.isRegularDate ? 'totalWithFee' : 'extra'

export const repaymentAmountModeValidationErrors = (
  context: RepaymentAmountModeContext,
  label: string,
  options: RepaymentAmountModeValidationOptions = {}
) => {
  const errors: string[] = []
  const includeTotalDateErrors = options.includeTotalDateErrors ?? true
  if (context.normalizedAmountMode === null) errors.push(options.invalidMode ?? `${label}: режим суммы повреждён`)
  if (includeTotalDateErrors && context.totalBeforeRegularPayment) {
    errors.push(options.totalBeforeRegularPayment ?? `${label}: общая сумма списания с учётом комиссии может применяться только после регулярного платежа`)
  }
  if (includeTotalDateErrors && context.totalOnNonRegularDate) {
    errors.push(options.totalOnNonRegularDate ?? `${label}: общую сумму списания с учётом комиссии можно указать только в дату регулярного платежа`)
  }
  return errors
}

export function repaymentAmountModeContextForRegularDate(
  repayment: { amount: unknown; amountMode?: unknown; enabled?: unknown; sameDayOrder?: unknown },
  isRegularDate: boolean
): RepaymentAmountModeContext {
  const normalizedAmountMode = normalizeRepaymentAmountMode(repayment.amountMode, isRegularDate)
  const disabled = repayment.enabled === false || hasZeroAmount(repayment.amount)
  const isExplicitTotalWithFee = isTotalWithFeeAmountMode(repayment.amountMode)
  const isTotalMode = normalizedAmountMode === 'totalWithFee'

  return {
    disabled,
    isExplicitTotalWithFee,
    isRegularDate,
    normalizedAmountMode,
    totalBeforeRegularPayment: !disabled && isTotalMode && repayment.sameDayOrder === 'earlyFirst',
    totalOnNonRegularDate: !disabled && isExplicitTotalWithFee && !isRegularDate,
    countsAsTotalWithFee: !disabled && isTotalMode && isRegularDate
  }
}

export function repaymentAmountModeContext(
  repayment: { amount: unknown; amountMode?: unknown; date: string; enabled?: unknown; sameDayOrder?: unknown },
  config: LoanConfig
): RepaymentAmountModeContext {
  return repaymentAmountModeContextForRegularDate(repayment, isRegularPaymentDate(repayment.date, config))
}
