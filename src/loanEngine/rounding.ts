import Decimal from 'decimal.js'
import type { RoundingMode } from './types'

export const money = (value: Decimal.Value, mode: RoundingMode = 'kopecks') => {
  const d = new Decimal(value)
  if (mode === 'rubles') return d.toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
  if (mode === 'bank') return d.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN)
  return d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
}

export const num = (value: Decimal.Value, mode: RoundingMode = 'kopecks') => money(value, mode).toNumber()
