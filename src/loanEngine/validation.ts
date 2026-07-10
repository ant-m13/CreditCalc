import { supportedCurrencies, type EarlyRepayment, type GracePeriod, type LoanConfig } from './types'
import { differenceInCalendarDays, parseISO } from 'date-fns'
import { MAX_CALENDAR_DAYS, MAX_CALENDAR_YEARS, MAX_EARLY_REPAYMENTS, MAX_FINANCIAL_RESULT, MAX_GRACE_PERIODS, MAX_MONEY_AMOUNT, MAX_PERCENT, MAX_RATE_CHANGES, MAX_TERM_MONTHS } from './limits'
import { contractualFinalPaymentDate, preparePaymentCalendar, regularPaymentDateMatches, totalPaymentPeriods } from './dates'
import { repaymentAmountModeContextForRegularDate, repaymentAmountModeValidationErrors } from './repaymentAmountMode'
import { isISODate } from '../utils/dateValidation'

const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
const oneOf = <T extends string>(value: unknown, values: readonly T[]) => typeof value === 'string' && values.includes(value as T)
const paymentTypes = ['annuity', 'differentiated'] as const
const frequencies = ['monthly', 'biweekly', 'quarterly'] as const
const roundingModes = ['kopecks', 'rubles', 'bank'] as const
const interestMethods = ['annuity', 'daily'] as const
const dayCountBases = ['365', '366', '360', 'actual365', 'actualActual'] as const
const periodStarts = ['inclusive', 'exclusive'] as const
const balanceMoments = ['startOfDay', 'endOfDay'] as const
const repaymentStrategies = ['reduceTerm', 'reducePayment', 'full', 'custom'] as const
const repaymentSources = ['own', 'subsidy', 'insurance', 'other'] as const
const sameDayOrders = ['regularFirst', 'earlyFirst'] as const
const graceTypes = ['full', 'interestOnly', 'reduced', 'custom'] as const

const daysFromIssue = (issueDate: string, date: string) => differenceInCalendarDays(parseISO(date), parseISO(issueDate))
const exceedsCalendarHorizon = (issueDate: string, date: string) => daysFromIssue(issueDate, date) > MAX_CALENDAR_DAYS
const exceedsFourDigitCalendar = (date: string) => !/^\d{4}-\d{2}-\d{2}$/.test(date) || date > '9999-12-31'
const horizonError = (label: string) => `${label} должна быть в пределах ${MAX_CALENDAR_YEARS} лет от даты выдачи`
const contractCanExceedFourDigitCalendar = (config: LoanConfig) => {
  if (!isISODate(config.firstPaymentDate) || !finite(config.termMonths)) return false
  if (config.frequency === 'biweekly') {
    const firstYear = Number(config.firstPaymentDate.slice(0, 4))
    return firstYear >= 9996 && totalPaymentPeriods(config) * 14 > (10000 - firstYear) * 366
  }
  const [year, month] = config.firstPaymentDate.split('-').map(Number)
  const periodMonths = config.frequency === 'quarterly' ? 3 : 1
  const finalMonthIndex = year * 12 + (month - 1) + (totalPaymentPeriods(config) - 1) * periodMonths
  return finalMonthIndex > 9999 * 12 + 11
}

export function validateLoan(config: LoanConfig) {
  const errors: string[] = []
  if (!finite(config.principal) || !(config.principal > 0) || config.principal > MAX_MONEY_AMOUNT) errors.push(`Сумма кредита должна быть больше нуля и не превышать ${MAX_MONEY_AMOUNT}`)
  if (!finite(config.annualRate) || config.annualRate < 0 || config.annualRate > MAX_PERCENT) errors.push(`Ставка должна быть от 0 до ${MAX_PERCENT}%`)
  if (config.rateChangeMode !== 'nextPeriod' && config.rateChangeMode !== 'exactDate') errors.push('Режим изменения ставки повреждён')
  if (typeof config.firstPaymentInterestOnly !== 'boolean') errors.push('Настройка первого платежа повреждена')
  if (!oneOf(config.paymentType, paymentTypes)) errors.push('Тип платежа повреждён')
  if (!oneOf(config.frequency, frequencies)) errors.push('Частота платежей повреждена')
  if (!oneOf(config.currency, supportedCurrencies)) errors.push('Валюта повреждена')
  if (!oneOf(config.rounding, roundingModes)) errors.push('Округление повреждено')
  if (!finite(config.termMonths) || !(config.termMonths > 0)) errors.push('Срок должен быть больше нуля')
  if (finite(config.termMonths) && !Number.isInteger(config.termMonths)) errors.push('Срок должен быть целым числом месяцев')
  if (finite(config.termMonths) && config.termMonths > MAX_TERM_MONTHS) errors.push(`Срок не должен превышать ${MAX_TERM_MONTHS} месяцев`)
  if (!finite(config.paymentDay) || config.paymentDay < 1 || config.paymentDay > 31) errors.push('День платежа должен быть от 1 до 31')
  if (finite(config.paymentDay) && !Number.isInteger(config.paymentDay)) errors.push('День платежа должен быть целым числом')
  if (!finite(config.closeThreshold) || config.closeThreshold < 0 || config.closeThreshold > MAX_MONEY_AMOUNT) errors.push(`Порог закрытия должен быть от 0 до ${MAX_MONEY_AMOUNT}`)
  if (!finite(config.oneTimeFee) || !finite(config.monthlyFee) || !finite(config.earlyRepaymentFeePercent) || config.oneTimeFee < 0 || config.monthlyFee < 0 || config.earlyRepaymentFeePercent < 0 || config.oneTimeFee > MAX_MONEY_AMOUNT || config.monthlyFee > MAX_MONEY_AMOUNT) errors.push(`Комиссии должны быть от 0 до ${MAX_MONEY_AMOUNT}`)
  if (finite(config.earlyRepaymentFeePercent) && config.earlyRepaymentFeePercent > MAX_PERCENT) errors.push(`Комиссия за досрочное погашение должна быть от 0 до ${MAX_PERCENT}%`)
  if (!isISODate(config.issueDate)) errors.push('Дата выдачи должна быть корректной календарной датой')
  if (!isISODate(config.firstPaymentDate)) errors.push('Дата первого платежа должна быть корректной календарной датой')
  if (isISODate(config.issueDate) && isISODate(config.firstPaymentDate) && config.firstPaymentDate <= config.issueDate) errors.push('Первый платёж должен быть после даты выдачи')
  if (isISODate(config.issueDate) && isISODate(config.firstPaymentDate) && config.firstPaymentDate > config.issueDate && exceedsCalendarHorizon(config.issueDate, config.firstPaymentDate)) errors.push(horizonError('Дата первого платежа'))
  if (isISODate(config.issueDate) && isISODate(config.firstPaymentDate) && config.firstPaymentDate > config.issueDate) {
    try {
      if (contractCanExceedFourDigitCalendar(config)) errors.push('Договорная дата закрытия должна оставаться в четырёхзначном календаре')
      const finalDate = contractualFinalPaymentDate(config)
      if (exceedsFourDigitCalendar(finalDate)) errors.push('Договорная дата закрытия должна оставаться в четырёхзначном календаре')
      else if (exceedsCalendarHorizon(config.issueDate, finalDate)) errors.push(horizonError('Договорная дата закрытия'))
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Не удалось проверить договорную дату закрытия')
    }
  }
  if (!config.interest || typeof config.interest !== 'object') {
    errors.push('Правила начисления процентов повреждены')
  } else {
    if (!oneOf(config.interest.method, interestMethods)) errors.push('Метод начисления процентов повреждён')
    if (!oneOf(config.interest.dayCountBasis, dayCountBases)) errors.push('База года повреждена')
    if (typeof config.interest.includePaymentDate !== 'boolean') errors.push('Правило включения даты платежа повреждено')
    if (!oneOf(config.interest.periodStart, periodStarts)) errors.push('Начало процентного периода повреждено')
    if (!oneOf(config.interest.balanceMoment, balanceMoments)) errors.push('Момент остатка для процентов повреждён')
  }
  if (!Array.isArray(config.rateChanges)) {
    errors.push('История ставок повреждена')
  } else {
    if (config.rateChanges.length > MAX_RATE_CHANGES) errors.push(`Количество изменений ставки не должно превышать ${MAX_RATE_CHANGES}`)
    const rateChangeDates = new Set<string>()
    config.rateChanges.forEach((change, index) => {
      if (typeof change.id !== 'string' || !change.id.trim()) errors.push(`Изменение ставки №${index + 1}: ID повреждён`)
      if (!finite(change.annualRate) || change.annualRate < 0 || change.annualRate > MAX_PERCENT) errors.push(`Изменение ставки №${index + 1}: ставка должна быть от 0 до ${MAX_PERCENT}%`)
      if (!isISODate(change.date)) {
        errors.push(`Изменение ставки №${index + 1}: дата должна быть корректной`)
      } else {
        if (isISODate(config.issueDate) && change.date <= config.issueDate) errors.push(`Изменение ставки №${index + 1}: дата должна быть после выдачи кредита`)
        if (isISODate(config.issueDate) && change.date > config.issueDate && exceedsCalendarHorizon(config.issueDate, change.date)) errors.push(horizonError(`Изменение ставки №${index + 1}`))
        if (rateChangeDates.has(change.date)) errors.push(`Изменение ставки №${index + 1}: дата дублируется`)
        rateChangeDates.add(change.date)
      }
    })
  }
  return errors
}

export function validateScenario(config: LoanConfig, repayments: EarlyRepayment[], gracePeriods: GracePeriod[]) {
  const errors = validateLoan(config)
  const configDatesValid = isISODate(config.issueDate) && isISODate(config.firstPaymentDate) && config.firstPaymentDate > config.issueDate
  const regularDates = errors.length === 0
    ? regularPaymentDateMatches(repayments.filter(item => isISODate(item.date) && item.amountMode !== 'extra').map(item => item.date), config)
    : new Set<string>()
  if (repayments.length > MAX_EARLY_REPAYMENTS) errors.push(`Количество досрочных платежей не должно превышать ${MAX_EARLY_REPAYMENTS}`)
  if (gracePeriods.length > MAX_GRACE_PERIODS) errors.push(`Количество льготных периодов не должно превышать ${MAX_GRACE_PERIODS}`)
  const totalRepaymentsByDate = new Map<string, number>()
  repayments.forEach((repayment, index) => {
    if (repayment.enabled !== undefined && typeof repayment.enabled !== 'boolean') errors.push(`Досрочный платёж №${index + 1}: признак активности повреждён`)
    if (!finite(repayment.amount) || repayment.amount < 0) errors.push(`Досрочный платёж №${index + 1}: сумма не может быть отрицательной`)
    else if (repayment.amount > MAX_MONEY_AMOUNT) errors.push(`Досрочный платёж №${index + 1}: сумма не должна превышать ${MAX_MONEY_AMOUNT}`)
    if (repayment.sameDaySequence !== undefined && (!Number.isInteger(repayment.sameDaySequence) || repayment.sameDaySequence < 0)) errors.push(`Досрочный платёж №${index + 1}: порядок применения повреждён`)
    if (!oneOf(repayment.strategy, repaymentStrategies)) errors.push(`Досрочный платёж №${index + 1}: стратегия повреждена`)
    if (!oneOf(repayment.source, repaymentSources)) errors.push(`Досрочный платёж №${index + 1}: источник повреждён`)
    if (!oneOf(repayment.sameDayOrder, sameDayOrders)) errors.push(`Досрочный платёж №${index + 1}: порядок в дату платежа повреждён`)
    if (typeof repayment.interestFirst !== 'boolean') errors.push(`Досрочный платёж №${index + 1}: правило погашения процентов повреждено`)
    const repaymentDateValid = isISODate(repayment.date)
    if (!repaymentDateValid) errors.push(`Досрочный платёж №${index + 1}: дата должна быть корректной`)
    else if (isISODate(config.issueDate) && repayment.date < config.issueDate) errors.push(`Досрочный платёж №${index + 1}: дата раньше выдачи кредита`)
    else if (isISODate(config.issueDate) && exceedsCalendarHorizon(config.issueDate, repayment.date)) errors.push(horizonError(`Досрочный платёж №${index + 1}`))
    const amountModeContext = repaymentDateValid && configDatesValid
      ? repaymentAmountModeContextForRegularDate(repayment, regularDates.has(repayment.date))
      : repaymentAmountModeContextForRegularDate(repayment, false)
    errors.push(...repaymentAmountModeValidationErrors(amountModeContext, `Досрочный платёж №${index + 1}`, { includeTotalDateErrors: repaymentDateValid }))
    if (repaymentDateValid && amountModeContext.countsAsTotalWithFee) totalRepaymentsByDate.set(repayment.date, (totalRepaymentsByDate.get(repayment.date) ?? 0) + 1)
  })
  totalRepaymentsByDate.forEach((count, date) => {
    if (count > 1) errors.push(`На дату ${date} можно указать только одну общую сумму списания с учётом комиссии`)
  })
  const requestedTotal = repayments.reduce((sum, repayment) => sum + repayment.amount, 0)
  if (!Number.isFinite(requestedTotal) || requestedTotal > MAX_FINANCIAL_RESULT) errors.push(`Сумма всех досрочных платежей не должна превышать ${MAX_FINANCIAL_RESULT}`)
  const sortedGrace = [...gracePeriods].sort((a, b) => a.startDate.localeCompare(b.startDate))
  sortedGrace.forEach((period, index) => {
    if (!isISODate(period.startDate)) errors.push(`Льготный период №${index + 1}: дата начала должна быть корректной`)
    if (!isISODate(period.endDate)) errors.push(`Льготный период №${index + 1}: дата окончания должна быть корректной`)
    if (isISODate(period.startDate) && isISODate(period.endDate) && period.endDate < period.startDate) errors.push(`Льготный период №${index + 1}: окончание раньше начала`)
    if (isISODate(config.issueDate) && isISODate(period.startDate) && period.startDate < config.issueDate) errors.push(`Льготный период №${index + 1}: дата начала раньше выдачи кредита`)
    if (isISODate(config.issueDate) && isISODate(period.startDate) && period.startDate >= config.issueDate && exceedsCalendarHorizon(config.issueDate, period.startDate)) errors.push(horizonError(`Льготный период №${index + 1}: дата начала`))
    if (isISODate(config.issueDate) && isISODate(period.endDate) && period.endDate >= config.issueDate && exceedsCalendarHorizon(config.issueDate, period.endDate)) errors.push(horizonError(`Льготный период №${index + 1}: дата окончания`))
    if (!oneOf(period.type, graceTypes)) errors.push(`Льготный период №${index + 1}: режим повреждён`)
    if (typeof period.extendTerm !== 'boolean') errors.push(`Льготный период №${index + 1}: правило продления срока повреждено`)
    if (typeof period.accrueInterest !== 'boolean') errors.push(`Льготный период №${index + 1}: правило начисления процентов повреждено`)
    if (typeof period.capitalizeInterest !== 'boolean') errors.push(`Льготный период №${index + 1}: правило капитализации процентов повреждено`)
    if (period.paymentAmount !== undefined && (!finite(period.paymentAmount) || period.paymentAmount < 0 || period.paymentAmount > MAX_MONEY_AMOUNT)) errors.push(`Льготный период №${index + 1}: индивидуальный платёж должен быть от 0 до ${MAX_MONEY_AMOUNT}`)
    if (index > 0 && isISODate(period.startDate) && isISODate(sortedGrace[index - 1].endDate) && period.startDate <= sortedGrace[index - 1].endDate) errors.push('Льготные периоды не должны пересекаться')
  })
  if (errors.length === 0) {
    try {
      if (contractCanExceedFourDigitCalendar(config)) errors.push('Договорная дата закрытия должна оставаться в четырёхзначном календаре')
      const paymentCalendar = preparePaymentCalendar(config, gracePeriods)
      const finalDate = contractualFinalPaymentDate(config, gracePeriods, paymentCalendar)
      if (exceedsFourDigitCalendar(finalDate)) errors.push('Договорная дата закрытия должна оставаться в четырёхзначном календаре')
      else if (exceedsCalendarHorizon(config.issueDate, finalDate)) errors.push(horizonError('Договорная дата закрытия'))
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Не удалось проверить договорную дату закрытия')
    }
  }
  return [...new Set(errors)]
}
