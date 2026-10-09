import { defineConfig } from '@playwright/test'

// UI API mocks only: deliberately no global setup, database reset or live mutations.
export default defineConfig({
  testDir: './tests/e2e', testMatch: 'frontend-ux.spec.ts', workers: 1,
  timeout: 60_000, expect: { timeout: 15_000 },
  outputDir: '../docs/ripple/evidence/frontend-ux-results',
  reporter: [['list'], ['json', { outputFile: '../docs/ripple/evidence/frontend-ux.json' }]],
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000', browserName: 'chromium', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true } },
  ],
})
