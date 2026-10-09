import { query, withTransaction, type Db } from '@/lib/db'
import { env } from '@/lib/env'
import { AppError } from '@/lib/errors'
import { idempotent } from '@/lib/idempotency'
import { requireCoordinator, requireEvent, type Session } from '@/lib/session'
import { createAccountLink, createGroupCode } from './linking'
import type { TelegramGroup } from './types'

function access(session: Session, eventId: string) {
  requireCoordinator(session)
  requireEvent(session, eventId)
}

function enabled() {
  if (!env().TELEGRAM_ENABLED) throw new AppError('INVALID_STATE', 'Notifikasi Telegram belum diaktifkan.')
}

async function userFor(session: Session, db?: Db) {
  const rows = await query<{ id: string }>('SELECT id FROM users WHERE actor_id = $1', [session.actor_id], db)
  return rows[0]?.id ?? null
}

async function requireUser(session: Session, db?: Db) {
  const id = await userFor(session, db)
  if (!id) throw new AppError('INVALID_STATE', 'Hubungkan Telegram melalui akun terdaftar. Akun demo belum memiliki profil pengguna.')
  return id
}

export async function listGroups(session: Session, eventId: string) {
  access(session, eventId)
  return { enabled: env().TELEGRAM_ENABLED, groups: await query<TelegramGroup>('SELECT id, event_id, chat_id, message_thread_id, title_snapshot, status, include_public_link, created_at FROM telegram_groups WHERE event_id = $1 ORDER BY created_at DESC', [eventId]) }
}

export async function groupCode(session: Session, eventId: string) {
  access(session, eventId)
  enabled()
  return createGroupCode(session, eventId)
}

export async function updateGroup(session: Session, eventId: string, groupId: string, input: { action: 'approve' | 'revoke'; include_public_link?: boolean; message_thread_id?: number | null }) {
  access(session, eventId)
  return withTransaction(async client => {
    const groups = await query<TelegramGroup>('SELECT * FROM telegram_groups WHERE id = $1 AND event_id = $2 FOR UPDATE', [groupId, eventId], client)
    const group = groups[0]
    if (!group) throw new AppError('NOT_FOUND', 'Grup tidak ditemukan pada acara ini.')
    if (input.action === 'approve' && !['pending', 'approved'].includes(group.status)) throw new AppError('INVALID_STATE', 'Daftarkan kembali grup dengan kode baru sebelum menyetujui.')
    const status = input.action === 'approve' ? 'approved' : 'revoked'
    const changed = group.status !== status
    const result = await client.query<TelegramGroup>(
      `UPDATE telegram_groups SET status = $3,
         include_public_link = COALESCE($4, include_public_link),
         message_thread_id = CASE WHEN $5 THEN $6 ELSE message_thread_id END,
         approved_by = CASE WHEN $3 = 'approved' THEN $7 ELSE approved_by END,
         approved_at = CASE WHEN $3 = 'approved' THEN COALESCE(approved_at, now()) ELSE approved_at END,
         revoked_at = CASE WHEN $3 = 'revoked' THEN now() ELSE NULL END
       WHERE id = $1 AND event_id = $2 RETURNING *`,
      [groupId, eventId, status, input.include_public_link, 'message_thread_id' in input, input.message_thread_id ?? null, session.actor_id],
    )
    if (status === 'revoked') await client.query("UPDATE notification_deliveries SET status = 'skipped', error_code = 'group_revoked' WHERE group_id = $1 AND status IN ('queued','retry','ambiguous')", [groupId])
    if (changed || input.include_public_link !== undefined || input.message_thread_id !== undefined) await client.query(
      'INSERT INTO telegram_audit (event_id, actor_id, action, target) VALUES ($1, $2, $3, $4)',
      [eventId, session.actor_id, status === 'approved' ? 'group_approved' : 'group_revoked', groupId],
    )
    return result.rows[0]
  })
}

export async function myTelegram(session: Session) {
  const userId = await userFor(session)
  if (!userId) return { enabled: env().TELEGRAM_ENABLED, registered: false, account: null, pic_roles: [] }
  const [accounts, roles] = await Promise.all([
    query('SELECT telegram_user_id, username_snapshot, display_snapshot, private_status, linked_at FROM telegram_accounts WHERE user_id = $1', [userId]),
    query('SELECT event_id, role_id FROM member_pic_roles WHERE user_id = $1 ORDER BY event_id, role_id', [userId]),
  ])
  return { enabled: env().TELEGRAM_ENABLED, registered: true, account: accounts[0] ?? null, pic_roles: roles }
}

export async function accountLink(session: Session) {
  enabled()
  return createAccountLink(await requireUser(session))
}

export async function unlinkAccount(session: Session) {
  return withTransaction(async client => {
    const userId = await requireUser(session, client)
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId])
    const removed = await client.query('DELETE FROM telegram_accounts WHERE user_id = $1 RETURNING telegram_user_id', [userId])
    await client.query('DELETE FROM telegram_link_tokens WHERE user_id = $1', [userId])
    if (removed.rowCount) await client.query('INSERT INTO telegram_audit (event_id, actor_id, action, target) VALUES ($1,$2,$3,$4)', [session.event_id, session.actor_id, 'account_unlinked', userId])
    return { unlinked: true }
  })
}

export async function setPicRoles(session: Session, input: { event_id: string; role_ids: string[] }) {
  requireEvent(session, input.event_id)
  return withTransaction(async client => {
    const userId = await requireUser(session, client)
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId])
    const known = await query<{ id: string }>('SELECT id FROM roles WHERE event_id = $1', [input.event_id], client)
    if (input.role_ids.some(id => !known.some(role => role.id === id))) throw new AppError('VALIDATION_ERROR', 'Peran PIC tidak tersedia pada acara ini.')
    await client.query('DELETE FROM member_pic_roles WHERE user_id = $1 AND event_id = $2', [userId, input.event_id])
    for (const roleId of new Set(input.role_ids)) await client.query('INSERT INTO member_pic_roles (user_id, event_id, role_id) VALUES ($1,$2,$3)', [userId, input.event_id, roleId])
    await client.query('INSERT INTO telegram_audit (event_id, actor_id, action, target) VALUES ($1,$2,$3,$4)', [input.event_id, session.actor_id, 'pic_roles_updated', userId])
    return { role_ids: [...new Set(input.role_ids)] }
  })
}

export async function notificationLog(session: Session, eventId: string, limit: number) {
  access(session, eventId)
  const outboxes = await query<{ id: string } & Record<string, unknown>>(
    `SELECT id, version, payload->>'origin' AS origin, status, summary_text, summary_source, created_at
       FROM notification_outbox WHERE event_id = $1 ORDER BY version DESC LIMIT $2`, [eventId, limit],
  )
  const deliveries = outboxes.length ? await query<{ outbox_id: string } & Record<string, unknown>>(
    `SELECT d.id, d.outbox_id, d.group_id, g.title_snapshot AS group_title, d.status, d.attempts,
            d.error_code, d.sent_at, d.telegram_message_id
       FROM notification_deliveries d JOIN telegram_groups g ON g.id = d.group_id
      WHERE d.outbox_id = ANY($1::uuid[]) ORDER BY d.created_at`, [outboxes.map(outbox => outbox.id)],
  ) : []
  return { outboxes: outboxes.map(outbox => ({ ...outbox, deliveries: deliveries.filter(delivery => delivery.outbox_id === outbox.id) })) }
}

export async function retryDelivery(session: Session, eventId: string, deliveryId: string, input: { idempotency_key: string; action?: 'retry' | 'mark_sent' }) {
  access(session, eventId)
  return withTransaction(client => idempotent(client, { eventId, actorId: session.actor_id, operation: `notifier.retry:${deliveryId}`, key: input.idempotency_key, payload: input }, async () => {
    // Urutan lock grup → delivery sama dengan revoke dan pembaruan chat.
    await client.query(`SELECT g.id FROM telegram_groups g JOIN notification_deliveries d ON d.group_id = g.id
      JOIN notification_outbox o ON o.id = d.outbox_id WHERE d.id = $1 AND o.event_id = $2 FOR UPDATE OF g`, [deliveryId, eventId])
    const rows = await query<{ outbox_id: string; status: string; group_status: string; version: number; active_version: number }>(
      `SELECT d.outbox_id, d.status, g.status AS group_status, o.version, e.active_version FROM notification_deliveries d
       JOIN notification_outbox o ON o.id = d.outbox_id JOIN telegram_groups g ON g.id = d.group_id JOIN events e ON e.id = o.event_id
       WHERE d.id = $1 AND o.event_id = $2 FOR UPDATE OF d, o`, [deliveryId, eventId], client,
    )
    const delivery = rows[0]
    if (!delivery) throw new AppError('NOT_FOUND', 'Pengiriman tidak ditemukan pada acara ini.')
    if (!['dead', 'ambiguous'].includes(delivery.status)) throw new AppError('INVALID_STATE', 'Hanya pengiriman gagal atau belum pasti yang dapat ditindaklanjuti.')
    const manualSent = input.action === 'mark_sent'
    if (!manualSent && delivery.version !== delivery.active_version) throw new AppError('STALE_VERSION', 'Notifikasi ini berasal dari rundown versi lama. Hanya versi aktif yang dapat dikirim.', { active_version: delivery.active_version })
    if (manualSent && delivery.status !== 'ambiguous') throw new AppError('INVALID_STATE', 'Konfirmasi manual hanya untuk pengiriman belum pasti.')
    if (!manualSent && delivery.group_status !== 'approved') throw new AppError('INVALID_STATE', 'Grup belum disetujui atau bot telah dikeluarkan.')
    await client.query(manualSent
      ? "UPDATE notification_deliveries SET status = 'sent', sent_at = now(), error_code = 'manually_confirmed', sending_started_at = NULL WHERE id = $1"
      : "UPDATE notification_deliveries SET status = 'retry', attempts = 0, ambiguous_retries = 0, error_code = NULL, next_attempt_at = now(), sending_started_at = NULL WHERE id = $1", [deliveryId])
    await client.query("UPDATE notification_outbox SET status = 'ready', completed_at = NULL WHERE id = $1", [delivery.outbox_id])
    await client.query('INSERT INTO telegram_audit (event_id, actor_id, action, target) VALUES ($1,$2,$3,$4)', [eventId, session.actor_id, manualSent ? 'delivery_confirmed_manual' : 'delivery_retried_manual', deliveryId])
    return { delivery_id: deliveryId, status: manualSent ? 'sent' : 'retry' }
  }))
}
