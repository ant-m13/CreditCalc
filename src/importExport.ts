import type { EarlyRepayment, GracePeriod, LoanConfig } from './loanEngine'
import { isRegularPaymentDate } from './loanEngine'
import { defaultConfig } from './loanDefaults'
import type { RepaymentRule } from './repaymentRules'
import { MAX_EARLY_REPAYMENTS, MAX_GRACE_PERIODS, MAX_TERM_MONTHS } from './loanEngine/limits'
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
}

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const oneOf = <T extends string>(value: unknown, values: readonly T[]): value is T => typeof value === 'string' && values.includes(value as T)
const finite = (value: unknown, minimum = 0) => typeof value === 'number' && Number.isFinite(value) && value >= minimum
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0
const hexColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
const currencies = ['RUB', 'USD', 'EUR', 'CNY'] as const

export function parseLoanBackup(text: string): LoanBackupData {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new Error('Файл не является корректным JSON') }
  return parseLoanBackupObject(raw)
}

export function parseLoanBackupObject(raw: unknown): LoanBackupData {
  if (!isObject(raw) || !isObject(raw.config)) throw new Error('В файле отсутствуют параметры кредита')

  const source = raw.config
  const interest = isObject(source.interest) ? source.interest : {}
  const config = { ...defaultConfig, ...source, interest: { ...defaultConfig.interest, ...interest } } as LoanConfig
  if (!finite(config.principal) || !finite(config.annualRate) || config.annualRate > 100 || !finite(config.termMonths, 1) || config.termMonths > MAX_TERM_MONTHS || !finite(config.paymentDay, 1) || config.paymentDay > 31 || !finite(config.closeThreshold) || !finite(config.oneTimeFee) || !finite(config.monthlyFee) || !finite(config.earlyRepaymentFeePercent) || config.earlyRepaymentFeePercent > 100) throw new Error('Параметры кредита содержат недопустимые числа')
  if (!isISODate(config.issueDate) || !isISODate(config.firstPaymentDate)) throw new Error('Проверьте даты выдачи и первого платежа')
  if (config.firstPaymentDate <= config.issueDate) throw new Error('Первый платёж должен быть после даты выдачи')
  if (!oneOf(config.currency, currencies)) throw new Error('Файл содержит неподдерживаемую валюту')
  if (typeof config.firstPaymentInterestOnly !== 'boolean' || !oneOf(config.paymentType, ['annuity', 'differentiated']) || !oneOf(config.frequency, ['monthly', 'biweekly', 'quarterly']) || !oneOf(config.rounding, ['kopecks', 'rubles', 'bank'])) throw new Error('Файл содержит неизвестный тип расчёта')
  if (typeof config.interest.includePaymentDate !== 'boolean' || !oneOf(config.interest.method, ['annuity', 'daily']) || !oneOf(config.interest.dayCountBasis, ['365', '366', '360', 'actual365', 'actualActual']) || !oneOf(config.interest.balanceMoment, ['startOfDay', 'endOfDay'])) throw new Error('Файл содержит неизвестное правило начисления процентов')

  const repaymentsRaw = raw.repayments ?? []
  if (!Array.isArray(repaymentsRaw)) throw new Error('Список досрочных платежей повреждён')
  if (repaymentsRaw.length > MAX_EARLY_REPAYMENTS) throw new Error(`Слишком много досрочных платежей. Максимум: ${MAX_EARLY_REPAYMENTS}`)
  const repayments = repaymentsRaw.map((item, index) => {
    if (!isObject(item) || typeof item.id !== 'string' || !isISODate(item.date) || !positive(item.amount) || !oneOf(item.strategy, ['reduceTerm', 'reducePayment', 'full', 'custom']) || !oneOf(item.source, ['own', 'subsidy', 'insurance', 'other']) || !oneOf(item.sameDayOrder, ['regularFirst', 'earlyFirst']) || typeof item.interestFirst !== 'boolean') throw new Error(`Ошибка в досрочном платеже №${index + 1}`)
    if (item.amountMode !== undefined && !oneOf(item.amountMode, ['extra', 'total'])) throw new Error(`Ошибка в досрочном платеже №${index + 1}`)
    if (item.amountMode === 'total' && item.sameDayOrder === 'earlyFirst') throw new Error(`Ошибка в досрочном платеже №${index + 1}: общая сумма из графика банка применяется после регулярного платежа`)
    if (item.amountMode === 'total' && !isRegularPaymentDate(item.date, config)) throw new Error(`Ошибка в досрочном платеже №${index + 1}: общую сумму строки банка можно указать только в дату регулярного платежа`)
    return item as unknown as EarlyRepayment
  })

  const graceRaw = raw.gracePeriods ?? []
  if (!Array.isArray(graceRaw)) throw new Error('Список льготных периодов повреждён')
  if (graceRaw.length > MAX_GRACE_PERIODS) throw new Error(`Слишком много льготных периодов. Максимум: ${MAX_GRACE_PERIODS}`)
  const gracePeriods = graceRaw.map((item, index) => {
    if (!isObject(item) || typeof item.id !== 'string' || !isISODate(item.startDate) || !isISODate(item.endDate) || !oneOf(item.type, ['full', 'interestOnly', 'reduced', 'custom']) || typeof item.extendTerm !== 'boolean' || typeof item.accrueInterest !== 'boolean' || typeof item.capitalizeInterest !== 'boolean') throw new Error(`Ошибка в льготном периоде №${index + 1}`)
    if (item.endDate < item.startDate) throw new Error(`Ошибка в льготном периоде №${index + 1}: окончание раньше начала`)
    if (item.paymentAmount !== undefined && !finite(item.paymentAmount)) throw new Error(`Ошибка в льготном периоде №${index + 1}`)
    return item as unknown as GracePeriod
  })

  const rulesRaw = raw.repaymentRules ?? []
  if (!Array.isArray(rulesRaw)) throw new Error('Список правил досрочных платежей повреждён')
  const repaymentRules = rulesRaw.map((item, index) => {
    if (!isObject(item) || typeof item.id !== 'string' || typeof item.name !== 'string' || !oneOf(item.type, ['monthlyFixed', 'annualBonus', 'paymentPercent']) || !isISODate(item.startDate) || !isISODate(item.endDate) || !oneOf(item.strategy, ['reduceTerm', 'reducePayment', 'full', 'custom']) || !oneOf(item.source, ['own', 'subsidy', 'insurance', 'other']) || !oneOf(item.sameDayOrder, ['regularFirst', 'earlyFirst']) || typeof item.interestFirst !== 'boolean' || !Array.isArray(item.skipMonths) || !item.skipMonths.every(isISOYearMonth)) throw new Error(`Ошибка в правиле досрочных платежей №${index + 1}`)
    if (item.endDate < item.startDate) throw new Error(`Ошибка в правиле досрочных платежей №${index + 1}: окончание раньше начала`)
    if (item.type === 'paymentPercent' ? item.percent === undefined : item.amount === undefined) throw new Error(`Ошибка в правиле досрочных платежей №${index + 1}`)
    if (item.amount !== undefined && !positive(item.amount)) throw new Error(`Ошибка в правиле досрочных платежей №${index + 1}`)
    if (item.percent !== undefined && !positive(item.percent)) throw new Error(`Ошибка в правиле досрочных платежей №${index + 1}`)
    if (item.comment !== undefined && typeof item.comment !== 'string') throw new Error(`Ошибка в правиле досрочных платежей №${index + 1}`)
    return item as unknown as RepaymentRule
  })

  const settings = isObject(raw.settings) ? raw.settings : raw
  const name = typeof raw.name === 'string' ? raw.name : undefined
  const scenarioFromLegacyExport = isObject(raw.scenario) && typeof raw.scenario.id === 'string' ? raw.scenario.id : undefined
  const selectedScenario = typeof raw.selectedScenario === 'string' ? raw.selectedScenario : scenarioFromLegacyExport ?? 'reduceTerm'
  const termUnit = oneOf(settings.termUnit, ['months', 'years']) ? settings.termUnit : 'months'
  const displayDecimals = settings.displayDecimals === 0 ? 0 : 2
  const appFontSize = oneOf(settings.appFontSize, ['normal', 'large', 'xlarge']) ? settings.appFontSize : 'normal'
  const scheduleFontSize = oneOf(settings.scheduleFontSize, ['normal', 'large', 'xlarge']) ? settings.scheduleFontSize : 'large'
  const theme = oneOf(settings.theme, ['emerald', 'ocean', 'violet', 'graphite', 'warm', 'night']) ? settings.theme : 'emerald'
  const customAccentColor = hexColor(settings.customAccentColor) ? settings.customAccentColor : '#0b9873'
  const useCustomAccentColor = typeof settings.useCustomAccentColor === 'boolean' ? settings.useCustomAccentColor : false
  return { name, config, repayments, repaymentRules, gracePeriods, selectedScenario, termUnit, displayDecimals, appFontSize, scheduleFontSize, theme, customAccentColor, useCustomAccentColor }
}
