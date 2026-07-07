import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { addMonths, format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import type { EarlyRepayment, GracePeriod, LoanConfig, PaymentScheduleItem } from '../loanEngine'
import type { RepaymentRule } from '../repaymentRules'
import { buildLoanCalculation, type LoanCalculationResult } from '../loanCalculation'
import { isISODate } from '../utils/dateValidation'

export interface LoanCalculationInput {
  config: LoanConfig
  repayments: EarlyRepayment[]
  repaymentRules: RepaymentRule[]
  gracePeriods: GracePeriod[]
  selectedScenario: string
  displayDecimals: 0 | 2
  loanId?: string
}

const emptyResult: LoanCalculationResult = {
  generatedRepayments: [],
  allRepayments: [],
  errors: [],
  comparison: null,
  selected: null,
  base: null
}

interface CalculationSnapshot extends LoanCalculationInput {
  revision: string
}

interface CalculationEnvelope {
  revision: string
  snapshot: CalculationSnapshot
  result: LoanCalculationResult
}

const objectRevisions = new WeakMap<object, number>()
let nextObjectRevision = 0

const objectRevision = (value: object) => {
  let revision = objectRevisions.get(value)
  if (revision === undefined) {
    revision = nextObjectRevision
    nextObjectRevision += 1
    objectRevisions.set(value, revision)
  }
  return revision
}

const snapshotRevision = ({ config, repayments, repaymentRules, gracePeriods, selectedScenario, displayDecimals, loanId }: LoanCalculationInput) =>
  JSON.stringify([
    loanId ?? '',
    objectRevision(config),
    objectRevision(repayments),
    objectRevision(repaymentRules),
    objectRevision(gracePeriods),
    selectedScenario,
    displayDecimals
  ])

export function useLoanCalculation({ config, repayments, repaymentRules, gracePeriods, selectedScenario, displayDecimals, loanId }: LoanCalculationInput) {
  const liveRevision = useMemo(
    () => snapshotRevision({ config, repayments, repaymentRules, gracePeriods, selectedScenario, displayDecimals, loanId }),
    [config, repayments, repaymentRules, gracePeriods, selectedScenario, displayDecimals, loanId]
  )
  const liveSnapshot = useMemo(
    () => ({ revision: liveRevision, config, repayments, repaymentRules, gracePeriods, selectedScenario, displayDecimals, loanId }),
    [liveRevision, config, repayments, repaymentRules, gracePeriods, selectedScenario, displayDecimals, loanId]
  )
  const calculationSnapshot = useDeferredValue(liveSnapshot)
  const requestedRevision = calculationSnapshot.revision
  const deferredStale = calculationSnapshot.revision !== liveSnapshot.revision

  const syncEnvelope = useMemo<CalculationEnvelope | null>(
    () => typeof Worker === 'undefined'
      ? { revision: requestedRevision, snapshot: calculationSnapshot, result: buildLoanCalculation(calculationSnapshot) }
      : null,
    [calculationSnapshot, requestedRevision]
  )
  const [workerEnvelope, setWorkerEnvelope] = useState<CalculationEnvelope | null>(syncEnvelope)
  const workerRef = useRef<Worker | null>(null)

  const setSyncFallback = useCallback((revision: string, snapshot: CalculationSnapshot) => {
    setWorkerEnvelope({ revision, snapshot, result: buildLoanCalculation(snapshot) })
  }, [])

  useEffect(() => {
    if (typeof Worker === 'undefined') {
      setWorkerEnvelope(syncEnvelope)
      return
    }
    const revision = requestedRevision
    const snapshot = calculationSnapshot
    let worker = workerRef.current
    if (!worker) {
      try {
        worker = new Worker(new URL('../loanCalculation.worker.ts', import.meta.url), { type: 'module' })
        workerRef.current = worker
      } catch {
        setSyncFallback(revision, snapshot)
        return
      }
    }
    worker.onmessage = (event: MessageEvent<{ revision: string; result: LoanCalculationResult }>) => {
      if (event.data.revision !== revision) return
      setWorkerEnvelope({ revision, snapshot, result: event.data.result })
    }
    worker.onerror = () => {
      setSyncFallback(revision, snapshot)
    }
    try {
      worker.postMessage({ revision, snapshot })
    } catch {
      worker.terminate()
      workerRef.current = null
      setSyncFallback(revision, snapshot)
    }
  }, [calculationSnapshot, requestedRevision, setSyncFallback, syncEnvelope])

  useEffect(() => () => workerRef.current?.terminate(), [])

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
