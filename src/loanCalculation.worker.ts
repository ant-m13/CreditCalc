import { buildLoanCalculation, type LoanCalculationSource } from './loanCalculation'

interface CalculationRequest {
  revision: string
  snapshot: LoanCalculationSource
}

self.onmessage = (event: MessageEvent<CalculationRequest>) => {
  const { revision, snapshot } = event.data
  try {
    self.postMessage({ revision, result: buildLoanCalculation(snapshot) })
  } catch (error) {
    self.postMessage({
      revision,
      result: {
        generatedRepayments: [],
        allRepayments: [],
        errors: [error instanceof Error ? error.message : 'Не удалось построить график платежей'],
        comparison: null,
        selected: null,
        base: null
      }
    })
  }
}
