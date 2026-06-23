export type PaymentType = 'annuity' | 'differentiated'
export type Frequency = 'monthly' | 'biweekly' | 'quarterly'
export type RepaymentStrategy = 'reduceTerm' | 'reducePayment' | 'full' | 'custom'
export type EarlySource = 'own' | 'subsidy' | 'insurance' | 'other'
export type DayCountBasis = '365' | '366' | '360' | 'actual365' | 'actualActual'
export type RoundingMode = 'kopecks' | 'rubles' | 'bank'

export interface InterestConfig {
  method: 'annuity' | 'daily'
  dayCountBasis: DayCountBasis
  includePaymentDate: boolean
  balanceMoment: 'startOfDay' | 'endOfDay'
}

export interface LoanConfig {
  principal: number
  annualRate: number
  issueDate: string
  firstPaymentDate: string
  termMonths: number
  paymentDay: number
  paymentType: PaymentType
  frequency: Frequency
  currency: string
  rounding: RoundingMode
  closeThreshold: number
  oneTimeFee: number
  monthlyFee: number
  earlyRepaymentFeePercent: number
  interest: InterestConfig
}

export interface EarlyRepayment {
  id: string
  date: string
  amount: number
  strategy: RepaymentStrategy
  source: EarlySource
  sameDayOrder: 'regularFirst' | 'earlyFirst'
  interestFirst: boolean
  comment?: string
}

export interface GracePeriod {
  id: string
  startDate: string
  endDate: string
  type: 'full' | 'interestOnly' | 'reduced' | 'custom'
  paymentAmount?: number
  extendTerm: boolean
  accrueInterest: boolean
  capitalizeInterest: boolean
}

export interface PaymentScheduleItem {
  number: number
  date: string
  days: number
  openingBalance: number
  payment: number
  interest: number
  principal: number
  earlyPayment: number
  closingBalance: number
  cumulativeInterest: number
  cumulativeSavings: number
  fee: number
  comment: string
  event: string
}

export interface ScenarioResult {
  id: string
  name: string
  strategy: RepaymentStrategy | 'base' | 'combined'
  schedule: PaymentScheduleItem[]
  monthlyPayment: number
  totalPaid: number
  totalInterest: number
  overpayment: number
  closingDate: string
  termMonths: number
  interestSavings: number
  monthsSaved: number
}

export interface ComparisonResult {
  scenarios: ScenarioResult[]
  bestSavings: ScenarioResult
  fastest: ScenarioResult
  lowestPayment: ScenarioResult
}
