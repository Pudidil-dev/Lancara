import { after, NextResponse } from 'next/server'
import { body, route } from '@/lib/http'
import { env } from '@/lib/env'
import { receiveUpdate, processPendingUpdates, TelegramUpdateSchema } from '@/modules/notifier/inbound'

export const runtime = 'nodejs'
export const maxDuration = 60
export const POST = route('telegram.webhook', async req => {
  if (!env().TELEGRAM_ENABLED) return NextResponse.json({ ok: true })
  const update = await body(req, TelegramUpdateSchema)
  const received = await receiveUpdate(update)
  if (received.accepted) after(async () => { await processPendingUpdates({ update_id: received.update_id, limit: 1 }) })
  return NextResponse.json({ ok: true })
}, { webhook: true })
