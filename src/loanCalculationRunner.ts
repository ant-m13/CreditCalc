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

export const canUseLoanCalculationWorker = () => typeof Worker !== 'undefined'

export const calculateLoanSynchronously = (snapshot: LoanCalculationSnapshot): LoanCalculationEnvelope => ({
  revision: snapshot.revision,
  snapshot,
  result: buildLoanCalculation(snapshot)
})

export class LoanCalculationRunner {
  private worker: Worker | null = null
  private workerErrorCount = 0
  private workerRuntimeErrorCount = 0
  private readonly maxWorkerErrors = 3

  private recordWorkerAcceptedWork() {
    this.workerErrorCount = this.workerRuntimeErrorCount
  }

  private recordWorkerResult() {
    this.workerErrorCount = 0
    this.workerRuntimeErrorCount = 0
  }

  calculate(snapshot: LoanCalculationSnapshot, onResult: (envelope: LoanCalculationEnvelope) => void) {
    if (!canUseLoanCalculationWorker() || this.workerErrorCount >= this.maxWorkerErrors) {
      onResult(calculateLoanSynchronously(snapshot))
      return
    }

    let worker = this.worker
    if (!worker) {
      try {
        worker = new Worker(new URL('./loanCalculation.worker.ts', import.meta.url), { type: 'module' })
        this.worker = worker
      } catch {
        this.workerErrorCount += 1
        onResult(calculateLoanSynchronously(snapshot))
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
      onResult(calculateLoanSynchronously(snapshot))
    }

    try {
      worker.postMessage({ revision: snapshot.revision, snapshot })
      this.recordWorkerAcceptedWork()
    } catch {
      this.workerErrorCount += 1
      worker.terminate()
      if (this.worker === worker) this.worker = null
      onResult(calculateLoanSynchronously(snapshot))
    }
  }

  dispose() {
    this.worker?.terminate()
    this.worker = null
  }
}
