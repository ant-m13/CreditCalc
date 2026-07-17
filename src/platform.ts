import { Capacitor, registerPlugin } from '@capacitor/core'

export const PUBLIC_APP_URL = 'https://ant-m13.github.io/CreditCalc/'

export const isNativeApp = () => Capacitor.isNativePlatform()

export const shareBaseUrl = () => isNativeApp() ? PUBLIC_APP_URL : window.location.href

interface SystemBarsPlugin {
  setStyle: (options: { style: 'LIGHT' | 'DARK' }) => Promise<void>
}

interface AndroidPrintPlugin {
  print: (options: { jobName: string }) => Promise<void>
}

let systemBarsPlugin: SystemBarsPlugin | null = null
let androidPrintPlugin: AndroidPrintPlugin | null = null

const getSystemBarsPlugin = () => systemBarsPlugin ??= registerPlugin<SystemBarsPlugin>('SystemBars')
const getAndroidPrintPlugin = () => androidPrintPlugin ??= registerPlugin<AndroidPrintPlugin>('AndroidPrint')

export const printDocument = async () => {
  if (isNativeApp()) {
    await getAndroidPrintPlugin().print({ jobName: 'CreditCalc — кредитный график' })
    return
  }
  window.print()
}

export const setSystemBarsForTheme = async (darkBackground: boolean) => {
  if (!isNativeApp()) return
  try {
    await getSystemBarsPlugin().setStyle({ style: darkBackground ? 'DARK' : 'LIGHT' })
  } catch {
    // The web UI remains usable if a vendor WebView does not expose SystemBars.
  }
}
