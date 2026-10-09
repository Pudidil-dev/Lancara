import { randomUUID } from 'node:crypto'
import { pool, query, withTransaction } from '@/lib/db'
import { createSession, loadSession, type Session } from '@/lib/session'
import { analyseChange, createChange, getChangeDetail } from '@/modules/changes/service'
import type { Delta } from '@/modules/engine/types'
import { at, DEMO_CLOCK, DEMO_EVENT_ID } from '@/modules/events/fixture'
import { seedDemo } from '@/modules/events/seed'

export const hasDb = !!process.env.DATABASE_URL_TEST

export async function resetDb(): Promise<void> {
  await withTransaction((client) => seedDemo(client, { reset: true }))
}

export async function sessionFor(actorId: string): Promise<Session> {
  const created = await createSession(actorId)
  return (await loadSession(created.id))!
}

export const key = () => `k-${randomUUID()}`

export const earliest = (item_id: string, hhmm: string): Delta => ({ type: 'earliest_start', item_id, value: at(hhmm), is_estimate: false, reference_at: DEMO_CLOCK })

/** Kabar → konfirmasi delta → detail dengan patch. */
export async function analysedChange(session: Session, delta: Delta, baseVersion: number) {
  const { change_id } = await createChange(session, DEMO_EVENT_ID, { original_text: null, reference_at: DEMO_CLOCK })
  await analyseChange(session, change_id, { delta, base_version: baseVersion, idempotency_key: key() }, 'confirm')
  return getChangeDetail(session, change_id)
}

export async function count(table: string): Promise<number> {
  const rows = await query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`)
  return Number(rows[0].n)
}

export async function closePool(): Promise<void> {
  await pool().end()
  ;(globalThis as { __ripplePool?: unknown }).__ripplePool = undefined
}
