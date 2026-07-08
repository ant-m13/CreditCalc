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

  calculate(snapshot: LoanCalculationSnapshot, onResult: (envelope: LoanCalculationEnvelope) => void) {
    if (!canUseLoanCalculationWorker()) {
      onResult(calculateLoanSynchronously(snapshot))
      return
    }

    let worker = this.worker
    if (!worker) {
      try {
        worker = new Worker(new URL('./loanCalculation.worker.ts', import.meta.url), { type: 'module' })
        this.worker = worker
      } catch {
        onResult(calculateLoanSynchronously(snapshot))
        return
      }
    }

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.revision !== snapshot.revision) return
      onResult({ revision: snapshot.revision, snapshot, result: event.data.result })
    }
    worker.onerror = () => {
      worker.terminate()
      this.worker = null
      onResult(calculateLoanSynchronously(snapshot))
    }

    try {
      worker.postMessage({ revision: snapshot.revision, snapshot })
    } catch {
      worker.terminate()
      this.worker = null
      onResult(calculateLoanSynchronously(snapshot))
    }
  }

  dispose() {
    this.worker?.terminate()
    this.worker = null
  }
}
