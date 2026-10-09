import { serverNow } from '@/lib/clock'
import { query, withTransaction } from '@/lib/db'
import { AppError } from '@/lib/errors'
import { idempotent } from '@/lib/idempotency'
import { log } from '@/lib/logger'
import { requireCoordinator, requireEvent, type Session } from '@/lib/session'
import { renderBrief, type BriefPayload } from '@/modules/briefs/render'
import { loadChange } from '@/modules/changes/service'
import { revalidate } from '@/modules/engine/analyze'
import type { Delta, RoleImpact, Snapshot } from '@/modules/engine/types'
import { getEvent, getSnapshot, insertVersion } from '@/modules/events/service'

interface PatchRow {
  id: string
  analysis_id: string
  change_id: string
  base_version: number
  proposed_snapshot: Snapshot
  impact: RoleImpact[]
  label: string
}

export interface ApproveInput {
  patch_id: string
  base_version: number
  reason: string
  idempotency_key: string
}

/**
 * Transaksi approval (02-technical-design.md §Approval):
 * auth koordinator → idempotency → lock event → cek base_version → validasi ulang kandidat tersimpan
 * → versi baru + decision + brief + status + request result. Commit semua atau rollback semua.
 */
export async function approve(session: Session, changeId: string, input: ApproveInput) {
  requireCoordinator(session)
  const started = performance.now()
  const result = await withTransaction(async (client) => {
    const change = await loadChange(changeId, client, true)
    requireEvent(session, change.event_id)
    return idempotent(client, { eventId: change.event_id, actorId: session.actor_id, operation: `approve:${changeId}`, key: input.idempotency_key, payload: input }, async () => {
      const event = await getEvent(change.event_id, client, 'FOR UPDATE')
      if (change.status !== 'preview_ready') throw new AppError('INVALID_STATE', `Perubahan berstatus ${change.status}; tidak dapat disetujui.`)
      if (event.active_version !== input.base_version || change.base_version !== input.base_version) {
        throw new AppError('STALE_VERSION', `Rundown sudah berubah ke v${event.active_version}. Hitung ulang dari versi terkini.`, { active_version: event.active_version })
      }
      const latest = await client.query<{ id: string }>('SELECT id FROM analyses WHERE change_id = $1 ORDER BY created_at DESC LIMIT 1', [changeId])
      const patchRes = await client.query<PatchRow>('SELECT id, analysis_id, change_id, base_version, proposed_snapshot, impact, label FROM patches WHERE id = $1 AND change_id = $2', [
        input.patch_id,
        changeId,
      ])
      const patch = patchRes.rows[0]
      if (!patch) throw new AppError('NOT_FOUND', 'Patch tidak ditemukan untuk perubahan ini.')
      if (patch.analysis_id !== latest.rows[0]?.id || patch.base_version !== input.base_version) {
        throw new AppError('CONTEXT_CHANGED', 'Patch berasal dari analisis lama. Pilih opsi dari analisis terbaru.')
      }

      const active = await getSnapshot(change.event_id, event.active_version, client)
      const now = serverNow(event.sim_clock_at)
      const violations = revalidate(patch.proposed_snapshot, active, now, change.confirmed_delta as Delta)
      if (violations.length) {
        throw new AppError('CONTEXT_CHANGED', 'Kondisi berubah sejak analisis (jam/status). Opsi tidak diganti diam-diam; minta analisis baru.', violations)
      }

      const newVersion = await insertVersion(client, event, patch.proposed_snapshot, 'decision', session.actor_id, `CH-${change.seq}: ${patch.label}`)
      // Metadata dan label session harus mengikuti snapshot yang baru committed, dalam transaksi yang sama.
      await client.query('UPDATE events SET name = $2, timezone = $3 WHERE id = $1', [change.event_id, patch.proposed_snapshot.event.name, patch.proposed_snapshot.event.timezone])
      for (const role of patch.proposed_snapshot.roles) {
        if (active.roles.find(previous => previous.id === role.id)?.label === role.label) continue
        await client.query('UPDATE roles SET label = $3 WHERE event_id = $1 AND id = $2', [change.event_id, role.id, role.label])
      }
      const decision = await client.query<{ id: string; approved_at: Date }>(
        `INSERT INTO decisions (event_id, change_id, patch_id, actor_id, reason, base_version, new_version) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, approved_at`,
        [change.event_id, change.id, patch.id, session.actor_id, input.reason, input.base_version, newVersion],
      )
      const decisionId = decision.rows[0].id

      let briefCount = 0
      for (const role of patch.impact) {
        if (role.level !== 'ACTION_REQUIRED' && role.level !== 'FYI') continue
        const payload: BriefPayload = {
          change_id: change.id,
          change_seq: Number(change.seq),
          version: newVersion,
          event_name: patch.proposed_snapshot.event.name,
          timezone: patch.proposed_snapshot.event.timezone,
          role_id: role.role_id,
          role_label: role.role_label,
          level: role.level,
          entries: role.entries,
          decision_reason: input.reason,
          approved_by: session.display_name,
          kind: change.kind,
        }
        await client.query(
          `INSERT INTO briefs (decision_id, change_id, event_id, version, recipient_role_id, level, payload, rendered) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [decisionId, change.id, change.event_id, newVersion, role.role_id, role.level, JSON.stringify(payload), renderBrief(payload)],
        )
        briefCount++
      }
      await client.query(`UPDATE changes SET status = 'approved', updated_at = now() WHERE id = $1`, [change.id])
      return { decision_id: decisionId, change_id: change.id, new_version: newVersion, base_version: input.base_version, briefs: briefCount }
    })
  })
  log('info', 'approved', { change_id: changeId, decision_id: result.decision_id, base_version: result.base_version, new_version: result.new_version, replayed: result.replayed, commit_ms: Math.round(performance.now() - started) })
  return result
}

/** GET /api/requests/:key — status permintaan setelah timeout. not_found bukan bukti permintaan tak pernah tiba. */
export async function requestStatus(session: Session, key: string) {
  const rows = await query<{ operation: string; status: string; result: unknown; created_at: Date; completed_at: Date | null; actor_id: string }>(
    `SELECT operation, status, result, created_at, completed_at, actor_id FROM requests
      WHERE event_id = $1 AND idempotency_key = $2 AND (actor_id = $3 OR $4::boolean)
      ORDER BY created_at DESC LIMIT 1`,
    [session.event_id, key, session.actor_id, session.capability === 'coordinator'],
  )
  if (!rows[0]) return { status: 'not_found' as const, note: 'Belum ditemukan. Jika transaksi gagal, tidak ada keputusan parsial; ulangi dengan key yang sama.' }
  return rows[0]
}

async function loadDecision(session: Session, decisionId: string) {
  requireCoordinator(session)
  if (!/^[0-9a-f-]{36}$/i.test(decisionId)) throw new AppError('NOT_FOUND', 'Keputusan tidak ditemukan.')
  const rows = await query<{ id: string; event_id: string; change_id: string; base_version: number; new_version: number; seq: number }>(
    `SELECT d.id, d.event_id, d.change_id, d.base_version, d.new_version, c.seq FROM decisions d JOIN changes c ON c.id = d.change_id WHERE d.id = $1`,
    [decisionId],
  )
  if (!rows[0]) throw new AppError('NOT_FOUND', 'Keputusan tidak ditemukan.')
  requireEvent(session, rows[0].event_id)
  return rows[0]
}

/** Koreksi = Change baru yang mereferensikan keputusan lama; tetap lewat konfirmasi + approval terhadap versi terkini. */
export async function createCorrection(session: Session, decisionId: string, input: { original_text?: string | null; reference_at?: string | null }) {
  const decision = await loadDecision(session, decisionId)
  const text = input.original_text?.trim() || null
  const rows = await query<{ id: string; seq: number }>(
    `INSERT INTO changes (event_id, actor_id, kind, original_text, reference_at, draft, corrects_decision_id)
     VALUES ($1, $2, 'correction', $3, $4, $5, $6) RETURNING id, seq`,
    [decision.event_id, session.actor_id, text, input.reference_at ? new Date(input.reference_at) : null, JSON.stringify({ manual: !text }), decision.id],
  )
  return { change_id: rows[0].id, seq: Number(rows[0].seq), corrects: `CH-${decision.seq}` }
}

/** Pembatalan keputusan = Change kompensasi; reversal dibangun terhadap versi aktif, bukan memutar pointer versi. */
export async function createCompensation(session: Session, decisionId: string, input: { reason?: string | null }) {
  const decision = await loadDecision(session, decisionId)
  const before = await getSnapshot(decision.event_id, decision.base_version)
  const after = await getSnapshot(decision.event_id, decision.new_version)
  const delta: Delta = { type: 'revert_decision', decision_id: decision.id, before, after, is_estimate: false, reference_at: null }
  const draft = { status: 'ok', delta, partial: null, questions: [], notes: [`Membatalkan keputusan CH-${decision.seq} (v${decision.base_version}→v${decision.new_version}).`], provider: 'system' }
  const rows = await query<{ id: string; seq: number }>(
    `INSERT INTO changes (event_id, actor_id, kind, original_text, draft, compensates_decision_id) VALUES ($1, $2, 'compensation', $3, $4, $5) RETURNING id, seq`,
    [decision.event_id, session.actor_id, input.reason?.trim() || `Batalkan keputusan CH-${decision.seq}`, JSON.stringify(draft), decision.id],
  )
  return { change_id: rows[0].id, seq: Number(rows[0].seq), compensates: `CH-${decision.seq}` }
}
