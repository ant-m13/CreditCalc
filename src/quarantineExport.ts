import type { QuarantinedLoanRaw } from './storeTypes'

// Ограничения не дают аварийному экспорту занять чрезмерный объём памяти или диска.
export const QUARANTINE_EXPORT_LIMITS = {
  maxDepth: 8,
  maxObjectKeys: 50,
  maxArrayItems: 100,
  maxStringLength: 5000
} as const

const truncateString = (value: string) =>
  value.length > QUARANTINE_EXPORT_LIMITS.maxStringLength
    ? `${value.slice(0, QUARANTINE_EXPORT_LIMITS.maxStringLength)}…[строка сокращена]`
    : value

export const sanitizeQuarantineRaw = (value: unknown, depth = 0, seen = new WeakSet<object>()): unknown => {
  if (typeof value === 'string') return truncateString(value)
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return '[циклическая ссылка]'
  if (depth >= QUARANTINE_EXPORT_LIMITS.maxDepth) return '[достигнута предельная глубина]'

  seen.add(value)
  if (Array.isArray(value)) {
    return value
      .slice(0, QUARANTINE_EXPORT_LIMITS.maxArrayItems)
      .map(item => sanitizeQuarantineRaw(item, depth + 1, seen))
  }

  return Object.fromEntries(
    Object.entries(value)
      .slice(0, QUARANTINE_EXPORT_LIMITS.maxObjectKeys)
      .map(([key, item]) => [key, sanitizeQuarantineRaw(item, depth + 1, seen)])
  )
}

export const createQuarantineExport = (items: QuarantinedLoanRaw[], exportedAt = new Date().toISOString()) => ({
  format: 'sanitized-quarantine-v1',
  rawIsComplete: false,
  notice: 'Ограниченная копия исходных данных для восстановления может включать маркеры усечения; это не полная побайтовая копия локального хранилища браузера.',
  exportedAt,
  limits: QUARANTINE_EXPORT_LIMITS,
  quarantinedLoans: items.map(item => ({
    ...item,
    raw: sanitizeQuarantineRaw(item.raw)
  }))
})
