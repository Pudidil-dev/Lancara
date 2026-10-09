import { createHash } from 'node:crypto'
import type { PoolClient } from 'pg'
import { AppError } from './errors'

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
}

export function payloadHash(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex')
}

export interface IdempotencyScope {
  eventId: string
  actorId: string
  operation: string
  key: string
  payload: unknown
}

/**
 * Jalankan mutation sekali per (event, actor, operation, key) di dalam transaksi pemanggil.
 * Key sama + payload sama → hasil lama (replayed). Key sama + payload beda → IDEMPOTENCY_CONFLICT.
 * Permintaan paralel dengan key sama menunggu unique index lalu membaca hasil yang sudah commit.
 */
export async function idempotent<T extends object>(client: PoolClient, scope: IdempotencyScope, fn: () => Promise<T>): Promise<T & { replayed: boolean }> {
  const hash = payloadHash(scope.payload)
  const inserted = await client.query(
    `INSERT INTO requests (event_id, actor_id, operation, idempotency_key, payload_hash, status)
     VALUES ($1, $2, $3, $4, $5, 'pending')
     ON CONFLICT (event_id, actor_id, operation, idempotency_key) DO NOTHING
     RETURNING id`,
    [scope.eventId, scope.actorId, scope.operation, scope.key, hash],
  )
  if (!inserted.rowCount) {
    const existing = await client.query(
      'SELECT payload_hash, status, result FROM requests WHERE event_id = $1 AND actor_id = $2 AND operation = $3 AND idempotency_key = $4',
      [scope.eventId, scope.actorId, scope.operation, scope.key],
    )
    const row = existing.rows[0]
    if (!row || row.payload_hash !== hash) {
      throw new AppError('IDEMPOTENCY_CONFLICT', 'Kunci permintaan sudah dipakai untuk isi berbeda. Hentikan retry otomatis.')
    }
    return { ...(row.result as T), replayed: true }
  }
  const result = await fn()
  await client.query(`UPDATE requests SET status = 'committed', result = $2, completed_at = now() WHERE id = $1`, [inserted.rows[0].id, JSON.stringify(result)])
  return { ...result, replayed: false }
}
