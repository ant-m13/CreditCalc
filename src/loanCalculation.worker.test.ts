import { describe, expect, it } from 'vitest'
import { handleLoanCalculationWorkerRequest } from './loanCalculation.worker'

describe('loan calculation Worker protocol', () => {
  it('возвращает явную ошибку для неизвестного kind', () => {
    expect(handleLoanCalculationWorkerRequest({
      requestId: 7,
      kind: 'estimate',
      revision: 'future-protocol',
      snapshot: {}
    })).toEqual({
      requestId: 7,
      kind: 'error',
      revision: 'future-protocol',
      error: 'Неизвестный тип запроса фонового расчёта: estimate'
    })
  })
})
