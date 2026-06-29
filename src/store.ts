import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { EarlyRepayment, GracePeriod, LoanConfig } from './loanEngine'
import { defaultConfig } from './loanDefaults'
import type { LoanBackupData } from './importExport'
import type { RepaymentRule } from './repaymentRules'
export { defaultConfig } from './loanDefaults'

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
  theme: 'emerald' | 'ocean' | 'violet' | 'graphite'
}

type LoanData = Omit<LoanProfile, 'id' | 'name'>
type LoanImportData = Pick<LoanProfile, 'config' | 'repayments' | 'gracePeriods' | 'selectedScenario' | 'termUnit' | 'displayDecimals' | 'theme'> & Partial<Pick<LoanProfile, 'name' | 'appFontSize' | 'scheduleFontSize' | 'repaymentRules'>>

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
  switchLoan: (id: string) => void
  createLoan: (name?: string) => void
  renameLoan: (id: string, name: string) => void
  addLoanFromData: (data: LoanImportData) => void
  replaceData: (data: LoanImportData) => void
}

const seedRepayments: EarlyRepayment[] = [{ id: 'seed-1', date: '2027-01-15', amount: 350000, amountMode: 'extra', strategy: 'reduceTerm', source: 'own', sameDayOrder: 'regularFirst', interestFirst: true, comment: 'Годовой бонус' }]

const sortRepayments = (repayments: EarlyRepayment[]) =>
  [...repayments].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))

const sortRules = (rules: RepaymentRule[]) =>
  [...rules].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id))

const createId = (): string => globalThis.crypto?.randomUUID?.() ?? `loan-${Date.now()}-${Math.random().toString(16).slice(2)}`

const defaultLoanData = (withSeedRepayment = true): LoanData => ({
  config: defaultConfig,
  repayments: withSeedRepayment ? seedRepayments : [],
  repaymentRules: [],
  gracePeriods: [],
  selectedScenario: 'reduceTerm',
  termUnit: 'months',
  displayDecimals: 2,
  appFontSize: 'normal',
  scheduleFontSize: 'large',
  theme: 'emerald'
})

const normalizeLoanData = (data: Partial<LoanImportData | LoanData>): LoanData => ({
  config: { ...defaultConfig, ...data.config, interest: { ...defaultConfig.interest, ...data.config?.interest }, firstPaymentInterestOnly: data.config?.firstPaymentInterestOnly ?? true },
  repayments: sortRepayments(data.repayments ?? []),
  repaymentRules: sortRules(data.repaymentRules ?? []),
  gracePeriods: data.gracePeriods ?? [],
  selectedScenario: data.selectedScenario ?? 'reduceTerm',
  termUnit: data.termUnit ?? 'months',
  displayDecimals: data.displayDecimals ?? 2,
  appFontSize: data.appFontSize ?? 'normal',
  scheduleFontSize: data.scheduleFontSize ?? 'large',
  theme: data.theme ?? 'emerald'
})

const loanFromData = (data: Partial<LoanImportData | LoanData>, name = 'Мой кредит', id = createId()): LoanProfile => ({
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
  theme: state.theme
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
  theme: loan.theme
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

export const useLoanStore = create<LoanState>()(persist((set) => ({
  ...publicData(initialLoan),
  loans: [initialLoan],
  activeLoanId: initialLoan.id,
  updateConfig: (patch) => set(s => syncActive(s, { config: { ...s.config, ...patch } })),
  updateInterest: (patch) => set(s => syncActive(s, { config: { ...s.config, interest: { ...s.config.interest, ...patch } } })),
  addRepayment: (repayment) => set(s => syncActive(s, { repayments: sortRepayments([...s.repayments, repayment]) })),
  updateRepayment: (repayment) => set(s => syncActive(s, { repayments: sortRepayments(s.repayments.map(item => item.id === repayment.id ? repayment : item)) })),
  removeRepayment: (id) => set(s => syncActive(s, { repayments: s.repayments.filter(r => r.id !== id) })),
  addRepaymentRule: (rule) => set(s => syncActive(s, { repaymentRules: sortRules([...s.repaymentRules, rule]) })),
  updateRepaymentRule: (rule) => set(s => syncActive(s, { repaymentRules: sortRules(s.repaymentRules.map(item => item.id === rule.id ? rule : item)) })),
  removeRepaymentRule: (id) => set(s => syncActive(s, { repaymentRules: s.repaymentRules.filter(rule => rule.id !== id) })),
  addGrace: (grace) => set(s => syncActive(s, { gracePeriods: [...s.gracePeriods, grace] })),
  removeGrace: (id) => set(s => syncActive(s, { gracePeriods: s.gracePeriods.filter(g => g.id !== id) })),
  selectScenario: (selectedScenario) => set(s => syncActive(s, { selectedScenario })),
  setTermUnit: (termUnit) => set(s => syncActive(s, { termUnit })),
  setDisplayDecimals: (displayDecimals) => set(s => syncActive(s, { displayDecimals })),
  setAppFontSize: (appFontSize) => set(s => syncActive(s, { appFontSize })),
  setScheduleFontSize: (scheduleFontSize) => set(s => syncActive(s, { scheduleFontSize })),
  setTheme: (theme) => set(s => syncActive(s, { theme })),
  switchLoan: (id) => set(s => switchToLoan(s, id)),
  createLoan: (name = 'Новый кредит') => set(s => {
    const loan = loanFromData(defaultLoanData(false), name)
    return { loans: [...s.loans, loan], activeLoanId: loan.id, ...publicData(loan) }
  }),
  renameLoan: (id, name) => set(s => ({ loans: s.loans.map(loan => loan.id === id ? { ...loan, name: name.trim() || loan.name } : loan) })),
  addLoanFromData: (data) => set(s => {
    const loan = loanFromData(data, data.name ?? 'Кредит из ссылки')
    return { loans: [...s.loans, loan], activeLoanId: loan.id, ...publicData(loan) }
  }),
  replaceData: (data) => set(s => {
    const normalized = normalizeLoanData(data)
    const name = data.name?.trim()
    return { ...normalized, loans: s.loans.map(loan => loan.id === s.activeLoanId ? { ...loan, ...(name ? { name } : {}), ...normalized } : loan) }
  })
}), {
  name: 'ipoteka-calculator-v1',
  version: 4,
  migrate: (persisted) => {
    const state = persisted as Partial<LoanState>
    const hasLoans = Array.isArray(state.loans) && state.loans.length > 0
    const loans = hasLoans
      ? state.loans!.map((loan, index) => loanFromData(loan, loan.name || `Кредит ${index + 1}`, loan.id || createId()))
      : [loanFromData(state, 'Мой кредит', 'loan-default')]
    const activeLoanId = state.activeLoanId && loans.some(loan => loan.id === state.activeLoanId) ? state.activeLoanId : loans[0].id
    const active = loans.find(loan => loan.id === activeLoanId) ?? loans[0]
    return { ...state, loans, activeLoanId, ...publicData(active) }
  }
}))
