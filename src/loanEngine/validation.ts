import type { EarlyRepayment, GracePeriod, LoanConfig } from './types'
import { MAX_EARLY_REPAYMENTS, MAX_GRACE_PERIODS, MAX_TERM_MONTHS } from './limits'
import { isRegularPaymentDate } from './dates'
import { isISODate } from '../utils/dateValidation'

const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value)

export function validateLoan(config: LoanConfig) {
  const errors: string[] = []
  if (!finite(config.principal) || !(config.principal > 0)) errors.push('Сумма кредита должна быть больше нуля')
  if (!finite(config.annualRate) || config.annualRate < 0 || config.annualRate > 100) errors.push('Ставка должна быть от 0 до 100%')
  if (!finite(config.termMonths) || !(config.termMonths > 0)) errors.push('Срок должен быть больше нуля')
  if (finite(config.termMonths) && !Number.isInteger(config.termMonths)) errors.push('Срок должен быть целым числом месяцев')
  if (finite(config.termMonths) && config.termMonths > MAX_TERM_MONTHS) errors.push(`Срок не должен превышать ${MAX_TERM_MONTHS} месяцев`)
  if (!finite(config.paymentDay) || config.paymentDay < 1 || config.paymentDay > 31) errors.push('День платежа должен быть от 1 до 31')
  if (finite(config.paymentDay) && !Number.isInteger(config.paymentDay)) errors.push('День платежа должен быть целым числом')
  if (!finite(config.closeThreshold) || config.closeThreshold < 0) errors.push('Порог закрытия не может быть отрицательным')
  if (!finite(config.oneTimeFee) || !finite(config.monthlyFee) || !finite(config.earlyRepaymentFeePercent) || config.oneTimeFee < 0 || config.monthlyFee < 0 || config.earlyRepaymentFeePercent < 0) errors.push('Комиссии не могут быть отрицательными')
  if (finite(config.earlyRepaymentFeePercent) && config.earlyRepaymentFeePercent > 100) errors.push('Комиссия за досрочное погашение должна быть от 0 до 100%')
  if (!isISODate(config.issueDate)) errors.push('Дата выдачи должна быть корректной календарной датой')
  if (!isISODate(config.firstPaymentDate)) errors.push('Дата первого платежа должна быть корректной календарной датой')
  if (isISODate(config.issueDate) && isISODate(config.firstPaymentDate) && config.firstPaymentDate <= config.issueDate) errors.push('Первый платёж должен быть после даты выдачи')
  return errors
}

export function validateScenario(config: LoanConfig, repayments: EarlyRepayment[], gracePeriods: GracePeriod[]) {
  const errors = validateLoan(config)
  if (repayments.length > MAX_EARLY_REPAYMENTS) errors.push(`Количество досрочных платежей не должно превышать ${MAX_EARLY_REPAYMENTS}`)
  if (gracePeriods.length > MAX_GRACE_PERIODS) errors.push(`Количество льготных периодов не должно превышать ${MAX_GRACE_PERIODS}`)
  const totalRepaymentsByDate = new Map<string, number>()
  repayments.forEach((repayment, index) => {
    const disabled = repayment.enabled === false || (finite(repayment.amount) && repayment.amount === 0)
    if (repayment.enabled !== undefined && typeof repayment.enabled !== 'boolean') errors.push(`Досрочный платёж №${index + 1}: признак активности повреждён`)
    if (!finite(repayment.amount) || repayment.amount < 0) errors.push(`Досрочный платёж №${index + 1}: сумма не может быть отрицательной`)
    if (!isISODate(repayment.date)) errors.push(`Досрочный платёж №${index + 1}: дата должна быть корректной`)
    else if (isISODate(config.issueDate) && repayment.date < config.issueDate) errors.push(`Досрочный платёж №${index + 1}: дата раньше выдачи кредита`)
    const isRegularDate = isISODate(repayment.date) && isRegularPaymentDate(repayment.date, config)
    const isTotalMode = repayment.amountMode === 'total' || (repayment.amountMode === undefined && isRegularDate)
    if (!disabled && isTotalMode && repayment.sameDayOrder === 'earlyFirst') errors.push(`Досрочный платёж №${index + 1}: общая сумма по телу и процентам без комиссий может применяться только после регулярного платежа`)
    if (!disabled && repayment.amountMode === 'total' && isISODate(repayment.date) && !isRegularDate) errors.push(`Досрочный платёж №${index + 1}: общую сумму по телу и процентам без комиссий можно указать только в дату регулярного платежа`)
    if (!disabled && isTotalMode && isRegularDate) totalRepaymentsByDate.set(repayment.date, (totalRepaymentsByDate.get(repayment.date) ?? 0) + 1)
  })
  totalRepaymentsByDate.forEach((count, date) => {
    if (count > 1) errors.push(`На дату ${date} можно указать только одну общую сумму по телу и процентам без комиссий`)
  })
  const sortedGrace = [...gracePeriods].sort((a, b) => a.startDate.localeCompare(b.startDate))
  sortedGrace.forEach((period, index) => {
    if (!isISODate(period.startDate)) errors.push(`Льготный период №${index + 1}: дата начала должна быть корректной`)
    if (!isISODate(period.endDate)) errors.push(`Льготный период №${index + 1}: дата окончания должна быть корректной`)
    if (isISODate(period.startDate) && isISODate(period.endDate) && period.endDate < period.startDate) errors.push(`Льготный период №${index + 1}: окончание раньше начала`)
    if (period.paymentAmount !== undefined && (!finite(period.paymentAmount) || period.paymentAmount < 0)) errors.push(`Льготный период №${index + 1}: индивидуальный платёж должен быть неотрицательным`)
    if (index > 0 && isISODate(period.startDate) && isISODate(sortedGrace[index - 1].endDate) && period.startDate <= sortedGrace[index - 1].endDate) errors.push('Льготные периоды не должны пересекаться')
  })
  return [...new Set(errors)]
}
