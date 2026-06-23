import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { EarlyRepayment, GracePeriod, LoanConfig } from './loanEngine'

export const defaultConfig: LoanConfig = {
  principal: 7200000, annualRate: 12.4, issueDate: '2026-06-23', firstPaymentDate: '2026-07-15', firstPaymentInterestOnly: true, termMonths: 240,
  paymentDay: 15, paymentType: 'annuity', frequency: 'monthly', currency: 'RUB', rounding: 'kopecks', closeThreshold: 300,
  oneTimeFee: 0, monthlyFee: 0, earlyRepaymentFeePercent: 0,
  interest: { method: 'daily', dayCountBasis: 'actualActual', includePaymentDate: false, balanceMoment: 'startOfDay' }
}

interface LoanState {
  config: LoanConfig
  repayments: EarlyRepayment[]
  gracePeriods: GracePeriod[]
  selectedScenario: string
  termUnit: 'months' | 'years'
  displayDecimals: 0 | 2
  theme: 'emerald' | 'ocean' | 'violet' | 'graphite'
  updateConfig: (patch: Partial<LoanConfig>) => void
  updateInterest: (patch: Partial<LoanConfig['interest']>) => void
  addRepayment: (repayment: EarlyRepayment) => void
  removeRepayment: (id: string) => void
  addGrace: (grace: GracePeriod) => void
  removeGrace: (id: string) => void
  selectScenario: (id: string) => void
  setTermUnit: (unit: 'months' | 'years') => void
  setDisplayDecimals: (value: 0 | 2) => void
  setTheme: (theme: LoanState['theme']) => void
}

export const useLoanStore = create<LoanState>()(persist((set) => ({
  config: defaultConfig,
  repayments: [{ id: 'seed-1', date: '2027-01-15', amount: 350000, amountMode: 'extra', strategy: 'reduceTerm', source: 'own', sameDayOrder: 'regularFirst', interestFirst: true, comment: 'Годовой бонус' }],
  gracePeriods: [], selectedScenario: 'reduceTerm', termUnit: 'months', displayDecimals: 2, theme: 'emerald',
  updateConfig: (patch) => set(s => ({ config: { ...s.config, ...patch } })),
  updateInterest: (patch) => set(s => ({ config: { ...s.config, interest: { ...s.config.interest, ...patch } } })),
  addRepayment: (repayment) => set(s => ({ repayments: [...s.repayments, repayment] })),
  removeRepayment: (id) => set(s => ({ repayments: s.repayments.filter(r => r.id !== id) })),
  addGrace: (grace) => set(s => ({ gracePeriods: [...s.gracePeriods, grace] })),
  removeGrace: (id) => set(s => ({ gracePeriods: s.gracePeriods.filter(g => g.id !== id) })),
  selectScenario: (id) => set({ selectedScenario: id }),
  setTermUnit: (termUnit) => set({ termUnit }),
  setDisplayDecimals: (displayDecimals) => set({ displayDecimals }),
  setTheme: (theme) => set({ theme })
}), { name: 'ipoteka-calculator-v1' }))
