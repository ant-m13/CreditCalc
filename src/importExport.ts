import type { EarlyRepayment, GracePeriod, LoanConfig, RateChange } from './loanEngine'
import { regularPaymentDateMatches, repaymentAmountModeContextForRegularDate, repaymentAmountModeValidationErrors, sortRateChanges } from './loanEngine'
import { defaultConfig } from './loanDefaults'
import type { RepaymentRule } from './repaymentRules'
import { assertLoanCandidateValid } from './loanCandidate'
import { MAX_EARLY_REPAYMENTS, MAX_GRACE_PERIODS, MAX_MONEY_AMOUNT, MAX_PERCENT, MAX_RATE_CHANGES, MAX_REPAYMENT_RULES, MAX_RULE_SKIP_MONTHS, MAX_TERM_MONTHS, MAX_TEXT_FIELD_LENGTH } from './loanEngine/limits'
import { isISODate, isISOYearMonth } from './utils/dateValidation'
import { balanceMoments, dayCountBases, fontSizes, frequencies, graceTypes, interestMethods, isOneOf as oneOf, paymentTypes, periodStarts, rateChangeModes, repaymentOperationSources, repaymentRuleTypes, repaymentSources, repaymentStrategies, roundingModes, sameDayOrders, scenarioIds, supportedCurrencies, termUnits, themeNames } from './portableSchemas'

export interface LoanBackupData {
  name?: string
  config: LoanConfig
  repayments: EarlyRepayment[]
  repaymentRules: RepaymentRule[]
  gracePeriods: GracePeriod[]
  selectedScenario: string
  termUnit: 'months' | 'years'
  displayDecimals: 0 | 2
  appFontSize?: 'normal' | 'large' | 'xlarge'
  scheduleFontSize?: 'normal' | 'large' | 'xlarge'
  theme: 'emerald' | 'ocean' | 'violet' | 'graphite' | 'warm' | 'night'
  customAccentColor?: string
  useCustomAccentColor?: boolean
  importWarnings?: string[]
}

export const VALIDATED_LOAN_DATA_MARKER = 'validated-loan-data-v1' as const
export interface ValidatedLoanData extends LoanBackupData {
  readonly __validatedLoanData: typeof VALIDATED_LOAN_DATA_MARKER
}
export const isValidatedLoanData = (value: unknown): value is ValidatedLoanData =>
  isObject(value) && value.__validatedLoanData === VALIDATED_LOAN_DATA_MARKER

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const finite = (value: unknown, minimum = 0, maximum = MAX_MONEY_AMOUNT) => typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
const integer = (value: unknown, minimum = 0) => finite(value, minimum) && Number.isInteger(value)
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0
const hexColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
export const SUPPORTED_BACKUP_VERSIONS = [1] as const
const explicitOneOfOrDefault = <T extends string>(value: unknown, values: readonly T[], fallback: T, label: string): T => {
  if (value === undefined) return fallback
  if (oneOf(value, values)) return value
  throw new Error(`${label} содержит недопустимое значение`)
}
const explicitBooleanOrDefault = (value: unknown, fallback: boolean, label: string) => {
  if (value === undefined) return fallback
  if (typeof value === 'boolean') return value
  throw new Error(`${label} содержит недопустимое значение`)
}
const ensureTextLength = (value: unknown, label: string) => {
  if (typeof value === 'string' && value.length > MAX_TEXT_FIELD_LENGTH) throw new Error(`${label} слишком длинное. Максимум: ${MAX_TEXT_FIELD_LENGTH} символов`)
}

const ensureUniqueIds = (items: { id: string }[], label: string) => {
  const seen = new Set<string>()
  for (const item of items) {
    if (seen.has(item.id)) throw new Error(`${label} содержат дублирующийся ID: ${item.id}`)
    seen.add(item.id)
  }
}

const ensureUniqueSameDaySequences = (repayments: EarlyRepayment[]) => {
  const seen = new Set<string>()
  repayments.forEach(item => {
    const key = `${item.date}:${item.sameDaySequence}`
    if (seen.has(key)) throw new Error(`Досрочные платежи содержат дублирующийся порядок в дату ${item.date}: ${item.sameDaySequence}`)
    seen.add(key)
  })
}

const ensureUniqueRuleSequences = (rules: RepaymentRule[]) => {
  const seen = new Set<number>()
  rules.forEach((item, index) => {
    const sequence = item.ruleSequence ?? index
    if (seen.has(sequence)) throw new Error(`Правила досрочных платежей содержат дублирующийся порядок: ${sequence}`)
    seen.add(sequence)
  })
}

export function parseLoanBackup(text: string): ValidatedLoanData {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new Error('Файл не является корректным JSON') }
  return parseLoanBackupObject(raw)
}

export function parseLoanBackupObject(raw: unknown): ValidatedLoanData {
  if (!isObject(raw) || !isObject(raw.config)) throw new Error('В файле отсутствуют параметры кредита')
  if (raw.version !== undefined && !SUPPORTED_BACKUP_VERSIONS.includes(raw.version as 1)) {
    throw new Error(`Версия JSON-резервной копии ${String(raw.version)} не поддерживается. Поддерживается версия 1`)
  }

  const source = raw.config
  if (source.interest !== undefined && !isObject(source.interest)) throw new Error('Правила начисления процентов повреждены')
  const interest = isObject(source.interest) ? source.interest : {}
  const importWarnings: string[] = []
  let currency: LoanConfig['currency']
  if (source.currency === undefined) {
    currency = defaultConfig.currency
    importWarnings.push(`В файле не указана валюта, используется ${defaultConfig.currency}`)
  } else if (oneOf(source.currency, supportedCurrencies)) {
    currency = source.currency
  } else if (source.currency === 'RUR') {
    currency = 'RUB'
    importWarnings.push('Legacy-код валюты RUR преобразован в RUB без конвертации суммы')
  } else {
    throw new Error(`Валюта ${String(source.currency)} не поддерживается`)
  }
  const config = {
    ...defaultConfig,
    ...source,
    firstPaymentInterestOnly: explicitBooleanOrDefault(source.firstPaymentInterestOnly, defaultConfig.firstPaymentInterestOnly, 'Настройка первого платежа'),
    paymentType: explicitOneOfOrDefault(source.paymentType, paymentTypes, defaultConfig.paymentType, 'Тип платежа'),
    frequency: explicitOneOfOrDefault(source.frequency, frequencies, defaultConfig.frequency, 'Частота платежей'),
    currency,
    rounding: explicitOneOfOrDefault(source.rounding, roundingModes, defaultConfig.rounding, 'Режим округления'),
    interest: {
      ...defaultConfig.interest,
      ...interest,
      method: explicitOneOfOrDefault(interest.method, interestMethods, defaultConfig.interest.method, 'Метод начисления процентов'),
      dayCountBasis: explicitOneOfOrDefault(interest.dayCountBasis, dayCountBases, defaultConfig.interest.dayCountBasis, 'База расчёта дней'),
      includePaymentDate: explicitBooleanOrDefault(interest.includePaymentDate, defaultConfig.interest.includePaymentDate, 'Правило включения даты платежа'),
      periodStart: explicitOneOfOrDefault(interest.periodStart, periodStarts, defaultConfig.interest.periodStart, 'Начало процентного периода'),
      balanceMoment: explicitOneOfOrDefault(interest.balanceMoment, balanceMoments, defaultConfig.interest.balanceMoment, 'Момент остатка для процентов')
    }
  } as LoanConfig
  if (!positive(config.principal) || config.principal > MAX_MONEY_AMOUNT || !finite(config.annualRate, 0, MAX_PERCENT) || !integer(config.termMonths, 1) || config.termMonths > MAX_TERM_MONTHS || !integer(config.paymentDay, 1) || config.paymentDay > 31 || !finite(config.closeThreshold) || !finite(config.oneTimeFee) || !finite(config.monthlyFee) || !finite(config.earlyRepaymentFeePercent, 0, MAX_PERCENT)) throw new Error('Параметры кредита содержат недопустимые числа')
  if (!isISODate(config.issueDate) || !isISODate(config.firstPaymentDate)) throw new Error('Проверьте даты выдачи и первого платежа')
  if (config.firstPaymentDate <= config.issueDate) throw new Error('Первый платёж должен быть после даты выдачи')
  config.rateChangeMode = explicitOneOfOrDefault(source.rateChangeMode, rateChangeModes, defaultConfig.rateChangeMode, 'Режим изменения ставки')

  const rateChangesRaw = source.rateChanges === undefined ? [] : source.rateChanges
  if (!Array.isArray(rateChangesRaw)) throw new Error('История ставок повреждена')
  if (rateChangesRaw.length > MAX_RATE_CHANGES) throw new Error(`Слишком много изменений ставки. Максимум: ${MAX_RATE_CHANGES}`)
  const rateChanges = sortRateChanges(rateChangesRaw.map((item, index): RateChange => {
    if (!isObject(item) || typeof item.id !== 'string' || !isISODate(item.date) || typeof item.annualRate !== 'number' || !Number.isFinite(item.annualRate) || item.annualRate < 0 || item.annualRate > MAX_PERCENT) throw new Error(`Ошибка в изменении ставки №${index + 1}`)
    if (item.date <= config.issueDate) throw new Error(`Ошибка в изменении ставки №${index + 1}: дата должна быть после выдачи кредита`)
    return { id: item.id, date: item.date, annualRate: item.annualRate }
  }))
  ensureUniqueIds(rateChanges, 'Изменения ставки')
  ensureUniqueIds(rateChanges.map(item => ({ id: item.date })), 'Даты изменения ставки')
  config.rateChanges = rateChanges

  const repaymentsRaw = raw.repayments ?? []
  if (!Array.isArray(repaymentsRaw)) throw new Error('Список досрочных платежей повреждён')
  if (repaymentsRaw.length > MAX_EARLY_REPAYMENTS) throw new Error(`Слишком много досрочных платежей. Максимум: ${MAX_EARLY_REPAYMENTS}`)
  const regularRepaymentDates = regularPaymentDateMatches(repaymentsRaw.flatMap(item =>
    isObject(item) && isISODate(item.date) && item.amountMode !== 'extra' ? [item.date] : []
  ), config)
  const repayments = repaymentsRaw.map((item, index) => {
    if (!isObject(item) || typeof item.id !== 'string' || !isISODate(item.date) || !finite(item.amount) || !oneOf(item.strategy, repaymentStrategies) || !oneOf(item.source, repaymentSources) || !oneOf(item.sameDayOrder, sameDayOrders) || typeof item.interestFirst !== 'boolean') throw new Error(`Ошибка в досрочном платеже №${index + 1}`)
    if (item.enabled !== undefined && typeof item.enabled !== 'boolean') throw new Error(`Ошибка в досрочном платеже №${index + 1}`)
    if (item.operationSource !== undefined && !oneOf(item.operationSource, repaymentOperationSources)) throw new Error(`Ошибка в досрочном платеже №${index + 1}: источник операции повреждён`)
    if (item.sourceRuleId !== undefined && typeof item.sourceRuleId !== 'string') throw new Error(`Ошибка в досрочном платеже №${index + 1}: ID правила повреждён`)
    ensureTextLength(item.comment, `Комментарий досрочного платежа №${index + 1}`)
    const sameDaySequence = typeof item.sameDaySequence === 'number' && Number.isInteger(item.sameDaySequence) && item.sameDaySequence >= 0 ? item.sameDaySequence : undefined
    if (item.sameDaySequence !== undefined && sameDaySequence === undefined) throw new Error(`Ошибка в досрочном платеже №${index + 1}`)
    const context = repaymentAmountModeContextForRegularDate({
      amount: item.amount,
      amountMode: item.amountMode,
      enabled: item.enabled,
      sameDayOrder: item.sameDayOrder
    }, regularRepaymentDates.has(item.date))
    const label = `Ошибка в досрочном платеже №${index + 1}`
    const amountModeErrors = repaymentAmountModeValidationErrors(context, label, {
      invalidMode: label,
      totalBeforeRegularPayment: `${label}: общая сумма списания с учётом комиссии применяется после регулярного платежа`
    })
    const amountMode = context.normalizedAmountMode
    if (amountModeErrors.length || amountMode === null) throw new Error(amountModeErrors[0] ?? label)
    if (item.amountMode === undefined) importWarnings.push(`${label}: отсутствующий legacy amountMode преобразован в ${amountMode}`)
    else if (item.amountMode === 'total') importWarnings.push(`${label}: legacy amountMode total преобразован в totalWithFee`)
    const enabled = item.enabled ?? true
    return { ...item, enabled, amountMode, sameDaySequence: sameDaySequence ?? index, sameDayOrder: amountMode === 'totalWithFee' ? 'regularFirst' : item.sameDayOrder } as unknown as EarlyRepayment
  })
  ensureUniqueIds(repayments, 'Досрочные платежи')
  ensureUniqueSameDaySequences(repayments)
  ensureUniqueIds(repayments.filter(item => item.enabled !== false && item.amount > 0 && item.amountMode === 'totalWithFee').map(item => ({ id: item.date })), 'Операции с общей суммой списания с учётом комиссии')

  const graceRaw = raw.gracePeriods ?? []
  if (!Array.isArray(graceRaw)) throw new Error('Список льготных периодов повреждён')
  if (graceRaw.length > MAX_GRACE_PERIODS) throw new Error(`Слишком много льготных периодов. Максимум: ${MAX_GRACE_PERIODS}`)
  const gracePeriods = graceRaw.map((item, index) => {
    if (!isObject(item) || typeof item.id !== 'string' || !isISODate(item.startDate) || !isISODate(item.endDate) || !oneOf(item.type, graceTypes) || typeof item.extendTerm !== 'boolean' || typeof item.accrueInterest !== 'boolean' || typeof item.capitalizeInterest !== 'boolean') throw new Error(`Ошибка в льготном периоде №${index + 1}`)
    if (item.endDate < item.startDate) throw new Error(`Ошибка в льготном периоде №${index + 1}: окончание раньше начала`)
    if (item.paymentAmount !== undefined && !finite(item.paymentAmount)) throw new Error(`Ошибка в льготном периоде №${index + 1}`)
    return item as unknown as GracePeriod
  })
  ensureUniqueIds(gracePeriods, 'Льготные периоды')
  const sortedGrace = [...gracePeriods].sort((a, b) => a.startDate.localeCompare(b.startDate))
  sortedGrace.forEach((period, index) => {
    if (index > 0 && period.startDate <= sortedGrace[index - 1].endDate) throw new Error('Льготные периоды не должны пересекаться')
  })

  const rulesRaw = raw.repaymentRules ?? []
  if (!Array.isArray(rulesRaw)) throw new Error('Список правил досрочных платежей повреждён')
  if (rulesRaw.length > MAX_REPAYMENT_RULES) throw new Error(`Слишком много правил досрочных платежей. Максимум: ${MAX_REPAYMENT_RULES}`)
  const repaymentRules = rulesRaw.map((item, index) => {
    if (!isObject(item) || typeof item.id !== 'string' || typeof item.name !== 'string' || !oneOf(item.type, repaymentRuleTypes) || !isISODate(item.startDate) || !isISODate(item.endDate) || !oneOf(item.strategy, repaymentStrategies) || !oneOf(item.source, repaymentSources) || !oneOf(item.sameDayOrder, sameDayOrders) || typeof item.interestFirst !== 'boolean' || !Array.isArray(item.skipMonths)) throw new Error(`Ошибка в правиле досрочных платежей №${index + 1}`)
    if (item.skipMonths.length > MAX_RULE_SKIP_MONTHS) throw new Error(`Ошибка в правиле досрочных платежей №${index + 1}: слишком много месяцев пропуска. Максимум: ${MAX_RULE_SKIP_MONTHS}`)
    if (!item.skipMonths.every(isISOYearMonth)) throw new Error(`Ошибка в правиле досрочных платежей №${index + 1}`)
    ensureTextLength(item.name, `Название правила досрочных платежей №${index + 1}`)
    ensureTextLength(item.comment, `Комментарий правила досрочных платежей №${index + 1}`)
    if (item.endDate < item.startDate) throw new Error(`Ошибка в правиле досрочных платежей №${index + 1}: окончание раньше начала`)
    if (item.type === 'paymentPercent' ? item.percent === undefined : item.amount === undefined) throw new Error(`Ошибка в правиле досрочных платежей №${index + 1}`)
    if (item.amount !== undefined && !finite(item.amount)) throw new Error(`Ошибка в правиле досрочных платежей №${index + 1}`)
    if (item.percent !== undefined && !finite(item.percent, 0, MAX_PERCENT)) throw new Error(`Ошибка в правиле досрочных платежей №${index + 1}`)
    if (item.enabled !== undefined && typeof item.enabled !== 'boolean') throw new Error(`Ошибка в правиле досрочных платежей №${index + 1}`)
    if (item.comment !== undefined && typeof item.comment !== 'string') throw new Error(`Ошибка в правиле досрочных платежей №${index + 1}`)
    const ruleSequence = typeof item.ruleSequence === 'number' && Number.isInteger(item.ruleSequence) && item.ruleSequence >= 0 ? item.ruleSequence : undefined
    if (item.ruleSequence !== undefined && ruleSequence === undefined) throw new Error(`Ошибка в правиле досрочных платежей №${index + 1}: порядок повреждён`)
    return { ...item, skipMonths: [...new Set(item.skipMonths)], ...(ruleSequence !== undefined ? { ruleSequence } : {}), enabled: item.enabled ?? true, sameDayOrder: item.type === 'monthlyTotalPayment' ? 'regularFirst' : item.sameDayOrder } as unknown as RepaymentRule
  })
  ensureUniqueIds(repaymentRules, 'Правила досрочных платежей')
  ensureUniqueRuleSequences(repaymentRules)

  const settings = isObject(raw.settings) ? raw.settings : raw
  ensureTextLength(raw.name, 'Название кредита')
  const name = typeof raw.name === 'string' ? raw.name : undefined
  const scenarioFromLegacyExport = isObject(raw.scenario) && typeof raw.scenario.id === 'string' ? raw.scenario.id : undefined
  const selectedCandidate = typeof raw.selectedScenario === 'string' ? raw.selectedScenario : scenarioFromLegacyExport ?? 'reduceTerm'
  if (!oneOf(selectedCandidate, scenarioIds)) throw new Error('Файл содержит неизвестный сценарий')
  const selectedScenario = selectedCandidate
  const termUnit = oneOf(settings.termUnit, termUnits) ? settings.termUnit : 'months'
  const displayDecimals = settings.displayDecimals === 0 ? 0 : 2
  const appFontSize = oneOf(settings.appFontSize, fontSizes) ? settings.appFontSize : 'normal'
  const scheduleFontSize = oneOf(settings.scheduleFontSize, fontSizes) ? settings.scheduleFontSize : 'large'
  const theme = oneOf(settings.theme, themeNames) ? settings.theme : 'emerald'
  const customAccentColor = hexColor(settings.customAccentColor) ? settings.customAccentColor : '#0b9873'
  const useCustomAccentColor = typeof settings.useCustomAccentColor === 'boolean' ? settings.useCustomAccentColor : false
  const result: ValidatedLoanData = { __validatedLoanData: VALIDATED_LOAN_DATA_MARKER, name, config, repayments, repaymentRules, gracePeriods, selectedScenario, termUnit, displayDecimals, appFontSize, scheduleFontSize, theme, customAccentColor, useCustomAccentColor, ...(importWarnings.length ? { importWarnings } : {}) }
  assertLoanCandidateValid(config, repayments, repaymentRules, gracePeriods)
  return result
}
