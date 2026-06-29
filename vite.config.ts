// @ts-nocheck
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const pkg = JSON.parse(readFileSync('package.json', 'utf-8')) as { version?: string }

  return {
    base: env.VITE_BASE_PATH || '/',
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version ?? '0.0.0'),
      __BUILD_DATE__: JSON.stringify(new Date().toISOString())
    },
    server: { port: 4317, strictPort: true }
  }
})
