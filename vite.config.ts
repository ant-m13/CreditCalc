import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import packageJson from './package.json'

interface PackageMetadata {
  version?: string
}

const productionCsp = "default-src 'self'; script-src 'self'; style-src 'self'; style-src-elem 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'none'; object-src 'none'"

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const pkg = packageJson as PackageMetadata

  return {
    base: env.VITE_BASE_PATH || '/',
    plugins: [
      react(),
      {
        name: 'credit-calculator-production-csp',
        apply: 'build',
        transformIndexHtml: (html) =>
          html.replace('<meta name="theme-color"', `<meta http-equiv="Content-Security-Policy" content="${productionCsp}"/><meta name="theme-color"`)
      }
    ],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version ?? '0.0.0'),
      __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
      __COMMIT_SHA__: JSON.stringify(env.VITE_COMMIT_SHA || env.GITHUB_SHA || 'dev')
    },
    server: { port: 4317, strictPort: true }
  }
})
