import { describe, expect, it } from 'vitest'
import { createQuarantineExport, QUARANTINE_EXPORT_LIMITS, sanitizeQuarantineRaw } from './quarantineExport'

describe('quarantine export', () => {
  it('ограничивает глубину, массивы и строки в исходных данных', () => {
    const circular: Record<string, unknown> = { name: 'root' }
    circular.self = circular
    const sanitized = sanitizeQuarantineRaw({
      longText: 'x'.repeat(QUARANTINE_EXPORT_LIMITS.maxStringLength + 10),
      manyItems: Array.from({ length: QUARANTINE_EXPORT_LIMITS.maxArrayItems + 10 }, (_, index) => index),
      deep: { a: { b: { c: { d: { e: { f: { g: { h: { i: 'too deep' } } } } } } } } },
      circular
    }) as any

    expect(sanitized.longText).toContain('[строка сокращена]')
    expect(sanitized.manyItems).toHaveLength(QUARANTINE_EXPORT_LIMITS.maxArrayItems)
    expect(JSON.stringify(sanitized.deep)).toContain('[достигнута предельная глубина]')
    expect(sanitized.circular.self).toBe('[циклическая ссылка]')
  })

  it('добавляет лимиты в скачиваемый JSON карантина', () => {
    const exported = createQuarantineExport([{
      id: 'bad',
      name: 'Сбой',
      reason: 'ошибка',
      raw: { value: 'x' }
    }], '2026-07-08T00:00:00.000Z')

    expect(exported.limits).toEqual(QUARANTINE_EXPORT_LIMITS)
    expect(exported).toMatchObject({ format: 'sanitized-quarantine-v1', rawIsComplete: false })
    expect(exported.notice).toContain('не полная побайтовая копия')
    expect(exported.quarantinedLoans[0].raw).toEqual({ value: 'x' })
  })
})
