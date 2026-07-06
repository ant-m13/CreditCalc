import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
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

export function useLoanCalculation({ config, repayments, repaymentRules, gracePeriods, selectedScenario, displayDecimals, loanId }: LoanCalculationInput) {
  const liveSnapshot = useMemo(
    () => ({ config, repayments, repaymentRules, gracePeriods, selectedScenario, displayDecimals, loanId }),
    [config, repayments, repaymentRules, gracePeriods, selectedScenario, displayDecimals, loanId]
  )
  const calculationSnapshot = useDeferredValue(liveSnapshot)
  const isStale = calculationSnapshot !== liveSnapshot

  const syncResult = useMemo(
    () => typeof Worker === 'undefined' ? buildLoanCalculation(calculationSnapshot) : null,
    [calculationSnapshot]
  )
  const [workerResult, setWorkerResult] = useState<LoanCalculationResult | null>(syncResult)
  const [workerPending, setWorkerPending] = useState(false)
  const workerRef = useRef<Worker | null>(null)
  const revisionRef = useRef(0)

  useEffect(() => {
    if (typeof Worker === 'undefined') {
      setWorkerResult(syncResult)
      setWorkerPending(false)
      return
    }
    workerRef.current ??= new Worker(new URL('../loanCalculation.worker.ts', import.meta.url), { type: 'module' })
    const worker = workerRef.current
    const revision = revisionRef.current + 1
    revisionRef.current = revision
    setWorkerPending(true)
    worker.onmessage = (event: MessageEvent<{ revision: number; result: LoanCalculationResult }>) => {
      if (event.data.revision !== revisionRef.current) return
      setWorkerResult(event.data.result)
      setWorkerPending(false)
    }
    worker.onerror = () => {
      if (revision !== revisionRef.current) return
      setWorkerResult(buildLoanCalculation(calculationSnapshot))
      setWorkerPending(false)
    }
    worker.postMessage({ revision, snapshot: calculationSnapshot })
  }, [calculationSnapshot, syncResult])

  useEffect(() => () => workerRef.current?.terminate(), [])

  const result = workerResult ?? syncResult ?? emptyResult
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
    defaultEarlyDate,
    calculationSnapshot,
    isStale: isStale || workerPending
  }
}
