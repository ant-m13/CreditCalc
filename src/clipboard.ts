import { isNativeApp } from './platform'

export const readClipboardText = async () => {
  if (isNativeApp()) {
    const { Clipboard } = await import('@capacitor/clipboard')
    return (await Clipboard.read()).value
  }
  return navigator.clipboard.readText()
}

export const writeClipboardText = async (text: string) => {
  if (isNativeApp()) {
    const { Clipboard } = await import('@capacitor/clipboard')
    await Clipboard.write({ string: text })
    return
  }
  await navigator.clipboard.writeText(text)
}
