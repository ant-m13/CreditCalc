import { defineConfig, devices } from '@playwright/test'

const port = 4318
const configuredBasePath = (process.env.E2E_BASE_PATH ?? '').replace(/^\/+|\/+$/g, '')
const basePath = configuredBasePath ? `/${configuredBasePath}/` : '/'
const appUrl = `http://127.0.0.1:${port}${basePath}`

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: {
    timeout: 10_000
  },
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: appUrl,
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'node ./scripts/serve-dist.mjs',
    url: appUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
})
