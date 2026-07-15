import { buildLoanCalculation, type LoanCalculationResult, type LoanCalculationSource } from './loanCalculation'

export interface LoanCalculationSnapshot extends LoanCalculationSource {
  revision: string
  displayDecimals: 0 | 2
  loanId?: string
}

export interface LoanCalculationEnvelope {
  revision: string
  snapshot: LoanCalculationSnapshot
  result: LoanCalculationResult
}

export type LoanCalculationWorkerRequest = {
  requestId: number
  kind: 'calculate'
  revision: string
  snapshot: LoanCalculationSource
}

export type LoanCalculationWorkerResponse =
  | { requestId: number; kind: 'result'; revision: string; result: LoanCalculationResult }
  | { requestId: number; kind: 'error'; revision: string; error: string }

// After three consecutive Worker failures, stop recreating failing instances and use sync fallback.
const MAX_WORKER_ERRORS = 3
const WORKER_WATCHDOG_MS = 15_000

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object'

const isLoanCalculationResult = (value: unknown): value is LoanCalculationResult => {
  if (!isRecord(value)) return false
  return Array.isArray(value.generatedRepayments)
    && Array.isArray(value.allRepayments)
    && Array.isArray(value.errors)
    && value.errors.every(error => typeof error === 'string')
    && (value.comparison === null || isRecord(value.comparison))
    && (value.selected === null || isRecord(value.selected))
    && (value.base === null || isRecord(value.base))
}

const isWorkerResponseEnvelope = (value: unknown): value is LoanCalculationWorkerResponse => {
  if (!isRecord(value)) return false
  return Number.isSafeInteger(value.requestId)
    && typeof value.revision === 'string'
    && ((value.kind === 'result' && isLoanCalculationResult(value.result))
      || (value.kind === 'error' && typeof value.error === 'string'))
}

export const canUseLoanCalculationWorker = () => typeof Worker !== 'undefined'

export const calculateLoanSynchronously = (snapshot: LoanCalculationSnapshot): LoanCalculationEnvelope => ({
  revision: snapshot.revision,
  snapshot,
  result: buildLoanCalculation(snapshot)
})

export class LoanCalculationRunner {
  private worker: Worker | null = null
  private workerWatchdogTimer: ReturnType<typeof setTimeout> | null = null
  private syncFallbackTimer: ReturnType<typeof setTimeout> | null = null
  private syncFallbackRevision: string | null = null
  private requestId = 0
  private workerErrorCount = 0
  private workerRuntimeErrorCount = 0
  private workerFallbackWarningShown = false
  private readonly maxWorkerErrors = MAX_WORKER_ERRORS

  private clearWorkerWatchdog() {
    if (this.workerWatchdogTimer !== null) clearTimeout(this.workerWatchdogTimer)
    this.workerWatchdogTimer = null
  }

  private cancelWorker() {
    this.clearWorkerWatchdog()
    if (!this.worker) return
    this.worker.onmessage = null
    this.worker.onerror = null
    this.worker.terminate()
    this.worker = null
  }

  private clearScheduledSyncFallback() {
    if (this.syncFallbackTimer !== null) clearTimeout(this.syncFallbackTimer)
    this.syncFallbackTimer = null
    this.syncFallbackRevision = null
  }

  private scheduleSynchronousFallback(snapshot: LoanCalculationSnapshot, onResult: (envelope: LoanCalculationEnvelope) => void) {
    this.clearScheduledSyncFallback()
    this.syncFallbackRevision = snapshot.revision
    this.syncFallbackTimer = setTimeout(() => {
      if (this.syncFallbackRevision !== snapshot.revision) return
      this.syncFallbackTimer = null
      this.syncFallbackRevision = null
      onResult(calculateLoanSynchronously(snapshot))
    }, 0)
  }

  private recordWorkerResult() {
    this.clearScheduledSyncFallback()
    this.workerErrorCount = 0
    this.workerRuntimeErrorCount = 0
    this.workerFallbackWarningShown = false
  }

  private warnAboutSynchronousFallback() {
    if (this.workerFallbackWarningShown) return
    this.workerFallbackWarningShown = true
    console.warn(`Loan calculation Worker failed ${this.workerErrorCount} times; switching to synchronous calculation`)
  }

  calculate(snapshot: LoanCalculationSnapshot, onResult: (envelope: LoanCalculationEnvelope) => void) {
    this.clearScheduledSyncFallback()
    this.cancelWorker()

    if (!canUseLoanCalculationWorker() || this.workerErrorCount >= this.maxWorkerErrors) {
      if (canUseLoanCalculationWorker()) {
        this.warnAboutSynchronousFallback()
        this.scheduleSynchronousFallback(snapshot, onResult)
      } else {
        onResult(calculateLoanSynchronously(snapshot))
      }
      return
    }

    let worker: Worker
    try {
      worker = new Worker(new URL('./loanCalculation.worker.ts', import.meta.url), { type: 'module' })
      this.worker = worker
    } catch {
      this.workerErrorCount += 1
      this.scheduleSynchronousFallback(snapshot, onResult)
      return
    }

    const requestId = ++this.requestId
    let settled = false
    let workerAcceptedWork = false
    const settle = () => {
      if (settled) return false
      settled = true
      this.clearWorkerWatchdog()
      worker.onmessage = null
      worker.onerror = null
      worker.terminate()
      if (this.worker === worker) this.worker = null
      return true
    }
    const fallback = () => {
      if (!settle()) return
      if (workerAcceptedWork) {
        this.workerRuntimeErrorCount += 1
        this.workerErrorCount = this.workerRuntimeErrorCount
      } else {
        this.workerErrorCount += 1
      }
      this.scheduleSynchronousFallback(snapshot, onResult)
    }

    worker.onmessage = (event: MessageEvent<unknown>) => {
      const response = event.data
      if (!isWorkerResponseEnvelope(response)
        || response.requestId !== requestId
        || response.revision !== snapshot.revision) {
        fallback()
        return
      }
      if (response.kind === 'error') {
        fallback()
        return
      }
      if (!settle()) return
      this.recordWorkerResult()
      onResult({ revision: snapshot.revision, snapshot, result: response.result })
    }
    worker.onerror = event => {
      event.preventDefault()
      fallback()
    }

    try {
      worker.postMessage({ requestId, kind: 'calculate', revision: snapshot.revision, snapshot } satisfies LoanCalculationWorkerRequest)
      workerAcceptedWork = true
      this.workerErrorCount = this.workerRuntimeErrorCount
      this.workerWatchdogTimer = setTimeout(fallback, WORKER_WATCHDOG_MS)
    } catch {
      fallback()
    }
  }

  dispose() {
    this.clearScheduledSyncFallback()
    this.cancelWorker()
  }
}
