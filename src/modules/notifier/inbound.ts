import { z } from 'zod'
import type { Db } from '@/lib/db'
import { query, withTransaction } from '@/lib/db'
import { env } from '@/lib/env'
import { AppError } from '@/lib/errors'
import { log } from '@/lib/logger'
import { consumeAccountLink, consumeGroupCode, hashLinkSecret, type TelegramIdentity } from './linking'
import { telegramClient, type TelegramClient } from './telegram-client'

export const TelegramUpdateSchema = z.object({ update_id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).passthrough()
type Payload = {
  kind: 'ignored' | 'account_link' | 'group_register' | 'invalid_start' | 'anonymous_start' | 'start_help' | 'migrate' | 'bot_removed' | 'private_status'
  chat_id?: string
  identity?: TelegramIdentity
  secret_hash?: string
  title?: string
  new_chat_id?: string
  private_status?: 'active' | 'blocked'
}
interface UpdateRow { update_id: string; payload: Payload }
interface Reply { chat_id: string; text: string }
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const id = (value: unknown, positive = false): string | null => typeof value === 'number' && Number.isSafeInteger(value) && value !== 0 && (!positive || value > 0) ? String(value) : null
const text = (value: unknown, max: number): string => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max) : ''

/** Drop arbitrary chatter and hash deep-link credentials before persistence. */
function minimalPayload(raw: Record<string, unknown>): Payload {
  const message = object(raw.message)
  const chat = object(message.chat)
  const chatId = id(chat.id)
  const group = chat.type === 'group' || chat.type === 'supergroup'
  if (chatId && group && id(message.migrate_to_chat_id)) return { kind: 'migrate', chat_id: chatId, new_chat_id: id(message.migrate_to_chat_id)! }
  const member = object(raw.my_chat_member)
  const memberChat = object(member.chat)
  const membership = object(member.new_chat_member)
  const bot = object(membership.user)
  const expectedBot = env().TELEGRAM_BOT_USERNAME?.toLowerCase()
  if (id(memberChat.id) && bot.is_bot === true && typeof bot.username === 'string' && bot.username.toLowerCase() === expectedBot) {
    const memberChatId = id(memberChat.id)!
    if ((memberChat.type === 'group' || memberChat.type === 'supergroup') && (membership.status === 'left' || membership.status === 'kicked')) return { kind: 'bot_removed', chat_id: memberChatId }
    if (memberChat.type === 'private' && (membership.status === 'kicked' || membership.status === 'member')) return { kind: 'private_status', chat_id: memberChatId, private_status: membership.status === 'kicked' ? 'blocked' : 'active' }
  }
  if (!chatId || typeof message.text !== 'string' || message.text.length > 200) return { kind: 'ignored' }
  const match = /^\/start(?:@([A-Za-z][A-Za-z0-9_]{4,31}))?(?:\s+([^\s]+))?\s*$/.exec(message.text)
  if (!match || (match[1] && match[1].toLowerCase() !== expectedBot)) return { kind: 'ignored' }
  if (group && !match[1]) return { kind: 'ignored' }
  if (chat.type !== 'private' && !group) return { kind: 'ignored' }
  if (message.sender_chat) return group ? { kind: 'anonymous_start', chat_id: chatId } : { kind: 'ignored' }
  const from = object(message.from)
  const userId = id(from.id, true)
  if (!userId || from.is_bot !== false || (chat.type === 'private' && userId !== chatId)) return { kind: 'ignored' }
  const identity = { id: userId, username: text(from.username, 32) || null, display: [text(from.first_name, 100), text(from.last_name, 100)].filter(Boolean).join(' ').slice(0, 200) }
  if (!match[2]) return chat.type === 'private' ? { kind: 'start_help', chat_id: chatId, identity } : { kind: 'ignored' }
  const expectedLength = group ? 22 : 32
  if (!new RegExp(`^[A-Za-z0-9_-]{${expectedLength}}$`).test(match[2])) return { kind: 'invalid_start', chat_id: chatId, identity }
  return { kind: group ? 'group_register' : 'account_link', chat_id: chatId, identity, secret_hash: hashLinkSecret(match[2]), ...(group ? { title: text(chat.title, 200) } : {}) }
}

/** Persist before returning webhook 200; duplicate update IDs never repeat the mutation. */
export async function receiveUpdate(raw: unknown): Promise<{ accepted: boolean; update_id: string }> {
  const parsed = TelegramUpdateSchema.safeParse(raw)
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Update Telegram tidak valid.')
  const payload = minimalPayload(parsed.data)
  const rows = await query<{ update_id: string }>(
    `INSERT INTO telegram_updates (update_id, kind, status, payload, processed_at)
      VALUES ($1, $2, $3, $4::jsonb, CASE WHEN $3 = 'ignored' THEN now() ELSE NULL END)
      ON CONFLICT (update_id) DO NOTHING RETURNING update_id`,
    [parsed.data.update_id, payload.kind, payload.kind === 'ignored' ? 'ignored' : 'received', JSON.stringify(payload)],
  )
  return { accepted: rows.length > 0, update_id: String(parsed.data.update_id) }
}

async function limitedReply(client: Db, chatId: string, message: string): Promise<Reply | null> {
  // Persistent, transaction-safe rate limit shared by webhook, polling and cron workers.
  await query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`telegram-invalid:${chatId}`], client)
  const recent = await query('SELECT id FROM telegram_audit WHERE action = $1 AND target = $2 AND at > now() - interval \'1 minute\' LIMIT 1', ['invalid_code_reply', chatId], client)
  if (recent.length) return null
  await query('INSERT INTO telegram_audit (action, target) VALUES ($1, $2)', ['invalid_code_reply', chatId], client)
  return { chat_id: chatId, text: message }
}

async function mutate(client: Db, payload: Payload): Promise<Reply | null> {
  const chatId = payload.chat_id!
  if (payload.identity) {
    await query('UPDATE telegram_accounts SET username_snapshot = $2, display_snapshot = $3, last_seen_at = now() WHERE telegram_user_id = $1', [payload.identity.id, payload.identity.username, payload.identity.display], client)
  }
  if (payload.kind === 'account_link') {
    const username = await consumeAccountLink(client, payload.secret_hash!, payload.identity!)
    if (username) return { chat_id: chatId, text: `Akun Telegram terhubung ke ${username}. Bot ini hanya mengirim notifikasi rundown.` }
    return limitedReply(client, chatId, 'Kode tidak berlaku. Buat kode baru dari aplikasi.')
  }
  if (payload.kind === 'group_register') {
    const name = await consumeGroupCode(client, payload.secret_hash!, { id: chatId, title: payload.title ?? '', from_id: payload.identity!.id })
    if (name) return { chat_id: chatId, text: `Grup terdaftar untuk ${name.slice(0, 200)}, menunggu persetujuan koordinator di aplikasi.` }
    return limitedReply(client, chatId, 'Kode tidak berlaku. Buat kode baru dari aplikasi.')
  }
  if (payload.kind === 'invalid_start') return limitedReply(client, chatId, 'Kode tidak berlaku. Buat kode baru dari aplikasi.')
  if (payload.kind === 'anonymous_start') return limitedReply(client, chatId, 'Nonaktifkan mode admin anonim, lalu buka kembali tautan grup dari aplikasi.')
  if (payload.kind === 'start_help') return limitedReply(client, chatId, 'Bot ini hanya mengirim notifikasi rundown Lancara. Hubungkan akun dari aplikasi.')
  if (payload.kind === 'private_status') {
    await query('UPDATE telegram_accounts SET private_status = $2, last_seen_at = now() WHERE telegram_user_id = $1', [chatId, payload.private_status], client)
    return null
  }
  if (payload.kind === 'bot_removed') {
    const groups = await query<{ id: string; event_id: string }>(
      `UPDATE telegram_groups SET status = 'bot_removed' WHERE chat_id = $1 AND status <> 'revoked' RETURNING id, event_id`, [chatId], client,
    )
    for (const group of groups) {
      await query(`UPDATE notification_deliveries SET status = 'skipped', error_code = 'bot_removed' WHERE group_id = $1 AND status IN ('queued', 'retry', 'ambiguous')`, [group.id], client)
      await query('INSERT INTO telegram_audit (event_id, action, target) VALUES ($1, $2, $3)', [group.event_id, 'bot_removed', group.id], client)
    }
    return null
  }
  if (payload.kind === 'migrate') {
    await query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`telegram-migrate:${chatId}`], client)
    const groups = await query<{ id: string; event_id: string }>('UPDATE telegram_groups SET chat_id = $2 WHERE chat_id = $1 RETURNING id, event_id', [chatId, payload.new_chat_id], client)
    for (const group of groups) {
      await query(`UPDATE notification_deliveries SET chat_id = $2 WHERE group_id = $1 AND status IN ('queued', 'retry', 'ambiguous')`, [group.id, payload.new_chat_id], client)
      await query('INSERT INTO telegram_audit (event_id, action, target) VALUES ($1, $2, $3)', [group.event_id, 'group_migrated', group.id], client)
    }
  }
  return null
}

export async function processPendingUpdates(options: { client?: TelegramClient; limit?: number; update_id?: string; deadline?: number } = {}): Promise<{ processed: number; failed: number }> {
  let processed = 0
  let failed = 0
  const limit = Math.min(30, Math.max(1, options.limit ?? 10))
  for (let i = 0; i < limit; i++) {
    if (options.deadline !== undefined && options.deadline - Date.now() < 10_500) break
    let updateId: string | null = null
    try {
      const result = await withTransaction(async client => {
        // A busy coordinator transaction must not consume the webhook/cron execution budget.
        await client.query("SET LOCAL lock_timeout = '2s'")
        await client.query("SET LOCAL statement_timeout = '5s'")
        const rows = await query<UpdateRow>(
          `SELECT update_id, payload FROM telegram_updates WHERE status IN ('received', 'failed')
            AND ($1::bigint IS NULL OR update_id = $1) ORDER BY received_at, update_id FOR UPDATE SKIP LOCKED LIMIT 1`, [options.update_id ?? null], client,
        )
        if (!rows.length) return null
        updateId = rows[0].update_id
        const reply = await mutate(client, rows[0].payload)
        await query(`UPDATE telegram_updates SET status = 'processed', processed_at = now() WHERE update_id = $1`, [updateId], client)
        return { reply, kind: rows[0].payload.kind }
      })
      if (!result) break
      processed++
      log('info', 'telegram.update', { update_id: updateId, kind: result.kind, status: 'processed' })
      if (result.reply) {
        // Mutation already committed. A reply failure must never undo or repeat linking.
        if (options.deadline !== undefined && options.deadline - Date.now() < 10_500) break
        try { await (options.client ?? telegramClient()).sendMessage(result.reply) } catch { /* Never expose raw transport errors. */ }
      }
    } catch {
      failed++
      if (updateId) await query(`UPDATE telegram_updates SET status = 'failed' WHERE update_id = $1 AND status = 'received'`, [updateId]).catch(() => undefined)
      log('error', 'telegram.update', { update_id: updateId, status: 'failed' })
      // A persistent failure waits for the next cron invocation rather than looping this row.
      break
    }
  }
  return { processed, failed }
}

export async function handleUpdate(raw: unknown, options: { client?: TelegramClient } = {}): Promise<{ accepted: boolean; update_id: string }> {
  const received = await receiveUpdate(raw)
  if (received.accepted) await processPendingUpdates({ ...options, update_id: received.update_id, limit: 1 })
  return received
}
