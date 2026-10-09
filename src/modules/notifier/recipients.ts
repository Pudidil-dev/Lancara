import { query, type Db } from '@/lib/db'
import { env } from '@/lib/env'
import type { Mention, MentionRecipients, NotificationPayload, TelegramGroup } from './types'

export async function resolveGroups(eventId: string, db?: Db): Promise<TelegramGroup[]> {
  return query<TelegramGroup>(`SELECT id, event_id, chat_id::text, message_thread_id::text,
    title_snapshot, status, include_public_link, created_at FROM telegram_groups
    WHERE event_id = $1 AND status = 'approved' ORDER BY created_at, id`, [eventId], db)
}

export async function resolveMentions(payload: NotificationPayload, db?: Db): Promise<MentionRecipients> {
  const roles = [...new Map(payload.impact.filter(role => role.level === 'ACTION_REQUIRED' || role.level === 'FYI')
    .map(role => [role.role_id, role.role_label])).entries()]
  if (!roles.length) return { mentions: [], unlinked_roles: [], additional_count: 0 }
  const rows = await query<{ role_id: string; telegram_user_id: string; display_name: string }>(`
    SELECT m.role_id, t.telegram_user_id::text,
      COALESCE(NULLIF(t.display_snapshot, ''), a.display_name, u.username) AS display_name
    FROM member_pic_roles m JOIN telegram_accounts t ON t.user_id = m.user_id
    JOIN users u ON u.id = m.user_id JOIN actors a ON a.id = u.actor_id
    WHERE m.event_id = $1 AND m.role_id = ANY($2::text[])
    ORDER BY m.role_id, t.telegram_user_id`, [payload.event.id, roles.map(([id]) => id)], db)
  const labels = new Map(roles)
  const linkedRoles = new Set<string>()
  const people = new Map<string, Mention>()
  for (const row of rows) {
    const label = labels.get(row.role_id)
    if (!label || !/^[1-9]\d*$/.test(row.telegram_user_id)) continue
    linkedRoles.add(row.role_id)
    const mention = people.get(row.telegram_user_id) ?? { telegram_user_id: row.telegram_user_id, display_name: row.display_name, role_labels: [] }
    if (!mention.role_labels.includes(label)) mention.role_labels.push(label)
    people.set(row.telegram_user_id, mention)
  }
  const mentions = [...people.values()]
  return { mentions: mentions.slice(0, 20), unlinked_roles: roles.filter(([id]) => !linkedRoles.has(id)).map(([, label]) => label),
    additional_count: Math.max(0, mentions.length - 20) }
}

/** A currently active share is the only public URL that may leave the application. */
export async function resolvePublicUrl(eventId: string, db?: Db): Promise<string | undefined> {
  const configured = env().APP_BASE_URL
  if (!configured) return undefined
  let base: URL
  try { base = new URL(configured) } catch { return undefined }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) return undefined
  const shares = await query<{ token: string }>('SELECT token FROM rundown_shares WHERE event_id = $1 AND revoked_at IS NULL LIMIT 1', [eventId], db)
  const token = shares[0]?.token
  if (!token || !/^[A-Za-z0-9_-]{32}$/.test(token)) return undefined
  return `${base.toString().replace(/\/$/, '')}/share/${token}`
}
