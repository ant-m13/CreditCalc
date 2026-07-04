import { describe, expect, it } from 'vitest'
import { createMoneyFormatter, formatMoney } from './formatters'

describe('formatters', () => {
  it('форматирует суммы независимо от предыдущих вызовов', () => {
    const rub = formatMoney(1234.56, 'RUB', 0)
    const usd = formatMoney(1234.56, 'USD', 2)

    expect(rub).toContain('₽')
    expect(usd).toContain('$')
    expect(formatMoney(1234.56, 'RUB', 0)).toBe(rub)
  })

  it('создаёт независимые money formatter для разных валют и точности', () => {
    const rub = createMoneyFormatter('RUB', 0)
    const usd = createMoneyFormatter('USD', 2)

    expect(rub.money(1500)).toContain('₽')
    expect(usd.money(1500)).toContain('$')
    expect(rub.currencySymbol).toBe('₽')
    expect(usd.currencySymbol).toBe('$')
  })
})
