export interface IdCryptoSource {
  randomUUID?: () => string
  getRandomValues?: (array: Uint8Array) => Uint8Array
}

const HEX_RADIX = 16
const HEX_BYTE_WIDTH = 2
const RANDOM_ID_BYTES = 16
const COMPACT_ID_RADIX = 36
const RANDOM_FRACTION_PREFIX_LENGTH = 2
const RANDOM_SUFFIX_LENGTH = 8

const normalizePrefix = (prefix: string) => {
  const normalized = prefix.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return /[a-zA-Z0-9]/.test(normalized) ? normalized : 'id'
}

const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes, byte => byte.toString(HEX_RADIX).padStart(HEX_BYTE_WIDTH, '0')).join('')

export function createId(prefix = 'id', cryptoSource: IdCryptoSource | undefined = globalThis.crypto as IdCryptoSource | undefined): string {
  const safePrefix = normalizePrefix(prefix)
  const uuid = cryptoSource?.randomUUID?.()
  if (uuid) return `${safePrefix}-${uuid}`

  if (cryptoSource?.getRandomValues) {
    return `${safePrefix}-${bytesToHex(cryptoSource.getRandomValues(new Uint8Array(RANDOM_ID_BYTES)))}`
  }

  const randomSuffix = Math.random().toString(COMPACT_ID_RADIX)
    .slice(RANDOM_FRACTION_PREFIX_LENGTH, RANDOM_FRACTION_PREFIX_LENGTH + RANDOM_SUFFIX_LENGTH)
  return `${safePrefix}-${Date.now().toString(COMPACT_ID_RADIX)}-${randomSuffix}`
}
