import { useDeferredValue, useMemo } from 'react'
import { addMonths, format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { compareScenarios, validateScenario, type EarlyRepayment, type GracePeriod, type LoanConfig, type PaymentScheduleItem } from '../loanEngine'
import { expandRepaymentRules, type RepaymentRule } from '../repaymentRules'
import type { LoanProfile } from '../store'
import { isISODate } from '../utils/dateValidation'

export interface LoanCalculationInput {
  config: LoanConfig
  repayments: EarlyRepayment[]
  repaymentRules: RepaymentRule[]
  gracePeriods: GracePeriod[]
  selectedScenario: string
}

export const buildLoanCalculation = (loan: LoanProfile) => {
  const generated = expandRepaymentRules(loan.config, loan.repaymentRules)
  const repayments = [...loan.repayments, ...generated].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  const comparison = compareScenarios(loan.config, repayments, loan.gracePeriods)
  const selected = comparison.scenarios.find(s => s.id === loan.selectedScenario) ?? comparison.scenarios[1]
  return { generated, repayments, comparison, selected }
}

export function useLoanCalculation({ config, repayments, repaymentRules, gracePeriods, selectedScenario }: LoanCalculationInput) {
  const calculationConfig = useDeferredValue(config)
  const calculationRepayments = useDeferredValue(repayments)
  const calculationRepaymentRules = useDeferredValue(repaymentRules)
  const calculationGracePeriods = useDeferredValue(gracePeriods)

  const validationErrors = useMemo(
    () => validateScenario(calculationConfig, calculationRepayments, calculationGracePeriods),
    [calculationConfig, calculationRepayments, calculationGracePeriods]
  )

  const generatedResult = useMemo(() => {
    if (validationErrors.length > 0) return { items: [] as EarlyRepayment[], error: null as string | null }
    try {
      return { items: expandRepaymentRules(calculationConfig, calculationRepaymentRules), error: null as string | null }
    } catch (error) {
      return { items: [] as EarlyRepayment[], error: error instanceof Error ? error.message : 'Не удалось создать операции по правилам досрочных платежей' }
    }
  }, [calculationConfig, calculationRepaymentRules, validationErrors])

  const generatedRepayments = generatedResult.items

  const activeManualRepayments = useMemo(
    () => calculationRepayments.filter(item => item.enabled !== false && item.amount > 0),
    [calculationRepayments]
  )

  const allRepayments = useMemo(
    () => [...activeManualRepayments, ...generatedRepayments].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)),
    [activeManualRepayments, generatedRepayments]
  )

  const preliminaryErrors = useMemo(
    () => generatedResult.error ? [...validationErrors, generatedResult.error] : validationErrors,
    [validationErrors, generatedResult.error]
  )

  const comparisonResult = useMemo(() => {
    if (preliminaryErrors.length > 0) return { comparison: null, error: null as string | null }
    try {
      return { comparison: compareScenarios(calculationConfig, allRepayments, calculationGracePeriods), error: null }
    } catch (error) {
      return { comparison: null, error: error instanceof Error ? error.message : 'Не удалось построить график платежей' }
    }
  }, [calculationConfig, allRepayments, calculationGracePeriods, preliminaryErrors])

  const errors = useMemo(
    () => comparisonResult.error ? [...preliminaryErrors, comparisonResult.error] : preliminaryErrors,
    [preliminaryErrors, comparisonResult.error]
  )

  const comparison = comparisonResult.comparison
  const selected = comparison?.scenarios.find(s => s.id === selectedScenario) ?? comparison?.scenarios[1] ?? null
  const base = comparison?.scenarios[0] ?? null

  const overviewChartData = useMemo(() => {
    if (!base || !selected) return []
    const baseStep = Math.max(1, Math.floor(base.schedule.length / 48))
    const dates = new Set(base.schedule.filter((_, index) => index % baseStep === 0).map(row => row.date))
    if (base.schedule.at(-1)) dates.add(base.schedule.at(-1)!.date)
    if (selected.schedule.at(-1)) dates.add(selected.schedule.at(-1)!.date)

    const balanceAt = (schedule: PaymentScheduleItem[], date: string) => {
      let balance = schedule[0]?.closingBalance ?? 0
      for (const row of schedule) {
        if (row.date > date) break
        balance = row.closingBalance
      }
      return balance
    }

    const selectedClosingDate = selected.schedule.at(-1)?.date ?? ''
    return [...dates].sort().map(date => ({
      date: format(parseISO(date), 'MMM yy', { locale: ru }),
      base: balanceAt(base.schedule, date),
      balance: date <= selectedClosingDate ? balanceAt(selected.schedule, date) : null
    }))
  }, [selected, base])

  const defaultEarlyDate = useMemo(
    () => isISODate(config.firstPaymentDate) ? format(addMonths(parseISO(config.firstPaymentDate), 1), 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'),
    [config.firstPaymentDate]
  )

  return {
    generatedRepayments,
    allRepayments,
    errors,
    comparison,
    selected,
    base,
    overviewChartData,
    defaultEarlyDate
  }
}
