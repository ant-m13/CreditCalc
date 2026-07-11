export const MAX_PORTABLE_JSON_BYTES = 8 * 1024 * 1024
export const MAX_SHARE_ENCODED_PAYLOAD_LENGTH = 12 * 1024 * 1024

export const portablePayloadTooLargeMessage = 'Расчёт превышает единый лимит переносимых данных (8 МБ)'

export const assertPortableJsonSize = (text: string) => {
  if (new TextEncoder().encode(text).byteLength > MAX_PORTABLE_JSON_BYTES) {
    throw new Error(portablePayloadTooLargeMessage)
  }
}
