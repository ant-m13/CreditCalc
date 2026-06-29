import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { EarlyRepayment, GracePeriod, LoanConfig } from './loanEngine'
import { defaultConfig } from './loanDefaults'
export { defaultConfig } from './loanDefaults'

interface LoanState {
  config: LoanConfig
  repayments: EarlyRepayment[]
  gracePeriods: GracePeriod[]
  selectedScenario: string
  termUnit: 'months' | 'years'
  displayDecimals: 0 | 2
  appFontSize: 'normal' | 'large' | 'xlarge'
  scheduleFontSize: 'normal' | 'large' | 'xlarge'
  theme: 'emerald' | 'ocean' | 'violet' | 'graphite'
  updateConfig: (patch: Partial<LoanConfig>) => void
  updateInterest: (patch: Partial<LoanConfig['interest']>) => void
  addRepayment: (repayment: EarlyRepayment) => void
  updateRepayment: (repayment: EarlyRepayment) => void
  removeRepayment: (id: string) => void
  addGrace: (grace: GracePeriod) => void
  removeGrace: (id: string) => void
  selectScenario: (id: string) => void
  setTermUnit: (unit: 'months' | 'years') => void
  setDisplayDecimals: (value: 0 | 2) => void
  setAppFontSize: (value: LoanState['appFontSize']) => void
  setScheduleFontSize: (value: LoanState['scheduleFontSize']) => void
  setTheme: (theme: LoanState['theme']) => void
  replaceData: (data: Pick<LoanState, 'config' | 'repayments' | 'gracePeriods' | 'selectedScenario' | 'termUnit' | 'displayDecimals' | 'theme'> & Partial<Pick<LoanState, 'appFontSize' | 'scheduleFontSize'>>) => void
}

const sortRepayments = (repayments: EarlyRepayment[]) =>
  [...repayments].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))

export const useLoanStore = create<LoanState>()(persist((set) => ({
  config: defaultConfig,
  repayments: [{ id: 'seed-1', date: '2027-01-15', amount: 350000, amountMode: 'extra', strategy: 'reduceTerm', source: 'own', sameDayOrder: 'regularFirst', interestFirst: true, comment: 'Годовой бонус' }],
  gracePeriods: [], selectedScenario: 'reduceTerm', termUnit: 'months', displayDecimals: 2, appFontSize: 'normal', scheduleFontSize: 'large', theme: 'emerald',
  updateConfig: (patch) => set(s => ({ config: { ...s.config, ...patch } })),
  updateInterest: (patch) => set(s => ({ config: { ...s.config, interest: { ...s.config.interest, ...patch } } })),
  addRepayment: (repayment) => set(s => ({ repayments: sortRepayments([...s.repayments, repayment]) })),
  updateRepayment: (repayment) => set(s => ({ repayments: sortRepayments(s.repayments.map(item => item.id === repayment.id ? repayment : item)) })),
  removeRepayment: (id) => set(s => ({ repayments: s.repayments.filter(r => r.id !== id) })),
  addGrace: (grace) => set(s => ({ gracePeriods: [...s.gracePeriods, grace] })),
  removeGrace: (id) => set(s => ({ gracePeriods: s.gracePeriods.filter(g => g.id !== id) })),
  selectScenario: (id) => set({ selectedScenario: id }),
  setTermUnit: (termUnit) => set({ termUnit }),
  setDisplayDecimals: (displayDecimals) => set({ displayDecimals }),
  setAppFontSize: (appFontSize) => set({ appFontSize }),
  setScheduleFontSize: (scheduleFontSize) => set({ scheduleFontSize }),
  setTheme: (theme) => set({ theme }),
  replaceData: (data) => set({ ...data, repayments: sortRepayments(data.repayments) })
}), {
  name: 'ipoteka-calculator-v1',
  version: 3,
  migrate: (persisted) => {
    const state = persisted as Partial<LoanState>
    return {
      ...state,
      config: { ...defaultConfig, ...state.config, firstPaymentInterestOnly: true },
      repayments: sortRepayments(state.repayments ?? []),
      appFontSize: state.appFontSize ?? 'normal',
      scheduleFontSize: state.scheduleFontSize ?? 'large'
    }
  }
}))
