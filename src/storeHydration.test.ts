// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_EARLY_REPAYMENTS } from './loanEngine/limits'
import { defaultConfig, normalizePersistedState, useLoanStore } from './store'
import { PERSISTED_LOAN_STORAGE_KEY } from './storageKeys'

beforeEach(() => {
  localStorage.clear()
})

describe('safe persisted storage hydration', () => {
  it('не читает элементы массивов за пределами лимита до нормализации', () => {
    const valid = {
      id: 'early',
      date: defaultConfig.firstPaymentDate,
      amount: 1000,
      amountMode: 'extra',
      enabled: false,
      strategy: 'reduceTerm',
      source: 'own',
      sameDayOrder: 'regularFirst',
      interestFirst: true
    }
    const source = Array.from({ length: MAX_EARLY_REPAYMENTS * 2 + 1 }, (_, index) => ({ ...valid, id: `early-${index}` }))
    const guarded = new Proxy(source, {
      get(target, property, receiver) {
        if (typeof property === 'string' && /^\d+$/.test(property) && Number(property) >= MAX_EARLY_REPAYMENTS * 2) {
          throw new Error('read beyond early limit')
        }
        return Reflect.get(target, property, receiver)
      }
    })

    const normalized = normalizePersistedState({ repayments: guarded }) as { repayments: unknown[] }
    expect(normalized.repayments).toHaveLength(MAX_EARLY_REPAYMENTS)
  })

  it('удаляет persisted-кредит и не записывает изменения в режиме только в памяти', () => {
    useLoanStore.getState().updateConfig({ principal: 7_000_000 })
    expect(localStorage.getItem(PERSISTED_LOAN_STORAGE_KEY)).not.toBeNull()

    useLoanStore.getState().setPersistentStorageEnabled(false)
    expect(useLoanStore.getState().persistentStorageEnabled).toBe(false)
    expect(localStorage.getItem(PERSISTED_LOAN_STORAGE_KEY)).toBeNull()

    useLoanStore.getState().updateConfig({ principal: 8_000_000 })
    expect(localStorage.getItem(PERSISTED_LOAN_STORAGE_KEY)).toBeNull()

    useLoanStore.getState().setPersistentStorageEnabled(true)
    expect(JSON.parse(localStorage.getItem(PERSISTED_LOAN_STORAGE_KEY)!)).toMatchObject({ state: { config: { principal: 8_000_000 } } })
  })
})
