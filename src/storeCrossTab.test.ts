// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleExternalStorageSignal, STORAGE_CONFLICT_EVENT, STORAGE_STATUS_EVENT, useLoanStore, type StorageConflictDetail } from './store'
import { PERSISTED_LOAN_STORAGE_KEY } from './storageKeys'

afterEach(() => {
  localStorage.clear()
  Reflect.deleteProperty(navigator, 'locks')
  vi.restoreAllMocks()
})

describe('cross-tab persistence', () => {
  it('сериализует запись под Web Lock и обнаруживает новую revision, удаление и race', async () => {
    const conflict = vi.fn()
    const status = vi.fn()
    window.addEventListener(STORAGE_CONFLICT_EVENT, conflict)
    window.addEventListener(STORAGE_STATUS_EVENT, status)
    const remote = JSON.stringify({
      state: { persistedRevision: 50, persistedUpdatedAt: '2026-07-10T10:00:00.000Z', persistedEpoch: 'remote-epoch', persistedWriterId: 'remote-writer', remoteMarker: true },
      version: 11
    })
    localStorage.setItem(PERSISTED_LOAN_STORAGE_KEY, remote)
    window.dispatchEvent(new StorageEvent('storage', { key: PERSISTED_LOAN_STORAGE_KEY, newValue: remote }))

    expect((conflict.mock.calls[0][0] as CustomEvent<StorageConflictDetail>).detail).toEqual({
      revision: 50,
      updatedAt: '2026-07-10T10:00:00.000Z',
      epoch: 'remote-epoch',
      writerId: 'remote-writer',
      kind: 'newer'
    })

    useLoanStore.getState().updateConfig({ principal: 7_777_777 })
    expect(localStorage.getItem(PERSISTED_LOAN_STORAGE_KEY)).toBe(remote)

    useLoanStore.getState().overwriteExternalStorageChanges()
    const persisted = JSON.parse(localStorage.getItem(PERSISTED_LOAN_STORAGE_KEY)!)
    expect(persisted.state.persistedRevision).toBe(51)
    expect(persisted.state.config.principal).toBe(7_777_777)
    expect(persisted.state.persistedEpoch).toBe('remote-epoch')
    expect(persisted.state.persistedWriterId).toEqual(expect.any(String))

    localStorage.removeItem(PERSISTED_LOAN_STORAGE_KEY)
    window.dispatchEvent(new StorageEvent('storage', { key: PERSISTED_LOAN_STORAGE_KEY, oldValue: JSON.stringify(persisted), newValue: null }))
    expect((conflict.mock.calls.at(-1)?.[0] as CustomEvent<StorageConflictDetail>).detail.kind).toBe('deleted')
    expect((status.mock.calls.at(-1)?.[0] as CustomEvent<{ kind: string }>).detail.kind).toBe('conflict')

    const request = vi.fn(async (_name: string, _options: LockOptions, callback: () => void) => callback())
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } })
    useLoanStore.getState().overwriteExternalStorageChanges()
    await vi.waitFor(() => expect(localStorage.getItem(PERSISTED_LOAN_STORAGE_KEY)).not.toBeNull())
    expect(request).toHaveBeenCalledWith(`credit-calculator:${PERSISTED_LOAN_STORAGE_KEY}`, { mode: 'exclusive' }, expect.any(Function))

    const recreated = JSON.parse(localStorage.getItem(PERSISTED_LOAN_STORAGE_KEY)!)
    handleExternalStorageSignal({
      revision: recreated.state.persistedRevision,
      updatedAt: '2026-07-10T11:00:00.000Z',
      epoch: recreated.state.persistedEpoch,
      writerId: 'simultaneous-writer',
      kind: 'newer'
    })
    expect((conflict.mock.calls.at(-1)?.[0] as CustomEvent<StorageConflictDetail>).detail.kind).toBe('race')
    window.removeEventListener(STORAGE_CONFLICT_EVENT, conflict)
    window.removeEventListener(STORAGE_STATUS_EVENT, status)
  })
})
