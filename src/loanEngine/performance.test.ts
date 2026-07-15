import { describe, expect, it } from 'vitest'
import { defaultConfig } from '../loanDefaults'
import { nextPaymentDate } from './dates'
import type { EarlyRepayment } from './types'
import { validateScenario } from './validation'

const MAX_VALIDATION_DURATION_MS = 3_000

const longTermConfig = {
  ...defaultConfig,
  issueDate: '2025-01-01',
  firstPaymentDate: '2025-02-01',
  paymentDay: 1,
  firstPaymentInterestOnly: false,
  termMonths: 1200
}

const regularTotalRepayments = (count: number) => {
  const result: EarlyRepayment[] = []
  let date = longTermConfig.firstPaymentDate
  for (let index = 0; index < count; index += 1) {
    result.push({
      id: `total-${index}`,
      date,
      amount: 20_000,
      amountMode: 'totalWithFee',
      strategy: 'reduceTerm',
      source: 'own',
      sameDayOrder: 'regularFirst',
      sameDaySequence: index,
      interestFirst: true
    })
    date = nextPaymentDate(date, longTermConfig)
  }
  return result
}

describe('performance regressions', () => {
  it('валидирует большой набор регулярных дат без квадратичного обхода календаря', () => {
    const repayments = regularTotalRepayments(1000)
    const startedAt = performance.now()

    expect(validateScenario(longTermConfig, repayments, [])).toEqual([])

    // Запас учитывает общие CI-среды. Основную защиту даёт структура поиска на Set,
    // а ограничение времени выявляет случайно добавленные вложенные обходы.
    expect(performance.now() - startedAt).toBeLessThan(MAX_VALIDATION_DURATION_MS)
  })
})
