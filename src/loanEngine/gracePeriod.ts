import { isWithinInterval, parseISO } from 'date-fns'
import type { GracePeriod } from './types'

export function activeGrace(date: string, periods: GracePeriod[]) {
  const value = parseISO(date)
  return periods.find((p) => isWithinInterval(value, { start: parseISO(p.startDate), end: parseISO(p.endDate) }))
}
