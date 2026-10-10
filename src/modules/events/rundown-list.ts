// Halaman /rundown: daftar rundown milik akun (event asal + event_members) beserta status berjalan/selesai.
import { serverNow } from '@/lib/clock'
import { query } from '@/lib/db'
import { toMs } from '@/lib/time'
import type { Session } from '@/lib/session'
import { endMs } from '@/modules/engine/schedule'
import type { Snapshot } from '@/modules/engine/types'

export type RundownStatus = 'live' | 'upcoming' | 'done' | 'empty'

export interface RundownSummary {
  id: string
  name: string
  timezone: string
  version: number
  item_count: number
  start_at: string | null
  end_at: string | null
  status: RundownStatus
  /** Segmen yang sedang berjalan (status live). */
  current_title: string | null
  active: boolean
}

/** Status dari segmen aktif (bukan dibatalkan) terhadap jam acara. */
export function summarizeRundown(snapshot: Snapshot | null, nowIso: string): Pick<RundownSummary, 'item_count' | 'start_at' | 'end_at' | 'status' | 'current_title'> {
  const items = (snapshot?.items ?? []).filter((item) => item.status !== 'cancelled')
  if (!items.length) return { item_count: 0, start_at: null, end_at: null, status: 'empty', current_title: null }
  const start = Math.min(...items.map((item) => toMs(item.start_at)))
  const end = Math.max(...items.map(endMs))
  const now = toMs(nowIso)
  const running = items.find((item) => item.status === 'in_progress')
  const status: RundownStatus = items.every((item) => item.status === 'completed') || (!running && now >= end)
    ? 'done'
    : running || now >= start ? 'live' : 'upcoming'
  const current = running ?? (status === 'live' ? items.find((item) => toMs(item.start_at) <= now && now < endMs(item)) : undefined)
  return { item_count: items.length, start_at: new Date(start).toISOString(), end_at: new Date(end).toISOString(), status, current_title: current?.title ?? null }
}

const ORDER: Record<RundownStatus, number> = { live: 0, upcoming: 1, empty: 2, done: 3 }

export async function listRundowns(session: Session): Promise<{ rundowns: RundownSummary[] }> {
  const rows = await query<{ id: string; name: string; timezone: string; active_version: number; sim_clock_at: Date | null; snapshot: Snapshot | null }>(
    `SELECT e.id, e.name, e.timezone, e.active_version, e.sim_clock_at, v.snapshot
       FROM events e
       JOIN actors a ON a.id = $1
       LEFT JOIN versions v ON v.event_id = e.id AND v.number = e.active_version
      WHERE e.id = a.event_id OR EXISTS (SELECT 1 FROM event_members m WHERE m.event_id = e.id AND m.actor_id = a.id)`,
    [session.actor_id],
  )
  const rundowns = rows.map((row): RundownSummary => ({
    id: row.id,
    name: row.name,
    timezone: row.timezone,
    version: row.active_version,
    ...summarizeRundown(row.snapshot, serverNow(row.sim_clock_at)),
    active: row.id === session.event_id,
  }))
  // Berjalan dulu, lalu akan datang (terdekat), kosong, kemudian selesai (terbaru).
  rundowns.sort((a, b) => ORDER[a.status] - ORDER[b.status]
    || (a.status === 'done' ? toMs(b.start_at ?? '1970-01-01T00:00:00Z') - toMs(a.start_at ?? '1970-01-01T00:00:00Z') : toMs(a.start_at ?? '9999-01-01T00:00:00Z') - toMs(b.start_at ?? '9999-01-01T00:00:00Z'))
    || a.name.localeCompare(b.name, 'id'))
  return { rundowns }
}
