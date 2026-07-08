import type { QuarantinedLoanRaw } from './storeTypes'

export const QUARANTINE_EXPORT_LIMITS = {
  maxDepth: 8,
  maxObjectKeys: 50,
  maxArrayItems: 100,
  maxStringLength: 5000
} as const

const truncateString = (value: string) =>
  value.length > QUARANTINE_EXPORT_LIMITS.maxStringLength
    ? `${value.slice(0, QUARANTINE_EXPORT_LIMITS.maxStringLength)}…[truncated]`
    : value

export const sanitizeQuarantineRaw = (value: unknown, depth = 0, seen = new WeakSet<object>()): unknown => {
  if (typeof value === 'string') return truncateString(value)
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return '[circular]'
  if (depth >= QUARANTINE_EXPORT_LIMITS.maxDepth) return '[max-depth]'

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
  exportedAt,
  limits: QUARANTINE_EXPORT_LIMITS,
  quarantinedLoans: items.map(item => ({
    ...item,
    raw: sanitizeQuarantineRaw(item.raw)
  }))
})
