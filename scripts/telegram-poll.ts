import { loadEnvFiles } from './load-env'
import { pool } from '../src/lib/db'
import { env } from '../src/lib/env'
import { handleUpdate, processPendingUpdates, TelegramUpdateSchema } from '../src/modules/notifier/inbound'
import { telegramClient } from '../src/modules/notifier/telegram-client'

loadEnvFiles()
let stopping = false
process.on('SIGINT', () => { stopping = true })
process.on('SIGTERM', () => { stopping = true })

async function main() {
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL || process.env.VERCEL_ENV === 'production') throw new Error('production_polling_disabled')
  if (!env().TELEGRAM_ENABLED) throw new Error('telegram_disabled')
  const client = telegramClient()
  if ((await client.getWebhookInfo()).url) throw new Error('webhook_active')
  await processPendingUpdates({ client })
  process.stdout.write('Polling Telegram lokal aktif. Tekan Ctrl+C untuk berhenti.\n')
  let offset: number | undefined
  while (!stopping) {
    const updates = await client.getUpdates({ offset, timeout: 25, allowed_updates: ['message', 'my_chat_member'] })
    for (const update of updates) {
      const parsed = TelegramUpdateSchema.safeParse(update)
      if (!parsed.success) continue
      await handleUpdate(update, { client })
      // Advancing after durable receipt is safe even if processing needs cron recovery.
      offset = Math.max(offset ?? 0, parsed.data.update_id + 1)
    }
  }
}

main().catch(() => {
  process.stderr.write('Polling gagal. Hanya gunakan lokal dengan bot uji, Telegram aktif, dan webhook dihapus. Detail rahasia tidak ditampilkan.\n')
  process.exitCode = 1
}).finally(async () => { if ((globalThis as { __ripplePool?: unknown }).__ripplePool) await pool().end().catch(() => undefined) })
