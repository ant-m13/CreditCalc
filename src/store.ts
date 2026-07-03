import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { addMonths, format, parseISO } from 'date-fns'
import { isRegularPaymentDate, sortRateChanges, type EarlyRepayment, type GracePeriod, type LoanConfig, type RateChange } from './loanEngine'
import { defaultConfig } from './loanDefaults'
import type { LoanBackupData } from './importExport'
import type { RepaymentRule } from './repaymentRules'
import { createId } from './utils/createId'
import { isISODate, isISOYearMonth } from './utils/dateValidation'
import { MAX_EARLY_REPAYMENTS, MAX_GRACE_PERIODS, MAX_REPAYMENT_RULES, MAX_TERM_MONTHS } from './loanEngine/limits'
export { defaultConfig } from './loanDefaults'

export const STORAGE_ERROR_EVENT = 'credit-calculator-storage-error'

const notifyStorageError = (error: unknown) => {
  if (typeof window === 'undefined') return
  const message = error instanceof Error ? error.message : 'Локальное хранилище недоступно'
  window.dispatchEvent(new CustomEvent(STORAGE_ERROR_EVENT, { detail: { message } }))
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
      window.localStorage.setItem(name, value)
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
  switchLoan: (id: string) => void
  createLoan: (name?: string) => void
  renameLoan: (id: string, name: string) => void
  removeLoan: (id: string) => void
  loadExampleLoan: () => void
  addLoanFromData: (data: LoanImportData) => void
  replaceData: (data: LoanImportData) => void
}

const seedRepayments: EarlyRepayment[] = [{ id: 'seed-1', date: '2027-01-15', amount: 350000, amountMode: 'extra', strategy: 'reduceTerm', source: 'own', sameDayOrder: 'regularFirst', interestFirst: true, comment: 'Годовой бонус' }]

const sortRepayments = (repayments: EarlyRepayment[]) =>
  [...repayments].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))

const sortRules = (rules: RepaymentRule[]) =>
  [...rules].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id))

const defaultAccentColor = '#0b9873'
const themeNames: readonly ThemeName[] = ['emerald', 'ocean', 'violet', 'graphite', 'warm', 'night']
const currencies = ['RUB', 'USD', 'EUR', 'CNY'] as const
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
const repaymentRuleTypes = ['monthlyFixed', 'annualBonus', 'paymentPercent'] as const
const graceTypes = ['full', 'interestOnly', 'reduced', 'custom'] as const
const scenarioIds = ['base', 'reduceTerm', 'reducePayment', 'combined'] as const
const termUnits = ['months', 'years'] as const
const fontSizes = ['normal', 'large', 'xlarge'] as const
export const MAX_LOANS = 100
const normalizeTheme = (value: unknown): ThemeName => typeof value === 'string' && themeNames.includes(value as ThemeName) ? value as ThemeName : 'emerald'
const normalizeAccentColor = (value: unknown): string => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : defaultAccentColor
const oneOf = <T extends string>(value: unknown, values: readonly T[], fallback: T): T => typeof value === 'string' && values.includes(value as T) ? value as T : fallback
const finiteNumber = (value: unknown, fallback: number, min = 0, max = Number.POSITIVE_INFINITY) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
const optionalFiniteNumber = (value: unknown, min = 0, max = Number.POSITIVE_INFINITY) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : undefined
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const nextMonthDate = (date: string) => format(addMonths(parseISO(date), 1), 'yyyy-MM-dd')

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

const defaultLoanData = (withSeedRepayment = false): LoanData => ({
  config: { ...defaultConfig, rateChanges: [...defaultConfig.rateChanges], interest: { ...defaultConfig.interest } },
  repayments: withSeedRepayment ? seedRepayments.map(item => ({ ...item })) : [],
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
})

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
  return withUniqueIds(sortRateChanges(changes), 'rate')
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
  return withUniqueIds(sortRepayments(value.slice(0, MAX_EARLY_REPAYMENTS).flatMap((item): EarlyRepayment[] => {
    if (!isObject(item) || typeof item.id !== 'string' || !isISODate(item.date)) return []
    const amount = optionalFiniteNumber(item.amount, 0)
    if (amount === undefined) return []
    const requestedAmountMode = item.amountMode === undefined ? 'total' : oneOf(item.amountMode, ['extra', 'total'] as const, 'extra')
    const amountMode = requestedAmountMode === 'total' && isRegularPaymentDate(item.date, config) ? 'total' : 'extra'
    return [{
      id: item.id,
      date: item.date,
      amount,
      enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
      amountMode,
      strategy: oneOf(item.strategy, repaymentStrategies, 'reduceTerm'),
      source: oneOf(item.source, repaymentSources, 'own'),
      sameDayOrder: amountMode === 'total' ? 'regularFirst' : oneOf(item.sameDayOrder, sameDayOrders, 'regularFirst'),
      interestFirst: typeof item.interestFirst === 'boolean' ? item.interestFirst : true,
      ...(typeof item.comment === 'string' ? { comment: item.comment } : {})
    }]
  })), 'early')
}

const normalizeRepaymentRules = (value: unknown): RepaymentRule[] => {
  if (!Array.isArray(value)) return []
  return withUniqueIds(sortRules(value.slice(0, MAX_REPAYMENT_RULES).flatMap((item): RepaymentRule[] => {
    if (!isObject(item) || typeof item.id !== 'string' || typeof item.name !== 'string' || !isISODate(item.startDate) || !isISODate(item.endDate) || item.endDate < item.startDate) return []
    const type = oneOf(item.type, repaymentRuleTypes, 'monthlyFixed')
    const amount = optionalFiniteNumber(item.amount, 0)
    const percent = optionalFiniteNumber(item.percent, 0)
    if (type === 'paymentPercent' ? percent === undefined : amount === undefined) return []
    return [{
      id: item.id,
      name: item.name.trim() || 'Регулярный платёж',
      type,
      startDate: item.startDate,
      endDate: item.endDate,
      amount: type === 'paymentPercent' ? undefined : amount,
      percent: type === 'paymentPercent' ? percent : undefined,
      enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
      strategy: oneOf(item.strategy, repaymentStrategies, 'reduceTerm'),
      source: oneOf(item.source, repaymentSources, 'own'),
      sameDayOrder: oneOf(item.sameDayOrder, sameDayOrders, 'regularFirst'),
      interestFirst: typeof item.interestFirst === 'boolean' ? item.interestFirst : true,
      skipMonths: Array.isArray(item.skipMonths) ? item.skipMonths.filter(isISOYearMonth) : [],
      ...(typeof item.comment === 'string' ? { comment: item.comment } : {})
    }]
  })), 'rule')
}

const normalizeGracePeriods = (value: unknown): GracePeriod[] => {
  if (!Array.isArray(value)) return []
  return withUniqueIds(value.slice(0, MAX_GRACE_PERIODS).flatMap((item): GracePeriod[] => {
    if (!isObject(item) || typeof item.id !== 'string' || !isISODate(item.startDate) || !isISODate(item.endDate) || item.endDate < item.startDate) return []
    const paymentAmount = item.paymentAmount === undefined ? undefined : finiteNumber(item.paymentAmount, 0, 0)
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
  }).sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id)), 'grace')
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
  name: name.trim() || 'Мой кредит',
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
  if (countArray(data.repayments) > MAX_EARLY_REPAYMENTS) throw new Error(`Слишком много досрочных платежей. Максимум: ${MAX_EARLY_REPAYMENTS}`)
  if (countArray(data.repaymentRules) > MAX_REPAYMENT_RULES) throw new Error(`Слишком много правил досрочных платежей. Максимум: ${MAX_REPAYMENT_RULES}`)
  if (countArray(data.gracePeriods) > MAX_GRACE_PERIODS) throw new Error(`Слишком много льготных периодов. Максимум: ${MAX_GRACE_PERIODS}`)
}

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
  const rawLoans = Array.isArray(state.loans) ? state.loans.filter(isObject).slice(0, MAX_LOANS) : []
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
  const loans = rawLoans.length
    ? rawLoans.map((loan, index) => loanFromData(loan, typeof loan.name === 'string' ? loan.name : `Кредит ${index + 1}`, uniqueLoanId(loan.id)))
    : [loanFromData(state, 'Мой кредит', 'loan-default')]
  const activeLoanId = typeof state.activeLoanId === 'string' && loans.some(loan => loan.id === state.activeLoanId) ? state.activeLoanId : loans[0].id
  const active = loans.find(loan => loan.id === activeLoanId) ?? loans[0]
  return { loans, activeLoanId, ...publicData(active) }
}

export const useLoanStore = create<LoanState>()(persist((set) => ({
  ...publicData(initialLoan),
  loans: [initialLoan],
  activeLoanId: initialLoan.id,
  updateConfig: (patch) => set(s => syncActive(s, { config: { ...s.config, ...patch } })),
  updateInterest: (patch) => set(s => syncActive(s, { config: { ...s.config, interest: { ...s.config.interest, ...patch } } })),
  addRepayment: (repayment) => set(s => {
    if (s.repayments.length >= MAX_EARLY_REPAYMENTS) throw new Error(`Можно добавить не более ${MAX_EARLY_REPAYMENTS} разовых платежей`)
    return syncActive(s, { repayments: sortRepayments([...s.repayments, repayment]) })
  }),
  updateRepayment: (repayment) => set(s => syncActive(s, { repayments: sortRepayments(s.repayments.map(item => item.id === repayment.id ? repayment : item)) })),
  removeRepayment: (id) => set(s => syncActive(s, { repayments: s.repayments.filter(r => r.id !== id) })),
  addRepaymentRule: (rule) => set(s => {
    if (s.repaymentRules.length >= MAX_REPAYMENT_RULES) throw new Error(`Можно добавить не более ${MAX_REPAYMENT_RULES} правил досрочных платежей`)
    return syncActive(s, { repaymentRules: sortRules([...s.repaymentRules, rule]) })
  }),
  updateRepaymentRule: (rule) => set(s => syncActive(s, { repaymentRules: sortRules(s.repaymentRules.map(item => item.id === rule.id ? rule : item)) })),
  removeRepaymentRule: (id) => set(s => syncActive(s, { repaymentRules: s.repaymentRules.filter(rule => rule.id !== id) })),
  addGrace: (grace) => set(s => {
    if (s.gracePeriods.length >= MAX_GRACE_PERIODS) throw new Error(`Можно добавить не более ${MAX_GRACE_PERIODS} льготных периодов`)
    return syncActive(s, { gracePeriods: [...s.gracePeriods, grace] })
  }),
  removeGrace: (id) => set(s => syncActive(s, { gracePeriods: s.gracePeriods.filter(g => g.id !== id) })),
  selectScenario: (selectedScenario) => set(s => syncActive(s, { selectedScenario })),
  setTermUnit: (termUnit) => set(s => syncActive(s, { termUnit })),
  setDisplayDecimals: (displayDecimals) => set(s => syncActive(s, { displayDecimals })),
  setAppFontSize: (appFontSize) => set(s => syncActive(s, { appFontSize, scheduleFontSize: appFontSize })),
  setScheduleFontSize: (scheduleFontSize) => set(s => syncActive(s, { scheduleFontSize })),
  setTheme: (theme) => set(s => syncActive(s, { theme })),
  setCustomAccentColor: (customAccentColor) => set(s => syncActive(s, { customAccentColor: normalizeAccentColor(customAccentColor), useCustomAccentColor: true })),
  setUseCustomAccentColor: (useCustomAccentColor) => set(s => syncActive(s, { useCustomAccentColor })),
  resetCustomAccentColor: () => set(s => syncActive(s, { customAccentColor: defaultAccentColor, useCustomAccentColor: false })),
  switchLoan: (id) => set(s => switchToLoan(s, id)),
  createLoan: (name = 'Новый кредит') => set(s => {
    assertCanAddLoan(s.loans.length)
    const loan = loanFromData(defaultLoanData(false), name)
    return { loans: [...s.loans, loan], activeLoanId: loan.id, ...publicData(loan) }
  }),
  renameLoan: (id, name) => set(s => ({ loans: s.loans.map(loan => loan.id === id ? { ...loan, name: name.trim() || loan.name } : loan) })),
  removeLoan: (id) => set(s => {
    if (s.loans.length <= 1) return {}
    const loans = s.loans.filter(loan => loan.id !== id)
    const activeLoanId = s.activeLoanId === id ? loans[0].id : s.activeLoanId
    const active = loans.find(loan => loan.id === activeLoanId) ?? loans[0]
    return { loans, activeLoanId, ...publicData(active) }
  }),
  loadExampleLoan: () => set(s => {
    const data = defaultLoanData(true)
    return { ...data, loans: s.loans.map(loan => loan.id === s.activeLoanId ? { ...loan, name: 'Пример кредита', ...data } : loan) }
  }),
  addLoanFromData: (data) => set(s => {
    assertCanAddLoan(s.loans.length)
    assertImportWithinLimits(data)
    const loan = loanFromData(data, data.name ?? 'Кредит из ссылки')
    return { loans: [...s.loans, loan], activeLoanId: loan.id, ...publicData(loan) }
  }),
  replaceData: (data) => set(s => {
    assertImportWithinLimits(data)
    const normalized = normalizeLoanData(data)
    const name = data.name?.trim()
    return { ...normalized, loans: s.loans.map(loan => loan.id === s.activeLoanId ? { ...loan, ...(name ? { name } : {}), ...normalized } : loan) }
  })
}), {
  name: 'ipoteka-calculator-v1',
  storage: createJSONStorage(() => safeLocalStorage),
  version: 7,
  migrate: normalizePersistedState,
  merge: (persisted, current) => ({ ...current, ...normalizePersistedState(persisted) })
}))
