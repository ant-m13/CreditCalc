import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'io.github.antm13.creditcalc',
  appName: 'CreditCalc',
  webDir: 'dist-android',
  loggingBehavior: 'none',
  server: {
    androidScheme: 'https',
    cleartext: false
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#071a17'
  },
  plugins: {
    SystemBars: {
      insetsHandling: 'css',
      style: 'LIGHT'
    }
  }
}

export default config
