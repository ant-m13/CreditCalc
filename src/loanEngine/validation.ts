import type { EarlyRepayment, GracePeriod, LoanConfig } from './types'

export function validateLoan(config: LoanConfig) {
  const errors: string[] = []
  if (!(config.principal > 0)) errors.push('Сумма кредита должна быть больше нуля')
  if (config.annualRate < 0 || config.annualRate > 100) errors.push('Ставка должна быть от 0 до 100%')
  if (!(config.termMonths > 0)) errors.push('Срок должен быть больше нуля')
  if (config.paymentDay < 1 || config.paymentDay > 31) errors.push('День платежа должен быть от 1 до 31')
  if (config.closeThreshold < 0) errors.push('Порог закрытия не может быть отрицательным')
  if (config.oneTimeFee < 0 || config.monthlyFee < 0 || config.earlyRepaymentFeePercent < 0) errors.push('Комиссии не могут быть отрицательными')
  if (new Date(config.firstPaymentDate) <= new Date(config.issueDate)) errors.push('Первый платёж должен быть после даты выдачи')
  return errors
}

export function validateScenario(config: LoanConfig, repayments: EarlyRepayment[], gracePeriods: GracePeriod[]) {
  const errors = validateLoan(config)
  repayments.forEach((repayment, index) => {
    if (repayment.amount <= 0) errors.push(`Досрочный платёж №${index + 1}: сумма должна быть больше нуля`)
    if (repayment.date < config.issueDate) errors.push(`Досрочный платёж №${index + 1}: дата раньше выдачи кредита`)
  })
  const sortedGrace = [...gracePeriods].sort((a, b) => a.startDate.localeCompare(b.startDate))
  sortedGrace.forEach((period, index) => {
    if (period.endDate < period.startDate) errors.push(`Льготный период №${index + 1}: окончание раньше начала`)
    if (index > 0 && period.startDate <= sortedGrace[index - 1].endDate) errors.push('Льготные периоды не должны пересекаться')
  })
  return [...new Set(errors)]
}
