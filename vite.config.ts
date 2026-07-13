import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import packageJson from './package.json'

interface PackageMetadata {
  version?: string
}

const productionCsp = "default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self'; style-src-elem 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'none'; object-src 'none'"

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const pkg = packageJson as PackageMetadata

  return {
    base: env.VITE_BASE_PATH || '/',
    plugins: [
      react(),
      VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'service-worker.ts',
        injectRegister: false,
        manifest: false,
        injectManifest: {
          rollupFormat: 'iife',
          globPatterns: ['**/*.{js,css,html,png,svg,webmanifest,woff2}'],
          maximumFileSizeToCacheInBytes: 1_500_000
        },
        devOptions: { enabled: false }
      }),
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
    test: {
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json-summary'],
        thresholds: {
          lines: 50,
          functions: 45,
          branches: 45,
          statements: 50
        }
      }
    },
    server: { port: 4317, strictPort: true }
  }
})
