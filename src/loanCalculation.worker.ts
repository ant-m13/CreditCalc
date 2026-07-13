import { buildLoanCalculation, type LoanCalculationSource } from './loanCalculation'
import type { LoanCalculationWorkerRequest, LoanCalculationWorkerResponse } from './loanCalculationRunner'

const isCalculationRequest = (value: unknown): value is LoanCalculationWorkerRequest => {
  if (!value || typeof value !== 'object') return false
  const request = value as Record<string, unknown>
  return Number.isSafeInteger(request.requestId)
    && request.kind === 'calculate'
    && typeof request.revision === 'string'
    && Boolean(request.snapshot)
    && typeof request.snapshot === 'object'
}

self.onmessage = (event: MessageEvent<unknown>) => {
  if (!isCalculationRequest(event.data)) return
  const { requestId, revision, snapshot } = event.data
  let result: ReturnType<typeof buildLoanCalculation>
  try {
    result = buildLoanCalculation(snapshot as LoanCalculationSource)
  } catch (error) {
    result = {
      generatedRepayments: [],
      allRepayments: [],
      errors: [error instanceof Error ? error.message : 'Не удалось построить график платежей'],
      comparison: null,
      selected: null,
      base: null
    }
  }
  self.postMessage({ requestId, kind: 'result', revision, result } satisfies LoanCalculationWorkerResponse)
}
