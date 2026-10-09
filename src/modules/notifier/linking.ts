import { createHash, randomBytes } from 'node:crypto'
import type { Db } from '@/lib/db'
import { isUniqueViolation, query, withTransaction } from '@/lib/db'
import { env } from '@/lib/env'
import { AppError } from '@/lib/errors'
import { requireCoordinator, requireEvent, type Session } from '@/lib/session'

export const hashLinkSecret = (value: string): string => createHash('sha256').update(value).digest('hex')

function botUsername(): string {
  const cfg = env()
  if (!cfg.TELEGRAM_ENABLED || !cfg.TELEGRAM_BOT_USERNAME) throw new AppError('INVALID_STATE', 'Notifikasi Telegram belum diaktifkan.')
  return cfg.TELEGRAM_BOT_USERNAME
}

export async function createAccountLink(userId: string): Promise<{ link: string; expires_at: string }> {
  const username = botUsername()
  const token = randomBytes(24).toString('base64url')
  const rows = await query<{ expires_at: Date }>(
    `INSERT INTO telegram_link_tokens (token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + interval '15 minutes') RETURNING expires_at`, [hashLinkSecret(token), userId],
  )
  return { link: `https://t.me/${username}?start=${token}`, expires_at: rows[0].expires_at.toISOString() }
}

export async function createGroupCode(session: Session, eventId: string): Promise<{ link: string; expires_at: string }> {
  requireCoordinator(session)
  requireEvent(session, eventId)
  const username = botUsername()
  const code = randomBytes(16).toString('base64url')
  const expires_at = await withTransaction(async client => {
    const rows = await query<{ expires_at: Date }>(
      `INSERT INTO telegram_group_codes (code_hash, event_id, created_by, expires_at)
       VALUES ($1, $2, $3, now() + interval '15 minutes') RETURNING expires_at`, [hashLinkSecret(code), eventId, session.actor_id], client,
    )
    await query('INSERT INTO telegram_audit (event_id, actor_id, action) VALUES ($1, $2, $3)', [eventId, session.actor_id, 'group_code_created'], client)
    return rows[0].expires_at.toISOString()
  })
  return { link: `https://t.me/${username}?startgroup=${code}`, expires_at }
}

export interface TelegramIdentity { id: string; username: string | null; display: string }

/** Called within the update transaction: token consumption and account mutation commit together. */
export async function consumeAccountLink(client: Db, tokenHash: string, identity: TelegramIdentity): Promise<string | null> {
  const candidates = await query<{ user_id: string }>(
    `SELECT user_id FROM telegram_link_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`, [tokenHash], client,
  )
  if (!candidates.length) return null
  // All account changes lock the application user first, including UI unlink/relink.
  await query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [candidates[0].user_id], client)
  const tokens = await query<{ user_id: string; username: string }>(
    `SELECT t.user_id, u.username FROM telegram_link_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > now() FOR UPDATE OF t`, [tokenHash], client,
  )
  if (!tokens.length) return null
  // Serialize competing users linking the same Telegram ID before checking its owner.
  await query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`telegram-account:${identity.id}`], client)
  const owner = await query<{ user_id: string }>('SELECT user_id FROM telegram_accounts WHERE telegram_user_id = $1', [identity.id], client)
  if (owner.length && owner[0].user_id !== tokens[0].user_id) return null
  await query('SAVEPOINT telegram_account_link', [], client)
  try {
    await query(
      `INSERT INTO telegram_accounts (user_id, telegram_user_id, username_snapshot, display_snapshot, last_seen_at)
       VALUES ($1, $2, $3, $4, now()) ON CONFLICT (user_id) DO UPDATE SET
         telegram_user_id = EXCLUDED.telegram_user_id, username_snapshot = EXCLUDED.username_snapshot,
         display_snapshot = EXCLUDED.display_snapshot, private_status = 'active', linked_at = now(), last_seen_at = now()`,
      [tokens[0].user_id, identity.id, identity.username, identity.display], client,
    )
  } catch (error) {
    await query('ROLLBACK TO SAVEPOINT telegram_account_link', [], client)
    if (isUniqueViolation(error)) return null
    throw error
  }
  // Supersede every outstanding token, so a stale deep link cannot replace this identity later.
  await query('UPDATE telegram_link_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [tokens[0].user_id], client)
  await query('INSERT INTO telegram_audit (action, target, telegram_user_id) VALUES ($1, $2, $3)', ['account_linked', tokens[0].user_id, identity.id], client)
  return tokens[0].username
}

export async function consumeGroupCode(client: Db, codeHash: string, chat: { id: string; title: string; from_id: string }): Promise<string | null> {
  const codes = await query<{ event_id: string; name: string }>(
    `SELECT c.event_id, e.name FROM telegram_group_codes c JOIN events e ON e.id = c.event_id
      WHERE c.code_hash = $1 AND c.used_at IS NULL AND c.expires_at > now() FOR UPDATE OF c`, [codeHash], client,
  )
  if (!codes.length) return null
  await query(
    `INSERT INTO telegram_groups (event_id, chat_id, title_snapshot, status, added_by_tg_user_id)
       VALUES ($1, $2, $3, 'pending', $4) ON CONFLICT (event_id, chat_id) DO UPDATE SET
         title_snapshot = EXCLUDED.title_snapshot, added_by_tg_user_id = EXCLUDED.added_by_tg_user_id,
         status = CASE WHEN telegram_groups.status = 'approved' THEN 'approved' ELSE 'pending' END,
         revoked_at = NULL`, [codes[0].event_id, chat.id, chat.title, chat.from_id], client,
  )
  await query('UPDATE telegram_group_codes SET used_at = now(), used_chat_id = $2 WHERE code_hash = $1', [codeHash, chat.id], client)
  await query('INSERT INTO telegram_audit (event_id, action, target, telegram_user_id) VALUES ($1, $2, $3, $4)', [codes[0].event_id, 'group_registered', chat.id, chat.from_id], client)
  return codes[0].name
}
