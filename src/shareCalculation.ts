import type { EarlyRepayment, GracePeriod, LoanConfig } from './loanEngine'
import { parseLoanBackupObject, type LoanBackupData } from './importExport'
import type { RepaymentRule } from './repaymentRules'

export const SHARE_PREFIX = 'v1.'
export const MAX_ENCODED_PAYLOAD_LENGTH = 120_000
export const MAX_JSON_PAYLOAD_LENGTH = 600_000

export interface SharedCalculationV1 {
  version: 1
  name?: string
  config: LoanConfig
  repayments: EarlyRepayment[]
  repaymentRules: RepaymentRule[]
  gracePeriods: GracePeriod[]
  selectedScenario: string
  settings: {
    termUnit: 'months' | 'years'
    displayDecimals: 0 | 2
    appFontSize: 'normal' | 'large' | 'xlarge'
    scheduleFontSize: 'normal' | 'large' | 'xlarge'
    theme: 'emerald' | 'ocean' | 'violet' | 'graphite'
  }
}

export type SnapshotSource = Pick<LoanBackupData, 'config' | 'repayments' | 'gracePeriods' | 'selectedScenario' | 'termUnit' | 'displayDecimals' | 'theme'> & Partial<Pick<LoanBackupData, 'name' | 'appFontSize' | 'scheduleFontSize' | 'repaymentRules'>>

const bytesToBase64Url = (bytes: Uint8Array) => {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.slice(index, index + 0x8000))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

const base64UrlToBytes = (value: string) => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
  const binary = atob(base64)
  return Uint8Array.from(binary, char => char.charCodeAt(0))
}

const streamToBytes = async (stream: ReadableStream<Uint8Array>) => {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    length += value.length
    if (length > MAX_JSON_PAYLOAD_LENGTH) throw new Error('Расчёт слишком большой для ссылки. Сохраните его в JSON-файл')
  }
  const result = new Uint8Array(length)
  let offset = 0
  chunks.forEach(chunk => { result.set(chunk, offset); offset += chunk.length })
  return result
}

const bytesToBlobPart = (input: Uint8Array) => input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer

const gzip = async (input: Uint8Array) => {
  if (typeof CompressionStream === 'undefined') throw new Error('Ваш браузер не поддерживает создание сжатых ссылок. Используйте JSON-файл')
  const writer = new Blob([bytesToBlobPart(input)]).stream().pipeThrough(new CompressionStream('gzip'))
  return streamToBytes(writer)
}

const gunzip = async (input: Uint8Array) => {
  if (typeof DecompressionStream === 'undefined') throw new Error('Ваш браузер не поддерживает загрузку сжатых ссылок. Используйте JSON-файл')
  try {
    return await streamToBytes(new Blob([bytesToBlobPart(input)]).stream().pipeThrough(new DecompressionStream('gzip')))
  } catch {
    throw new Error('Ссылка повреждена. Проверьте ссылку или используйте JSON-файл')
  }
}

export function createLoanSnapshot(source: SnapshotSource): SharedCalculationV1 {
  return {
    version: 1,
    name: source.name,
    config: source.config,
    repayments: source.repayments,
    repaymentRules: source.repaymentRules ?? [],
    gracePeriods: source.gracePeriods,
    selectedScenario: source.selectedScenario,
    settings: {
      termUnit: source.termUnit,
      displayDecimals: source.displayDecimals,
      appFontSize: source.appFontSize ?? 'normal',
      scheduleFontSize: source.scheduleFontSize ?? 'large',
      theme: source.theme
    }
  }
}

export function serializeLoanSnapshot(snapshot: SharedCalculationV1) {
  return JSON.stringify(snapshot)
}

export function parseLoanSnapshot(value: unknown): LoanBackupData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ссылка повреждена. Проверьте ссылку или используйте JSON-файл')
  const version = (value as { version?: unknown }).version
  if (version !== 1) throw new Error('Версия ссылки не поддерживается')
  return parseLoanBackupObject(value)
}

export async function encodeSharedCalculation(snapshot: SharedCalculationV1) {
  const json = serializeLoanSnapshot(snapshot)
  if (json.length > MAX_JSON_PAYLOAD_LENGTH) throw new Error('Расчёт слишком большой для ссылки. Сохраните его в JSON-файл')
  const compressed = await gzip(new TextEncoder().encode(json))
  const encoded = `${SHARE_PREFIX}${bytesToBase64Url(compressed)}`
  if (encoded.length > MAX_ENCODED_PAYLOAD_LENGTH) throw new Error('Расчёт слишком большой для ссылки. Сохраните его в JSON-файл')
  return encoded
}

export async function decodeSharedCalculation(payload: string) {
  if (!payload.startsWith(SHARE_PREFIX)) throw new Error('Версия ссылки не поддерживается')
  if (payload.length > MAX_ENCODED_PAYLOAD_LENGTH) throw new Error('Расчёт слишком большой для ссылки. Сохраните его в JSON-файл')
  const encoded = payload.slice(SHARE_PREFIX.length)
  let raw: unknown
  try {
    const bytes = await gunzip(base64UrlToBytes(encoded))
    const json = new TextDecoder().decode(bytes)
    if (json.length > MAX_JSON_PAYLOAD_LENGTH) throw new Error('Расчёт слишком большой для ссылки. Сохраните его в JSON-файл')
    raw = JSON.parse(json)
  } catch (error) {
    if (error instanceof Error && error.message.includes('слишком большой')) throw error
    throw new Error('Ссылка повреждена. Проверьте ссылку или используйте JSON-файл')
  }
  return parseLoanSnapshot(raw)
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
