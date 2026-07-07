import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { EarlyRepayment, GracePeriod, LoanConfig } from './loanEngine'
import { MAX_EARLY_REPAYMENTS, MAX_GRACE_PERIODS, MAX_REPAYMENT_RULES } from './loanEngine/limits'
import type { RepaymentRule } from './repaymentRules'
import {
  assertCanAddLoan,
  assertGracePeriodsDoNotOverlap,
  assertImportWithinLimits,
  assertRepaymentPlanValid,
  defaultAccentColor,
  defaultLoanData,
  loanFromData,
  normalizeAccentColor,
  normalizeConfigPatch,
  normalizeLoanData,
  normalizePersistedState,
  normalizeText,
  publicData,
  sortRepayments,
  sortRules,
  withRepaymentSequence,
  withRuleSequence
} from './storeNormalization'
import type { LoanData, LoanImportData, LoanProfile } from './storeTypes'

export { defaultConfig } from './loanDefaults'
export { MAX_LOANS, loanToBackupData, normalizePersistedState } from './storeNormalization'
export type { LoanProfile } from './storeTypes'

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

const loanToPublicState = (loan: LoanProfile) => ({
  activeLoanId: loan.id,
  ...publicData(loan)
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
  return loan ? loanToPublicState(loan) : {}
}

const initialLoan = loanFromData(defaultLoanData(), 'Мой кредит', 'loan-default')

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
    return { loans: [...s.loans, loan], ...loanToPublicState(loan) }
  }),
  renameLoan: (id, name) => set(s => ({ loans: s.loans.map(loan => loan.id === id ? { ...loan, name: normalizeText(name) || loan.name } : loan) })),
  removeLoan: (id) => set(s => {
    if (s.loans.length <= 1) return {}
    const loans = s.loans.filter(loan => loan.id !== id)
    const activeLoanId = s.activeLoanId === id ? loans[0].id : s.activeLoanId
    const active = loans.find(loan => loan.id === activeLoanId) ?? loans[0]
    return { loans, ...loanToPublicState(active) }
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
    return { loans: [...s.loans, loan], ...loanToPublicState(loan) }
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
