import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { addMonths, format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import type { PaymentScheduleItem } from '../loanEngine'
import type { LoanCalculationResult } from '../loanCalculation'
import { calculateLoanSynchronously, canUseLoanCalculationWorker, LoanCalculationRunner, type LoanCalculationEnvelope, type LoanCalculationSnapshot } from '../loanCalculationRunner'
import { isISODate } from '../utils/dateValidation'

export type LoanCalculationInput = Omit<LoanCalculationSnapshot, 'revision'>

const emptyResult: LoanCalculationResult = {
  generatedRepayments: [],
  allRepayments: [],
  errors: [],
  comparison: null,
  selected: null,
  base: null
}

const MAX_OBJECT_REVISION = Number.MAX_SAFE_INTEGER

export const createSnapshotRevisionTracker = (maxObjectRevision = MAX_OBJECT_REVISION) => {
  let objectRevisions = new WeakMap<object, number>()
  let nextObjectRevision = 0
  let objectRevisionEpoch = 0

  const objectRevision = (value: object) => {
    let revision = objectRevisions.get(value)
    if (revision === undefined) {
      if (nextObjectRevision >= maxObjectRevision) {
        objectRevisions = new WeakMap<object, number>()
        nextObjectRevision = 0
        objectRevisionEpoch += 1
      }
      revision = nextObjectRevision
      nextObjectRevision += 1
      objectRevisions.set(value, revision)
    }
    return revision
  }

  return ({ config, repayments, repaymentRules, gracePeriods, selectedScenario, displayDecimals, loanId }: LoanCalculationInput) => {
    const configRevision = objectRevision(config)
    const repaymentsRevision = objectRevision(repayments)
    const repaymentRulesRevision = objectRevision(repaymentRules)
    const gracePeriodsRevision = objectRevision(gracePeriods)

    return JSON.stringify([
      objectRevisionEpoch,
      loanId ?? '',
      configRevision,
      repaymentsRevision,
      repaymentRulesRevision,
      gracePeriodsRevision,
      selectedScenario,
      displayDecimals
    ])
  }
}

const snapshotRevision = createSnapshotRevisionTracker()

export function useLoanCalculation({ config, repayments, repaymentRules, gracePeriods, selectedScenario, displayDecimals, loanId }: LoanCalculationInput) {
  const liveRevision = useMemo(
    () => snapshotRevision({ config, repayments, repaymentRules, gracePeriods, selectedScenario, displayDecimals, loanId }),
    [config, repayments, repaymentRules, gracePeriods, selectedScenario, displayDecimals, loanId]
  )
  const liveSnapshot = useMemo<LoanCalculationSnapshot>(
    () => ({ revision: liveRevision, config, repayments, repaymentRules, gracePeriods, selectedScenario, displayDecimals, loanId }),
    [liveRevision, config, repayments, repaymentRules, gracePeriods, selectedScenario, displayDecimals, loanId]
  )
  const calculationSnapshot = useDeferredValue(liveSnapshot)
  const requestedRevision = calculationSnapshot.revision
  const deferredStale = calculationSnapshot.revision !== liveSnapshot.revision

  const syncEnvelope = useMemo<LoanCalculationEnvelope | null>(
    () => canUseLoanCalculationWorker() ? null : calculateLoanSynchronously(calculationSnapshot),
    [calculationSnapshot]
  )
  const [workerEnvelope, setWorkerEnvelope] = useState<LoanCalculationEnvelope | null>(syncEnvelope)
  const calculationRunnerRef = useRef<LoanCalculationRunner | null>(null)

  useEffect(() => {
    if (!canUseLoanCalculationWorker()) {
      setWorkerEnvelope(syncEnvelope)
      return
    }
    calculationRunnerRef.current ??= new LoanCalculationRunner()
    calculationRunnerRef.current.calculate(calculationSnapshot, setWorkerEnvelope)
  }, [calculationSnapshot, syncEnvelope])

  useEffect(() => () => calculationRunnerRef.current?.dispose(), [])

  const envelope = syncEnvelope ?? workerEnvelope
  const resultIsCurrent = envelope?.revision === requestedRevision
  const resultSnapshot = envelope?.snapshot ?? calculationSnapshot
  const result = envelope?.result ?? emptyResult
  const generatedRepayments = result.generatedRepayments
  const allRepayments = result.allRepayments
  const errors = result.errors
  const comparison = result.comparison
  const selected = result.selected
  const base = result.base

  const overviewChartData = useMemo(() => {
    if (!base || !selected) return []
    const baseStep = Math.max(1, Math.floor(base.schedule.length / 48))
    const dates = new Set(base.schedule.filter((_, index) => index % baseStep === 0).map(row => row.date))
    dates.add(base.closingDate)
    dates.add(selected.closingDate)

    const balanceAt = (schedule: PaymentScheduleItem[], date: string) => {
      let balance = schedule[0]?.closingBalance ?? 0
      for (const row of schedule) {
        if (row.date > date) break
        balance = row.closingBalance
      }
      return balance
    }

    const selectedClosingDate = selected.closingDate
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
    defaultEarlyDate,
    calculationSnapshot: resultSnapshot,
    isStale: deferredStale || !resultIsCurrent
  }
}
