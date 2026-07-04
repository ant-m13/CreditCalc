import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import packageJson from './package.json'

interface PackageMetadata {
  version?: string
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const pkg = packageJson as PackageMetadata

  return {
    base: env.VITE_BASE_PATH || '/',
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version ?? '0.0.0'),
      __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
      __COMMIT_SHA__: JSON.stringify(env.VITE_COMMIT_SHA || env.GITHUB_SHA || 'dev')
    },
    server: { port: 4317, strictPort: true }
  }
})
