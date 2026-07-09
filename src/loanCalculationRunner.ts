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

type WorkerResponse = {
  revision: string
  result: LoanCalculationResult
}

// After three consecutive Worker failures, stop recreating failing instances and use sync fallback.
const MAX_WORKER_ERRORS = 3

export const canUseLoanCalculationWorker = () => typeof Worker !== 'undefined'

export const calculateLoanSynchronously = (snapshot: LoanCalculationSnapshot): LoanCalculationEnvelope => ({
  revision: snapshot.revision,
  snapshot,
  result: buildLoanCalculation(snapshot)
})

export class LoanCalculationRunner {
  private worker: Worker | null = null
  private syncFallbackTimer: ReturnType<typeof setTimeout> | null = null
  private syncFallbackRevision: string | null = null
  private workerErrorCount = 0
  private workerRuntimeErrorCount = 0
  private workerFallbackWarningShown = false
  private readonly maxWorkerErrors = MAX_WORKER_ERRORS

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

  private recordWorkerAcceptedWork() {
    this.workerErrorCount = this.workerRuntimeErrorCount
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

    if (!canUseLoanCalculationWorker() || this.workerErrorCount >= this.maxWorkerErrors) {
      if (canUseLoanCalculationWorker()) {
        this.warnAboutSynchronousFallback()
        this.scheduleSynchronousFallback(snapshot, onResult)
      } else {
        onResult(calculateLoanSynchronously(snapshot))
      }
      return
    }

    let worker = this.worker
    if (!worker) {
      try {
        worker = new Worker(new URL('./loanCalculation.worker.ts', import.meta.url), { type: 'module' })
        this.worker = worker
      } catch {
        this.workerErrorCount += 1
        this.scheduleSynchronousFallback(snapshot, onResult)
        return
      }
    }

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.revision !== snapshot.revision) return
      this.recordWorkerResult()
      onResult({ revision: snapshot.revision, snapshot, result: event.data.result })
    }
    worker.onerror = () => {
      this.workerRuntimeErrorCount += 1
      this.workerErrorCount += 1
      worker.terminate()
      if (this.worker === worker) this.worker = null
      this.scheduleSynchronousFallback(snapshot, onResult)
    }

    try {
      worker.postMessage({ revision: snapshot.revision, snapshot })
      this.recordWorkerAcceptedWork()
    } catch {
      this.workerErrorCount += 1
      worker.terminate()
      if (this.worker === worker) this.worker = null
      this.scheduleSynchronousFallback(snapshot, onResult)
    }
  }

  dispose() {
    this.clearScheduledSyncFallback()
    this.worker?.terminate()
    this.worker = null
  }
}
