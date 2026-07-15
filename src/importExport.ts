import type { EarlyRepayment, GracePeriod, LoanConfig, RateChange } from './loanEngine'
import { regularPaymentDateMatches, repaymentAmountModeContextForRegularDate, repaymentAmountModeValidationErrors, sortRateChanges } from './loanEngine'
import { defaultConfig } from './loanDefaults'
import type { RepaymentRule } from './repaymentRules'
import { assertLoanCandidateValid } from './loanCandidate'
import { MAX_EARLY_REPAYMENTS, MAX_GRACE_PERIODS, MAX_ID_LENGTH, MAX_MONEY_AMOUNT, MAX_PAYMENT_DAY, MAX_PERCENT, MAX_RATE_CHANGES, MAX_REPAYMENT_RULES, MAX_RULE_SKIP_MONTHS, MAX_TERM_MONTHS, MAX_TEXT_FIELD_LENGTH } from './loanEngine/limits'
import { isISODate, isISOYearMonth } from './utils/dateValidation'
import { balanceMoments, dayCountBases, firstInterestOnlyModes, fontSizes, frequencies, graceTypes, interestMethods, isOneOf as oneOf, migrateLegacyDayCountBasis, paymentTypes, periodStarts, rateChangeModes, repaymentOperationSources, repaymentRuleTypes, repaymentSources, repaymentStrategies, roundingModes, sameDayOrders, scenarioIds, supportedCurrencies, termUnits, themeNames } from './portableSchemas'
import { normalizeAccentColor } from './accentColor'
import { BACKUP_FORMAT_VERSION } from './protocolVersions'
import { CURRENCY_DECIMAL_PLACES } from './constants'

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
const finite = (value: unknown, minimum = 0, maximum = MAX_MONEY_AMOUNT): value is number => typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
const integer = (value: unknown, minimum = 0): value is number => finite(value, minimum) && Number.isInteger(value)
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0
const hexColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
export const SUPPORTED_BACKUP_VERSIONS = [BACKUP_FORMAT_VERSION] as const
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
const requiredId = (value: unknown, label: string) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}: ID повреждён`)
  if (value.length > MAX_ID_LENGTH) throw new Error(`${label}: ID слишком длинный. Максимум: ${MAX_ID_LENGTH} символов`)
  return value
}
const optionalId = (value: unknown, label: string) => {
  if (value === undefined) return undefined
  return requiredId(value, label)
}
const optionalText = (value: unknown, label: string) => {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`${label} должно быть строкой`)
  ensureTextLength(value, label)
  return value
}
const valueOrDefault = <T>(value: unknown, fallback: T) => value === undefined ? fallback : value

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
  if (raw.version !== undefined && !SUPPORTED_BACKUP_VERSIONS.includes(raw.version as typeof BACKUP_FORMAT_VERSION)) {
    throw new Error(`Версия JSON-резервной копии ${String(raw.version)} не поддерживается. Поддерживается версия ${BACKUP_FORMAT_VERSION}`)
  }

  const source = raw.config
  if (source.interest !== undefined && !isObject(source.interest)) throw new Error('Правила начисления процентов повреждены')
  const interest = isObject(source.interest) ? source.interest : {}
  const importWarnings: string[] = []
  const dayCountBasisCandidate = migrateLegacyDayCountBasis(interest.dayCountBasis)
  if (interest.dayCountBasis === '365') importWarnings.push('Legacy-база 365 преобразована в однозначную Actual/365 без изменения расчёта')
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
  const config: LoanConfig = {
    principal: valueOrDefault(source.principal, defaultConfig.principal) as number,
    annualRate: valueOrDefault(source.annualRate, defaultConfig.annualRate) as number,
    rateChanges: [],
    rateChangeMode: explicitOneOfOrDefault(source.rateChangeMode, rateChangeModes, defaultConfig.rateChangeMode, 'Режим изменения ставки'),
    issueDate: valueOrDefault(source.issueDate, defaultConfig.issueDate) as string,
    firstPaymentDate: valueOrDefault(source.firstPaymentDate, defaultConfig.firstPaymentDate) as string,
    firstPaymentInterestOnly: explicitBooleanOrDefault(source.firstPaymentInterestOnly, defaultConfig.firstPaymentInterestOnly, 'Настройка первого платежа'),
    firstPaymentInterestOnlyMode: explicitOneOfOrDefault(source.firstPaymentInterestOnlyMode, firstInterestOnlyModes, 'addToTerm', 'Режим первого платежа'),
    termMonths: valueOrDefault(source.termMonths, defaultConfig.termMonths) as number,
    paymentDay: valueOrDefault(source.paymentDay, defaultConfig.paymentDay) as number,
    paymentType: explicitOneOfOrDefault(source.paymentType, paymentTypes, defaultConfig.paymentType, 'Тип платежа'),
    frequency: explicitOneOfOrDefault(source.frequency, frequencies, defaultConfig.frequency, 'Частота платежей'),
    currency,
    rounding: explicitOneOfOrDefault(source.rounding, roundingModes, defaultConfig.rounding, 'Режим округления'),
    closeThreshold: valueOrDefault(source.closeThreshold, defaultConfig.closeThreshold) as number,
    oneTimeFee: valueOrDefault(source.oneTimeFee, defaultConfig.oneTimeFee) as number,
    monthlyFee: valueOrDefault(source.monthlyFee, defaultConfig.monthlyFee) as number,
    earlyRepaymentFeePercent: valueOrDefault(source.earlyRepaymentFeePercent, defaultConfig.earlyRepaymentFeePercent) as number,
    interest: {
      method: explicitOneOfOrDefault(interest.method, interestMethods, defaultConfig.interest.method, 'Метод начисления процентов'),
      dayCountBasis: explicitOneOfOrDefault(dayCountBasisCandidate, dayCountBases, defaultConfig.interest.dayCountBasis, 'База расчёта дней'),
      includePaymentDate: explicitBooleanOrDefault(interest.includePaymentDate, defaultConfig.interest.includePaymentDate, 'Правило включения даты платежа'),
      periodStart: explicitOneOfOrDefault(interest.periodStart, periodStarts, defaultConfig.interest.periodStart, 'Начало процентного периода'),
      balanceMoment: explicitOneOfOrDefault(interest.balanceMoment, balanceMoments, defaultConfig.interest.balanceMoment, 'Момент остатка для процентов')
    }
  }
  if (!positive(config.principal) || config.principal > MAX_MONEY_AMOUNT || !finite(config.annualRate, 0, MAX_PERCENT) || !integer(config.termMonths, 1) || config.termMonths > MAX_TERM_MONTHS || !integer(config.paymentDay, 1) || config.paymentDay > MAX_PAYMENT_DAY || !finite(config.closeThreshold) || !finite(config.oneTimeFee) || !finite(config.monthlyFee) || !finite(config.earlyRepaymentFeePercent, 0, MAX_PERCENT)) throw new Error('Параметры кредита содержат недопустимые числа')
  if (!isISODate(config.issueDate) || !isISODate(config.firstPaymentDate)) throw new Error('Проверьте даты выдачи и первого платежа')
  if (config.firstPaymentDate <= config.issueDate) throw new Error('Первый платёж должен быть после даты выдачи')
  const rateChangesRaw = source.rateChanges === undefined ? [] : source.rateChanges
  if (!Array.isArray(rateChangesRaw)) throw new Error('История ставок повреждена')
  if (rateChangesRaw.length > MAX_RATE_CHANGES) throw new Error(`Слишком много изменений ставки. Максимум: ${MAX_RATE_CHANGES}`)
  const rateChanges = sortRateChanges(rateChangesRaw.map((item, index): RateChange => {
    if (!isObject(item) || !isISODate(item.date) || typeof item.annualRate !== 'number' || !Number.isFinite(item.annualRate) || item.annualRate < 0 || item.annualRate > MAX_PERCENT) throw new Error(`Ошибка в изменении ставки №${index + 1}`)
    if (item.date <= config.issueDate) throw new Error(`Ошибка в изменении ставки №${index + 1}: дата должна быть после выдачи кредита`)
    return { id: requiredId(item.id, `Ошибка в изменении ставки №${index + 1}`), date: item.date, annualRate: item.annualRate }
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
    const label = `Ошибка в досрочном платеже №${index + 1}`
    if (!isObject(item) || !isISODate(item.date) || !finite(item.amount) || !oneOf(item.strategy, repaymentStrategies) || !oneOf(item.source, repaymentSources) || !oneOf(item.sameDayOrder, sameDayOrders) || typeof item.interestFirst !== 'boolean') throw new Error(label)
    const id = requiredId(item.id, label)
    if (item.enabled !== undefined && typeof item.enabled !== 'boolean') throw new Error(`Ошибка в досрочном платеже №${index + 1}`)
    if (item.operationSource !== undefined && !oneOf(item.operationSource, repaymentOperationSources)) throw new Error(`Ошибка в досрочном платеже №${index + 1}: источник операции повреждён`)
    const sourceRuleId = optionalId(item.sourceRuleId, `${label}: правило-источник`)
    const comment = optionalText(item.comment, `Комментарий досрочного платежа №${index + 1}`)
    const sameDaySequence = typeof item.sameDaySequence === 'number' && Number.isInteger(item.sameDaySequence) && item.sameDaySequence >= 0 ? item.sameDaySequence : undefined
    if (item.sameDaySequence !== undefined && sameDaySequence === undefined) throw new Error(`Ошибка в досрочном платеже №${index + 1}`)
    const context = repaymentAmountModeContextForRegularDate({
      amount: item.amount,
      amountMode: item.amountMode,
      enabled: item.enabled,
      sameDayOrder: item.sameDayOrder
    }, regularRepaymentDates.has(item.date))
    const amountModeErrors = repaymentAmountModeValidationErrors(context, label, {
      invalidMode: label,
      totalBeforeRegularPayment: `${label}: общая сумма списания с учётом комиссии применяется после регулярного платежа`
    })
    const amountMode = context.normalizedAmountMode
    if (amountModeErrors.length || amountMode === null) throw new Error(amountModeErrors[0] ?? label)
    if (item.amountMode === undefined) importWarnings.push(`${label}: отсутствующий legacy amountMode преобразован в ${amountMode}`)
    else if (item.amountMode === 'total') importWarnings.push(`${label}: legacy amountMode total преобразован в totalWithFee`)
    const enabled = item.enabled ?? true
    return {
      id,
      date: item.date,
      amount: item.amount,
      enabled,
      amountMode,
      sameDaySequence: sameDaySequence ?? index,
      ...(item.operationSource !== undefined ? { operationSource: item.operationSource } : {}),
      ...(sourceRuleId !== undefined ? { sourceRuleId } : {}),
      strategy: item.strategy,
      source: item.source,
      sameDayOrder: amountMode === 'totalWithFee' ? 'regularFirst' : item.sameDayOrder,
      interestFirst: item.interestFirst,
      ...(comment !== undefined ? { comment } : {})
    } satisfies EarlyRepayment
  })
  ensureUniqueIds(repayments, 'Досрочные платежи')
  ensureUniqueSameDaySequences(repayments)
  ensureUniqueIds(repayments.filter(item => item.enabled !== false && item.amount > 0 && item.amountMode === 'totalWithFee').map(item => ({ id: item.date })), 'Операции с общей суммой списания с учётом комиссии')

  const graceRaw = raw.gracePeriods ?? []
  if (!Array.isArray(graceRaw)) throw new Error('Список льготных периодов повреждён')
  if (graceRaw.length > MAX_GRACE_PERIODS) throw new Error(`Слишком много льготных периодов. Максимум: ${MAX_GRACE_PERIODS}`)
  const gracePeriods = graceRaw.map((item, index) => {
    const label = `Ошибка в льготном периоде №${index + 1}`
    if (!isObject(item) || !isISODate(item.startDate) || !isISODate(item.endDate) || !oneOf(item.type, graceTypes) || typeof item.extendTerm !== 'boolean' || typeof item.accrueInterest !== 'boolean' || typeof item.capitalizeInterest !== 'boolean') throw new Error(label)
    const id = requiredId(item.id, label)
    if (item.endDate < item.startDate) throw new Error(`Ошибка в льготном периоде №${index + 1}: окончание раньше начала`)
    if (item.paymentAmount !== undefined && !finite(item.paymentAmount)) throw new Error(`Ошибка в льготном периоде №${index + 1}`)
    return {
      id,
      startDate: item.startDate,
      endDate: item.endDate,
      type: item.type,
      ...(item.paymentAmount !== undefined ? { paymentAmount: item.paymentAmount } : {}),
      extendTerm: item.extendTerm,
      accrueInterest: item.accrueInterest,
      capitalizeInterest: item.capitalizeInterest
    } satisfies GracePeriod
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
    const label = `Ошибка в правиле досрочных платежей №${index + 1}`
    if (!isObject(item) || typeof item.name !== 'string' || !oneOf(item.type, repaymentRuleTypes) || !isISODate(item.startDate) || !isISODate(item.endDate) || !oneOf(item.strategy, repaymentStrategies) || !oneOf(item.source, repaymentSources) || !oneOf(item.sameDayOrder, sameDayOrders) || typeof item.interestFirst !== 'boolean' || !Array.isArray(item.skipMonths)) throw new Error(label)
    const id = requiredId(item.id, label)
    if (item.skipMonths.length > MAX_RULE_SKIP_MONTHS) throw new Error(`Ошибка в правиле досрочных платежей №${index + 1}: слишком много месяцев пропуска. Максимум: ${MAX_RULE_SKIP_MONTHS}`)
    if (!item.skipMonths.every(isISOYearMonth)) throw new Error(`Ошибка в правиле досрочных платежей №${index + 1}`)
    ensureTextLength(item.name, `Название правила досрочных платежей №${index + 1}`)
    const comment = optionalText(item.comment, `Комментарий правила досрочных платежей №${index + 1}`)
    if (item.endDate < item.startDate) throw new Error(`Ошибка в правиле досрочных платежей №${index + 1}: окончание раньше начала`)
    if (item.type === 'paymentPercent' ? item.percent === undefined : item.amount === undefined) throw new Error(`Ошибка в правиле досрочных платежей №${index + 1}`)
    if (item.amount !== undefined && !finite(item.amount)) throw new Error(`Ошибка в правиле досрочных платежей №${index + 1}`)
    if (item.percent !== undefined && !finite(item.percent, 0, MAX_PERCENT)) throw new Error(`Ошибка в правиле досрочных платежей №${index + 1}`)
    if (item.enabled !== undefined && typeof item.enabled !== 'boolean') throw new Error(`Ошибка в правиле досрочных платежей №${index + 1}`)
    const ruleSequence = typeof item.ruleSequence === 'number' && Number.isInteger(item.ruleSequence) && item.ruleSequence >= 0 ? item.ruleSequence : undefined
    if (item.ruleSequence !== undefined && ruleSequence === undefined) throw new Error(`Ошибка в правиле досрочных платежей №${index + 1}: порядок повреждён`)
    return {
      id,
      name: item.name,
      ...(ruleSequence !== undefined ? { ruleSequence } : {}),
      type: item.type,
      startDate: item.startDate,
      endDate: item.endDate,
      ...(item.amount !== undefined ? { amount: item.amount } : {}),
      ...(item.percent !== undefined ? { percent: item.percent } : {}),
      enabled: item.enabled ?? true,
      strategy: item.strategy,
      source: item.source,
      sameDayOrder: item.type === 'monthlyTotalPayment' ? 'regularFirst' : item.sameDayOrder,
      interestFirst: item.interestFirst,
      skipMonths: [...new Set(item.skipMonths)],
      ...(comment !== undefined ? { comment } : {})
    } satisfies RepaymentRule
  })
  ensureUniqueIds(repaymentRules, 'Правила досрочных платежей')
  ensureUniqueRuleSequences(repaymentRules)

  const settings = isObject(raw.settings) ? raw.settings : raw
  const name = optionalText(raw.name, 'Название кредита')
  const scenarioFromLegacyExport = isObject(raw.scenario) && typeof raw.scenario.id === 'string' ? raw.scenario.id : undefined
  const selectedCandidate = typeof raw.selectedScenario === 'string' ? raw.selectedScenario : scenarioFromLegacyExport ?? 'reduceTerm'
  if (!oneOf(selectedCandidate, scenarioIds)) throw new Error('Файл содержит неизвестный сценарий')
  const selectedScenario = selectedCandidate
  const termUnit = oneOf(settings.termUnit, termUnits) ? settings.termUnit : 'months'
  const displayDecimals = settings.displayDecimals === 0 ? 0 : CURRENCY_DECIMAL_PLACES
  const appFontSize = oneOf(settings.appFontSize, fontSizes) ? settings.appFontSize : 'normal'
  const scheduleFontSize = oneOf(settings.scheduleFontSize, fontSizes) ? settings.scheduleFontSize : 'large'
  const theme = oneOf(settings.theme, themeNames) ? settings.theme : 'emerald'
  const customAccentColor = normalizeAccentColor(hexColor(settings.customAccentColor) ? settings.customAccentColor : undefined)
  const useCustomAccentColor = typeof settings.useCustomAccentColor === 'boolean' ? settings.useCustomAccentColor : false
  const result: ValidatedLoanData = { __validatedLoanData: VALIDATED_LOAN_DATA_MARKER, name, config, repayments, repaymentRules, gracePeriods, selectedScenario, termUnit, displayDecimals, appFontSize, scheduleFontSize, theme, customAccentColor, useCustomAccentColor, ...(importWarnings.length ? { importWarnings } : {}) }
  assertLoanCandidateValid(config, repayments, repaymentRules, gracePeriods)
  return result
}
