import { format, isValid, parseISO } from 'date-fns'

export const isISODate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = parseISO(value)
  return isValid(parsed) && format(parsed, 'yyyy-MM-dd') === value
}

export const isISOYearMonth = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}$/.test(value) && isISODate(`${value}-01`)
