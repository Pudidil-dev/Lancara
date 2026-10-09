import type { PoolClient } from 'pg'
import { serverNow } from '@/lib/clock'
import { query, withTransaction } from '@/lib/db'
import { AppError } from '@/lib/errors'
import { idempotent } from '@/lib/idempotency'
import { log } from '@/lib/logger'
import { requireCoordinator, requireEvent, type Session } from '@/lib/session'
import { AiUnavailableError, interpret } from '@/modules/ai'
import type { Interpretation } from '@/modules/ai/extraction'
import { analyze } from '@/modules/engine/analyze'
import { diffConfiguration } from '@/modules/engine/revision'
import type { Delta, Snapshot } from '@/modules/engine/types'
import { getEvent, getSnapshot } from '@/modules/events/service'

export const MAX_TEXT = 2000
const PARSE_PER_MINUTE = 10

export interface ChangeRow {
  id: string
  seq: number
  event_id: string
  actor_id: string
  kind: 'report' | 'correction' | 'compensation'
  original_text: string | null
  reference_at: Date | null
  draft: (Partial<Interpretation> & { manual?: boolean }) | null
  parse_provider: string | null
  parse_ms: number | null
  confirmed_delta: Delta | null
  is_estimate: boolean
  analysis_now: Date | null
  base_version: number | null
  status: 'draft' | 'needs_clarification' | 'preview_ready' | 'approved' | 'rejected'
  corrects_decision_id: string | null
  compensates_decision_id: string | null
  reject_reason: string | null
  created_at: Date
}

export async function loadChange(changeId: string, db?: PoolClient, lock = false): Promise<ChangeRow> {
  if (!/^[0-9a-f-]{36}$/i.test(changeId)) throw new AppError('NOT_FOUND', 'Perubahan tidak ditemukan.')
  const rows = await query<ChangeRow>(`SELECT * FROM changes WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`, [changeId], db)
  if (!rows[0]) throw new AppError('NOT_FOUND', 'Perubahan tidak ditemukan.')
  return rows[0]
}

function requireOwnerOrCoordinator(session: Session, change: ChangeRow): void {
  requireEvent(session, change.event_id)
  requireCoordinator(session)
}

export async function createChange(
  session: Session,
  eventId: string,
  input: { original_text?: string | null; reference_at?: string | null },
): Promise<{ change_id: string; seq: number }> {
  requireEvent(session, eventId)
  const text = input.original_text?.trim() || null
  if (text && text.length > MAX_TEXT) throw new AppError('VALIDATION_ERROR', `Kabar maksimal ${MAX_TEXT} karakter.`)
  const rows = await query<{ id: string; seq: number }>(
    `INSERT INTO changes (event_id, actor_id, kind, original_text, reference_at, draft) VALUES ($1, $2, 'report', $3, $4, $5) RETURNING id, seq`,
    [eventId, session.actor_id, text, input.reference_at ? new Date(input.reference_at) : null, JSON.stringify({ manual: !text })],
  )
  return { change_id: rows[0].id, seq: Number(rows[0].seq) }
}

export async function parseChange(session: Session, changeId: string) {
  const change = await loadChange(changeId)
  requireOwnerOrCoordinator(session, change)
  if (!['draft', 'needs_clarification'].includes(change.status)) throw new AppError('INVALID_STATE', 'Kabar ini sudah dikonfirmasi; buat koreksi bila perlu.')
  if (!change.original_text) throw new AppError('VALIDATION_ERROR', 'Kabar kosong; gunakan form manual.')

  const recent = await query<{ n: string }>(`SELECT count(*) AS n FROM parse_usage WHERE session_id = $1 AND at > now() - interval '1 minute'`, [session.session_id])
  if (Number(recent[0].n) >= PARSE_PER_MINUTE) throw new AppError('RATE_LIMITED', 'Terlalu banyak permintaan tafsir. Tunggu sebentar atau gunakan form manual.')
  await query('INSERT INTO parse_usage (session_id) VALUES ($1)', [session.session_id])

  const event = await getEvent(change.event_id)
  const snapshot = await getSnapshot(change.event_id, event.active_version)
  const started = performance.now()
  let interpretation: Interpretation
  try {
    interpretation = await interpret(change.original_text, snapshot, change.reference_at ? change.reference_at.toISOString() : null)
  } catch (error) {
    const parseMs = Math.round(performance.now() - started)
    log('warn', 'parse_failed', { change_id: change.id, parse_ms: parseMs, cause: (error as Error).message })
    if (error instanceof AiUnavailableError) throw new AppError('AI_UNAVAILABLE', `${error.message} Gunakan form manual; draft tetap tersimpan.`)
    throw error
  }
  const parseMs = Math.round(performance.now() - started)
  const status = interpretation.status === 'ok' ? 'draft' : 'needs_clarification'
  await query(`UPDATE changes SET draft = $2, parse_provider = $3, parse_ms = $4, status = $5, updated_at = now() WHERE id = $1`, [
    change.id,
    JSON.stringify(interpretation),
    interpretation.provider,
    parseMs,
    status,
  ])
  log('info', 'parsed', { change_id: change.id, parse_ms: parseMs, provider: interpretation.provider, status })
  return { change_id: change.id, status, interpretation, parse_ms: parseMs, version: event.active_version }
}

/**
 * Konfirmasi tafsiran (atau analisis ulang) → simpan delta terkonfirmasi + analisis + maksimal 3 patch.
 * Tidak mengubah rundown aktif. Analisis lama tetap tersimpan sebagai riwayat.
 */
export async function analyseChange(
  session: Session,
  changeId: string,
  input: { delta?: Delta | null; base_version: number; idempotency_key: string },
  mode: 'confirm' | 'reanalyse',
) {
  return withTransaction(async (client) => {
    const change = await loadChange(changeId, client, true)
    requireOwnerOrCoordinator(session, change)
    return idempotent(client, { eventId: change.event_id, actorId: session.actor_id, operation: `${mode}:${changeId}`, key: input.idempotency_key, payload: input }, async () => {
      const allowed = mode === 'confirm' ? ['draft', 'needs_clarification', 'preview_ready'] : ['preview_ready']
      if (!allowed.includes(change.status)) throw new AppError('INVALID_STATE', `Perubahan berstatus ${change.status}; tidak bisa dianalisis.`)
      const event = await getEvent(change.event_id, client, 'FOR SHARE')
      if (event.active_version !== input.base_version) {
        throw new AppError('STALE_VERSION', `Rundown sudah berubah ke v${event.active_version}. Hitung ulang dari versi terkini.`, { active_version: event.active_version })
      }
      const delta: Delta | null = change.kind === 'compensation' ? (change.draft?.delta ?? null) : (input.delta ?? change.confirmed_delta)
      if (!delta) throw new AppError('VALIDATION_ERROR', 'Delta terkonfirmasi wajib diisi.')
      const base = await getSnapshot(change.event_id, event.active_version, client)
      const analysisNow = serverNow(event.sim_clock_at)
      const started = performance.now()
      const result = analyze({ base, delta, analysisNow })
      const engineMs = Math.round(performance.now() - started)

      const analysis = await client.query<{ id: string }>(
        `INSERT INTO analyses (change_id, event_id, base_version, analysis_now, delta, engine_version, blockers, rejected, search_meta, engine_ms, actor_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [
          change.id,
          change.event_id,
          event.active_version,
          analysisNow,
          JSON.stringify(delta),
          result.engine_version,
          JSON.stringify(result.blockers),
          JSON.stringify(result.rejected),
          JSON.stringify(result.search),
          engineMs,
          session.actor_id,
        ],
      )
      for (const c of result.candidates) {
        await client.query(
          `INSERT INTO patches (analysis_id, change_id, candidate_id, rank, strategy, label, engine_version, base_version, proposed_snapshot, diff, violations, impact, items_changed, total_shift_seconds)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            analysis.rows[0].id,
            change.id,
            c.candidate_id,
            c.rank,
            c.strategy,
            c.label,
            result.engine_version,
            event.active_version,
            JSON.stringify(c.proposed),
            JSON.stringify(c.diff),
            JSON.stringify(c.violations),
            JSON.stringify(c.impact),
            c.items_changed,
            c.total_start_shift_seconds,
          ],
        )
      }
      await client.query(
        `UPDATE changes SET confirmed_delta = $2, is_estimate = $3, analysis_now = $4, base_version = $5, status = 'preview_ready', updated_at = now() WHERE id = $1`,
        [change.id, JSON.stringify(delta), delta.is_estimate, analysisNow, event.active_version],
      )
      log('info', 'analysed', { change_id: change.id, event_id: change.event_id, base_version: event.active_version, engine_version: result.engine_version, engine_ms: engineMs, candidates: result.candidates.length })
      return { change_id: change.id, analysis_id: analysis.rows[0].id, candidates: result.candidates.length, engine_ms: engineMs }
    })
  })
}

export async function rejectChange(session: Session, changeId: string, input: { reason: string; idempotency_key: string }) {
  return withTransaction(async (client) => {
    const change = await loadChange(changeId, client, true)
    requireEvent(session, change.event_id)
    requireCoordinator(session)
    return idempotent(client, { eventId: change.event_id, actorId: session.actor_id, operation: `reject:${changeId}`, key: input.idempotency_key, payload: input }, async () => {
      if (['approved', 'rejected'].includes(change.status)) throw new AppError('INVALID_STATE', `Perubahan sudah ${change.status}.`)
      await client.query(`UPDATE changes SET status = 'rejected', rejected_by = $2, reject_reason = $3, rejected_at = now(), updated_at = now() WHERE id = $1`, [
        change.id,
        session.actor_id,
        input.reason,
      ])
      return { change_id: change.id, status: 'rejected' }
    })
  })
}

export async function getChangeDetail(session: Session, changeId: string) {
  const change = await loadChange(changeId)
  requireEvent(session, change.event_id)
  const event = await getEvent(change.event_id)
  const analyses = await query<Record<string, unknown>>(
    `SELECT id, base_version, analysis_now, delta, engine_version, blockers, rejected, search_meta, engine_ms, created_at FROM analyses WHERE change_id = $1 ORDER BY created_at DESC`,
    [change.id],
  )
  const latest = analyses[0] ?? null
  const patches = latest
    ? await query<Record<string, unknown>>(
        `SELECT id, candidate_id, rank, strategy, label, base_version, diff, violations, impact, items_changed, total_shift_seconds, proposed_snapshot FROM patches WHERE analysis_id = $1 ORDER BY rank`,
        [latest.id],
      )
    : []
  if (latest) {
    const base = await getSnapshot(change.event_id, Number(latest.base_version))
    for (const patch of patches) {
      patch.configuration_diff = diffConfiguration(base, patch.proposed_snapshot as Snapshot)
      delete patch.proposed_snapshot
    }
  }
  const decision = await query<Record<string, unknown>>(
    `SELECT d.id, d.patch_id, d.reason, d.base_version, d.new_version, d.approved_at, a.display_name AS approved_by
       FROM decisions d JOIN actors a ON a.id = d.actor_id WHERE d.change_id = $1`,
    [change.id],
  )
  const actor = await query<{ display_name: string }>('SELECT display_name FROM actors WHERE id = $1', [change.actor_id])
  const snapshot = await getSnapshot(change.event_id, event.active_version)
  return {
    change: { ...change, actor_name: actor[0]?.display_name ?? change.actor_id },
    event: { id: event.id, name: event.name, timezone: event.timezone, active_version: event.active_version },
    stale: change.status === 'preview_ready' && change.base_version !== event.active_version,
    analysis: latest,
    analysis_count: analyses.length,
    patches,
    decision: decision[0] ?? null,
    items: snapshot.items.map((i) => ({ id: i.id, title: i.title, start_at: i.start_at, status: i.status, duration_seconds: i.duration_seconds, estimated_end_at: i.estimated_end_at })),
    server_now: serverNow(event.sim_clock_at),
    can_approve: true,
  }
}

export async function listChanges(session: Session, eventId: string) {
  requireEvent(session, eventId)
  return query(
    `SELECT c.id, c.seq, c.kind, c.status, c.original_text, c.base_version, c.created_at, a.display_name AS actor_name
       FROM changes c JOIN actors a ON a.id = c.actor_id
      WHERE c.event_id = $1 AND ($2::boolean OR c.actor_id = $3)
      ORDER BY c.created_at DESC LIMIT 30`,
    [eventId, true, session.actor_id],
  )
}
