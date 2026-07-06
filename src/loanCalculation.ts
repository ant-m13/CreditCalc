import { compareScenarios, preparePaymentCalendar, sortRepaymentsByApplicationOrder, validateScenario, type ComparisonResult, type EarlyRepayment, type GracePeriod, type LoanConfig, type ScenarioResult } from './loanEngine'
import { expandRepaymentRules, type RepaymentRule } from './repaymentRules'

export interface LoanCalculationSource {
  config: LoanConfig
  repayments: EarlyRepayment[]
  repaymentRules: RepaymentRule[]
  gracePeriods: GracePeriod[]
  selectedScenario: string
}

export interface LoanCalculationResult {
  generatedRepayments: EarlyRepayment[]
  allRepayments: EarlyRepayment[]
  errors: string[]
  comparison: ComparisonResult | null
  selected: ScenarioResult | null
  base: ScenarioResult | null
}

export const activeManualRepayments = (repayments: EarlyRepayment[]) =>
  repayments.filter(item => item.enabled !== false && item.amount > 0)

export function buildLoanCalculationOrThrow(loan: LoanCalculationSource) {
  const paymentCalendar = preparePaymentCalendar(loan.config, loan.gracePeriods)
  const generated = expandRepaymentRules(loan.config, loan.repaymentRules, loan.gracePeriods, paymentCalendar)
  const repayments = sortRepaymentsByApplicationOrder([...loan.repayments, ...generated])
  const comparison = compareScenarios(loan.config, repayments, loan.gracePeriods, paymentCalendar)
  const selected = comparison.scenarios.find(s => s.id === loan.selectedScenario) ?? comparison.scenarios[1]
  return { generated, repayments, comparison, selected }
}

export function buildLoanCalculation(loan: LoanCalculationSource): LoanCalculationResult {
  const validationErrors = validateScenario(loan.config, loan.repayments, loan.gracePeriods)
  if (validationErrors.length > 0) {
    return { generatedRepayments: [], allRepayments: activeManualRepayments(loan.repayments), errors: validationErrors, comparison: null, selected: null, base: null }
  }

  let paymentCalendar: ReturnType<typeof preparePaymentCalendar>
  try {
    paymentCalendar = preparePaymentCalendar(loan.config, loan.gracePeriods)
  } catch (error) {
    return { generatedRepayments: [], allRepayments: activeManualRepayments(loan.repayments), errors: [error instanceof Error ? error.message : 'Не удалось построить календарь платежей'], comparison: null, selected: null, base: null }
  }

  let generatedRepayments: EarlyRepayment[]
  try {
    generatedRepayments = expandRepaymentRules(loan.config, loan.repaymentRules, loan.gracePeriods, paymentCalendar)
  } catch (error) {
    return { generatedRepayments: [], allRepayments: activeManualRepayments(loan.repayments), errors: [error instanceof Error ? error.message : 'Не удалось создать операции по правилам досрочных платежей'], comparison: null, selected: null, base: null }
  }

  const allRepayments = sortRepaymentsByApplicationOrder([...activeManualRepayments(loan.repayments), ...generatedRepayments])
  try {
    const comparison = compareScenarios(loan.config, allRepayments, loan.gracePeriods, paymentCalendar)
    const selected = comparison.scenarios.find(s => s.id === loan.selectedScenario) ?? comparison.scenarios[1] ?? null
    const base = comparison.scenarios[0] ?? null
    return { generatedRepayments, allRepayments, errors: [], comparison, selected, base }
  } catch (error) {
    return { generatedRepayments, allRepayments, errors: [error instanceof Error ? error.message : 'Не удалось построить график платежей'], comparison: null, selected: null, base: null }
  }
}
