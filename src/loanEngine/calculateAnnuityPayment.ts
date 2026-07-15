import Decimal from 'decimal.js'
import { MONTHS_PER_YEAR, PERCENT_FACTOR } from '../constants'
import { money } from './rounding'
import type { RoundingMode } from './types'

export function calculateAnnuityPayment(principal: Decimal.Value, annualRate: number, periods: number, periodsPerYear = MONTHS_PER_YEAR, rounding: RoundingMode = 'kopecks') {
  const p = new Decimal(principal)
  if (periods <= 0) return new Decimal(0)
  const rate = new Decimal(annualRate).div(PERCENT_FACTOR).div(periodsPerYear)
  if (rate.isZero()) return money(p.div(periods), rounding)
  const factor = rate.add(1).pow(periods)
  return money(p.mul(rate).mul(factor).div(factor.minus(1)), rounding)
}
