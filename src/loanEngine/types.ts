export type PaymentType = 'annuity' | 'differentiated'
export type Frequency = 'monthly' | 'biweekly' | 'quarterly'
export type RepaymentStrategy = 'reduceTerm' | 'reducePayment' | 'full' | 'custom'
export type EarlySource = 'own' | 'subsidy' | 'insurance' | 'other'
export type DayCountBasis = '365' | '366' | '360' | 'actual365' | 'actualActual'
export type RoundingMode = 'kopecks' | 'rubles' | 'bank'
export type RateChangeMode = 'nextPeriod' | 'exactDate'
export type EarlyRepaymentAmountMode = 'extra' | 'totalWithFee'
export type ScheduleEventType =
  | 'loanIssued'
  | 'earlyReduceTerm'
  | 'earlyReducePayment'
  | 'earlyFull'
  | 'earlyFullInsufficient'
  | 'earlyIgnored'
  | 'earlyCombined'
  | 'firstInterestOnly'
  | 'graceFull'
  | 'graceInterestOnly'
  | 'graceSpecialPayment'
  | 'deferredInterestPayment'
  | 'rateChange'
  | 'autoClose'
  | 'finalBalloon'

export interface InterestAuditSegment {
  from: string
  to: string
  days: number
  balance: number
  annualRate: number
  rateBasis: DayCountBasis
  rawInterest: number
  reason: string
}

export interface RateChange {
  id: string
  date: string
  annualRate: number
}

export interface InterestConfig {
  method: 'annuity' | 'daily'
  dayCountBasis: DayCountBasis
  includePaymentDate: boolean
  periodStart: 'inclusive' | 'exclusive'
  balanceMoment: 'startOfDay' | 'endOfDay'
}

export interface LoanConfig {
  principal: number
  annualRate: number
  rateChanges: RateChange[]
  rateChangeMode: RateChangeMode
  issueDate: string
  firstPaymentDate: string
  firstPaymentInterestOnly: boolean
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
  enabled?: boolean
  amountMode?: EarlyRepaymentAmountMode
  sameDaySequence?: number
  operationSource?: 'manual' | 'rule'
  sourceRuleId?: string
  strategy: RepaymentStrategy
  source: EarlySource
  sameDayOrder: 'regularFirst' | 'earlyFirst'
  interestFirst: boolean
  comment?: string
}

export interface RepaymentApplicationOutcome {
  repaymentId: string
  date: string
  requestedAmount: number
  appliedAmount: number
  appliedInterest: number
  appliedPrincipal: number
  fee: number
  unusedAmount: number
  reason: 'applied' | 'partiallyApplied' | 'debtClosed'
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
  interestAccrued: number
  interestPaid: number
  principalPaid: number
  feePaid: number
  deferredInterestOpening: number
  deferredInterestClosing: number
  cashFlowTotal: number
  closingBalance: number
  cumulativeInterest: number
  cumulativeSavings: number
  fee: number
  comment: string
  event: string
  eventTypes: ScheduleEventType[]
  paymentRecalculated: boolean
  fullyClosedByEarlyRepayment: boolean
  isRegularPayment: boolean
  isGracePayment: boolean
  audit?: {
    periodStart: string
    periodEnd: string
    regularPeriodStart?: string
    regularPeriodEnd?: string
    regularPeriodDays?: number
    segmentStart?: string
    segmentEnd?: string
    segmentDays?: number
    days: number
    dayCountBasis: DayCountBasis
    interestBalance: number
    interestBeforeRounding: number
    interestSegments: InterestAuditSegment[]
    rounding: RoundingMode
    operationOrder: string
  }
  repaymentOutcomes?: RepaymentApplicationOutcome[]
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
  termDays: number
  interestSavings: number
  monthsSaved: number
  daysSaved: number
}

export interface ComparisonResult {
  scenarios: ScenarioResult[]
  bestSavings: ScenarioResult
  fastest: ScenarioResult
  lowestPayment: ScenarioResult
}
