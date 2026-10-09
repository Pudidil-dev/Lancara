import { loadEnvFiles } from './load-env'
import { pool } from '../src/lib/db'
import { env } from '../src/lib/env'
import { handleUpdate, processPendingUpdates, TelegramUpdateSchema } from '../src/modules/notifier/inbound'
import { telegramClient, TelegramApiError } from '../src/modules/notifier/telegram-client'
import { retryTelegramRead } from './telegram-poll-retry'

loadEnvFiles()
let stopping = false
process.on('SIGINT', () => { stopping = true })
process.on('SIGTERM', () => { stopping = true })

async function main() {
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL || process.env.VERCEL_ENV === 'production') throw new Error('production_polling_disabled')
  if (!env().TELEGRAM_ENABLED) throw new Error('telegram_disabled')
  const client = telegramClient()
  if ((await retryTelegramRead(() => client.getWebhookInfo())).url) throw new Error('webhook_active')
  await processPendingUpdates({ client })
  process.stdout.write('Polling Telegram lokal aktif. Tekan Ctrl+C untuk berhenti.\n')
  let offset: number | undefined
  while (!stopping) {
    const updates = await retryTelegramRead(() => client.getUpdates({ offset, timeout: 25, allowed_updates: ['message', 'my_chat_member'] }))
    for (const update of updates) {
      const parsed = TelegramUpdateSchema.safeParse(update)
      if (!parsed.success) continue
      await handleUpdate(update, { client })
      // Advancing after durable receipt is safe even if processing needs cron recovery.
      offset = Math.max(offset ?? 0, parsed.data.update_id + 1)
    }
  }
}

main().catch((error: unknown) => {
  const reasons: Record<string, string> = {
    production_polling_disabled: 'Polling hanya dapat dijalankan di lingkungan lokal.',
    telegram_disabled: 'Set TELEGRAM_ENABLED=true, lalu jalankan kembali.',
    webhook_active: 'Webhook masih aktif. Untuk bot uji lokal, jalankan npm run telegram:webhook -- delete.',
  }
  let detail = 'Periksa konfigurasi environment dan koneksi database.'
  if (error instanceof TelegramApiError) {
    detail = `Telegram ${error.method}: ${error.code}${error.http_status ? ` (HTTP ${error.http_status})` : ''}.`
    if (error.code === 'network' || error.code === 'ambiguous') detail += ' Koneksi gagal setelah tiga percobaan; periksa jaringan/VPN lalu coba lagi.'
    if (error.http_status === 409) detail += ' Hentikan polling lain untuk bot yang sama dan periksa webhook.'
    if (error.http_status === 401) detail += ' Periksa TELEGRAM_BOT_TOKEN dari BotFather.'
  } else if (error instanceof Error && reasons[error.message]) detail = reasons[error.message]
  process.stderr.write(`Polling gagal. ${detail} Token dan detail rahasia tidak ditampilkan.\n`)
  process.exitCode = 1
}).finally(async () => { if ((globalThis as { __ripplePool?: unknown }).__ripplePool) await pool().end().catch(() => undefined) })
