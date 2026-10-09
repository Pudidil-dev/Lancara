import { randomUUID } from 'node:crypto'
import { query, withTransaction, type Db } from '@/lib/db'
import { env } from '@/lib/env'
import { log } from '@/lib/logger'
import { processPendingUpdates } from './inbound'
import { plainText, renderMessage } from './render'
import { resolveGroups, resolveMentions, resolvePublicUrl } from './recipients'
import { summarize } from './summarize'
import { telegramClient, type TelegramClient } from './telegram-client'
import type { NotificationPayload, TelegramGroup } from './types'

const BACKOFF_SECONDS = [30, 120, 300, 900, 1800]
const TERMINAL = ['sent', 'skipped', 'dead']
interface Outbox { id: string; event_id: string; version: number; schema_version: number; payload: NotificationPayload; created_at: Date; attempts: number; summary_text: string | null; summary_source: 'llm' | 'template' | null }
interface Delivery { id: string; outbox_id: string; event_id: string; version: number; group_id: string; chat_id: string; message_thread_id: string | null; group_status: TelegramGroup['status']; status: string; attempts: number; ambiguous_retries: number; entities_fallback: boolean; rendered_text: string }
interface Stats { claimed: number; sent: number; retry: number; dead: number; pending_oldest_seconds: number }

export async function health() {
  const rows = await query<{ pending: number; ambiguous: number; dead_24h: number; oldest_pending_seconds: number }>(
    `SELECT (SELECT count(*)::int FROM notification_outbox WHERE status IN ('pending','ready')) AS pending,
      (SELECT count(*)::int FROM notification_deliveries WHERE status = 'ambiguous') AS ambiguous,
      (SELECT count(*)::int FROM notification_deliveries WHERE status = 'dead' AND created_at > now() - interval '24 hours') AS dead_24h,
      COALESCE((SELECT EXTRACT(epoch FROM now() - min(created_at))::int FROM notification_outbox WHERE status IN ('pending','ready')), 0) AS oldest_pending_seconds`,
  )
  return rows[0]
}

async function acquireLease() {
  const token = randomUUID()
  return withTransaction(async client => {
    const lock = await client.query<{ acquired: boolean }>('SELECT pg_try_advisory_xact_lock(726412) AS acquired')
    if (!lock.rows[0].acquired) return null
    const result = await client.query(
      `INSERT INTO notifier_worker_leases (name, token, locked_until) VALUES ('drain',$1,now() + interval '60 seconds')
       ON CONFLICT (name) DO UPDATE SET token = EXCLUDED.token, locked_until = EXCLUDED.locked_until
       WHERE notifier_worker_leases.locked_until < now() RETURNING token`, [token],
    )
    return result.rowCount ? token : null
  })
}

async function renewLease(token: string) {
  const rows = await query("UPDATE notifier_worker_leases SET locked_until = now() + interval '60 seconds' WHERE name = 'drain' AND token = $1 AND locked_until > now() RETURNING token", [token])
  return rows.length > 0
}

async function claimNextOutbox() {
  return withTransaction(async client => {
    const rows = await query<Outbox>(
      `SELECT o.* FROM notification_outbox o WHERE o.status = 'pending' AND o.available_at <= now()
       AND (o.locked_until IS NULL OR o.locked_until < now())
       AND NOT EXISTS (SELECT 1 FROM notification_outbox p WHERE p.event_id = o.event_id AND p.version < o.version AND p.status = 'pending')
       ORDER BY o.created_at, o.version LIMIT 1 FOR UPDATE SKIP LOCKED`, [], client,
    )
    if (!rows[0]) return null
    await client.query("UPDATE notification_outbox SET locked_until = now() + interval '60 seconds', attempts = attempts + 1 WHERE id = $1", [rows[0].id])
    return { ...rows[0], attempts: rows[0].attempts + 1 }
  })
}

async function prepare(outbox: Outbox) {
  if (Date.now() - outbox.created_at.getTime() > env().NOTIFIER_MAX_AGE_MIN * 60_000) {
    await query("UPDATE notification_outbox SET status = 'expired', locked_until = NULL, completed_at = now() WHERE id = $1", [outbox.id])
    return
  }
  const payload = outbox.payload
  if (outbox.schema_version !== 1 || payload?.schema_version !== 1 || payload.kind !== 'schedule.version.committed' || payload.event?.id !== outbox.event_id || payload.version !== outbox.version) {
    await query("UPDATE notification_outbox SET status = 'dead', last_error = 'schema_unsupported', completed_at = now(), locked_until = NULL WHERE id = $1", [outbox.id])
    return
  }
  const started = performance.now()
  const summary = outbox.summary_text ? { paragraph: outbox.summary_text, source: outbox.summary_source ?? 'template' as const } : await summarize(payload)
  await withTransaction(async client => {
    const groups = await resolveGroups(outbox.event_id, client)
    const recipients = await resolveMentions(payload, client)
    const publicUrl = await resolvePublicUrl(outbox.event_id, client)
    for (const group of groups) {
      const rendered = renderMessage({ payload, paragraph: summary.paragraph, recipients, ...(group.include_public_link ? { publicUrl } : {}) })
      await client.query(
        `INSERT INTO notification_deliveries (outbox_id, group_id, chat_id, rendered_text, mentioned_tg_ids)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (outbox_id,group_id) DO NOTHING`,
        [outbox.id, group.id, group.chat_id, rendered, recipients.mentions.map(mention => mention.telegram_user_id)],
      )
    }
    await client.query("UPDATE notification_outbox SET status = 'ready', summary_text = $2, summary_source = $3, locked_until = NULL, last_error = NULL WHERE id = $1", [outbox.id, summary.paragraph, summary.source])
  })
  log('info', 'notifier.summary', { outbox_id: outbox.id, source: summary.source, latency_ms: Math.round(performance.now() - started) })
}

async function recoverSending() {
  await query(`UPDATE notification_deliveries SET
    status = CASE WHEN ambiguous_retries >= 1 OR attempts >= 5 THEN 'dead' ELSE 'ambiguous' END,
    next_attempt_at = now() + interval '60 seconds', error_code = 'sending_interrupted'
    WHERE status = 'sending' AND sending_started_at < now() - interval '2 minutes'`)
}

async function reserveDelivery(): Promise<Delivery | 'deferred' | null> {
  return withTransaction(async client => {
    const rows = await query<Delivery>(
      `SELECT d.*, o.event_id, o.version, g.status AS group_status, g.message_thread_id FROM notification_deliveries d
       JOIN notification_outbox o ON o.id = d.outbox_id JOIN telegram_groups g ON g.id = d.group_id
       WHERE o.status = 'ready' AND d.status IN ('queued','retry','ambiguous') AND d.next_attempt_at <= now()
       AND NOT EXISTS (SELECT 1 FROM notification_deliveries p JOIN notification_outbox po ON po.id = p.outbox_id
          WHERE po.event_id = o.event_id AND po.version < o.version AND p.attempts = 0 AND p.status IN ('queued','retry'))
       ORDER BY o.version, d.created_at LIMIT 1 FOR UPDATE OF d, g SKIP LOCKED`, [], client,
    )
    const delivery = rows[0]
    if (!delivery) return null
    if (delivery.group_status !== 'approved') {
      await client.query("UPDATE notification_deliveries SET status = 'skipped', error_code = 'group_unavailable' WHERE id = $1", [delivery.id])
      return 'deferred'
    }
    if (delivery.attempts >= 5 || (delivery.status === 'ambiguous' && delivery.ambiguous_retries >= 1)) {
      await client.query("UPDATE notification_deliveries SET status = 'dead', error_code = 'retry_exhausted' WHERE id = $1", [delivery.id])
      return 'deferred'
    }
    const rate = (await query<{ chat_count: number; global_count: number; last_chat: Date | null; first_chat: Date | null; first_global: Date | null }>(
      `SELECT count(*) FILTER (WHERE target = $1)::int AS chat_count,
        count(*) FILTER (WHERE at > now() - interval '1 second')::int AS global_count,
        max(at) FILTER (WHERE target = $1) AS last_chat,
        min(at) FILTER (WHERE target = $1) AS first_chat,
        min(at) FILTER (WHERE at > now() - interval '1 second') AS first_global
       FROM telegram_audit WHERE action = 'delivery_attempt' AND at > now() - interval '60 seconds'`, [delivery.chat_id], client,
    ))[0]
    const next = Math.max(Date.now(), (rate.last_chat?.getTime() ?? 0) + 1100,
      rate.chat_count >= 18 ? (rate.first_chat?.getTime() ?? Date.now()) + 60_010 : 0,
      rate.global_count >= 25 ? (rate.first_global?.getTime() ?? Date.now()) + 1010 : 0)
    if (next > Date.now()) {
      await client.query('UPDATE notification_deliveries SET next_attempt_at = $2 WHERE id = $1', [delivery.id, new Date(next)])
      return 'deferred'
    }
    // Teks asli tetap tersimpan untuk retry. Penanda kirim ulang disisipkan saat pengiriman.
    const newer = await client.query(`SELECT 1 FROM notification_deliveries d JOIN notification_outbox o ON o.id = d.outbox_id
      WHERE o.event_id = $1 AND o.version > $2 AND d.status = 'sent' LIMIT 1`, [delivery.event_id, delivery.version])
    if (delivery.attempts > 0 && newer.rowCount) {
      delivery.rendered_text = delivery.entities_fallback
        ? delivery.rendered_text.replace(/^(Rundown v[^\n]+)/, '$1 (kirim ulang)')
        : delivery.rendered_text.replace('</b>', '</b> (kirim ulang)')
    }
    await client.query("UPDATE notification_deliveries SET status = 'sending', attempts = attempts + 1, ambiguous_retries = ambiguous_retries + $2, sending_started_at = now() WHERE id = $1", [delivery.id, delivery.status === 'ambiguous' ? 1 : 0])
    await client.query('INSERT INTO telegram_audit (event_id, action, target, detail) VALUES ($1,$2,$3,$4)', [delivery.event_id, 'delivery_attempt', delivery.chat_id, JSON.stringify({ delivery_id: delivery.id })])
    return { ...delivery, attempts: delivery.attempts + 1, ambiguous_retries: delivery.ambiguous_retries + (delivery.status === 'ambiguous' ? 1 : 0) }
  })
}

async function recordResult(delivery: Delivery, result: Awaited<ReturnType<ReturnType<typeof telegramClient>['sendMessage']>>, db: Db) {
  if (result.ok) {
    await db.query("UPDATE notification_deliveries SET status = 'sent', telegram_message_id = $2, sent_at = now(), sending_started_at = NULL WHERE id = $1", [delivery.id, result.message_id])
    return 'sent' as const
  }
  let status: 'retry' | 'dead' | 'ambiguous' | 'skipped' = 'dead'
  let error = result.kind
  let delay = BACKOFF_SECONDS[Math.min(delivery.attempts - 1, 4)]
  if (result.kind === 'forbidden') {
    status = 'skipped'
    await db.query("UPDATE telegram_groups SET status = 'bot_removed' WHERE id = $1", [delivery.group_id])
    await db.query('INSERT INTO telegram_audit (event_id, action, target) VALUES ($1,$2,$3)', [delivery.event_id, 'bot_removed', delivery.group_id])
  } else if (result.kind === 'rate_limited') {
    status = 'retry'
    delay = Math.max(1, result.retry_after)
  } else if (result.kind === 'network') status = 'retry'
  else if (result.kind === 'ambiguous') { status = 'ambiguous'; delay = 60 }
  else if (result.kind === 'bad_request' && result.migrate_to_chat_id) {
    status = 'retry'; delay = 1
    await db.query('UPDATE telegram_groups SET chat_id = $2 WHERE id = $1', [delivery.group_id, String(result.migrate_to_chat_id)])
    await db.query('UPDATE notification_deliveries SET chat_id = $2 WHERE group_id = $1 AND status NOT IN (\'sent\',\'skipped\',\'dead\')', [delivery.group_id, String(result.migrate_to_chat_id)])
  } else if (result.kind === 'bad_request' && result.description_code === 'entities_invalid' && !delivery.entities_fallback) {
    status = 'retry'; delay = 1; error = 'entities_fallback' as typeof error
    await db.query("UPDATE notification_deliveries SET rendered_text = $2, entities_fallback = true, mentioned_tg_ids = '{}' WHERE id = $1", [delivery.id, plainText(delivery.rendered_text)])
  }
  if (delivery.ambiguous_retries >= 1 && status !== 'skipped') status = 'dead'
  if (delivery.attempts >= 5 && status !== 'skipped') status = 'dead'
  await db.query('UPDATE notification_deliveries SET status = $2, error_code = $3, next_attempt_at = now() + $4 * interval \'1 second\', sending_started_at = NULL WHERE id = $1', [delivery.id, status, error, delay])
  return status
}

async function finalizeOutboxes() {
  await query(`UPDATE notification_outbox o SET status = 'done', completed_at = now() WHERE o.status = 'ready'
    AND NOT EXISTS (SELECT 1 FROM notification_deliveries d WHERE d.outbox_id = o.id AND NOT (d.status = ANY($1::text[])))`, [TERMINAL])
}

async function cleanup() {
  await withTransaction(async client => {
    const token = randomUUID()
    const due = await client.query(`INSERT INTO notifier_worker_leases (name, token, locked_until) VALUES ('cleanup',$1,now() + interval '1 day')
      ON CONFLICT (name) DO UPDATE SET token = EXCLUDED.token, locked_until = EXCLUDED.locked_until
      WHERE notifier_worker_leases.locked_until < now() RETURNING token`, [token])
    if (!due.rowCount) return
    await client.query("DELETE FROM telegram_updates WHERE received_at < now() - interval '7 days' AND status IN ('processed','ignored')")
    await client.query("DELETE FROM notification_outbox WHERE status IN ('done','expired','dead') AND created_at < now() - interval '90 days'")
    await client.query("DELETE FROM telegram_audit WHERE at < now() - interval '180 days'")
    await client.query('DELETE FROM telegram_link_tokens WHERE expires_at < now()')
    await client.query('DELETE FROM telegram_group_codes WHERE expires_at < now()')
  })
}

export async function drain({ budgetMs = 20_000, client }: { budgetMs?: number; client?: TelegramClient } = {}): Promise<Stats> {
  const stats: Stats = { claimed: 0, sent: 0, retry: 0, dead: 0, pending_oldest_seconds: 0 }
  if (!env().TELEGRAM_ENABLED) return stats
  const token = await acquireLease()
  if (!token) return stats
  const deadline = Date.now() + Math.min(30_000, Math.max(1000, budgetMs))
  try {
    await processPendingUpdates({ limit: 10, deadline, client })
    await recoverSending()
    while (Date.now() < deadline - 1000) {
      let prepared = false
      if (!await renewLease(token)) break
      if (Date.now() < deadline - env().NOTIFIER_LLM_TIMEOUT_MS) {
        const outbox = await claimNextOutbox()
        if (outbox) {
          prepared = true
          stats.claimed++
          log('info', 'notifier.claim', { outbox_id: outbox.id, version: outbox.version })
          try { await prepare(outbox) } catch {
            await query("UPDATE notification_outbox SET last_error = 'prepare_failed', status = CASE WHEN attempts >= 5 THEN 'dead' ELSE 'pending' END, locked_until = NULL, available_at = now() + interval '30 seconds' WHERE id = $1", [outbox.id])
          }
        }
      }
      if (Date.now() > deadline - 10_500) break
      const delivery = await reserveDelivery()
      if (!delivery) { await finalizeOutboxes(); if (prepared) continue; break }
      if (delivery === 'deferred') { await finalizeOutboxes(); continue }
      const started = performance.now()
      const result = await (client ?? telegramClient()).sendMessage({ chat_id: delivery.chat_id, text: delivery.rendered_text,
        ...(delivery.entities_fallback ? {} : { parse_mode: 'HTML' as const }),
        ...(delivery.message_thread_id ? { message_thread_id: Number(delivery.message_thread_id) } : {}), link_preview_options: { is_disabled: true },
      })
      const status = await withTransaction(client => recordResult(delivery, result, client))
      if (status === 'sent') stats.sent++
      else if (status === 'dead') stats.dead++
      else if (status === 'retry' || status === 'ambiguous') stats.retry++
      log('info', 'notifier.send', { delivery_id: delivery.id, status, latency_ms: Math.round(performance.now() - started) })
      await finalizeOutboxes()
    }
    await finalizeOutboxes()
    await cleanup()
    stats.pending_oldest_seconds = (await health()).oldest_pending_seconds
    return stats
  } finally {
    await query("DELETE FROM notifier_worker_leases WHERE name = 'drain' AND token = $1", [token])
  }
}
