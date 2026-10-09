import { defineConfig } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseURL).hostname)
const productionServer = process.env.E2E_SERVER_MODE === 'production'
if (productionServer && !process.env.E2E_DATABASE_URL) throw new Error('Mode produksi E2E memerlukan E2E_DATABASE_URL untuk database uji terpisah.')
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1, // A single demo fixture is reset between scenarios and projects.
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  globalSetup: './tests/e2e/global-setup.ts',
  outputDir: '../docs/ripple/evidence/playwright-results',
  reporter: [['list'], ['json', { outputFile: '../docs/ripple/evidence/e2e-results.json' }]],
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure', browserName: 'chromium' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true } },
  ],
  webServer: local ? {
    command: productionServer
      ? `npm run start -- --port ${new URL(baseURL).port || '3000'} --hostname 127.0.0.1`
      : `npm run dev -- --port ${new URL(baseURL).port || '3000'}`,
    url: `${baseURL}/health/ready`,
    timeout: 120_000,
    reuseExistingServer: !productionServer && process.env.E2E_REUSE_SERVER === 'true',
    env: {
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? 'postgres://ripple@127.0.0.1:54329/ripple',
      APP_BASE_URL: baseURL,
      AI_PROVIDER: 'rule', DEMO_MODE: 'true', DEMO_CLOCK_ISO: '2026-10-09T11:40:00Z',
    },
  } : undefined,
})
