import { addMonths, format, parseISO } from 'date-fns'
import {
  nextPaymentDate,
  nextSameDaySequence,
  normalizeStoredRepaymentAmountMode,
  repaymentAmountModeContext,
  sortRateChanges,
  sortRepaymentsByApplicationOrder,
  supportedCurrencies,
  validateScenario,
  type EarlyRepayment,
  type GracePeriod,
  type LoanConfig,
  type RateChange
} from './loanEngine'
import { MAX_EARLY_REPAYMENTS, MAX_GRACE_PERIODS, MAX_RATE_CHANGES, MAX_REPAYMENT_RULES, MAX_RULE_SKIP_MONTHS, MAX_TERM_MONTHS, MAX_TEXT_FIELD_LENGTH } from './loanEngine/limits'
import { createDefaultConfig, defaultConfig } from './loanDefaults'
import { assertLoanCandidateValid } from './loanCandidate'
import type { LoanBackupData } from './importExport'
import { sortRepaymentRulesByApplicationOrder, type RepaymentRule } from './repaymentRules'
import type { LoanData, LoanImportData, LoanPersistedState, LoanProfile, QuarantinedLoanRaw, ThemeName } from './storeTypes'
import { createId } from './utils/createId'
import { isISODate, isISOYearMonth } from './utils/dateValidation'

export const MAX_LOANS = 100
export const defaultAccentColor = '#0b9873'

const themeNames: readonly ThemeName[] = ['emerald', 'ocean', 'violet', 'graphite', 'warm', 'night']
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

const oneOf = <T extends string>(value: unknown, values: readonly T[], fallback: T): T =>
  typeof value === 'string' && values.includes(value as T) ? value as T : fallback

const isOneOf = <T extends string>(value: unknown, values: readonly T[]): value is T =>
  typeof value === 'string' && values.includes(value as T)

const finiteNumber = (value: unknown, fallback: number, min = 0, max = Number.POSITIVE_INFINITY) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback

const optionalFiniteNumber = (value: unknown, min = 0, max = Number.POSITIVE_INFINITY) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : undefined

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const nextMonthDate = (date: string) => format(addMonths(parseISO(date), 1), 'yyyy-MM-dd')

const firstPaymentAfterIssue = (config: LoanConfig) => {
  const candidate = nextPaymentDate(config.issueDate, config)
  return candidate > config.issueDate ? candidate : nextMonthDate(config.issueDate)
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

const normalizeTheme = (value: unknown): ThemeName =>
  typeof value === 'string' && themeNames.includes(value as ThemeName) ? value as ThemeName : 'emerald'

export const normalizeAccentColor = (value: unknown): string =>
  typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : defaultAccentColor

export const normalizeText = (value: unknown, fallback = '') => {
  const text = typeof value === 'string' ? value.trim() : fallback
  return text.slice(0, MAX_TEXT_FIELD_LENGTH)
}

const optionalText = (value: unknown) =>
  typeof value === 'string' ? value.slice(0, MAX_TEXT_FIELD_LENGTH) : undefined

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

export const sortRepayments = (repayments: EarlyRepayment[]) =>
  sortRepaymentsByApplicationOrder(repayments)

export const sortRules = (rules: RepaymentRule[]) =>
  sortRepaymentRulesByApplicationOrder(rules)

export const defaultLoanData = (withSeedRepayment = false, today = new Date()): LoanData => {
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
    currency: oneOf(source.currency, supportedCurrencies, defaultConfig.currency),
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
    const context = repaymentAmountModeContext({
      amount,
      amountMode: item.amountMode,
      date: item.date,
      enabled: item.enabled,
      sameDayOrder: item.sameDayOrder
    }, config)
    const amountMode = normalizeStoredRepaymentAmountMode(context)
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

export const normalizeLoanData = (data: Partial<LoanImportData | LoanData>): LoanData => {
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

export const loanFromData = (data: Partial<LoanImportData | LoanData>, name = 'Мой кредит', id = createId('loan')): LoanProfile => ({
  id,
  name: normalizeText(name, 'Мой кредит') || 'Мой кредит',
  ...normalizeLoanData(data)
})

export const publicData = (state: LoanData): LoanData => ({
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

export const assertCanAddLoan = (count: number) => {
  if (count >= MAX_LOANS) throw new Error(`Можно сохранить не более ${MAX_LOANS} кредитов`)
}

export const assertImportWithinLimits = (data: Partial<LoanImportData | LoanData>) => {
  if (countArray(data.config?.rateChanges) > MAX_RATE_CHANGES) throw new Error(`Слишком много изменений ставки. Максимум: ${MAX_RATE_CHANGES}`)
  if (countArray(data.repayments) > MAX_EARLY_REPAYMENTS) throw new Error(`Слишком много досрочных платежей. Максимум: ${MAX_EARLY_REPAYMENTS}`)
  if (countArray(data.repaymentRules) > MAX_REPAYMENT_RULES) throw new Error(`Слишком много правил досрочных платежей. Максимум: ${MAX_REPAYMENT_RULES}`)
  if (countArray(data.gracePeriods) > MAX_GRACE_PERIODS) throw new Error(`Слишком много льготных периодов. Максимум: ${MAX_GRACE_PERIODS}`)
}

export const assertRepaymentPlanValid = (config: LoanConfig, repayments: EarlyRepayment[], rules: RepaymentRule[], gracePeriods: GracePeriod[]) => {
  assertLoanCandidateValid(config, repayments, rules, gracePeriods)
}

export const assertRepaymentPlanStructurallyValid = (config: LoanConfig, repayments: EarlyRepayment[], gracePeriods: GracePeriod[]) => {
  const validationErrors = validateScenario(config, repayments, gracePeriods)
  if (validationErrors.length > 0) throw new Error(validationErrors.join(' · '))
}

export const assertRepaymentRuleStructurallyValid = (rule: RepaymentRule) => {
  const errors: string[] = []
  const title = typeof rule.name === 'string' && rule.name.trim() ? `«${normalizeText(rule.name)}»` : 'без названия'
  const label = `Правило досрочных платежей ${title}`
  const type = isOneOf(rule.type, repaymentRuleTypes) ? rule.type : null

  if (typeof rule.id !== 'string' || !rule.id.trim()) errors.push(`${label}: ID повреждён`)
  if (typeof rule.name !== 'string' || !rule.name.trim()) errors.push(`${label}: название обязательно`)
  if (typeof rule.name === 'string' && rule.name.length > MAX_TEXT_FIELD_LENGTH) errors.push(`${label}: название слишком длинное`)
  if (!type) errors.push(`${label}: тип повреждён`)
  if (!isISODate(rule.startDate)) errors.push(`${label}: дата начала должна быть корректной`)
  if (!isISODate(rule.endDate)) errors.push(`${label}: дата окончания должна быть корректной`)
  if (isISODate(rule.startDate) && isISODate(rule.endDate) && rule.endDate < rule.startDate) errors.push(`${label}: окончание раньше начала`)
  if (rule.ruleSequence !== undefined && (!Number.isInteger(rule.ruleSequence) || rule.ruleSequence < 0)) errors.push(`${label}: порядок повреждён`)
  if (rule.enabled !== undefined && typeof rule.enabled !== 'boolean') errors.push(`${label}: признак активности повреждён`)
  if (!isOneOf(rule.strategy, repaymentStrategies)) errors.push(`${label}: стратегия повреждена`)
  if (!isOneOf(rule.source, repaymentSources)) errors.push(`${label}: источник повреждён`)
  if (!isOneOf(rule.sameDayOrder, sameDayOrders)) errors.push(`${label}: порядок в дату платежа повреждён`)
  if (typeof rule.interestFirst !== 'boolean') errors.push(`${label}: правило погашения процентов повреждено`)
  if (!Array.isArray(rule.skipMonths)) {
    errors.push(`${label}: месяцы пропуска повреждены`)
  } else {
    if (rule.skipMonths.length > MAX_RULE_SKIP_MONTHS) errors.push(`${label}: слишком много месяцев пропуска. Максимум: ${MAX_RULE_SKIP_MONTHS}`)
    if (!rule.skipMonths.every(isISOYearMonth)) errors.push(`${label}: месяц пропуска должен быть корректным`)
  }
  if (rule.comment !== undefined && typeof rule.comment !== 'string') errors.push(`${label}: комментарий повреждён`)
  if (typeof rule.comment === 'string' && rule.comment.length > MAX_TEXT_FIELD_LENGTH) errors.push(`${label}: комментарий слишком длинный`)

  if (type === 'paymentPercent') {
    if (typeof rule.percent !== 'number' || !Number.isFinite(rule.percent) || rule.percent < 0) errors.push(`${label}: процент должен быть неотрицательным числом`)
  } else if (type && (typeof rule.amount !== 'number' || !Number.isFinite(rule.amount) || rule.amount < 0)) {
    errors.push(`${label}: сумма должна быть неотрицательным числом`)
  }

  if (rule.amount !== undefined && (typeof rule.amount !== 'number' || !Number.isFinite(rule.amount) || rule.amount < 0)) errors.push(`${label}: сумма повреждена`)
  if (rule.percent !== undefined && (typeof rule.percent !== 'number' || !Number.isFinite(rule.percent) || rule.percent < 0)) errors.push(`${label}: процент повреждён`)

  if (errors.length > 0) throw new Error([...new Set(errors)].join(' · '))
}

export const assertGracePeriodsDoNotOverlap = (gracePeriods: GracePeriod[]) => {
  const sortedGrace = [...gracePeriods].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id))
  sortedGrace.forEach((period, index) => {
    if (index > 0 && period.startDate <= sortedGrace[index - 1].endDate) throw new Error('Льготные периоды не должны пересекаться')
  })
}

export const normalizeConfigPatch = (current: LoanConfig, patch: Partial<LoanConfig>): LoanConfig => {
  const next = { ...current, ...patch }
  if (isISODate(next.issueDate) && isISODate(next.firstPaymentDate) && next.firstPaymentDate <= next.issueDate) {
    next.firstPaymentDate = firstPaymentAfterIssue(next)
  }
  return next
}

export const withRepaymentSequence = (repayments: EarlyRepayment[], repayment: EarlyRepayment) => ({
  ...repayment,
  operationSource: repayment.operationSource ?? 'manual',
  sameDaySequence: typeof repayment.sameDaySequence === 'number' && Number.isInteger(repayment.sameDaySequence) && repayment.sameDaySequence >= 0
    ? repayment.sameDaySequence
    : nextSameDaySequence(repayments, repayment.date)
})

const nextRuleSequence = (rules: RepaymentRule[]) =>
  rules.reduce((max, rule, index) => Math.max(max, Number.isFinite(rule.ruleSequence) ? rule.ruleSequence! : index), -1) + 1

export const withRuleSequence = (rules: RepaymentRule[], rule: RepaymentRule) => ({
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

export const normalizePersistedState = (persisted: unknown): Partial<LoanPersistedState> => {
  const state = (isObject(persisted) ? persisted : {}) as Partial<LoanPersistedState>
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
  const quarantinedLoansRaw: QuarantinedLoanRaw[] = Array.isArray(state.quarantinedLoansRaw)
    ? state.quarantinedLoansRaw.flatMap((item): QuarantinedLoanRaw[] => {
      if (!isObject(item)) return []
      return [{
        id: typeof item.id === 'string' && item.id.trim() ? item.id : createId('quarantine'),
        name: typeof item.name === 'string' && item.name.trim() ? item.name : 'Повреждённый кредит',
        reason: typeof item.reason === 'string' && item.reason.trim() ? item.reason : 'Причина неизвестна',
        raw: item.raw
      }]
    })
    : []
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
      quarantinedLoansRaw.push({ id, name, reason: message, raw: loan })
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
  return { loans, activeLoanId, ...publicData(active), storageRecoveryReport, quarantinedLoansRaw: quarantinedLoansRaw.slice(0, MAX_LOANS) }
}
