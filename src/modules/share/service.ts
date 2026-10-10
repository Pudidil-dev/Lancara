// Tautan publik rundown: koordinator membuat/menonaktifkan; siapa pun dengan token dapat membaca versi aktif (hanya baca).
import { randomBytes } from 'node:crypto'
import { serverNow } from '@/lib/clock'
import { isUniqueViolation, query, withTransaction } from '@/lib/db'
import { AppError } from '@/lib/errors'
import { log } from '@/lib/logger'
import { requireCoordinator, requireEvent, type Session } from '@/lib/session'
import { endMs, isBreakItem } from '@/modules/engine/schedule'
import { getEvent, getSnapshot } from '@/modules/events/service'

export interface ShareLink { token: string; path: string; created_at: string }

const TOKEN = /^[A-Za-z0-9_-]{32}$/
const toLink = (row: { token: string; created_at: Date | string }): ShareLink => ({ token: row.token, path: `/share/${row.token}`, created_at: new Date(row.created_at).toISOString() })

async function activeShare(eventId: string): Promise<ShareLink | null> {
  const rows = await query<{ token: string; created_at: Date }>('SELECT token, created_at FROM rundown_shares WHERE event_id = $1 AND revoked_at IS NULL', [eventId])
  return rows[0] ? toLink(rows[0]) : null
}

export async function getShare(session: Session, eventId: string): Promise<{ share: ShareLink | null }> {
  requireEvent(session, eventId)
  requireCoordinator(session)
  return { share: await activeShare(eventId) }
}

/** Idempoten: bila tautan aktif sudah ada, tautan itu yang dikembalikan. */
export async function createShare(session: Session, eventId: string): Promise<{ share: ShareLink }> {
  requireEvent(session, eventId)
  requireCoordinator(session)
  const existing = await activeShare(eventId)
  if (existing) return { share: existing }
  const token = randomBytes(24).toString('base64url')
  try {
    const rows = await query<{ token: string; created_at: Date }>('INSERT INTO rundown_shares (token, event_id, created_by) VALUES ($1, $2, $3) RETURNING token, created_at', [token, eventId, session.actor_id])
    log('info', 'share_created', { event_id: eventId })
    return { share: toLink(rows[0]) }
  } catch (error) {
    // Dua klik bersamaan: indeks unik menahan satu tautan aktif; kembalikan yang menang.
    if (isUniqueViolation(error)) {
      const winner = await activeShare(eventId)
      if (winner) return { share: winner }
    }
    throw error
  }
}

export async function revokeShare(session: Session, eventId: string): Promise<{ revoked: boolean }> {
  requireEvent(session, eventId)
  requireCoordinator(session)
  const rows = await query<{ token: string }>('UPDATE rundown_shares SET revoked_at = now() WHERE event_id = $1 AND revoked_at IS NULL RETURNING token', [eventId])
  if (rows.length) log('info', 'share_revoked', { event_id: eventId })
  return { revoked: rows.length > 0 }
}

export interface PublicItem {
  id: string
  title: string
  start_at: string
  end_at: string
  duration_min: number
  segment: string | null
  pic: string[]
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  locked: boolean
}
export interface PublicRundown {
  event: { name: string; timezone: string; curfew_at: string }
  version: number
  server_now: string
  items: PublicItem[]
}

/**
 * Data publik sengaja dibatasi: jam, judul, tipe segmen, durasi, label peran PIC, status.
 * Catatan teknis, perlengkapan, resource, dependensi, kabar, dan identitas akun tidak pernah dikirim.
 */
export async function getPublicRundown(token: string): Promise<PublicRundown> {
  const notFound = new AppError('NOT_FOUND', 'Tautan rundown tidak ditemukan atau sudah dinonaktifkan.')
  if (!TOKEN.test(token)) throw notFound
  return withTransaction(async (client) => {
    const rows = await query<{ event_id: string }>('SELECT event_id FROM rundown_shares WHERE token = $1 AND revoked_at IS NULL', [token], client)
    if (!rows[0]) throw notFound
    const event = await getEvent(rows[0].event_id, client)
    const snapshot = await getSnapshot(event.id, event.active_version, client)
    const roles = new Map(snapshot.roles.map((r) => [r.id, r.label.replace(/^PIC\s+/i, '')]))
    const fixed = new Set(snapshot.constraints.filter((c) => c.type === 'fixed_start').map((c) => c.item_id))
    const items = [...snapshot.items]
      .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at) || a.id.localeCompare(b.id))
      .map((item): PublicItem => ({
        id: item.id,
        title: item.title,
        start_at: item.start_at,
        end_at: new Date(endMs(item)).toISOString(),
        duration_min: Math.round(item.duration_seconds / 60),
        segment: item.segment ?? null,
        pic: item.pic_text ? item.pic_text.split(/\s*,\s*/).filter(Boolean) : item.pic_role_ids.map((id) => roles.get(id) ?? id),
        status: item.status,
        locked: fixed.has(item.id) || isBreakItem(item),
      }))
    return { event: { name: snapshot.event.name, timezone: snapshot.event.timezone, curfew_at: snapshot.event.curfew_at }, version: event.active_version, server_now: serverNow(event.sim_clock_at), items }
  })
}
