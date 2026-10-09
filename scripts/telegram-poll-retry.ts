import { setTimeout } from 'node:timers/promises'
import { TelegramApiError } from '../src/modules/notifier/telegram-client'

/** Retry only reads; account mutations and sendMessage must never be replayed here. */
export async function retryTelegramRead<T>(read: () => Promise<T>, wait: (ms: number) => Promise<unknown> = setTimeout): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await read() } catch (error) {
      const transient = error instanceof TelegramApiError && (
        error.code === 'network' || error.code === 'ambiguous' || (error.http_status !== undefined && error.http_status >= 500)
      )
      if (!transient || attempt >= 2) throw error
      process.stderr.write('Koneksi Telegram terganggu; mencoba ulang…\n')
      await wait((attempt + 1) * 1000)
    }
  }
}
