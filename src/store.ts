import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { addMonths, format, parseISO } from 'date-fns'
import { isRegularPaymentDate, nextPaymentDate, nextSameDaySequence, sortRateChanges, sortRepaymentsByApplicationOrder, validateScenario, type EarlyRepayment, type GracePeriod, type LoanConfig, type RateChange } from './loanEngine'
import { createDefaultConfig, defaultConfig } from './loanDefaults'
import type { LoanBackupData } from './importExport'
import { assertLoanCandidateValid } from './loanCandidate'
import { sortRepaymentRulesByApplicationOrder, type RepaymentRule } from './repaymentRules'
import { createId } from './utils/createId'
import { isISODate, isISOYearMonth } from './utils/dateValidation'
import { MAX_EARLY_REPAYMENTS, MAX_GRACE_PERIODS, MAX_RATE_CHANGES, MAX_REPAYMENT_RULES, MAX_RULE_SKIP_MONTHS, MAX_TERM_MONTHS, MAX_TEXT_FIELD_LENGTH } from './loanEngine/limits'
export { defaultConfig } from './loanDefaults'

export const STORAGE_ERROR_EVENT = 'credit-calculator-storage-error'
export const STORAGE_STATUS_EVENT = 'credit-calculator-storage-status'
export const MAX_PERSISTED_STATE_BYTES = 4_000_000

export type StorageStatusKind = 'saved' | 'nearQuota' | 'failed'

const notifyStorageStatus = (kind: StorageStatusKind, message: string) => {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(STORAGE_STATUS_EVENT, { detail: { kind, message } }))
}

const notifyStorageError = (error: unknown) => {
  const message = error instanceof Error ? error.message : 'Локальное хранилище недоступно'
  notifyStorageStatus('failed', `Последние изменения не сохранены в localStorage: ${message}`)
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(STORAGE_ERROR_EVENT, { detail: { message } }))
}

const safeLocalStorage = {
  getItem: (name: string) => {
    if (typeof window === 'undefined') return null
    try {
      return window.localStorage.getItem(name)
    } catch (error) {
      notifyStorageError(error)
      return null
    }
  },
  setItem: (name: string, value: string) => {
    if (typeof window === 'undefined') return
    try {
      const isNearQuota = new TextEncoder().encode(value).byteLength > MAX_PERSISTED_STATE_BYTES
      window.localStorage.setItem(name, value)
      notifyStorageStatus(
        isNearQuota ? 'nearQuota' : 'saved',
        isNearQuota ? 'Сохранённые данные приближаются к лимиту браузера. Экспортируйте расчёт в JSON' : 'Данные сохранены'
      )
    } catch (error) {
      notifyStorageError(error)
    }
  },
  removeItem: (name: string) => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.removeItem(name)
    } catch (error) {
      notifyStorageError(error)
    }
  }
}

type ThemeName = 'emerald' | 'ocean' | 'violet' | 'graphite' | 'warm' | 'night'

export interface LoanProfile {
  id: string
  name: string
  config: LoanConfig
  repayments: EarlyRepayment[]
  repaymentRules: RepaymentRule[]
  gracePeriods: GracePeriod[]
  selectedScenario: string
  termUnit: 'months' | 'years'
  displayDecimals: 0 | 2
  appFontSize: 'normal' | 'large' | 'xlarge'
  scheduleFontSize: 'normal' | 'large' | 'xlarge'
  theme: ThemeName
  customAccentColor: string
  useCustomAccentColor: boolean
}

type LoanData = Omit<LoanProfile, 'id' | 'name'>
type LoanImportData = Pick<LoanProfile, 'config' | 'repayments' | 'gracePeriods' | 'selectedScenario' | 'termUnit' | 'displayDecimals' | 'theme'> & Partial<Pick<LoanProfile, 'name' | 'appFontSize' | 'scheduleFontSize' | 'repaymentRules' | 'customAccentColor' | 'useCustomAccentColor'>>

interface LoanState extends LoanData {
  loans: LoanProfile[]
  activeLoanId: string
  updateConfig: (patch: Partial<LoanConfig>) => void
  updateInterest: (patch: Partial<LoanConfig['interest']>) => void
  addRepayment: (repayment: EarlyRepayment) => void
  updateRepayment: (repayment: EarlyRepayment) => void
  removeRepayment: (id: string) => void
  addRepaymentRule: (rule: RepaymentRule) => void
  updateRepaymentRule: (rule: RepaymentRule) => void
  removeRepaymentRule: (id: string) => void
  addGrace: (grace: GracePeriod) => void
  removeGrace: (id: string) => void
  selectScenario: (id: string) => void
  setTermUnit: (unit: 'months' | 'years') => void
  setDisplayDecimals: (value: 0 | 2) => void
  setAppFontSize: (value: LoanState['appFontSize']) => void
  setScheduleFontSize: (value: LoanState['scheduleFontSize']) => void
  setTheme: (theme: LoanState['theme']) => void
  setCustomAccentColor: (color: string) => void
  setUseCustomAccentColor: (enabled: boolean) => void
  resetCustomAccentColor: () => void
  retryStorageSave: () => void
  clearStorageRecoveryReport: () => void
  switchLoan: (id: string) => void
  createLoan: (name?: string) => void
  renameLoan: (id: string, name: string) => void
  removeLoan: (id: string) => void
  loadExampleLoan: () => void
  addLoanFromData: (data: LoanImportData) => void
  replaceData: (data: LoanImportData) => void
  storageRecoveryReport: string[]
}

const advancePaymentPeriods = (startDate: string, config: LoanConfig, periods: number) => {
  let date = startDate
  for (let index = 0; index < periods; index += 1) date = nextPaymentDate(date, config)
  return date
}

const createSeedRepayments = (config: LoanConfig): EarlyRepayment[] => [{
  id: 'seed-1',
  date: advancePaymentPeriods(config.firstPaymentDate, config, 11),
  amount: 350000,
  amountMode: 'extra',
  strategy: 'reduceTerm',
  source: 'own',
  sameDayOrder: 'regularFirst',
  interestFirst: true,
  comment: 'Годовой бонус'
}]

const sortRepayments = (repayments: EarlyRepayment[]) =>
  sortRepaymentsByApplicationOrder(repayments)

const sortRules = (rules: RepaymentRule[]) =>
  sortRepaymentRulesByApplicationOrder(rules)

const defaultAccentColor = '#0b9873'
const themeNames: readonly ThemeName[] = ['emerald', 'ocean', 'violet', 'graphite', 'warm', 'night']
const currencies = ['RUB', 'USD', 'EUR', 'CNY'] as const
const paymentTypes = ['annuity', 'differentiated'] as const
const frequencies = ['monthly', 'biweekly', 'quarterly'] as const
const roundingModes = ['kopecks', 'rubles', 'bank'] as const
const interestMethods = ['annuity', 'daily'] as const
const rateChangeModes = ['nextPeriod', 'exactDate'] as const
const dayCountBases = ['365', '366', '360', 'actual365', 'actualActual'] as const
const periodStarts = ['inclusive', 'exclusive'] as const
const balanceMoments = ['startOfDay', 'endOfDay'] as const
const repaymentStrategies = ['reduceTerm', 'reducePayment', 'full', 'custom'] as const
const repaymentSources = ['own', 'subsidy', 'insurance', 'other'] as const
const sameDayOrders = ['regularFirst', 'earlyFirst'] as const
const repaymentRuleTypes = ['weeklyFixed', 'monthlyFixed', 'bimonthlyFixed', 'quarterlyFixed', 'semiannualFixed', 'annualFixed', 'annualBonus', 'paymentPercent', 'monthlyTotalPayment'] as const
const graceTypes = ['full', 'interestOnly', 'reduced', 'custom'] as const
const scenarioIds = ['base', 'reduceTerm', 'reducePayment', 'combined'] as const
const termUnits = ['months', 'years'] as const
const fontSizes = ['normal', 'large', 'xlarge'] as const
const amountModes = ['extra', 'totalWithFee'] as const
export const MAX_LOANS = 100
const normalizeTheme = (value: unknown): ThemeName => typeof value === 'string' && themeNames.includes(value as ThemeName) ? value as ThemeName : 'emerald'
const normalizeAccentColor = (value: unknown): string => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : defaultAccentColor
const oneOf = <T extends string>(value: unknown, values: readonly T[], fallback: T): T => typeof value === 'string' && values.includes(value as T) ? value as T : fallback
const normalizeAmountMode = (value: unknown, isRegularDate: boolean): typeof amountModes[number] => {
  if (value === undefined) return isRegularDate ? 'totalWithFee' : 'extra'
  if (value === 'total') return 'totalWithFee'
  return oneOf(value, amountModes, 'extra')
}
const finiteNumber = (value: unknown, fallback: number, min = 0, max = Number.POSITIVE_INFINITY) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
const optionalFiniteNumber = (value: unknown, min = 0, max = Number.POSITIVE_INFINITY) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : undefined
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const nextMonthDate = (date: string) => format(addMonths(parseISO(date), 1), 'yyyy-MM-dd')
const firstPaymentAfterIssue = (config: LoanConfig) => {
  const candidate = nextPaymentDate(config.issueDate, config)
  return candidate > config.issueDate ? candidate : nextMonthDate(config.issueDate)
}
const normalizeText = (value: unknown, fallback = '') => {
  const text = typeof value === 'string' ? value.trim() : fallback
  return text.slice(0, MAX_TEXT_FIELD_LENGTH)
}
const optionalText = (value: unknown) => typeof value === 'string' ? value.slice(0, MAX_TEXT_FIELD_LENGTH) : undefined
const uniqueYearMonths = (value: unknown) => {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter(isISOYearMonth))].slice(0, MAX_RULE_SKIP_MONTHS)
}

const withUniqueIds = <T extends { id: string }>(items: T[], prefix: string): T[] => {
  const seen = new Set<string>()
  return items.map(item => {
    if (!seen.has(item.id)) {
      seen.add(item.id)
      return item
    }
    const id = createId(prefix)
    seen.add(id)
    return { ...item, id }
  })
}

const defaultLoanData = (withSeedRepayment = false, today = new Date()): LoanData => {
  const config = createDefaultConfig(today)
  return {
  config,
  repayments: withSeedRepayment ? createSeedRepayments(config).map(item => ({ ...item })) : [],
  repaymentRules: [],
  gracePeriods: [],
  selectedScenario: 'combined',
  termUnit: 'months',
  displayDecimals: 2,
  appFontSize: 'normal',
  scheduleFontSize: 'large',
  theme: 'emerald',
  customAccentColor: defaultAccentColor,
  useCustomAccentColor: false
}
}

const normalizeRateChanges = (value: unknown, issueDate: string): RateChange[] => {
  if (!Array.isArray(value)) return []
  const seenDates = new Set<string>()
  const changes = value.flatMap((item): RateChange[] => {
    if (!isObject(item) || !isISODate(item.date)) return []
    if (isISODate(issueDate) && item.date <= issueDate) return []
    const annualRate = typeof item.annualRate === 'number' && Number.isFinite(item.annualRate) && item.annualRate >= 0 && item.annualRate <= 100 ? item.annualRate : undefined
    if (annualRate === undefined || seenDates.has(item.date)) return []
    seenDates.add(item.date)
    return [{
      id: typeof item.id === 'string' && item.id.trim() ? item.id : createId('rate'),
      date: item.date,
      annualRate
    }]
  })
  return withUniqueIds(sortRateChanges(changes).slice(0, MAX_RATE_CHANGES), 'rate')
}

const normalizeConfig = (config: Partial<LoanConfig> | undefined): LoanConfig => {
  const source = config ?? {}
  const interest = (source.interest ?? {}) as Partial<LoanConfig['interest']>
  const issueDate = isISODate(source.issueDate) ? source.issueDate : defaultConfig.issueDate
  const firstPaymentDate = isISODate(source.firstPaymentDate) && source.firstPaymentDate > issueDate ? source.firstPaymentDate : defaultConfig.firstPaymentDate > issueDate ? defaultConfig.firstPaymentDate : nextMonthDate(issueDate)
  return {
    ...defaultConfig,
    ...source,
    principal: finiteNumber(source.principal, defaultConfig.principal, 1),
    annualRate: finiteNumber(source.annualRate, defaultConfig.annualRate, 0, 100),
    rateChanges: normalizeRateChanges(source.rateChanges, issueDate),
    rateChangeMode: oneOf(source.rateChangeMode, rateChangeModes, defaultConfig.rateChangeMode),
    issueDate,
    firstPaymentDate,
    firstPaymentInterestOnly: typeof source.firstPaymentInterestOnly === 'boolean' ? source.firstPaymentInterestOnly : true,
    termMonths: Math.round(finiteNumber(source.termMonths, defaultConfig.termMonths, 1, MAX_TERM_MONTHS)),
    paymentDay: Math.round(finiteNumber(source.paymentDay, defaultConfig.paymentDay, 1, 31)),
    paymentType: oneOf(source.paymentType, paymentTypes, defaultConfig.paymentType),
    frequency: oneOf(source.frequency, frequencies, defaultConfig.frequency),
    currency: oneOf(source.currency, currencies, defaultConfig.currency as typeof currencies[number]),
    rounding: oneOf(source.rounding, roundingModes, defaultConfig.rounding),
    closeThreshold: finiteNumber(source.closeThreshold, defaultConfig.closeThreshold, 0),
    oneTimeFee: finiteNumber(source.oneTimeFee, defaultConfig.oneTimeFee, 0),
    monthlyFee: finiteNumber(source.monthlyFee, defaultConfig.monthlyFee, 0),
    earlyRepaymentFeePercent: finiteNumber(source.earlyRepaymentFeePercent, defaultConfig.earlyRepaymentFeePercent, 0, 100),
    interest: {
      ...defaultConfig.interest,
      ...interest,
      method: oneOf(interest.method, interestMethods, defaultConfig.interest.method),
      dayCountBasis: oneOf(interest.dayCountBasis, dayCountBases, defaultConfig.interest.dayCountBasis),
      includePaymentDate: typeof interest.includePaymentDate === 'boolean' ? interest.includePaymentDate : defaultConfig.interest.includePaymentDate,
      periodStart: oneOf(interest.periodStart, periodStarts, defaultConfig.interest.periodStart),
      balanceMoment: oneOf(interest.balanceMoment, balanceMoments, defaultConfig.interest.balanceMoment)
    }
  }
}

const normalizeRepayments = (value: unknown, config: LoanConfig): EarlyRepayment[] => {
  if (!Array.isArray(value)) return []
  const usedSequences = new Map<string, Set<number>>()
  const nextSequence = (date: string, candidate: number) => {
    const used = usedSequences.get(date) ?? new Set<number>()
    let sequence = candidate
    while (used.has(sequence)) sequence += 1
    used.add(sequence)
    usedSequences.set(date, used)
    return sequence
  }
  return withUniqueIds(sortRepayments(value.flatMap((item, index): EarlyRepayment[] => {
    if (!isObject(item) || typeof item.id !== 'string' || !isISODate(item.date)) return []
    const amount = optionalFiniteNumber(item.amount, 0)
    if (amount === undefined) return []
    const requestedAmountMode = normalizeAmountMode(item.amountMode, isRegularPaymentDate(item.date, config))
    const amountMode = requestedAmountMode === 'totalWithFee' && isRegularPaymentDate(item.date, config) ? 'totalWithFee' : 'extra'
    const sequenceCandidate = typeof item.sameDaySequence === 'number' && Number.isInteger(item.sameDaySequence) && item.sameDaySequence >= 0 ? item.sameDaySequence : index
    return [{
      id: item.id,
      date: item.date,
      amount,
      enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
      amountMode,
      sameDaySequence: nextSequence(item.date, sequenceCandidate),
      operationSource: item.operationSource === 'rule' ? 'rule' : 'manual',
      ...(typeof item.sourceRuleId === 'string' && item.sourceRuleId.trim() ? { sourceRuleId: item.sourceRuleId } : {}),
      strategy: oneOf(item.strategy, repaymentStrategies, 'reduceTerm'),
      source: oneOf(item.source, repaymentSources, 'own'),
      sameDayOrder: amountMode === 'totalWithFee' ? 'regularFirst' : oneOf(item.sameDayOrder, sameDayOrders, 'regularFirst'),
      interestFirst: typeof item.interestFirst === 'boolean' ? item.interestFirst : true,
      ...(optionalText(item.comment) !== undefined ? { comment: optionalText(item.comment) } : {})
    }]
  })).slice(0, MAX_EARLY_REPAYMENTS), 'early')
}

const normalizeRepaymentRules = (value: unknown): RepaymentRule[] => {
  if (!Array.isArray(value)) return []
  const usedSequences = new Set<number>()
  const nextRuleSequence = (candidate: number) => {
    let sequence = candidate
    while (usedSequences.has(sequence)) sequence += 1
    usedSequences.add(sequence)
    return sequence
  }
  return withUniqueIds(sortRules(value.flatMap((item, index): RepaymentRule[] => {
    if (!isObject(item) || typeof item.id !== 'string' || typeof item.name !== 'string' || !isISODate(item.startDate) || !isISODate(item.endDate) || item.endDate < item.startDate) return []
    const type = oneOf(item.type, repaymentRuleTypes, 'monthlyFixed')
    const amount = optionalFiniteNumber(item.amount, 0)
    const percent = optionalFiniteNumber(item.percent, 0)
    if (type === 'paymentPercent' ? percent === undefined : amount === undefined) return []
    return [{
      id: item.id,
      name: normalizeText(item.name) || 'Регулярный платёж',
      ruleSequence: nextRuleSequence(typeof item.ruleSequence === 'number' && Number.isInteger(item.ruleSequence) && item.ruleSequence >= 0 ? item.ruleSequence : index),
      type,
      startDate: item.startDate,
      endDate: item.endDate,
      amount: type === 'paymentPercent' ? undefined : amount,
      percent: type === 'paymentPercent' ? percent : undefined,
      enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
      strategy: oneOf(item.strategy, repaymentStrategies, 'reduceTerm'),
      source: oneOf(item.source, repaymentSources, 'own'),
      sameDayOrder: type === 'monthlyTotalPayment' ? 'regularFirst' : oneOf(item.sameDayOrder, sameDayOrders, 'regularFirst'),
      interestFirst: typeof item.interestFirst === 'boolean' ? item.interestFirst : true,
      skipMonths: uniqueYearMonths(item.skipMonths),
      ...(optionalText(item.comment) !== undefined ? { comment: optionalText(item.comment) } : {})
    }]
  })).slice(0, MAX_REPAYMENT_RULES), 'rule')
}

const normalizeGracePeriods = (value: unknown): GracePeriod[] => {
  if (!Array.isArray(value)) return []
  return withUniqueIds(value.flatMap((item): GracePeriod[] => {
    if (!isObject(item) || typeof item.id !== 'string' || !isISODate(item.startDate) || !isISODate(item.endDate) || item.endDate < item.startDate) return []
    const paymentAmount = item.paymentAmount === undefined ? undefined : optionalFiniteNumber(item.paymentAmount, 0)
    return [{
      id: item.id,
      startDate: item.startDate,
      endDate: item.endDate,
      type: oneOf(item.type, graceTypes, 'interestOnly'),
      ...(paymentAmount !== undefined ? { paymentAmount } : {}),
      extendTerm: typeof item.extendTerm === 'boolean' ? item.extendTerm : true,
      accrueInterest: typeof item.accrueInterest === 'boolean' ? item.accrueInterest : true,
      capitalizeInterest: typeof item.capitalizeInterest === 'boolean' ? item.capitalizeInterest : false
    }]
  }).sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id)).slice(0, MAX_GRACE_PERIODS), 'grace')
}

const assertGracePeriodsDoNotOverlap = (gracePeriods: GracePeriod[]) => {
  const sortedGrace = [...gracePeriods].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id))
  sortedGrace.forEach((period, index) => {
    if (index > 0 && period.startDate <= sortedGrace[index - 1].endDate) throw new Error('Льготные периоды не должны пересекаться')
  })
}

const normalizeLoanData = (data: Partial<LoanImportData | LoanData>): LoanData => {
  const config = normalizeConfig(data.config)
  return {
    config,
    repayments: normalizeRepayments(data.repayments, config),
    repaymentRules: normalizeRepaymentRules(data.repaymentRules),
    gracePeriods: normalizeGracePeriods(data.gracePeriods),
    selectedScenario: oneOf(data.selectedScenario, scenarioIds, 'reduceTerm'),
    termUnit: oneOf(data.termUnit, termUnits, 'months'),
    displayDecimals: data.displayDecimals === 0 ? 0 : 2,
    appFontSize: oneOf(data.appFontSize, fontSizes, 'normal'),
    scheduleFontSize: oneOf(data.scheduleFontSize, fontSizes, 'large'),
    theme: normalizeTheme(data.theme),
    customAccentColor: normalizeAccentColor(data.customAccentColor),
    useCustomAccentColor: typeof data.useCustomAccentColor === 'boolean' ? data.useCustomAccentColor : false
  }
}

const loanFromData = (data: Partial<LoanImportData | LoanData>, name = 'Мой кредит', id = createId('loan')): LoanProfile => ({
  id,
  name: normalizeText(name, 'Мой кредит') || 'Мой кредит',
  ...normalizeLoanData(data)
})

const publicData = (state: LoanData): LoanData => ({
  config: state.config,
  repayments: state.repayments,
  repaymentRules: state.repaymentRules,
  gracePeriods: state.gracePeriods,
  selectedScenario: state.selectedScenario,
  termUnit: state.termUnit,
  displayDecimals: state.displayDecimals,
  appFontSize: state.appFontSize,
  scheduleFontSize: state.scheduleFontSize,
  theme: state.theme,
  customAccentColor: state.customAccentColor,
  useCustomAccentColor: state.useCustomAccentColor
})

const countArray = (value: unknown) => Array.isArray(value) ? value.length : 0
const assertCanAddLoan = (count: number) => {
  if (count >= MAX_LOANS) throw new Error(`Можно сохранить не более ${MAX_LOANS} кредитов`)
}
const assertImportWithinLimits = (data: Partial<LoanImportData | LoanData>) => {
  if (countArray(data.config?.rateChanges) > MAX_RATE_CHANGES) throw new Error(`Слишком много изменений ставки. Максимум: ${MAX_RATE_CHANGES}`)
  if (countArray(data.repayments) > MAX_EARLY_REPAYMENTS) throw new Error(`Слишком много досрочных платежей. Максимум: ${MAX_EARLY_REPAYMENTS}`)
  if (countArray(data.repaymentRules) > MAX_REPAYMENT_RULES) throw new Error(`Слишком много правил досрочных платежей. Максимум: ${MAX_REPAYMENT_RULES}`)
  if (countArray(data.gracePeriods) > MAX_GRACE_PERIODS) throw new Error(`Слишком много льготных периодов. Максимум: ${MAX_GRACE_PERIODS}`)
}

const assertRepaymentPlanValid = (config: LoanConfig, repayments: EarlyRepayment[], rules: RepaymentRule[], gracePeriods: GracePeriod[]) => {
  assertLoanCandidateValid(config, repayments, rules, gracePeriods)
}

const normalizeConfigPatch = (current: LoanConfig, patch: Partial<LoanConfig>): LoanConfig => {
  const next = { ...current, ...patch }
  if (isISODate(next.issueDate) && isISODate(next.firstPaymentDate) && next.firstPaymentDate <= next.issueDate) {
    next.firstPaymentDate = firstPaymentAfterIssue(next)
  }
  return next
}

const withRepaymentSequence = (repayments: EarlyRepayment[], repayment: EarlyRepayment) => ({
  ...repayment,
  operationSource: repayment.operationSource ?? 'manual',
  sameDaySequence: typeof repayment.sameDaySequence === 'number' && Number.isInteger(repayment.sameDaySequence) && repayment.sameDaySequence >= 0
    ? repayment.sameDaySequence
    : nextSameDaySequence(repayments, repayment.date)
})

const nextRuleSequence = (rules: RepaymentRule[]) =>
  rules.reduce((max, rule, index) => Math.max(max, Number.isFinite(rule.ruleSequence) ? rule.ruleSequence! : index), -1) + 1

const withRuleSequence = (rules: RepaymentRule[], rule: RepaymentRule) => ({
  ...rule,
  ruleSequence: typeof rule.ruleSequence === 'number' && Number.isInteger(rule.ruleSequence) && rule.ruleSequence >= 0
    ? rule.ruleSequence
    : nextRuleSequence(rules)
})

export const loanToBackupData = (loan: LoanProfile): LoanBackupData => ({
  name: loan.name,
  config: loan.config,
  repayments: loan.repayments,
  repaymentRules: loan.repaymentRules,
  gracePeriods: loan.gracePeriods,
  selectedScenario: loan.selectedScenario,
  termUnit: loan.termUnit,
  displayDecimals: loan.displayDecimals,
  appFontSize: loan.appFontSize,
  scheduleFontSize: loan.scheduleFontSize,
  theme: loan.theme,
  customAccentColor: loan.customAccentColor,
  useCustomAccentColor: loan.useCustomAccentColor
})

const syncActive = (state: LoanState, patch: Partial<LoanData>): Partial<LoanState> => {
  const nextData = { ...publicData(state), ...patch }
  return {
    ...patch,
    loans: state.loans.map(loan => loan.id === state.activeLoanId ? { ...loan, ...nextData } : loan)
  }
}

const switchToLoan = (state: LoanState, id: string): Partial<LoanState> => {
  const loan = state.loans.find(item => item.id === id) ?? state.loans[0]
  return loan ? { activeLoanId: loan.id, ...publicData(loan) } : {}
}

const initialLoan = loanFromData(defaultLoanData(), 'Мой кредит', 'loan-default')

export const normalizePersistedState = (persisted: unknown): Partial<LoanState> => {
  const state = (isObject(persisted) ? persisted : {}) as Partial<LoanState>
  const rawLoans = Array.isArray(state.loans)
    ? state.loans.filter(loan =>
      isObject(loan) && (isObject(loan.config) || Array.isArray(loan.repayments) || Array.isArray(loan.repaymentRules) || Array.isArray(loan.gracePeriods)))
    : []
  const seenLoanIds = new Set<string>()
  const uniqueLoanId = (value: unknown) => {
    const id = typeof value === 'string' && value.trim() ? value : createId('loan')
    if (!seenLoanIds.has(id)) {
      seenLoanIds.add(id)
      return id
    }
    const nextId = createId('loan')
    seenLoanIds.add(nextId)
    return nextId
  }
  const storageRecoveryReport: string[] = []
  const recoverLoan = (loan: Partial<LoanProfile | LoanData>, name: string, id: string) => {
    try {
      const normalized = loanFromData(loan, name, id)
      const errors = validateScenario(normalized.config, normalized.repayments, normalized.gracePeriods)
      if (errors.length) throw new Error(errors[0])
      if (normalized.repayments.length > 0 || normalized.repaymentRules.length > 0 || normalized.gracePeriods.length > 0) {
        assertRepaymentPlanValid(normalized.config, normalized.repayments, normalized.repaymentRules, normalized.gracePeriods)
      }
      return normalized
    } catch (error) {
      const message = error instanceof Error ? error.message : 'неизвестная ошибка'
      storageRecoveryReport.push(`Кредит «${name}» помещён в карантин: ${message}`)
      return null
    }
  }
  const recoveredLoans = rawLoans.length
    ? rawLoans.flatMap((loan, index) => {
      const normalized = recoverLoan(loan, typeof loan.name === 'string' ? loan.name : `Кредит ${index + 1}`, uniqueLoanId(loan.id))
      return normalized ? [normalized] : []
    }).slice(0, MAX_LOANS)
    : []
  const fallbackLoan = () => {
    const normalized = recoverLoan(state, 'Мой кредит', 'loan-default')
    return normalized ?? loanFromData(defaultLoanData(), 'Мой кредит', 'loan-default')
  }
  const loans = recoveredLoans.length ? recoveredLoans : [fallbackLoan()]
  if (!recoveredLoans.length && rawLoans.length) storageRecoveryReport.push('Все повреждённые кредиты отклонены, создан новый пустой расчёт.')
  const activeLoanId = typeof state.activeLoanId === 'string' && loans.some(loan => loan.id === state.activeLoanId) ? state.activeLoanId : loans[0].id
  const active = loans.find(loan => loan.id === activeLoanId) ?? loans[0]
  return { loans, activeLoanId, ...publicData(active), storageRecoveryReport }
}

export const useLoanStore = create<LoanState>()(persist((set) => ({
  ...publicData(initialLoan),
  loans: [initialLoan],
  activeLoanId: initialLoan.id,
  storageRecoveryReport: [],
  updateConfig: (patch) => set(s => {
    const config = normalizeConfigPatch(s.config, patch)
    assertRepaymentPlanValid(config, s.repayments, s.repaymentRules, s.gracePeriods)
    return syncActive(s, { config })
  }),
  updateInterest: (patch) => set(s => {
    const config = { ...s.config, interest: { ...s.config.interest, ...patch } }
    assertRepaymentPlanValid(config, s.repayments, s.repaymentRules, s.gracePeriods)
    return syncActive(s, { config })
  }),
  addRepayment: (repayment) => set(s => {
    if (s.repayments.length >= MAX_EARLY_REPAYMENTS) throw new Error(`Можно добавить не более ${MAX_EARLY_REPAYMENTS} разовых платежей`)
    const repayments = sortRepayments([...s.repayments, withRepaymentSequence(s.repayments, repayment)])
    assertRepaymentPlanValid(s.config, repayments, s.repaymentRules, s.gracePeriods)
    return syncActive(s, { repayments })
  }),
  updateRepayment: (repayment) => set(s => {
    if (!s.repayments.some(item => item.id === repayment.id)) throw new Error('Редактируемый досрочный платёж не найден в активном кредите')
    const repayments = sortRepayments(s.repayments.map(item => item.id === repayment.id
      ? withRepaymentSequence(s.repayments.filter(current => current.id !== repayment.id), {
        ...repayment,
        sameDaySequence: repayment.date === item.date ? repayment.sameDaySequence ?? item.sameDaySequence : undefined
      })
      : item))
    assertRepaymentPlanValid(s.config, repayments, s.repaymentRules, s.gracePeriods)
    return syncActive(s, { repayments })
  }),
  removeRepayment: (id) => set(s => syncActive(s, { repayments: s.repayments.filter(r => r.id !== id) })),
  addRepaymentRule: (rule) => set(s => {
    if (s.repaymentRules.length >= MAX_REPAYMENT_RULES) throw new Error(`Можно добавить не более ${MAX_REPAYMENT_RULES} правил досрочных платежей`)
    const repaymentRules = sortRules([...s.repaymentRules, withRuleSequence(s.repaymentRules, rule)])
    assertRepaymentPlanValid(s.config, s.repayments, repaymentRules, s.gracePeriods)
    return syncActive(s, { repaymentRules })
  }),
  updateRepaymentRule: (rule) => set(s => {
    if (!s.repaymentRules.some(item => item.id === rule.id)) throw new Error('Редактируемое правило не найдено в активном кредите')
    const repaymentRules = sortRules(s.repaymentRules.map(item => item.id === rule.id ? { ...rule, ruleSequence: rule.ruleSequence ?? item.ruleSequence } : item))
    assertRepaymentPlanValid(s.config, s.repayments, repaymentRules, s.gracePeriods)
    return syncActive(s, { repaymentRules })
  }),
  removeRepaymentRule: (id) => set(s => syncActive(s, { repaymentRules: s.repaymentRules.filter(rule => rule.id !== id) })),
  addGrace: (grace) => set(s => {
    if (s.gracePeriods.length >= MAX_GRACE_PERIODS) throw new Error(`Можно добавить не более ${MAX_GRACE_PERIODS} льготных периодов`)
    const gracePeriods = [...s.gracePeriods, grace]
    assertGracePeriodsDoNotOverlap(gracePeriods)
    assertRepaymentPlanValid(s.config, s.repayments, s.repaymentRules, gracePeriods)
    return syncActive(s, { gracePeriods })
  }),
  removeGrace: (id) => set(s => {
    const gracePeriods = s.gracePeriods.filter(g => g.id !== id)
    if (gracePeriods.length === s.gracePeriods.length) throw new Error('Льготный период не найден в активном кредите')
    assertRepaymentPlanValid(s.config, s.repayments, s.repaymentRules, gracePeriods)
    return syncActive(s, { gracePeriods })
  }),
  selectScenario: (selectedScenario) => set(s => syncActive(s, { selectedScenario })),
  setTermUnit: (termUnit) => set(s => syncActive(s, { termUnit })),
  setDisplayDecimals: (displayDecimals) => set(s => syncActive(s, { displayDecimals })),
  setAppFontSize: (appFontSize) => set(s => syncActive(s, { appFontSize, scheduleFontSize: appFontSize })),
  setScheduleFontSize: (scheduleFontSize) => set(s => syncActive(s, { scheduleFontSize })),
  setTheme: (theme) => set(s => syncActive(s, { theme })),
  setCustomAccentColor: (customAccentColor) => set(s => syncActive(s, { customAccentColor: normalizeAccentColor(customAccentColor), useCustomAccentColor: true })),
  setUseCustomAccentColor: (useCustomAccentColor) => set(s => syncActive(s, { useCustomAccentColor })),
  resetCustomAccentColor: () => set(s => syncActive(s, { customAccentColor: defaultAccentColor, useCustomAccentColor: false })),
  retryStorageSave: () => set(s => ({ activeLoanId: s.activeLoanId, loans: s.loans })),
  clearStorageRecoveryReport: () => set({ storageRecoveryReport: [] }),
  switchLoan: (id) => set(s => switchToLoan(s, id)),
  createLoan: (name = 'Новый кредит') => set(s => {
    assertCanAddLoan(s.loans.length)
    const loan = loanFromData(defaultLoanData(false), name)
    return { loans: [...s.loans, loan], activeLoanId: loan.id, ...publicData(loan) }
  }),
  renameLoan: (id, name) => set(s => ({ loans: s.loans.map(loan => loan.id === id ? { ...loan, name: normalizeText(name) || loan.name } : loan) })),
  removeLoan: (id) => set(s => {
    if (s.loans.length <= 1) return {}
    const loans = s.loans.filter(loan => loan.id !== id)
    const activeLoanId = s.activeLoanId === id ? loans[0].id : s.activeLoanId
    const active = loans.find(loan => loan.id === activeLoanId) ?? loans[0]
    return { loans, activeLoanId, ...publicData(active) }
  }),
  loadExampleLoan: () => set(s => {
    const data = defaultLoanData(true, new Date())
    return { ...data, loans: s.loans.map(loan => loan.id === s.activeLoanId ? { ...loan, name: 'Пример кредита', ...data } : loan) }
  }),
  addLoanFromData: (data) => set(s => {
    assertCanAddLoan(s.loans.length)
    assertImportWithinLimits(data)
    const loan = loanFromData(data, data.name ?? 'Кредит из ссылки')
    assertGracePeriodsDoNotOverlap(loan.gracePeriods)
    assertRepaymentPlanValid(loan.config, loan.repayments, loan.repaymentRules, loan.gracePeriods)
    return { loans: [...s.loans, loan], activeLoanId: loan.id, ...publicData(loan) }
  }),
  replaceData: (data) => set(s => {
    assertImportWithinLimits(data)
    const normalized = normalizeLoanData(data)
    assertGracePeriodsDoNotOverlap(normalized.gracePeriods)
    assertRepaymentPlanValid(normalized.config, normalized.repayments, normalized.repaymentRules, normalized.gracePeriods)
    const name = normalizeText(data.name)
    return { ...normalized, loans: s.loans.map(loan => loan.id === s.activeLoanId ? { ...loan, ...(name ? { name } : {}), ...normalized } : loan) }
  })
}), {
  name: 'ipoteka-calculator-v1',
  storage: createJSONStorage(() => safeLocalStorage),
  version: 10,
  migrate: normalizePersistedState,
  merge: (persisted, current) => ({ ...current, ...normalizePersistedState(persisted) })
}))
