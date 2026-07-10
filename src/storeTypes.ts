import type { EarlyRepayment, GracePeriod, LoanConfig } from './loanEngine'
import type { RepaymentRule } from './repaymentRules'
import type { themeNames } from './portableSchemas'

export type ThemeName = typeof themeNames[number]

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

export type LoanData = Omit<LoanProfile, 'id' | 'name'>

export type LoanImportData =
  Pick<LoanProfile, 'config' | 'repayments' | 'gracePeriods' | 'selectedScenario' | 'termUnit' | 'displayDecimals' | 'theme'> &
  Partial<Pick<LoanProfile, 'name' | 'appFontSize' | 'scheduleFontSize' | 'repaymentRules' | 'customAccentColor' | 'useCustomAccentColor'>>

export interface QuarantinedLoanRaw {
  id: string
  name: string
  reason: string
  raw: unknown
}

export type LoanPersistedState = LoanData & {
  loans: LoanProfile[]
  activeLoanId: string
  storageRecoveryReport: string[]
  quarantinedLoansRaw: QuarantinedLoanRaw[]
  persistedRevision: number
  persistedUpdatedAt: string
}
