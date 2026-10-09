import type { PoolClient } from 'pg'
import { z } from 'zod'
import { query, withTransaction } from '@/lib/db'
import { AppError } from '@/lib/errors'
import { idempotent } from '@/lib/idempotency'
import { requireCoordinator, type Session } from '@/lib/session'
export const selectEventSchema = z.object({
  event_id: z.string().min(1).max(64),
  idempotency_key: z.string().min(8).max(100),
})

export async function listEvents(session: Session) {
  return query<{ id: string; name: string; timezone: string; active_version: number }>(
    `SELECT e.id, e.name, e.timezone, e.active_version FROM events e
     JOIN actors a ON a.id = $1
     WHERE e.id = a.event_id OR EXISTS (
       SELECT 1 FROM event_members m WHERE m.event_id = e.id AND m.actor_id = a.id
     ) ORDER BY lower(e.name), e.id`, [session.actor_id],
  )
}

/** Kunci sesi; scope idempotensi tetap stabil setelah pergantian event. */
async function lockSession(session: Session, client: PoolClient) {
  const [row] = await query<{ home_event_id: string }>(
    `SELECT a.event_id AS home_event_id FROM demo_sessions s JOIN actors a ON a.id = s.actor_id
     WHERE s.id = $1 AND s.actor_id = $2 AND s.expires_at > now() FOR UPDATE OF s`,
    [session.session_id, session.actor_id], client,
  )
  if (!row) throw new AppError('UNAUTHENTICATED', 'Sesi kedaluwarsa. Masuk kembali untuk memilih event.')
  return row.home_event_id
}

async function activate(session: Session, eventId: string, client: PoolClient) {
  const [allowed] = await query(
    `SELECT 1 FROM events e JOIN actors a ON a.id = $1 WHERE e.id = $2
     AND (e.id = a.event_id OR EXISTS (SELECT 1 FROM event_members m WHERE m.event_id = e.id AND m.actor_id = a.id))`,
    [session.actor_id, eventId], client,
  )
  if (!allowed) throw new AppError('NOT_FOUND', 'Event tidak tersedia untuk akun ini.')
  await client.query('UPDATE demo_sessions SET selected_event_id = $2 WHERE id = $1', [session.session_id, eventId])
}

export async function selectEvent(session: Session, input: z.infer<typeof selectEventSchema>) {
  requireCoordinator(session)
  return withTransaction(async client => {
    const homeEventId = await lockSession(session, client)
    const result = await idempotent(client, { eventId: homeEventId, actorId: session.actor_id, operation: 'event.select', key: input.idempotency_key, payload: input }, async () => {
      // Akses diperiksa sebelum request dicatat sebagai committed.
      await activate(session, input.event_id, client)
      return { event_id: input.event_id }
    })
    // Retry dari sesi lain akun yang sama tetap mengaktifkan sesi pemanggil dan mengecek akses terbaru.
    if (result.replayed) await activate(session, result.event_id, client)
    return result
  })
}

