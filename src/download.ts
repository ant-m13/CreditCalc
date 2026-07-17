import { isNativeApp } from './platform'

export const OBJECT_URL_REVOKE_DELAY_MS = 1000
const BINARY_CHUNK_SIZE = 0x8000

export const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  try {
    anchor.click()
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_REVOKE_DELAY_MS)
  }
}

const blobToBase64 = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += BINARY_CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BINARY_CHUNK_SIZE))
  }
  return btoa(binary)
}

export const saveBlob = async (blob: Blob, filename: string) => {
  if (!isNativeApp()) {
    downloadBlob(blob, filename)
    return 'downloaded' as const
  }

  const [{ Directory, Filesystem }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share')
  ])
  const saved = await Filesystem.writeFile({
    path: `exports/${filename}`,
    data: await blobToBase64(blob),
    directory: Directory.Cache,
    recursive: true
  })
  await Share.share({
    title: `CreditCalc — ${filename}`,
    files: [saved.uri],
    dialogTitle: 'Сохранить или отправить файл'
  })
  return 'shared' as const
}
