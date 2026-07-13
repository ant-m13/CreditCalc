import { create } from 'zustand'
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware'
import type { EarlyRepayment, GracePeriod, LoanConfig } from './loanEngine'
import { MAX_EARLY_REPAYMENTS, MAX_GRACE_PERIODS, MAX_REPAYMENT_RULES } from './loanEngine/limits'
import type { RepaymentRule } from './repaymentRules'
import { isValidatedLoanData, type ValidatedLoanData } from './importExport'
import {
  assertCanAddLoan,
  assertGracePeriodsDoNotOverlap,
  assertImportWithinLimits,
  assertRepaymentPlanValid,
  assertRepaymentRuleStructurallyValid,
  assertRepaymentPlanStructurallyValid,
  defaultAccentColor,
  defaultLoanData,
  loanFromData,
  loanDataFromValidated,
  loanFromValidatedData,
  normalizeAccentColor,
  normalizeConfigPatch,
  normalizeLoanData,
  normalizePersistedState,
  normalizeText,
  publicData,
  sortRepayments,
  sortRules,
  withRepaymentSequence,
  withRuleSequence
} from './storeNormalization'
import { PERSISTED_LOAN_STORAGE_KEY } from './storageKeys'
import type { LoanData, LoanImportData, LoanProfile, QuarantinedLoanRaw } from './storeTypes'

export { defaultConfig } from './loanDefaults'
export { MAX_LOANS, loanToBackupData, normalizePersistedState } from './storeNormalization'
export type { LoanProfile } from './storeTypes'

export const STORAGE_ERROR_EVENT = 'credit-calculator-storage-error'
export const STORAGE_STATUS_EVENT = 'credit-calculator-storage-status'
export const STORAGE_CONFLICT_EVENT = 'credit-calculator-storage-conflict'
export const STORAGE_SYNC_CHANNEL = 'credit-calculator-storage-sync'
export const MAX_PERSISTED_STATE_BYTES = 4_000_000
export const MAX_PERSISTED_INPUT_BYTES = 8 * 1024 * 1024

export type StorageStatusKind = 'saved' | 'nearQuota' | 'failed' | 'conflict'
type StorageConflictKind = 'newer' | 'deleted' | 'race'
interface PersistedMetadata { revision: number; updatedAt: string; epoch: string; writerId: string }
export interface StorageConflictDetail extends PersistedMetadata { kind: StorageConflictKind }

let lastKnownPersistedRevision = 0
let lastKnownPersistedWriterId = ''
let pendingExternalConflict: StorageConflictDetail | null = null
let storageWriteBlockedReason: string | null = null
let lastReadPersistedRaw: string | null = null

const storageId = () => typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
const TAB_WRITER_ID = storageId()
let activeStorageEpoch = storageId()
let storageSyncChannel: BroadcastChannel | null = null

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const persistedMetadata = (value: string | null): PersistedMetadata => {
  if (!value) return { revision: 0, updatedAt: '', epoch: '', writerId: '' }
  try {
    const parsed = JSON.parse(value) as { state?: { persistedRevision?: unknown; persistedUpdatedAt?: unknown; persistedEpoch?: unknown; persistedWriterId?: unknown } }
    const revision = typeof parsed.state?.persistedRevision === 'number' && Number.isSafeInteger(parsed.state.persistedRevision) && parsed.state.persistedRevision >= 0 ? parsed.state.persistedRevision : 0
    const updatedAt = typeof parsed.state?.persistedUpdatedAt === 'string' ? parsed.state.persistedUpdatedAt : ''
    const epoch = typeof parsed.state?.persistedEpoch === 'string' && parsed.state.persistedEpoch ? parsed.state.persistedEpoch : 'legacy'
    const writerId = typeof parsed.state?.persistedWriterId === 'string' ? parsed.state.persistedWriterId : ''
    return { revision, updatedAt, epoch, writerId }
  } catch {
    return { revision: 0, updatedAt: '', epoch: 'legacy', writerId: '' }
  }
}

const notifyStorageConflict = (detail: StorageConflictDetail) => {
  pendingExternalConflict = detail
  notifyStorageStatus('conflict', detail.kind === 'deleted'
    ? 'Сохранённые данные удалены или сброшены в другой вкладке. Локальные изменения не записаны'
    : 'Обнаружено конкурирующее изменение данных в другой вкладке. Локальные изменения не записаны')
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<StorageConflictDetail>(STORAGE_CONFLICT_EVENT, { detail }))
}

const notifyStorageStatus = (kind: StorageStatusKind, message: string) => {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(STORAGE_STATUS_EVENT, { detail: { kind, message } }))
}

const notifyStorageError = (error: unknown) => {
  const message = error instanceof Error ? error.message : 'Локальное хранилище недоступно'
  notifyStorageStatus('failed', `Последние изменения не сохранены в localStorage: ${message}`)
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(STORAGE_ERROR_EVENT, { detail: { message } }))
}

const storageRecoveryState = (raw: string, reason: string): StorageValue<LoanState> => ({
  version: 11,
  state: {
    storageRecoveryReport: [`Сохранённое состояние localStorage помещено в карантин: ${reason}. Автосохранение заблокировано до удаления повреждённых данных.`],
    storageRecoveryDismissed: false,
    quarantinedLoansRaw: [{
      id: 'persisted-storage',
      name: 'Повреждённое состояние localStorage',
      reason,
      raw
    }]
  } as LoanState
})

const quarantinePersistedStorage = (raw: string, reason: string) => {
  storageWriteBlockedReason = reason
  notifyStorageStatus('failed', `Автосохранение заблокировано: ${reason}. Сначала скачайте backup или удалите повреждённые данные`)
  return storageRecoveryState(raw, reason)
}

export const deserializePersistedStorage = (raw: string): StorageValue<LoanState> => {
  if (raw.length > MAX_PERSISTED_INPUT_BYTES || new TextEncoder().encode(raw).byteLength > MAX_PERSISTED_INPUT_BYTES) {
    return quarantinePersistedStorage(raw, `размер сохранённого состояния превышает ${MAX_PERSISTED_INPUT_BYTES} байт`)
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!isObject(parsed) || !isObject(parsed.state)) throw new Error('корневой объект persisted state повреждён')
    return parsed as unknown as StorageValue<LoanState>
  } catch (error) {
    const reason = error instanceof Error ? `JSON не удалось разобрать (${error.message})` : 'JSON не удалось разобрать'
    return quarantinePersistedStorage(raw, reason)
  }
}

const conflictDetail = (metadata: PersistedMetadata, kind: StorageConflictKind): StorageConflictDetail => ({ ...metadata, kind })

export const handleExternalStorageSignal = (detail: StorageConflictDetail) => {
  if (detail.writerId === TAB_WRITER_ID) return
  if (detail.kind === 'deleted') {
    if (!detail.epoch || detail.epoch === activeStorageEpoch || lastKnownPersistedRevision > 0) notifyStorageConflict(detail)
    return
  }
  const epochChanged = Boolean(detail.epoch && detail.epoch !== activeStorageEpoch)
  const newerRevision = detail.revision > lastKnownPersistedRevision
  const sameRevisionRace = detail.revision > 0 && detail.revision === lastKnownPersistedRevision && Boolean(detail.writerId) && detail.writerId !== lastKnownPersistedWriterId
  if (epochChanged || newerRevision || sameRevisionRace) notifyStorageConflict({ ...detail, kind: sameRevisionRace ? 'race' : 'newer' })
}

const broadcastStorageSignal = (detail: StorageConflictDetail) => {
  try { storageSyncChannel?.postMessage(detail) } catch { /* storage events remain the compatibility fallback */ }
}

const writePersistedItem = (name: string, value: StorageValue<LoanState>) => {
  if (storageWriteBlockedReason) {
    notifyStorageStatus('failed', `Автосохранение заблокировано: ${storageWriteBlockedReason}. Сначала скачайте backup или удалите повреждённые данные`)
    return
  }
  try {
    const current = window.localStorage.getItem(name)
    const currentMetadata = persistedMetadata(current)
    if (current === null && lastKnownPersistedRevision > 0) {
      notifyStorageConflict(conflictDetail({ ...currentMetadata, epoch: activeStorageEpoch, updatedAt: new Date().toISOString() }, 'deleted'))
      return
    }
    if (current !== null && (currentMetadata.epoch !== activeStorageEpoch || currentMetadata.revision > lastKnownPersistedRevision)) {
      notifyStorageConflict(conflictDetail(currentMetadata, 'newer'))
      return
    }
    const revision = Math.max(lastKnownPersistedRevision, currentMetadata.revision) + 1
    const updatedAt = new Date().toISOString()
    const stampedValue = JSON.stringify({
      ...value,
      state: {
        ...value.state,
        persistedRevision: revision,
        persistedUpdatedAt: updatedAt,
        persistedEpoch: activeStorageEpoch,
        persistedWriterId: TAB_WRITER_ID
      }
    })
    const isNearQuota = new TextEncoder().encode(stampedValue).byteLength > MAX_PERSISTED_STATE_BYTES
    window.localStorage.setItem(name, stampedValue)
    lastKnownPersistedRevision = revision
    lastKnownPersistedWriterId = TAB_WRITER_ID
    const metadata = { revision, updatedAt, epoch: activeStorageEpoch, writerId: TAB_WRITER_ID }
    broadcastStorageSignal(conflictDetail(metadata, 'newer'))
    notifyStorageStatus(
      isNearQuota ? 'nearQuota' : 'saved',
      isNearQuota ? 'Сохранённые данные приближаются к лимиту браузера. Экспортируйте расчёт в JSON' : 'Данные сохранены'
    )
  } catch (error) {
    notifyStorageError(error)
  }
}

const withStorageWriteLock = (name: string, write: () => void) => {
  if (typeof navigator === 'undefined' || !navigator.locks) {
    write()
    return
  }
  return navigator.locks.request(`credit-calculator:${name}`, { mode: 'exclusive' }, () => write()).catch(notifyStorageError)
}

const safePersistStorage: PersistStorage<LoanState> = {
  getItem: (name: string) => {
    if (typeof window === 'undefined') return null
    try {
      const value = window.localStorage.getItem(name)
      lastReadPersistedRaw = value
      const metadata = persistedMetadata(value)
      lastKnownPersistedRevision = metadata.revision
      lastKnownPersistedWriterId = metadata.writerId
      if (value !== null) activeStorageEpoch = metadata.epoch
      return value === null ? null : deserializePersistedStorage(value)
    } catch (error) {
      notifyStorageError(error)
      return null
    }
  },
  setItem: (name: string, value: StorageValue<LoanState>) => {
    if (typeof window === 'undefined') return
    return withStorageWriteLock(name, () => writePersistedItem(name, value))
  },
  removeItem: (name: string) => {
    if (typeof window === 'undefined') return
    try {
      const previous = persistedMetadata(window.localStorage.getItem(name))
      window.localStorage.removeItem(name)
      lastKnownPersistedRevision = 0
      lastKnownPersistedWriterId = ''
      pendingExternalConflict = null
      lastReadPersistedRaw = null
      broadcastStorageSignal(conflictDetail({ ...previous, writerId: TAB_WRITER_ID, updatedAt: new Date().toISOString() }, 'deleted'))
      activeStorageEpoch = storageId()
    } catch (error) {
      notifyStorageError(error)
    }
  }
}

interface LoanState extends LoanData {
  loans: LoanProfile[]
  activeLoanId: string
  updateConfig: (patch: Partial<LoanConfig>) => void
  updateInterest: (patch: Partial<LoanConfig['interest']>) => void
  addRepayment: (repayment: EarlyRepayment) => void
  updateRepayment: (repayment: EarlyRepayment) => void
  removeRepayment: (id: string) => void
  addRepaymentRule: (rule: RepaymentRule) => void
  updateRepaymentRule: (rule: RepaymentRule) => void
  removeRepaymentRule: (id: string) => void
  addGrace: (grace: GracePeriod) => void
  removeGrace: (id: string) => void
  selectScenario: (id: string) => void
  setTermUnit: (unit: 'months' | 'years') => void
  setDisplayDecimals: (value: 0 | 2) => void
  setAppFontSize: (value: LoanState['appFontSize']) => void
  setScheduleFontSize: (value: LoanState['scheduleFontSize']) => void
  setTheme: (theme: LoanState['theme']) => void
  setCustomAccentColor: (color: string) => void
  setUseCustomAccentColor: (enabled: boolean) => void
  resetCustomAccentColor: () => void
  retryStorageSave: () => void
  overwriteExternalStorageChanges: () => void
  dismissStorageRecoveryReport: () => void
  showStorageRecoveryReport: () => void
  deleteQuarantinedLoans: () => void
  switchLoan: (id: string) => void
  createLoan: (name?: string) => void
  renameLoan: (id: string, name: string) => void
  removeLoan: (id: string) => void
  loadExampleLoan: () => void
  addLoanFromData: (data: LoanImportData | ValidatedLoanData) => void
  replaceData: (data: LoanImportData | ValidatedLoanData) => void
  storageRecoveryReport: string[]
  quarantinedLoansRaw: QuarantinedLoanRaw[]
  storageRecoveryDismissed: boolean
}

const loanToPublicState = (loan: LoanProfile) => ({
  activeLoanId: loan.id,
  ...publicData(loan)
})

const syncActive = (state: LoanState, patch: Partial<LoanData>): Partial<LoanState> => {
  const nextData = { ...publicData(state), ...patch }
  return {
    ...patch,
    loans: state.loans.map(loan => loan.id === state.activeLoanId ? { ...loan, ...nextData } : loan)
  }
}

const switchToLoan = (state: LoanState, id: string): Partial<LoanState> => {
  const loan = state.loans.find(item => item.id === id) ?? state.loans[0]
  return loan ? loanToPublicState(loan) : {}
}

const initialLoan = loanFromData(defaultLoanData(), 'Мой кредит', 'loan-default')

export const useLoanStore = create<LoanState>()(persist((set) => ({
  ...publicData(initialLoan),
  loans: [initialLoan],
  activeLoanId: initialLoan.id,
  storageRecoveryReport: [],
  quarantinedLoansRaw: [],
  storageRecoveryDismissed: false,
  updateConfig: (patch) => set(s => {
    const config = normalizeConfigPatch(s.config, patch)
    assertRepaymentPlanStructurallyValid(config, s.repayments, s.gracePeriods)
    return syncActive(s, { config })
  }),
  updateInterest: (patch) => set(s => {
    const config = { ...s.config, interest: { ...s.config.interest, ...patch } }
    assertRepaymentPlanStructurallyValid(config, s.repayments, s.gracePeriods)
    return syncActive(s, { config })
  }),
  addRepayment: (repayment) => set(s => {
    if (s.repayments.length >= MAX_EARLY_REPAYMENTS) throw new Error(`Можно добавить не более ${MAX_EARLY_REPAYMENTS} разовых платежей`)
    const repayments = sortRepayments([...s.repayments, withRepaymentSequence(s.repayments, repayment)])
    assertRepaymentPlanStructurallyValid(s.config, repayments, s.gracePeriods)
    return syncActive(s, { repayments })
  }),
  updateRepayment: (repayment) => set(s => {
    if (!s.repayments.some(item => item.id === repayment.id)) throw new Error('Редактируемый досрочный платёж не найден в активном кредите')
    const repayments = sortRepayments(s.repayments.map(item => item.id === repayment.id
      ? withRepaymentSequence(s.repayments.filter(current => current.id !== repayment.id), {
        ...repayment,
        sameDaySequence: repayment.date === item.date ? repayment.sameDaySequence ?? item.sameDaySequence : undefined
      })
      : item))
    assertRepaymentPlanStructurallyValid(s.config, repayments, s.gracePeriods)
    return syncActive(s, { repayments })
  }),
  removeRepayment: (id) => set(s => syncActive(s, { repayments: s.repayments.filter(r => r.id !== id) })),
  addRepaymentRule: (rule) => set(s => {
    if (s.repaymentRules.length >= MAX_REPAYMENT_RULES) throw new Error(`Можно добавить не более ${MAX_REPAYMENT_RULES} правил досрочных платежей`)
    const nextRule = withRuleSequence(s.repaymentRules, rule)
    assertRepaymentRuleStructurallyValid(nextRule)
    const repaymentRules = sortRules([...s.repaymentRules, nextRule])
    return syncActive(s, { repaymentRules })
  }),
  updateRepaymentRule: (rule) => set(s => {
    if (!s.repaymentRules.some(item => item.id === rule.id)) throw new Error('Редактируемое правило не найдено в активном кредите')
    const repaymentRules = sortRules(s.repaymentRules.map(item => {
      if (item.id !== rule.id) return item
      const nextRule = { ...rule, ruleSequence: rule.ruleSequence ?? item.ruleSequence }
      assertRepaymentRuleStructurallyValid(nextRule)
      return nextRule
    }))
    return syncActive(s, { repaymentRules })
  }),
  removeRepaymentRule: (id) => set(s => syncActive(s, { repaymentRules: s.repaymentRules.filter(rule => rule.id !== id) })),
  addGrace: (grace) => set(s => {
    if (s.gracePeriods.length >= MAX_GRACE_PERIODS) throw new Error(`Можно добавить не более ${MAX_GRACE_PERIODS} льготных периодов`)
    const gracePeriods = [...s.gracePeriods, grace]
    assertGracePeriodsDoNotOverlap(gracePeriods)
    assertRepaymentPlanStructurallyValid(s.config, s.repayments, gracePeriods)
    return syncActive(s, { gracePeriods })
  }),
  removeGrace: (id) => set(s => {
    const gracePeriods = s.gracePeriods.filter(g => g.id !== id)
    if (gracePeriods.length === s.gracePeriods.length) throw new Error('Льготный период не найден в активном кредите')
    assertRepaymentPlanStructurallyValid(s.config, s.repayments, gracePeriods)
    return syncActive(s, { gracePeriods })
  }),
  selectScenario: (selectedScenario) => set(s => syncActive(s, { selectedScenario })),
  setTermUnit: (termUnit) => set(s => syncActive(s, { termUnit })),
  setDisplayDecimals: (displayDecimals) => set(s => syncActive(s, { displayDecimals })),
  setAppFontSize: (appFontSize) => set(s => syncActive(s, { appFontSize, scheduleFontSize: appFontSize })),
  setScheduleFontSize: (scheduleFontSize) => set(s => syncActive(s, { scheduleFontSize })),
  setTheme: (theme) => set(s => syncActive(s, { theme })),
  setCustomAccentColor: (customAccentColor) => set(s => syncActive(s, { customAccentColor: normalizeAccentColor(customAccentColor), useCustomAccentColor: true })),
  setUseCustomAccentColor: (useCustomAccentColor) => set(s => syncActive(s, { useCustomAccentColor })),
  resetCustomAccentColor: () => set(s => syncActive(s, { customAccentColor: defaultAccentColor, useCustomAccentColor: false })),
  retryStorageSave: () => set(s => ({ activeLoanId: s.activeLoanId, loans: s.loans })),
  overwriteExternalStorageChanges: () => {
    if (pendingExternalConflict?.kind === 'deleted') {
      activeStorageEpoch = storageId()
      lastKnownPersistedRevision = 0
      lastKnownPersistedWriterId = ''
    } else if (pendingExternalConflict) {
      activeStorageEpoch = pendingExternalConflict.epoch || activeStorageEpoch
      lastKnownPersistedRevision = Math.max(lastKnownPersistedRevision, pendingExternalConflict.revision)
      lastKnownPersistedWriterId = pendingExternalConflict.writerId
    }
    pendingExternalConflict = null
    set(s => ({ activeLoanId: s.activeLoanId, loans: s.loans }))
  },
  dismissStorageRecoveryReport: () => set({ storageRecoveryDismissed: true }),
  showStorageRecoveryReport: () => set({ storageRecoveryDismissed: false }),
  deleteQuarantinedLoans: () => {
    if (storageWriteBlockedReason) {
      safePersistStorage.removeItem(PERSISTED_LOAN_STORAGE_KEY)
      storageWriteBlockedReason = null
    }
    set({ quarantinedLoansRaw: [], storageRecoveryReport: [], storageRecoveryDismissed: false })
  },
  switchLoan: (id) => set(s => switchToLoan(s, id)),
  createLoan: (name = 'Новый кредит') => set(s => {
    assertCanAddLoan(s.loans.length)
    const loan = loanFromData(defaultLoanData(false), name)
    return { loans: [...s.loans, loan], ...loanToPublicState(loan) }
  }),
  renameLoan: (id, name) => set(s => ({ loans: s.loans.map(loan => loan.id === id ? { ...loan, name: normalizeText(name) || loan.name } : loan) })),
  removeLoan: (id) => set(s => {
    if (s.loans.length <= 1) return {}
    const loans = s.loans.filter(loan => loan.id !== id)
    const activeLoanId = s.activeLoanId === id ? loans[0].id : s.activeLoanId
    const active = loans.find(loan => loan.id === activeLoanId) ?? loans[0]
    return { loans, ...loanToPublicState(active) }
  }),
  loadExampleLoan: () => set(s => {
    const data = defaultLoanData(true, new Date())
    return { ...data, loans: s.loans.map(loan => loan.id === s.activeLoanId ? { ...loan, name: 'Пример кредита', ...data } : loan) }
  }),
  addLoanFromData: (data) => set(s => {
    assertCanAddLoan(s.loans.length)
    if (isValidatedLoanData(data)) {
      const loan = loanFromValidatedData(data, data.name ?? 'Кредит из ссылки')
      return { loans: [...s.loans, loan], ...loanToPublicState(loan) }
    }
    assertImportWithinLimits(data)
    const loan = loanFromData(data, data.name ?? 'Кредит из ссылки')
    assertGracePeriodsDoNotOverlap(loan.gracePeriods)
    assertRepaymentPlanValid(loan.config, loan.repayments, loan.repaymentRules, loan.gracePeriods)
    return { loans: [...s.loans, loan], ...loanToPublicState(loan) }
  }),
  replaceData: (data) => set(s => {
    if (isValidatedLoanData(data)) {
      const validated = loanDataFromValidated(data)
      return { ...validated, loans: s.loans.map(loan => loan.id === s.activeLoanId ? { ...loan, ...(data.name ? { name: data.name } : {}), ...validated } : loan) }
    }
    assertImportWithinLimits(data)
    const normalized = normalizeLoanData(data)
    assertGracePeriodsDoNotOverlap(normalized.gracePeriods)
    assertRepaymentPlanValid(normalized.config, normalized.repayments, normalized.repaymentRules, normalized.gracePeriods)
    const name = normalizeText(data.name)
    return { ...normalized, loans: s.loans.map(loan => loan.id === s.activeLoanId ? { ...loan, ...(name ? { name } : {}), ...normalized } : loan) }
  })
}), {
  name: PERSISTED_LOAN_STORAGE_KEY,
  storage: safePersistStorage,
  version: 11,
  migrate: (persisted) => normalizePersistedState(persisted) as LoanState,
  merge: (persisted, current) => {
    try {
      const normalized = normalizePersistedState(persisted)
      if (!storageWriteBlockedReason || lastReadPersistedRaw === null) return { ...current, ...normalized }
      const recovery = storageRecoveryState(lastReadPersistedRaw, storageWriteBlockedReason).state
      return {
        ...current,
        ...normalized,
        storageRecoveryReport: recovery.storageRecoveryReport,
        quarantinedLoansRaw: recovery.quarantinedLoansRaw
      }
    } catch (error) {
      const reason = error instanceof Error ? `миграция завершилась ошибкой (${error.message})` : 'миграция завершилась ошибкой'
      const recovery = quarantinePersistedStorage(lastReadPersistedRaw ?? '', reason)
      return { ...current, ...normalizePersistedState(recovery.state) }
    }
  },
  onRehydrateStorage: () => (_state, error) => {
    if (!error) return
    storageWriteBlockedReason = error instanceof Error ? error.message : 'неизвестная ошибка восстановления localStorage'
    notifyStorageError(error)
  }
}))

if (typeof window !== 'undefined') {
  if (typeof BroadcastChannel !== 'undefined') {
    storageSyncChannel = new BroadcastChannel(STORAGE_SYNC_CHANNEL)
    storageSyncChannel.onmessage = (event: MessageEvent<StorageConflictDetail>) => handleExternalStorageSignal(event.data)
  }
  window.addEventListener('storage', event => {
    if (event.key !== PERSISTED_LOAN_STORAGE_KEY) return
    if (event.newValue === null) {
      const previous = persistedMetadata(event.oldValue)
      handleExternalStorageSignal(conflictDetail({ ...previous, writerId: 'external-storage-event', updatedAt: new Date().toISOString() }, 'deleted'))
      return
    }
    handleExternalStorageSignal(conflictDetail(persistedMetadata(event.newValue), 'newer'))
  })
}
