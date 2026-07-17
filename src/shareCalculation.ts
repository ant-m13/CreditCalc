import type { EarlyRepayment, GracePeriod, LoanConfig } from './loanEngine'
import { parseLoanBackupObject, type LoanBackupData } from './importExport'
import type { RepaymentRule } from './repaymentRules'
import { validatePortableShare } from './portableDataValidation'
import { encodeSharedPayloadJson } from './sharedPayloadCodec'
import { SHARED_CALCULATION_VERSION } from './protocolVersions'

export { SHARE_PREFIX, MAX_ENCODED_PAYLOAD_LENGTH, MAX_JSON_PAYLOAD_LENGTH } from './sharedPayloadCodec'

export interface SharedCalculationV1 {
  version: typeof SHARED_CALCULATION_VERSION
  name?: string
  config: LoanConfig
  repayments: EarlyRepayment[]
  repaymentRules: RepaymentRule[]
  gracePeriods: GracePeriod[]
  selectedScenario: string
  settings: {
    termUnit: 'months' | 'years'
    displayDecimals: 0 | 2
    theme: 'emerald' | 'ocean' | 'violet' | 'graphite' | 'warm' | 'night'
    customAccentColor?: string
    useCustomAccentColor?: boolean
  }
}

export type SnapshotSource = Pick<LoanBackupData, 'config' | 'repayments' | 'gracePeriods' | 'selectedScenario' | 'termUnit' | 'displayDecimals' | 'theme'> & Partial<Pick<LoanBackupData, 'name' | 'repaymentRules' | 'customAccentColor' | 'useCustomAccentColor'>>

export function createLoanSnapshot(source: SnapshotSource): SharedCalculationV1 {
  return {
    version: SHARED_CALCULATION_VERSION,
    name: source.name,
    config: source.config,
    repayments: source.repayments,
    repaymentRules: source.repaymentRules ?? [],
    gracePeriods: source.gracePeriods,
    selectedScenario: source.selectedScenario,
    settings: {
      termUnit: source.termUnit,
      displayDecimals: source.displayDecimals,
      theme: source.theme,
      customAccentColor: source.customAccentColor,
      useCustomAccentColor: source.useCustomAccentColor
    }
  }
}

export function serializeLoanSnapshot(snapshot: SharedCalculationV1) {
  return JSON.stringify(snapshot)
}

export function parseLoanSnapshot(value: unknown): LoanBackupData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ссылка повреждена. Проверьте ссылку или используйте JSON-файл')
  const version = (value as { version?: unknown }).version
  if (version !== undefined && version !== SHARED_CALCULATION_VERSION) throw new Error('Версия ссылки не поддерживается')
  return parseLoanBackupObject(value)
}

export async function encodeSharedCalculation(snapshot: SharedCalculationV1) {
  return encodeSharedPayloadJson(serializeLoanSnapshot(snapshot))
}

export async function decodeSharedCalculation(payload: string) {
  return validatePortableShare(payload)
}

export async function buildShareUrl(snapshot: SharedCalculationV1, currentUrl: string | URL) {
  const url = new URL(currentUrl)
  url.hash = `calc=${await encodeSharedCalculation(snapshot)}`
  return url.toString()
}

export function readSharedCalculationFromLocation(location: Pick<Location, 'hash'>) {
  const hash = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash
  if (!hash.startsWith('calc=')) return null
  return hash.slice('calc='.length)
}

export function normalizeSharedCalculationPayload(input: string) {
  const value = input.trim()
  if (/^https?:\/\//i.test(value)) {
    try {
      const payload = readSharedCalculationFromLocation(new URL(value))
      if (payload) return payload
    } catch {
      throw new Error('Не удалось прочитать ссылку')
    }
    throw new Error('В ссылке не найден код параметров')
  }
  return value.startsWith('calc=') ? value.slice('calc='.length).trim() : value
}

export function looksLikeSharedCalculationUrl(input: string) {
  const value = input.trim()
  if (!/^https?:\/\//i.test(value)) return false
  try {
    return Boolean(readSharedCalculationFromLocation(new URL(value)))
  } catch {
    return false
  }
}
