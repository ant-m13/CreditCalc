import { Capacitor, registerPlugin, SystemBars, SystemBarsStyle } from '@capacitor/core'

export const PUBLIC_APP_URL = 'https://ant-m13.github.io/CreditCalc/'

export const isNativeApp = () => Capacitor.isNativePlatform()

export const shareBaseUrl = () => isNativeApp() ? PUBLIC_APP_URL : window.location.href

interface AndroidPrintPlugin {
  print: (options: { jobName: string }) => Promise<void>
}

let androidPrintPlugin: AndroidPrintPlugin | null = null

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
    await SystemBars.setStyle({ style: darkBackground ? SystemBarsStyle.Dark : SystemBarsStyle.Light })
  } catch {
    // The web UI remains usable if a vendor WebView does not expose SystemBars.
  }
}
