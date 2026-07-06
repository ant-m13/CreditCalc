import { generateBaseSchedule, preparePaymentCalendar, sortRepaymentsByApplicationOrder, validateScenario, type EarlyRepayment, type GracePeriod, type LoanConfig } from './loanEngine'
import { expandRepaymentRules, type RepaymentRule } from './repaymentRules'

const activeRepayments = (repayments: EarlyRepayment[]) =>
  repayments.filter(item => item.enabled !== false && item.amount > 0)

export function assertLoanCandidateValid(config: LoanConfig, repayments: EarlyRepayment[], rules: RepaymentRule[], gracePeriods: GracePeriod[]) {
  const paymentCalendar = preparePaymentCalendar(config, gracePeriods)
  const generated = expandRepaymentRules(config, rules, gracePeriods, paymentCalendar)
  const candidateRepayments = sortRepaymentsByApplicationOrder([...activeRepayments(repayments), ...generated])
  const validationErrors = validateScenario(config, candidateRepayments, gracePeriods)
  if (validationErrors.length > 0) throw new Error(validationErrors.join(' · '))
  generateBaseSchedule(config, { earlyRepayments: candidateRepayments, gracePeriods, paymentCalendar })
}
