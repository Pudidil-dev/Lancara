import { loadEnvFiles } from './load-env'
import { env } from '../src/lib/env'
import { pool, query } from '../src/lib/db'
import { telegramClient } from '../src/modules/notifier/telegram-client'

loadEnvFiles()

async function main() {
  const command = process.argv[2]
  if (!['set', 'info', 'delete'].includes(command)) throw new Error('invalid_command')
  const cfg = env()
  const client = telegramClient()
  if (command === 'info') {
    const info = await client.getWebhookInfo()
    let origin: string | null = null
    try { if (info.url) origin = new URL(info.url).origin } catch { /* An untrusted URL is never echoed. */ }
    process.stdout.write(`${JSON.stringify({ webhook_active: !!info.url, origin, pending_update_count: info.pending_update_count, last_error_date: info.last_error_date, last_error_code: info.last_error_message })}\n`)
    return
  }
  if (command === 'delete') {
    if (!await client.deleteWebhook({ drop_pending_updates: process.argv.includes('--drop-pending') })) throw new Error('webhook_delete_failed')
    process.stdout.write('Webhook dihapus.\n')
    return
  }
  if (!cfg.APP_BASE_URL || !cfg.TELEGRAM_WEBHOOK_SECRET) throw new Error('configuration_missing')
  const base = new URL(cfg.APP_BASE_URL)
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('invalid_https_base')
  const url = new URL('/api/telegram/webhook', base.origin).toString()
  if (!await client.setWebhook({ url, secret_token: cfg.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ['message', 'my_chat_member'], drop_pending_updates: process.argv.includes('--drop-pending'), max_connections: 10 })) throw new Error('webhook_set_failed')
  await query(`INSERT INTO telegram_audit (action) VALUES ('webhook_set')`)
  process.stdout.write('Webhook diatur; verifikasi dengan npm run telegram:webhook -- info.\n')
}

main().catch(() => {
  process.stderr.write('Perintah webhook gagal. Cek konfigurasi dan koneksi; detail rahasia tidak ditampilkan. Gunakan set, info, atau delete.\n')
  process.exitCode = 1
}).finally(async () => { if ((globalThis as { __ripplePool?: unknown }).__ripplePool) await pool().end().catch(() => undefined) })
