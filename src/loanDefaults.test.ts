import { describe, expect, it } from 'vitest'
import { createDefaultConfig, defaultConfig } from './loanDefaults'

describe('loan defaults', () => {
  it('оставляет defaultConfig детерминированным для миграций', () => {
    expect(defaultConfig.issueDate).toBe('2026-06-23')
    expect(defaultConfig.firstPaymentDate).toBe('2026-07-15')
  })

  it('создаёт новые кредиты с датами от текущего дня', () => {
    const config = createDefaultConfig(new Date(2026, 6, 4))
    expect(config.issueDate).toBe('2026-07-04')
    expect(config.firstPaymentDate).toBe('2026-08-15')
  })

  it('корректно обрабатывает конец месяца и 29 февраля', () => {
    expect(createDefaultConfig(new Date(2026, 0, 31), 31).firstPaymentDate).toBe('2026-02-28')
    expect(createDefaultConfig(new Date(2028, 0, 31), 31).firstPaymentDate).toBe('2028-02-29')
  })
})
