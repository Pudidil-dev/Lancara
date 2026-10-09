import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('DATABASE_URL', 'postgres://ripple@localhost:54329/ripple_test')
  vi.stubEnv('SESSION_SECRET', 'unit-test-secret-unit-test-secret-123')
  vi.stubEnv('OPENAI_API_KEY', '')
  vi.stubEnv('ANTHROPIC_API_KEY', '')
  for (const key of ['TELEGRAM_ENABLED', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'TELEGRAM_BOT_USERNAME', 'NOTIFIER_CRON_SECRET']) vi.stubEnv(key, '')
})
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

describe('environment Telegram opsional', () => {
  it('Telegram nonaktif secara default dan field kosong menjadi undefined', async () => {
    const { env } = await import('@/lib/env')
    expect(env().TELEGRAM_ENABLED).toBe(false)
    expect(env().TELEGRAM_BOT_TOKEN).toBeUndefined()
    expect(env().TELEGRAM_WEBHOOK_SECRET).toBeUndefined()
    expect(env().TELEGRAM_BOT_USERNAME).toBeUndefined()
  })
  it('menerima konfigurasi lengkap bila aktif', async () => {
    vi.stubEnv('TELEGRAM_ENABLED', 'true')
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '12345:unit-test-token')
    vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', 'test_webhook_secret_24_characters')
    vi.stubEnv('TELEGRAM_BOT_USERNAME', 'ripple_test_bot')
    vi.stubEnv('NOTIFIER_CRON_SECRET', 'test-cron-secret-at-least-32-characters')
    const { env } = await import('@/lib/env')
    expect(env().TELEGRAM_ENABLED).toBe(true)
    expect(env().TELEGRAM_BOT_USERNAME).toBe('ripple_test_bot')
  })
  it('menolak aktif tanpa konfigurasi yang dibutuhkan', async () => {
    vi.stubEnv('TELEGRAM_ENABLED', 'true')
    const { env } = await import('@/lib/env')
    expect(env).toThrow('TELEGRAM_BOT_TOKEN')
  })
  it('menolak nilai enabled yang tidak jelas', async () => {
    vi.stubEnv('TELEGRAM_ENABLED', 'yes')
    const { env } = await import('@/lib/env')
    expect(env).toThrow('TELEGRAM_ENABLED')
  })
  it('menolak secret pendek tanpa membocorkan nilainya', async () => {
    vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', 'do-not-log-this')
    const { env } = await import('@/lib/env')
    expect(env).toThrow('TELEGRAM_WEBHOOK_SECRET')
    try { env() } catch (error) { expect(String(error)).not.toContain('do-not-log-this') }
  })
})
