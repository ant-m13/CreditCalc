import { assertPortableJsonSize, MAX_PORTABLE_JSON_BYTES, MAX_SHARE_ENCODED_PAYLOAD_LENGTH, portablePayloadTooLargeMessage } from './portabilityLimits'

export const SHARE_PREFIX = 'v1.'
export const MAX_ENCODED_PAYLOAD_LENGTH = MAX_SHARE_ENCODED_PAYLOAD_LENGTH
export const MAX_JSON_PAYLOAD_LENGTH = MAX_PORTABLE_JSON_BYTES
const BASE64_CHUNK_BYTES = 0x8000
const BASE64_BLOCK_SIZE = 4

const bytesToBase64Url = (bytes: Uint8Array) => {
  let binary = ''
  for (let index = 0; index < bytes.length; index += BASE64_CHUNK_BYTES) {
    binary += String.fromCharCode(...bytes.slice(index, index + BASE64_CHUNK_BYTES))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

const base64UrlToBytes = (value: string) => {
  const missingPadding = (BASE64_BLOCK_SIZE - value.length % BASE64_BLOCK_SIZE) % BASE64_BLOCK_SIZE
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(missingPadding)
  const binary = atob(base64)
  return Uint8Array.from(binary, char => char.charCodeAt(0))
}

const streamToBytes = async (stream: ReadableStream<Uint8Array>, maximumLength = MAX_PORTABLE_JSON_BYTES) => {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    length += value.length
    if (length > maximumLength) {
      await reader.cancel()
      throw new Error(portablePayloadTooLargeMessage)
    }
  }
  const result = new Uint8Array(length)
  let offset = 0
  chunks.forEach(chunk => { result.set(chunk, offset); offset += chunk.length })
  return result
}

const bytesToBlobPart = (input: Uint8Array) => input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer
const bytesToStream = (input: Uint8Array): ReadableStream<BufferSource> => {
  const blob = new Blob([bytesToBlobPart(input)])
  if (typeof blob.stream === 'function') return blob.stream() as ReadableStream<BufferSource>
  return new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(bytesToBlobPart(input))
      controller.close()
    }
  })
}

const gzip = async (input: Uint8Array) => {
  if (typeof CompressionStream === 'undefined') throw new Error('Ваш браузер не поддерживает создание сжатых ссылок. Используйте JSON-файл')
  return streamToBytes(bytesToStream(input).pipeThrough(new CompressionStream('gzip')))
}

const gunzip = async (input: Uint8Array) => {
  if (typeof DecompressionStream === 'undefined') throw new Error('Ваш браузер не поддерживает загрузку сжатых ссылок. Используйте JSON-файл')
  try {
    return await streamToBytes(bytesToStream(input).pipeThrough(new DecompressionStream('gzip')))
  } catch {
    throw new Error('Ссылка повреждена. Проверьте ссылку или используйте JSON-файл')
  }
}

export const assertSharedPayloadEnvelope = (payload: string) => {
  if (!payload.startsWith(SHARE_PREFIX)) throw new Error('Версия ссылки не поддерживается')
  if (payload.length > MAX_ENCODED_PAYLOAD_LENGTH) throw new Error(portablePayloadTooLargeMessage)
}

export async function encodeSharedPayloadJson(json: string) {
  assertPortableJsonSize(json)
  const compressed = await gzip(new TextEncoder().encode(json))
  const encoded = `${SHARE_PREFIX}${bytesToBase64Url(compressed)}`
  if (encoded.length > MAX_ENCODED_PAYLOAD_LENGTH) throw new Error(portablePayloadTooLargeMessage)
  return encoded
}

export async function decodeSharedPayload(payload: string): Promise<unknown> {
  assertSharedPayloadEnvelope(payload)
  try {
    const bytes = await gunzip(base64UrlToBytes(payload.slice(SHARE_PREFIX.length)))
    if (bytes.byteLength > MAX_JSON_PAYLOAD_LENGTH) throw new Error(portablePayloadTooLargeMessage)
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch (error) {
    if (error instanceof Error && (error.message.includes('слишком большой') || error.message.includes('лимит переносимых данных'))) throw error
    throw new Error('Ссылка повреждена. Проверьте ссылку или используйте JSON-файл', { cause: error })
  }
}
