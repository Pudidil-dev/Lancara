import { serverNow } from '@/lib/clock'
import { query, withTransaction } from '@/lib/db'
import { AppError } from '@/lib/errors'
import { requireCoordinator, requireEvent, type Session } from '@/lib/session'
import { getEvent } from '@/modules/events/service'
import type { BriefPayload } from './render'

interface BriefRow {
  id: string
  decision_id: string
  change_id: string
  version: number
  recipient_role_id: string
  level: 'ACTION_REQUIRED' | 'FYI'
  payload: BriefPayload
  rendered: string
  created_at: Date
  acknowledged_at: Date | null
  ack_by: string | null
}

/** Akun utama membaca semua brief PIC acara. Supersession tetap terikat penerima dan item. */
export async function inbox(session: Session, eventId: string) {
  requireEvent(session, eventId)
  requireCoordinator(session)
  const event = await getEvent(eventId)
  const rows = await query<BriefRow>(
    `SELECT b.id, b.decision_id, b.change_id, b.version, b.recipient_role_id, b.level, b.payload, b.rendered, b.created_at,
            k.acknowledged_at, a.display_name AS ack_by
       FROM briefs b
       LEFT JOIN acknowledgements k ON k.brief_id = b.id AND k.role_id = b.recipient_role_id
       LEFT JOIN actors a ON a.id = k.actor_id
      WHERE b.event_id = $1
      ORDER BY b.version DESC
      LIMIT 50`,
    [eventId],
  )
  const briefs = rows.map((b) => {
    const items = new Set(b.payload.entries.map((e) => e.item_id))
    const newer = rows.find((o) => o.recipient_role_id === b.recipient_role_id && o.version > b.version && o.payload.entries.some((e) => items.has(e.item_id)))
    return { ...b, superseded_by: newer ? { id: newer.id, version: newer.version, change_seq: newer.payload.change_seq } : null }
  })
  return {
    role: { id: session.role_id, label: session.role_label },
    scope: 'event' as const,
    active_version: event.active_version,
    server_now: serverNow(event.sim_clock_at),
    unread: briefs.filter((b) => !b.acknowledged_at).length,
    briefs,
  }
}

/** "Sudah dibaca": unik per (brief, role); klik berulang tidak menggandakan; tidak menutup revisi lain. */
export async function acknowledge(session: Session, briefId: string) {
  requireCoordinator(session)
  if (!/^[0-9a-f-]{36}$/i.test(briefId)) throw new AppError('NOT_FOUND', 'Brief tidak ditemukan.')
  return withTransaction(async (client) => {
    const brief = await client.query<{ id: string; event_id: string; recipient_role_id: string; change_id: string; version: number; seq: number }>(
      `SELECT b.id, b.event_id, b.recipient_role_id, b.change_id, b.version, c.seq FROM briefs b JOIN changes c ON c.id = b.change_id WHERE b.id = $1`,
      [briefId],
    )
    const row = brief.rows[0]
    if (!row || row.event_id !== session.event_id) throw new AppError('NOT_FOUND', 'Brief tidak ditemukan.')
    await client.query(`INSERT INTO acknowledgements (brief_id, role_id, actor_id) VALUES ($1, $2, $3) ON CONFLICT (brief_id, role_id) DO NOTHING`, [
      row.id,
      row.recipient_role_id,
      session.actor_id,
    ])
    const ack = await client.query<{ acknowledged_at: Date }>('SELECT acknowledged_at FROM acknowledgements WHERE brief_id = $1 AND role_id = $2', [row.id, row.recipient_role_id])
    return { brief_id: row.id, change_id: row.change_id, change_seq: Number(row.seq), version: row.version, acknowledged_at: ack.rows[0].acknowledged_at }
  })
}

/** Riwayat keputusan + versi + status ack per peran (koordinator). */
export async function history(session: Session, eventId: string) {
  requireEvent(session, eventId)
  requireCoordinator(session)
  const event = await getEvent(eventId)
  const decisions = await query<Record<string, unknown>>(
    `SELECT d.id, d.change_id, d.reason, d.base_version, d.new_version, d.approved_at, ap.display_name AS approved_by,
            c.seq, c.kind, c.original_text, c.confirmed_delta->>'type' AS delta_type, c.corrects_decision_id, c.compensates_decision_id,
            rp.display_name AS reported_by, p.label AS patch_label, p.diff,
            COALESCE(json_agg(json_build_object(
              'brief_id', b.id, 'role_id', b.recipient_role_id, 'role_label', r.label, 'level', b.level, 'version', b.version,
              'acknowledged_at', k.acknowledged_at, 'ack_by', ka.display_name
            ) ORDER BY b.level, b.recipient_role_id) FILTER (WHERE b.id IS NOT NULL), '[]') AS acks
       FROM decisions d
       JOIN changes c ON c.id = d.change_id
       JOIN patches p ON p.id = d.patch_id
       JOIN actors ap ON ap.id = d.actor_id
       JOIN actors rp ON rp.id = c.actor_id
       LEFT JOIN briefs b ON b.decision_id = d.id
       LEFT JOIN roles r ON r.event_id = b.event_id AND r.id = b.recipient_role_id
       LEFT JOIN acknowledgements k ON k.brief_id = b.id AND k.role_id = b.recipient_role_id
       LEFT JOIN actors ka ON ka.id = k.actor_id
      WHERE d.event_id = $1
      GROUP BY d.id, ap.display_name, c.id, rp.display_name, p.label, p.diff
      ORDER BY d.new_version DESC`,
    [eventId],
  )
  const versions = await query<Record<string, unknown>>(
    `SELECT v.number, v.parent_number, v.source, v.note, v.created_at, a.display_name AS actor_name
       FROM versions v LEFT JOIN actors a ON a.id = v.actor_id WHERE v.event_id = $1 ORDER BY v.number DESC`,
    [eventId],
  )
  const pending = await query<{ n: string }>(
    `SELECT count(*) AS n FROM briefs b LEFT JOIN acknowledgements k ON k.brief_id = b.id AND k.role_id = b.recipient_role_id
      WHERE b.event_id = $1 AND k.id IS NULL`,
    [eventId],
  )
  return { event: { id: event.id, name: event.name, timezone: event.timezone, active_version: event.active_version }, decisions, versions, pending_acks: Number(pending[0].n) }
}
