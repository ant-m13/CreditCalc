import { describe, expect, it } from 'vitest'
import { createId } from './createId'

describe('createId', () => {
  it('uses randomUUID when available', () => {
    expect(createId('loan', { randomUUID: () => 'abc-123' })).toBe('loan-abc-123')
  })

  it('falls back to crypto random bytes', () => {
    const cryptoSource = {
      getRandomValues: <T extends Uint8Array>(array: T) => {
        array.fill(15)
        return array
      }
    }

    expect(createId('early payment', cryptoSource)).toBe('early-payment-0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f')
  })

  it('normalizes empty or unsafe prefixes', () => {
    expect(createId('  ', { randomUUID: () => 'uuid' })).toBe('id-uuid')
    expect(createId('мой кредит', { randomUUID: () => 'uuid' })).toBe('id-uuid')
  })
})
