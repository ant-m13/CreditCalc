import { buildLoanCalculation, type LoanCalculationSource } from './loanCalculation'
import type { LoanCalculationWorkerRequest, LoanCalculationWorkerResponse } from './loanCalculationRunner'

type LoanCalculationWorkerRequestEnvelope = {
  requestId: number
  kind: string
  revision: string
  snapshot?: unknown
}

const isWorkerRequestEnvelope = (value: unknown): value is LoanCalculationWorkerRequestEnvelope => {
  if (!value || typeof value !== 'object') return false
  const request = value as Record<string, unknown>
  return Number.isSafeInteger(request.requestId)
    && typeof request.kind === 'string'
    && typeof request.revision === 'string'
}

const isCalculationRequest = (value: unknown): value is LoanCalculationWorkerRequest => {
  if (!isWorkerRequestEnvelope(value)) return false
  return value.kind === 'calculate'
    && Boolean(value.snapshot)
    && typeof value.snapshot === 'object'
}

export const handleLoanCalculationWorkerRequest = (value: unknown): LoanCalculationWorkerResponse | null => {
  if (!isWorkerRequestEnvelope(value)) return null
  const { requestId, revision } = value
  if (value.kind !== 'calculate') {
    return { requestId, kind: 'error', revision, error: `Неизвестный тип запроса фонового расчёта: ${value.kind}` }
  }
  if (!isCalculationRequest(value)) {
    return { requestId, kind: 'error', revision, error: 'Некорректные данные запроса фонового расчёта' }
  }

  let result: ReturnType<typeof buildLoanCalculation>
  try {
    result = buildLoanCalculation(value.snapshot as LoanCalculationSource)
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
  return { requestId, kind: 'result', revision, result }
}

if (typeof self !== 'undefined') {
  self.onmessage = (event: MessageEvent<unknown>) => {
    const response = handleLoanCalculationWorkerRequest(event.data)
    if (response) self.postMessage(response)
  }
}
