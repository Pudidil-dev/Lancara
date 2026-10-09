import type { PoolClient } from 'pg'
import { serverNow } from '@/lib/clock'
import { query, withTransaction, type Db } from '@/lib/db'
import { env } from '@/lib/env'
import { AppError } from '@/lib/errors'
import { idempotent } from '@/lib/idempotency'
import { AUTHORIZATION_ROLE_ID, AUTHORIZATION_ROLE_LABEL, requireCoordinator, requireEvent, SINGLE_ACCOUNT_ACTOR_ID, type Session } from '@/lib/session'
import { sortByStart } from '@/modules/engine/schedule'
import type { ItemStatus, Snapshot } from '@/modules/engine/types'
import { validateSnapshot } from '@/modules/engine/validate'
import { normalizeIso } from '@/lib/time'
import { enqueueVersionNotification } from '@/modules/notifier/outbox'
import type { NotificationOrigin } from '@/modules/notifier/types'
import { seedDemo } from './seed'
import { fillDefaultPic } from './default-pic'

export interface EventRow {
  id: string
  name: string
  timezone: string
  active_version: number
  sim_clock_at: Date | null
}

export async function getEvent(eventId: string, db?: Db, lock: '' | 'FOR UPDATE' | 'FOR SHARE' = ''): Promise<EventRow> {
  const rows = await query<EventRow>(`SELECT id, name, timezone, active_version, sim_clock_at FROM events WHERE id = $1 ${lock}`, [eventId], db)
  if (!rows[0]) throw new AppError('NOT_FOUND', 'Event tidak ditemukan.')
  return rows[0]
}

export async function getSnapshot(eventId: string, version: number, db?: Db): Promise<Snapshot> {
  const rows = await query<{ snapshot: Snapshot }>('SELECT snapshot FROM versions WHERE event_id = $1 AND number = $2', [eventId, version], db)
  if (!rows[0]) throw new AppError('NOT_FOUND', `Versi ${version} tidak ditemukan.`)
  return rows[0].snapshot
}

/** Normalisasi timestamp & urutan supaya snapshot tersimpan kanonis (hash kandidat stabil). */
export function normalizeSnapshot(s: Snapshot): Snapshot {
  s = fillDefaultPic(s)
  return {
    ...s,
    event: { ...s.event, curfew_at: normalizeIso(s.event.curfew_at) },
    items: sortByStart(
      s.items.map((i) => ({ ...i, start_at: normalizeIso(i.start_at), estimated_end_at: i.estimated_end_at ? normalizeIso(i.estimated_end_at) : null })),
    ),
    constraints: s.constraints.map((c) => ({ ...c, at: normalizeIso(c.at) })),
  }
}

export async function insertVersion(
  client: PoolClient,
  event: EventRow,
  snapshot: Snapshot,
  source: 'setup' | 'item_status' | 'decision',
  actorId: string,
  note: string,
): Promise<number> {
  const next = event.active_version + 1
  await client.query('INSERT INTO versions (event_id, number, parent_number, snapshot, source, actor_id, note) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
    event.id,
    next,
    event.active_version,
    JSON.stringify(snapshot),
    source,
    actorId,
    note,
  ])
  await client.query('UPDATE events SET active_version = $2 WHERE id = $1', [event.id, next])
  return next
}

function assertBase(event: EventRow, baseVersion: number): void {
  if (event.active_version !== baseVersion) {
    throw new AppError('STALE_VERSION', `Rundown sudah berubah ke v${event.active_version}. Hitung ulang dari versi terkini.`, { active_version: event.active_version })
  }
}

export async function getRundown(session: Session, eventId: string) {
  requireEvent(session, eventId)
  const event = await getEvent(eventId)
  const snapshot = await getSnapshot(eventId, event.active_version)
  const validation = validateSnapshot(snapshot)
  return {
    event: { id: event.id, name: event.name, timezone: event.timezone, active_version: event.active_version, sim_clock_at: event.sim_clock_at },
    version: event.active_version,
    snapshot,
    validation,
    server_now: serverNow(event.sim_clock_at),
    demo_mode: env().DEMO_MODE,
  }
}

export async function saveSetup(session: Session, eventId: string, input: { base_version: number; snapshot: Snapshot; idempotency_key: string; note?: string; origin?: Exclude<NotificationOrigin, 'decision'>; import_filename?: string }) {
  requireEvent(session, eventId)
  requireCoordinator(session)
  const snapshot = normalizeSnapshot({ ...input.snapshot, event: { ...input.snapshot.event, id: eventId } })
  const { errors } = validateSnapshot(snapshot)
  if (errors.length) throw new AppError('VALIDATION_ERROR', 'Setup ditolak: perbaiki data berikut.', errors)
  return withTransaction((client) =>
    idempotent(client, { eventId, actorId: session.actor_id, operation: 'setup', key: input.idempotency_key, payload: input }, async () => {
      const event = await getEvent(eventId, client, 'FOR UPDATE')
      assertBase(event, input.base_version)
      const base = await getSnapshot(eventId, event.active_version, client)
      const roles = await query<{ id: string; label: string }>('SELECT id, label FROM roles WHERE event_id = $1 ORDER BY id', [eventId], client)
      const known = new Set(roles.map((r) => r.id))
      const unknown = snapshot.roles.filter((r) => !known.has(r.id))
      if (unknown.length) throw new AppError('VALIDATION_ERROR', `Peran ${unknown.map((r) => r.id).join(', ')} belum terdaftar pada event.`)
      await client.query('UPDATE events SET name = $2, timezone = $3 WHERE id = $1', [eventId, snapshot.event.name, snapshot.event.timezone])
      const newVersion = await insertVersion(client, event, snapshot, 'setup', session.actor_id, input.note ?? 'Perubahan setup')
      const origin = input.origin ?? 'manual_edit'
      // Label settings dari client tidak boleh menyembunyikan perubahan jadwal.
      const hasItemChanges = JSON.stringify(base.items) !== JSON.stringify(snapshot.items)
      const effectiveOrigin = origin === 'settings' && hasItemChanges ? 'manual_edit' : origin
      const changedSettings = (['name', 'timezone', 'curfew_at'] as const).some(field => base.event[field] !== snapshot.event[field])
      if (effectiveOrigin !== 'settings' || changedSettings) {
        await enqueueVersionNotification(client, { base, proposed: snapshot, version: newVersion, baseVersion: input.base_version, session, origin: effectiveOrigin, importFilename: input.import_filename })
      }
      return { new_version: newVersion }
    }),
  )
}

const TRANSITIONS: Record<ItemStatus, ItemStatus[]> = {
  pending: ['in_progress'],
  in_progress: ['completed'],
  completed: [],
  cancelled: [],
}

export async function setItemStatus(session: Session, eventId: string, input: { item_id: string; status: ItemStatus; base_version: number; idempotency_key: string }) {
  requireEvent(session, eventId)
  requireCoordinator(session)
  return withTransaction((client) =>
    idempotent(client, { eventId, actorId: session.actor_id, operation: 'item-status', key: input.idempotency_key, payload: input }, async () => {
      const event = await getEvent(eventId, client, 'FOR UPDATE')
      assertBase(event, input.base_version)
      const snapshot = await getSnapshot(eventId, event.active_version, client)
      const item = snapshot.items.find((i) => i.id === input.item_id)
      if (!item) throw new AppError('NOT_FOUND', `Item ${input.item_id} tidak ditemukan.`)
      if (!TRANSITIONS[item.status].includes(input.status)) {
        throw new AppError('INVALID_STATE', `Status ${item.title} tidak bisa berubah dari ${item.status} ke ${input.status}.`)
      }
      const busy = snapshot.items.find((i) => i.status === 'in_progress' && i.id !== item.id)
      if (input.status === 'in_progress' && busy) {
        throw new AppError('INVALID_STATE', `${busy.title} masih berlangsung di panggung. Tandai selesai lebih dulu.`)
      }
      const next: Snapshot = { ...snapshot, items: snapshot.items.map((i) => (i.id === item.id ? { ...i, status: input.status } : i)) }
      const label = input.status === 'in_progress' ? 'mulai' : 'selesai'
      const newVersion = await insertVersion(client, event, next, 'item_status', session.actor_id, `${item.title} ${label}`)
      return { new_version: newVersion }
    }),
  )
}

export async function setSimClock(session: Session, eventId: string, simClockAt: string | null) {
  requireEvent(session, eventId)
  requireCoordinator(session)
  if (!env().DEMO_MODE) throw new AppError('FORBIDDEN', 'Jam simulasi hanya tersedia di DEMO_MODE.')
  await query('UPDATE events SET sim_clock_at = $2 WHERE id = $1', [eventId, simClockAt ? new Date(simClockAt) : null])
  return { sim_clock_at: simClockAt }
}

export async function resetDemo(session: Session) {
  requireCoordinator(session)
  if (!env().DEMO_MODE) throw new AppError('FORBIDDEN', 'Reset hanya tersedia di DEMO_MODE.')
  await withTransaction((client) => seedDemo(client, { reset: true }))
  return { reset: true }
}

export async function listDemoAccounts() {
  return query<{ id: string; display_name: string; role_id: string; role_label: string; capability: string; event_id: string }>(
    `SELECT a.id, a.display_name, $2::text AS role_id, $3::text AS role_label,
            'coordinator'::text AS capability, a.event_id
       FROM actors a WHERE a.id = $1`,
    [SINGLE_ACCOUNT_ACTOR_ID, AUTHORIZATION_ROLE_ID, AUTHORIZATION_ROLE_LABEL],
  )
}
