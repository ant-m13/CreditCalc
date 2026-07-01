export interface IdCryptoSource {
  randomUUID?: () => string
  getRandomValues?: (array: Uint8Array) => Uint8Array
}

const normalizePrefix = (prefix: string) => {
  const normalized = prefix.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return /[a-zA-Z0-9]/.test(normalized) ? normalized : 'id'
}

const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')

export function createId(prefix = 'id', cryptoSource: IdCryptoSource | undefined = globalThis.crypto as IdCryptoSource | undefined): string {
  const safePrefix = normalizePrefix(prefix)
  const uuid = cryptoSource?.randomUUID?.()
  if (uuid) return `${safePrefix}-${uuid}`

  if (cryptoSource?.getRandomValues) {
    return `${safePrefix}-${bytesToHex(cryptoSource.getRandomValues(new Uint8Array(16)))}`
  }

  return `${safePrefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
