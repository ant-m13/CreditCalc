// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { PERSISTED_LOAN_STORAGE_KEY } from './storageKeys'

describe('safe corrupted storage hydration', () => {
  it('карантинит исходную строку и блокирует перезапись повреждённого JSON', async () => {
    const corrupted = '{"state":{"loans":['
    localStorage.clear()
    localStorage.setItem(PERSISTED_LOAN_STORAGE_KEY, corrupted)
    vi.resetModules()

    const { useLoanStore } = await import('./store')
    const recovered = useLoanStore.getState()

    expect(recovered.storageRecoveryReport.join(' ')).toContain('Автосохранение заблокировано')
    expect(recovered.quarantinedLoansRaw).toEqual([
      expect.objectContaining({ id: 'persisted-storage', raw: corrupted })
    ])

    recovered.updateConfig({ principal: 7_777_777 })
    expect(localStorage.getItem(PERSISTED_LOAN_STORAGE_KEY)).toBe(corrupted)

    useLoanStore.getState().deleteQuarantinedLoans()
    expect(JSON.parse(localStorage.getItem(PERSISTED_LOAN_STORAGE_KEY)!)).toMatchObject({
      state: { config: { principal: 7_777_777 }, quarantinedLoansRaw: [] }
    })
  })
})
