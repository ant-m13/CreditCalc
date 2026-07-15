import { defineConfig, devices } from '@playwright/test'

const E2E_SERVER_PORT = 4318
const E2E_TEST_TIMEOUT_MS = 45_000
const E2E_EXPECT_TIMEOUT_MS = 10_000
const E2E_SERVER_START_TIMEOUT_MS = 60_000
const configuredBasePath = (process.env.E2E_BASE_PATH ?? '').replace(/^\/+|\/+$/g, '')
const basePath = configuredBasePath ? `/${configuredBasePath}/` : '/'
const appUrl = `http://127.0.0.1:${E2E_SERVER_PORT}${basePath}`

export default defineConfig({
  testDir: './e2e',
  timeout: E2E_TEST_TIMEOUT_MS,
  expect: {
    timeout: E2E_EXPECT_TIMEOUT_MS
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
    timeout: E2E_SERVER_START_TIMEOUT_MS
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
})
