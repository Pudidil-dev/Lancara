// Notifikasi in-app: diturunkan dari log yang sudah ada; hanya status baca yang disimpan (notification_reads).
import { serverNow } from '@/lib/clock'
import { query } from '@/lib/db'
import { AppError } from '@/lib/errors'
import { requireEvent, type Session } from '@/lib/session'
import type { BriefPayload } from '@/modules/briefs/render'
import { getEvent, getSnapshot } from '@/modules/events/service'
import { buildFeed, clip, decisionCopy, reminderNotifications, type NotificationFeed, type NotificationItem } from './feed'

type Source = Omit<NotificationItem, 'unread'>
const iso = (at: Date | string) => new Date(at).toISOString()

async function pendingChanges(eventId: string): Promise<Source[]> {
  const rows = await query<{ id: string; seq: string; original_text: string | null; created_at: Date; reporter: string }>(
    `SELECT c.id, c.seq, c.original_text, c.created_at, a.display_name AS reporter
       FROM changes c JOIN actors a ON a.id = c.actor_id
      WHERE c.event_id = $1 AND c.status IN ('draft', 'needs_clarification', 'preview_ready')
      ORDER BY c.created_at DESC LIMIT 20`,
    [eventId],
  )
  return rows.map((r) => ({
    key: `change:${r.id}`,
    category: 'review',
    title: clip(r.original_text?.replace(/\s+/g, ' ').trim() || `Laporan perubahan CH-${r.seq}`, 90),
    description: `Laporan ${r.reporter} perlu ditinjau. Jadwal belum diubah.`,
    at: iso(r.created_at),
    href: `/changes/${r.id}`,
  }))
}

async function decisions(eventId: string, timezone: string): Promise<Source[]> {
  const rows = await query<{ id: string; new_version: number; reason: string; approved_at: Date; approved_by: string; seq: string; payload: BriefPayload | null }>(
    `SELECT d.id, d.new_version, d.reason, d.approved_at, a.display_name AS approved_by, c.seq,
            (SELECT b.payload FROM briefs b WHERE b.decision_id = d.id ORDER BY (b.level = 'ACTION_REQUIRED') DESC, b.created_at LIMIT 1) AS payload
       FROM decisions d JOIN actors a ON a.id = d.actor_id JOIN changes c ON c.id = d.change_id
      WHERE d.event_id = $1
      ORDER BY d.approved_at DESC LIMIT 20`,
    [eventId],
  )
  return rows.map((r) => ({
    key: `decision:${r.id}`,
    category: 'change',
    ...decisionCopy({ entries: r.payload?.entries ?? [], timezone, approvedBy: r.approved_by, newVersion: r.new_version, changeSeq: Number(r.seq), reason: r.reason }),
    at: iso(r.approved_at),
    href: '/history',
  }))
}

async function acknowledgements(eventId: string): Promise<Source[]> {
  const rows = await query<{ id: string; acknowledged_at: Date; role_label: string | null; role_id: string; version: number }>(
    `SELECT k.id, k.acknowledged_at, k.role_id, r.label AS role_label, b.version
       FROM acknowledgements k JOIN briefs b ON b.id = k.brief_id
       LEFT JOIN roles r ON r.event_id = b.event_id AND r.id = k.role_id
      WHERE b.event_id = $1
      ORDER BY k.acknowledged_at DESC LIMIT 20`,
    [eventId],
  )
  return rows.map((r) => {
    const role = r.role_label ?? r.role_id
    return {
      key: `ack:${r.id}`,
      category: 'crew',
      title: `${role} mengonfirmasi kesiapan`,
      description: `Brief Rundown v${r.version} sudah dibaca. ${role} siap untuk segmen berikutnya.`,
      at: iso(r.acknowledged_at),
      href: '/history',
    }
  })
}

async function rundownActivity(eventId: string): Promise<Source[]> {
  const [versions, shares] = await Promise.all([
    query<{ number: number; note: string | null; created_at: Date; actor: string | null }>(
      `SELECT v.number, v.note, v.created_at, a.display_name AS actor
         FROM versions v LEFT JOIN actors a ON a.id = v.actor_id
        WHERE v.event_id = $1 AND v.source = 'setup'
        ORDER BY v.number DESC LIMIT 10`,
      [eventId],
    ),
    query<{ token: string; created_at: Date }>('SELECT token, created_at FROM rundown_shares WHERE event_id = $1 ORDER BY created_at DESC LIMIT 5', [eventId]),
  ])
  return [
    ...versions.map((v): Source => ({
      key: `version:${v.number}`,
      category: 'rundown',
      title: `Rundown v${v.number} diaktifkan`,
      description: clip(`${v.note?.trim() || 'Pengaturan rundown diperbarui'}${v.actor ? ` oleh ${v.actor}` : ''}.`, 200),
      at: iso(v.created_at),
      href: '/history',
    })),
    ...shares.map((s): Source => ({
      key: `share:${s.token.slice(0, 12)}`,
      category: 'rundown',
      title: 'Tautan publik rundown dibuat',
      description: 'Siapa pun yang memegang tautan dapat melihat rundown aktif tanpa login.',
      at: iso(s.created_at),
      href: '/',
    })),
  ]
}

async function team(eventId: string): Promise<Source[]> {
  const rows = await query<{ actor_id: string; display_name: string; joined_at: Date }>(
    `SELECT a.id AS actor_id, a.display_name, u.created_at AS joined_at
       FROM users u JOIN actors a ON a.id = u.actor_id WHERE a.event_id = $1
     UNION ALL
     SELECT a.id, a.display_name, m.created_at
       FROM event_members m JOIN actors a ON a.id = m.actor_id WHERE m.event_id = $1
     ORDER BY joined_at DESC LIMIT 10`,
    [eventId],
  )
  return rows.map((r) => ({
    key: `team:${r.actor_id}`,
    category: 'team',
    title: `${clip(r.display_name, 80)} bergabung ke tim`,
    description: 'Akun ini kini dapat membuka rundown acara dan menerima ringkasan perubahan.',
    at: iso(r.joined_at),
    href: '/settings',
  }))
}

async function sources(eventId: string): Promise<Source[]> {
  const event = await getEvent(eventId)
  const snapshot = await getSnapshot(eventId, event.active_version)
  const groups = await Promise.all([
    pendingChanges(eventId),
    decisions(eventId, snapshot.event.timezone),
    acknowledgements(eventId),
    rundownActivity(eventId),
    team(eventId),
  ])
  return [...groups.flat(), ...reminderNotifications(snapshot, serverNow(event.sim_clock_at), Date.now())]
}

async function readKeys(eventId: string, actorId: string): Promise<Set<string>> {
  const rows = await query<{ notification_key: string }>('SELECT notification_key FROM notification_reads WHERE event_id = $1 AND actor_id = $2', [eventId, actorId])
  return new Set(rows.map((r) => r.notification_key))
}

export async function notificationFeed(session: Session, eventId: string, filter: 'all' | 'unread' = 'all'): Promise<NotificationFeed> {
  requireEvent(session, eventId)
  const [items, read] = await Promise.all([sources(eventId), readKeys(eventId, session.actor_id)])
  return buildFeed(items, read, filter)
}

/** Tandai dibaca: kunci tertentu, atau semua notifikasi di feed saat ini ("Tandai semua dibaca"). */
export async function markNotificationsRead(session: Session, eventId: string, input: { keys?: string[]; all?: boolean }): Promise<NotificationFeed> {
  requireEvent(session, eventId)
  const current = buildFeed(await sources(eventId), new Set())
  const valid = new Set(current.items.map((item) => item.key))
  const keys = input.all ? [...valid] : (input.keys ?? []).filter((key) => valid.has(key))
  if (!input.all && !keys.length) throw new AppError('VALIDATION_ERROR', 'Notifikasi tidak ditemukan.')
  if (keys.length) {
    await query(
      `INSERT INTO notification_reads (event_id, actor_id, notification_key)
       SELECT $1, $2, unnest($3::text[]) ON CONFLICT DO NOTHING`,
      [eventId, session.actor_id, keys],
    )
  }
  return buildFeed(current.items, await readKeys(eventId, session.actor_id))
}
