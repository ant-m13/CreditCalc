// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_CONFLICT_EVENT, useLoanStore, type StorageConflictDetail } from './store'
import { PERSISTED_LOAN_STORAGE_KEY } from './storageKeys'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('cross-tab persistence', () => {
  it('блокирует неявную запись поверх новой revision и разрешает только явное overwrite', () => {
    const conflict = vi.fn()
    window.addEventListener(STORAGE_CONFLICT_EVENT, conflict)
    const remote = JSON.stringify({
      state: { persistedRevision: 50, persistedUpdatedAt: '2026-07-10T10:00:00.000Z', remoteMarker: true },
      version: 11
    })
    localStorage.setItem(PERSISTED_LOAN_STORAGE_KEY, remote)
    window.dispatchEvent(new StorageEvent('storage', { key: PERSISTED_LOAN_STORAGE_KEY, newValue: remote }))

    expect((conflict.mock.calls[0][0] as CustomEvent<StorageConflictDetail>).detail).toEqual({ revision: 50, updatedAt: '2026-07-10T10:00:00.000Z' })

    useLoanStore.getState().updateConfig({ principal: 7_777_777 })
    expect(localStorage.getItem(PERSISTED_LOAN_STORAGE_KEY)).toBe(remote)

    useLoanStore.getState().overwriteExternalStorageChanges()
    const persisted = JSON.parse(localStorage.getItem(PERSISTED_LOAN_STORAGE_KEY)!)
    expect(persisted.state.persistedRevision).toBe(51)
    expect(persisted.state.config.principal).toBe(7_777_777)
    window.removeEventListener(STORAGE_CONFLICT_EVENT, conflict)
  })
})
