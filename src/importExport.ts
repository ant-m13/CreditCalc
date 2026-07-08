import type { EarlyRepayment, GracePeriod, LoanConfig, RateChange } from './loanEngine'
import { repaymentAmountModeContext, repaymentAmountModeValidationErrors, sortRateChanges, supportedCurrencies } from './loanEngine'
import { defaultConfig } from './loanDefaults'
import type { RepaymentRule } from './repaymentRules'
import { assertLoanCandidateValid } from './loanCandidate'
import { MAX_EARLY_REPAYMENTS, MAX_GRACE_PERIODS, MAX_RATE_CHANGES, MAX_REPAYMENT_RULES, MAX_RULE_SKIP_MONTHS, MAX_TERM_MONTHS, MAX_TEXT_FIELD_LENGTH } from './loanEngine/limits'
import { isISODate, isISOYearMonth } from './utils/dateValidation'

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

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const oneOf = <T extends string>(value: unknown, values: readonly T[]): value is T => typeof value === 'string' && values.includes(value as T)
const finite = (value: unknown, minimum = 0) => typeof value === 'number' && Number.isFinite(value) && value >= minimum
const integer = (value: unknown, minimum = 0) => finite(value, minimum) && Number.isInteger(value)
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0
const hexColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
const paymentTypes = ['annuity', 'differentiated'] as const
const frequencies = ['monthly', 'biweekly', 'quarterly'] as const
const roundingModes = ['kopecks', 'rubles', 'bank'] as const
const interestMethods = ['annuity', 'daily'] as const
const dayCountBases = ['365', '366', '360', 'actual365', 'actualActual'] as const
const periodStarts = ['inclusive', 'exclusive'] as const
const balanceMoments = ['startOfDay', 'endOfDay'] as const
const scenarioIds = ['base', 'reduceTerm', 'reducePayment', 'combined'] as const
const oneOfOrDefault = <T extends string>(value: unknown, values: readonly T[], fallback: T): T => oneOf(value, values) ? value : fallback
const booleanOrDefault = (value: unknown, fallback: boolean) => typeof value === 'boolean' ? value : fallback
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

export function parseLoanBackup(text: string): LoanBackupData {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new Error('Файл не является корректным JSON') }
  return parseLoanBackupObject(raw)
}

export function parseLoanBackupObject(raw: unknown): LoanBackupData {
  if (!isObject(raw) || !isObject(raw.config)) throw new Error('В файле отсутствуют параметры кредита')

  const source = raw.config
  const interest = isObject(source.interest) ? source.interest : {}
  const importWarnings: string[] = []
  const currency = oneOf(source.currency, supportedCurrencies) ? source.currency : defaultConfig.currency
  if (source.currency !== undefined && !oneOf(source.currency, supportedCurrencies)) {
    importWarnings.push(`Валюта ${String(source.currency)} не поддерживается и заменена на ${defaultConfig.currency}`)
  }
  const config = {
    ...defaultConfig,
    ...source,
    firstPaymentInterestOnly: booleanOrDefault(source.firstPaymentInterestOnly, defaultConfig.firstPaymentInterestOnly),
    paymentType: oneOfOrDefault(source.paymentType, paymentTypes, defaultConfig.paymentType),
    frequency: oneOfOrDefault(source.frequency, frequencies, defaultConfig.frequency),
    currency,
    rounding: oneOfOrDefault(source.rounding, roundingModes, defaultConfig.rounding),
    interest: {
      ...defaultConfig.interest,
      ...interest,
      method: oneOfOrDefault(interest.method, interestMethods, defaultConfig.interest.method),
      dayCountBasis: oneOfOrDefault(interest.dayCountBasis, dayCountBases, defaultConfig.interest.dayCountBasis),
      includePaymentDate: booleanOrDefault(interest.includePaymentDate, defaultConfig.interest.includePaymentDate),
      periodStart: oneOfOrDefault(interest.periodStart, periodStarts, defaultConfig.interest.periodStart),
      balanceMoment: oneOfOrDefault(interest.balanceMoment, balanceMoments, defaultConfig.interest.balanceMoment)
    }
  } as LoanConfig
  if (!positive(config.principal) || !finite(config.annualRate) || config.annualRate > 100 || !integer(config.termMonths, 1) || config.termMonths > MAX_TERM_MONTHS || !integer(config.paymentDay, 1) || config.paymentDay > 31 || !finite(config.closeThreshold) || !finite(config.oneTimeFee) || !finite(config.monthlyFee) || !finite(config.earlyRepaymentFeePercent) || config.earlyRepaymentFeePercent > 100) throw new Error('Параметры кредита содержат недопустимые числа')
  if (!isISODate(config.issueDate) || !isISODate(config.firstPaymentDate)) throw new Error('Проверьте даты выдачи и первого платежа')
  if (config.firstPaymentDate <= config.issueDate) throw new Error('Первый платёж должен быть после даты выдачи')
  if (!oneOf(config.rateChangeMode, ['nextPeriod', 'exactDate'])) throw new Error('Файл содержит неизвестный режим изменения ставки')

  const rateChangesRaw = source.rateChanges === undefined ? [] : source.rateChanges
  if (!Array.isArray(rateChangesRaw)) throw new Error('История ставок повреждена')
  if (rateChangesRaw.length > MAX_RATE_CHANGES) throw new Error(`Слишком много изменений ставки. Максимум: ${MAX_RATE_CHANGES}`)
  const rateChanges = sortRateChanges(rateChangesRaw.map((item, index): RateChange => {
    if (!isObject(item) || typeof item.id !== 'string' || !isISODate(item.date) || typeof item.annualRate !== 'number' || !Number.isFinite(item.annualRate) || item.annualRate < 0 || item.annualRate > 100) throw new Error(`Ошибка в изменении ставки №${index + 1}`)
    if (item.date <= config.issueDate) throw new Error(`Ошибка в изменении ставки №${index + 1}: дата должна быть после выдачи кредита`)
    return { id: item.id, date: item.date, annualRate: item.annualRate }
  }))
  ensureUniqueIds(rateChanges, 'Изменения ставки')
  ensureUniqueIds(rateChanges.map(item => ({ id: item.date })), 'Даты изменения ставки')
  config.rateChanges = rateChanges

  const repaymentsRaw = raw.repayments ?? []
  if (!Array.isArray(repaymentsRaw)) throw new Error('Список досрочных платежей повреждён')
  if (repaymentsRaw.length > MAX_EARLY_REPAYMENTS) throw new Error(`Слишком много досрочных платежей. Максимум: ${MAX_EARLY_REPAYMENTS}`)
  const repayments = repaymentsRaw.map((item, index) => {
    if (!isObject(item) || typeof item.id !== 'string' || !isISODate(item.date) || !finite(item.amount) || !oneOf(item.strategy, ['reduceTerm', 'reducePayment', 'full', 'custom']) || !oneOf(item.source, ['own', 'subsidy', 'insurance', 'other']) || !oneOf(item.sameDayOrder, ['regularFirst', 'earlyFirst']) || typeof item.interestFirst !== 'boolean') throw new Error(`Ошибка в досрочном платеже №${index + 1}`)
    if (item.enabled !== undefined && typeof item.enabled !== 'boolean') throw new Error(`Ошибка в досрочном платеже №${index + 1}`)
    if (item.operationSource !== undefined && !oneOf(item.operationSource, ['manual', 'rule'])) throw new Error(`Ошибка в досрочном платеже №${index + 1}: источник операции повреждён`)
    if (item.sourceRuleId !== undefined && typeof item.sourceRuleId !== 'string') throw new Error(`Ошибка в досрочном платеже №${index + 1}: ID правила повреждён`)
    ensureTextLength(item.comment, `Комментарий досрочного платежа №${index + 1}`)
    const sameDaySequence = typeof item.sameDaySequence === 'number' && Number.isInteger(item.sameDaySequence) && item.sameDaySequence >= 0 ? item.sameDaySequence : undefined
    if (item.sameDaySequence !== undefined && sameDaySequence === undefined) throw new Error(`Ошибка в досрочном платеже №${index + 1}`)
    const context = repaymentAmountModeContext({
      amount: item.amount,
      amountMode: item.amountMode,
      date: item.date,
      enabled: item.enabled,
      sameDayOrder: item.sameDayOrder
    }, config)
    const label = `Ошибка в досрочном платеже №${index + 1}`
    const amountModeErrors = repaymentAmountModeValidationErrors(context, label, {
      invalidMode: label,
      totalBeforeRegularPayment: `${label}: общая сумма списания с учётом комиссии применяется после регулярного платежа`
    })
    const amountMode = context.normalizedAmountMode
    if (amountModeErrors.length || amountMode === null) throw new Error(amountModeErrors[0] ?? label)
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
    if (!isObject(item) || typeof item.id !== 'string' || !isISODate(item.startDate) || !isISODate(item.endDate) || !oneOf(item.type, ['full', 'interestOnly', 'reduced', 'custom']) || typeof item.extendTerm !== 'boolean' || typeof item.accrueInterest !== 'boolean' || typeof item.capitalizeInterest !== 'boolean') throw new Error(`Ошибка в льготном периоде №${index + 1}`)
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
    if (!isObject(item) || typeof item.id !== 'string' || typeof item.name !== 'string' || !oneOf(item.type, ['weeklyFixed', 'monthlyFixed', 'bimonthlyFixed', 'quarterlyFixed', 'semiannualFixed', 'annualFixed', 'annualBonus', 'paymentPercent', 'monthlyTotalPayment']) || !isISODate(item.startDate) || !isISODate(item.endDate) || !oneOf(item.strategy, ['reduceTerm', 'reducePayment', 'full', 'custom']) || !oneOf(item.source, ['own', 'subsidy', 'insurance', 'other']) || !oneOf(item.sameDayOrder, ['regularFirst', 'earlyFirst']) || typeof item.interestFirst !== 'boolean' || !Array.isArray(item.skipMonths)) throw new Error(`Ошибка в правиле досрочных платежей №${index + 1}`)
    if (item.skipMonths.length > MAX_RULE_SKIP_MONTHS) throw new Error(`Ошибка в правиле досрочных платежей №${index + 1}: слишком много месяцев пропуска. Максимум: ${MAX_RULE_SKIP_MONTHS}`)
    if (!item.skipMonths.every(isISOYearMonth)) throw new Error(`Ошибка в правиле досрочных платежей №${index + 1}`)
    ensureTextLength(item.name, `Название правила досрочных платежей №${index + 1}`)
    ensureTextLength(item.comment, `Комментарий правила досрочных платежей №${index + 1}`)
    if (item.endDate < item.startDate) throw new Error(`Ошибка в правиле досрочных платежей №${index + 1}: окончание раньше начала`)
    if (item.type === 'paymentPercent' ? item.percent === undefined : item.amount === undefined) throw new Error(`Ошибка в правиле досрочных платежей №${index + 1}`)
    if (item.amount !== undefined && !finite(item.amount)) throw new Error(`Ошибка в правиле досрочных платежей №${index + 1}`)
    if (item.percent !== undefined && !finite(item.percent)) throw new Error(`Ошибка в правиле досрочных платежей №${index + 1}`)
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
  const termUnit = oneOf(settings.termUnit, ['months', 'years']) ? settings.termUnit : 'months'
  const displayDecimals = settings.displayDecimals === 0 ? 0 : 2
  const appFontSize = oneOf(settings.appFontSize, ['normal', 'large', 'xlarge']) ? settings.appFontSize : 'normal'
  const scheduleFontSize = oneOf(settings.scheduleFontSize, ['normal', 'large', 'xlarge']) ? settings.scheduleFontSize : 'large'
  const theme = oneOf(settings.theme, ['emerald', 'ocean', 'violet', 'graphite', 'warm', 'night']) ? settings.theme : 'emerald'
  const customAccentColor = hexColor(settings.customAccentColor) ? settings.customAccentColor : '#0b9873'
  const useCustomAccentColor = typeof settings.useCustomAccentColor === 'boolean' ? settings.useCustomAccentColor : false
  const result: LoanBackupData = { name, config, repayments, repaymentRules, gracePeriods, selectedScenario, termUnit, displayDecimals, appFontSize, scheduleFontSize, theme, customAccentColor, useCustomAccentColor, ...(importWarnings.length ? { importWarnings } : {}) }
  assertLoanCandidateValid(config, repayments, repaymentRules, gracePeriods)
  return result
}
