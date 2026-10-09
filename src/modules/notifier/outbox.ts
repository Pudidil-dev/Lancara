import type { Db } from '@/lib/db'
import { buildPayload, type PayloadInput } from './payload'

/** Ditulis dalam transaksi versi, termasuk saat pengiriman Telegram dinonaktifkan. */
export async function enqueueVersionNotification(db: Db, input: Omit<PayloadInput, 'committedAt'> & { committedAt?: string }) {
  const committedAt = input.committedAt ?? (await db.query<{ at: Date }>('SELECT transaction_timestamp() AS at')).rows[0].at.toISOString()
  const payload = buildPayload({ ...input, committedAt })
  await db.query(
    `INSERT INTO notification_outbox (event_id, version, kind, schema_version, payload, correlation_id)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (event_id, version) DO NOTHING`,
    [payload.event.id, payload.version, payload.kind, payload.schema_version, JSON.stringify(payload), payload.correlation_id],
  )
  return payload
}
