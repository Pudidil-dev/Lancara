import { randomUUID } from 'node:crypto'
import { z, ZodError } from 'zod'
import { serverNow } from '@/lib/clock'
import { query } from '@/lib/db'
import { AppError, type ErrorCode } from '@/lib/errors'
import { AGENT_NAME } from '@/lib/brand'
import { requireCoordinator, type Session } from '@/lib/session'
import { formatClock, toMs } from '@/lib/time'
import { analyseChange, createChange, getChangeDetail } from '@/modules/changes/service'
import { createCompensation } from '@/modules/decisions/service'
import { history, inbox } from '@/modules/briefs/service'
import { listChanges } from '@/modules/changes/service'
import { endMs, isActive, isBreakItem } from '@/modules/engine/schedule'
import type { Delta, Item, ItemDiff, Snapshot } from '@/modules/engine/types'
import { getEvent, getSnapshot } from '@/modules/events/service'
import { buildEditedRundown, EditRundownInputSchema, recommendReschedules } from './rescheduling'
import { resolveEventClock } from './time'
import { buildAgentContext } from '@/modules/support/context'
import { buildEventConfiguration, EditEventConfigurationInputSchema } from './configuration'

/** Definisi tool untuk model. Schema JSON ini juga divalidasi ulang dengan zod di server. */
export interface ToolSpec { name: string; description: string; parameters: Record<string, unknown> }
export interface Proposal {
  change_id: string; href: string; label: string; applied?: boolean; version?: number
  preview?: { base_version: number; patch_id: string; candidate_rank: number; label: string; timezone: string; diff: ItemDiff[]; configuration_diff?: Array<{ field: string; old: string; new: string }>; candidates: Array<{ patch_id: string; rank: number; label: string; diff: ItemDiff[]; configuration_diff?: Array<{ field: string; old: string; new: string }> }> }
}
export type ToolOutcome = { ok: true; data: unknown; proposal?: Proposal } | { ok: false; error: string; code?: ErrorCode }

const TIME_PATTERN = '^([01]?\\d|2[0-3])[:.][0-5]\\d$'

/** Kompatibilitas konfigurasi lama: semua tool perubahan kini hanya menyiapkan preview. */
export function autonomyEnabled(): boolean {
  return false
}

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: 'get_event_context',
    description: 'Membaca seluruh data acara aktif untuk mengedit format/rundown: versi, waktu, item, PIC/peran, resource, slot/batas waktu, dependensi dan metadata acara. Tidak mengubah database.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'edit_event_configuration',
    description: 'API edit konfigurasi acara lengkap: nama/zona waktu/panggung/curfew, label peran, CRUD resource, slot tetap/earliest_start dan dependensi. Menyiapkan bubble konfirmasi dengan seluruh perubahan Lama→Baru; belum mengubah data aktif. Gunakan untuk perubahan format dan aturan acara yang diminta pengguna, lalu edit_rundown untuk sesi/jam/durasi/PIC.',
    parameters: z.toJSONSchema(EditEventConfigurationInputSchema),
  },
  {
    name: 'get_rundown_summary',
    description: 'Membaca rundown aktif: ID item, jam, status, batas, istirahat/ishoma (protected), dan sisa menit terhadap curfew. Tidak mengubah apa pun.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'propose_schedule_change',
    description: 'Menganalisis kabar gangguan dan menyimpan pratinjau opsi yang lolos batas. Rundown aktif belum berubah; koordinator mengonfirmasi lewat dialog website. Untuk memindahkan sesi secara persis, gunakan edit_rundown.',
    parameters: {
      type: 'object',
      properties: {
        item_id: { type: 'string', minLength: 1, maxLength: 64 },
        kind: { type: 'string', enum: ['delay', 'earlier_start', 'end_estimate', 'cancel'] },
        minutes: { type: ['integer', 'null'], minimum: 1, maximum: 720, description: 'Menit keterlambatan persis dari kabar. Null bila tidak digunakan.' },
        time_hhmm: { type: ['string', 'null'], pattern: TIME_PATTERN, description: 'Jam lokal HH.MM: dari kabar, atau hasil menghitung menit relatif dari jam sekarang. Null bila tidak digunakan.' },
        summary: { type: 'string', minLength: 3, maxLength: 200, description: 'Ringkasan kabar dalam kalimat pendek.' },
      },
      required: ['item_id', 'kind', 'minutes', 'time_hhmm', 'summary'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_changes',
    description: 'Membaca daftar kabar/perubahan terbaru (CH-n, status: draft, needs_clarification, preview_ready, approved, rejected; pelapor; teks kabar). Akun utama membaca semua kabar acara. Tidak mengubah apa pun.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'get_history',
    description: 'Membaca riwayat keputusan (versi, opsi yang diterapkan, penyetuju, alasan) dan status baca brief per peran (siapa yang belum membaca). Tidak mengubah apa pun.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'get_my_inbox',
    description: 'Membaca seluruh brief acara (aksi, jam lama dan baru, status sudah dibaca). Tidak mengubah apa pun.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'recommend_reschedule',
    description: 'Mencari sampai tiga rekomendasi yang benar-benar lolos engine untuk mengisi jeda dengan sesi pending, tanpa mengubah DB. Mencoba alternatif bila sesi pertama terhalang batas. Pilih operations dari rekomendasi lalu panggil edit_rundown untuk menyiapkan konfirmasi.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'edit_rundown',
    description: 'API CRUD rundown: membuat sesi, mengubah judul/jam/durasi/PIC/resource sesi pending, membatalkan melalui delete, atau reorder dengan item_ids semua sesi pending untuk menghitung ulang urutan/jam. Rencana persis divalidasi engine dan disimpan sebagai bubble preview. Pakai base_version aktif. Database aktif dan brief hanya berubah setelah dialog konfirmasi koordinator.',
    parameters: z.toJSONSchema(EditRundownInputSchema),
  },
  {
    name: 'undo_decision',
    description: 'Menyiapkan pratinjau pembatalan keputusan terakhir (atau decision_id tertentu) melalui versi kompensasi. Perubahan aktif menunggu konfirmasi koordinator; riwayat tidak dihapus.',
    parameters: {
      type: 'object',
      properties: { decision_id: { type: ['string', 'null'], description: 'Null untuk keputusan terakhir.' } },
      required: ['decision_id'],
      additionalProperties: false,
    },
  },
]

const SummaryInput = z.object({}).strict()
const ProposeInput = z.object({
  item_id: z.string().min(1).max(64),
  kind: z.enum(['delay', 'earlier_start', 'end_estimate', 'cancel']),
  // Model sering mengirim null untuk field opsional; null diperlakukan sama dengan tidak diisi.
  minutes: z.number().int().min(1).max(720).nullish(),
  time_hhmm: z.string().regex(new RegExp(TIME_PATTERN)).nullish(),
  summary: z.string().trim().min(3).max(200),
}).strict().superRefine((value, ctx) => {
  const minutes = value.minutes != null
  const time = value.time_hhmm != null
  const valid = value.kind === 'cancel' ? !minutes && !time : value.kind === 'delay' ? minutes !== time : !minutes && time
  if (!valid) ctx.addIssue({ code: 'custom', message: 'Jenis perubahan membutuhkan tepat satu nilai waktu yang sesuai; pembatalan tanpa waktu.' })
})
const UndoInput = z.object({ decision_id: z.string().uuid().nullish() }).strict()
export const ProposeInputSchema = ProposeInput
export type ProposeArgs = z.infer<typeof ProposeInput>

export function toolsForCapability(capability: Session['capability'] | 'crew'): ToolSpec[] {
  void capability // Kompatibilitas pemanggil lama; satu akun memiliki seluruh katalog tools.
  return TOOL_SPECS
}

export function validateToolInput(name: string, raw: unknown): { ok: true; data: unknown } | { ok: false; error: string } {
  const schema = ['get_rundown_summary', 'get_event_context', 'list_changes', 'get_history', 'get_my_inbox', 'recommend_reschedule'].includes(name) ? SummaryInput : name === 'propose_schedule_change' ? ProposeInput : name === 'undo_decision' ? UndoInput : name === 'edit_rundown' ? EditRundownInputSchema : name === 'edit_event_configuration' ? EditEventConfigurationInputSchema : null
  if (!schema) return { ok: false, error: 'Tool tidak diizinkan.' }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'Input tool tidak valid.' }
  return { ok: true, data: parsed.data }
}

/** Istirahat/ishoma dikenali dari judul atau catatan batas. Item ini tidak boleh diubah oleh agen. */
export function isBreak(item: Item, snapshot: Snapshot): boolean {
  if (isBreakItem(item)) return true
  return snapshot.constraints.some((c) => c.item_id === item.id && /ishoma|istirahat/i.test(c.note ?? ''))
}

/**
 * Ubah argumen tool menjadi Delta engine. Konversi jam dilakukan di server, bukan oleh model.
 * Fungsi murni supaya mudah diuji.
 */
export function toDelta(args: ProposeArgs, item: Item, snapshot: Snapshot, now: string): { delta: Delta } | { error: string } {
  const zone = snapshot.event.timezone
  const reference_at = now
  switch (args.kind) {
    case 'delay': {
      if (item.status !== 'pending') return { error: `${item.title} sudah berlangsung atau selesai. Gunakan end_estimate untuk sesi yang molor.` }
      const value = args.time_hhmm
        ? resolveEventClock(snapshot, args.time_hhmm, item.start_at)
        : (args.minutes != null ? new Date(toMs(item.start_at) + args.minutes * 60_000).toISOString() : null)
      if (!value) return { error: 'Untuk delay, isi minutes (jumlah menit telat).' }
      // Keterlambatan harus membuat jadwal lebih lambat; jam yang sama dengan jadwal awal berarti tidak ada keterlambatan.
      if (toMs(value) <= toMs(item.start_at)) {
        return { error: `Keterlambatan harus setelah jadwal mulai ${formatClock(item.start_at, zone)}. Untuk telat N menit, kirim minutes=N tanpa time_hhmm.` }
      }
      return { delta: { type: 'earliest_start', item_id: item.id, value, is_estimate: false, reference_at } }
    }
    case 'earlier_start': {
      if (item.status !== 'pending') return { error: `${item.title} sudah berlangsung atau selesai.` }
      if (!args.time_hhmm) return { error: 'Untuk earlier_start, isi time_hhmm.' }
      return { delta: { type: 'earliest_start', item_id: item.id, value: resolveEventClock(snapshot, args.time_hhmm, item.start_at), is_estimate: false, reference_at } }
    }
    case 'end_estimate': {
      if (item.status !== 'in_progress') return { error: `${item.title} tidak sedang berlangsung.` }
      if (!args.time_hhmm) return { error: 'Untuk end_estimate, isi time_hhmm.' }
      const value = resolveEventClock(snapshot, args.time_hhmm, item.start_at)
      if (toMs(value) <= toMs(item.start_at)) return { error: 'Estimasi selesai harus setelah jam mulai.' }
      return { delta: { type: 'active_end_estimate', item_id: item.id, value, is_estimate: true, reference_at } }
    }
    case 'cancel':
      if (item.status !== 'pending') return { error: 'Pembatalan oleh asisten hanya untuk item yang belum berlangsung.' }
      return { delta: { type: 'cancel_item', item_id: item.id, is_estimate: false, reference_at } }
  }
}

function messageOf(error: unknown): string {
  if (error instanceof AppError) return error.message
  if (error instanceof ZodError) return 'Input tool tidak valid. Periksa item_id, kind, dan format jam HH.MM.'
  return 'Tool gagal dijalankan. Coba lagi atau gunakan form manual.'
}

async function summary(session: Session): Promise<ToolOutcome> {
  const event = await getEvent(session.event_id)
  const snapshot = await getSnapshot(session.event_id, event.active_version)
  const zone = snapshot.event.timezone
  const live = snapshot.items.filter(isActive)
  const finish = live.reduce((max, item) => Math.max(max, endMs(item)), 0)
  const curfew = toMs(snapshot.event.curfew_at)
  const items = [...live].sort((a, b) => toMs(a.start_at) - toMs(b.start_at)).map((item) => ({
    id: item.id,
    title: item.title,
    start: formatClock(item.start_at, zone),
    end: formatClock(new Date(endMs(item)).toISOString(), zone),
    status: item.status,
    duration_min: Math.round(item.duration_seconds / 60),
    min_duration_min: Math.round(item.min_duration_seconds / 60),
    swappable: item.swappable,
    fixed_start: snapshot.constraints.some((c) => c.item_id === item.id && c.type === 'fixed_start'),
    protected: isBreak(item, snapshot),
    pic: item.pic_role_ids.map((id) => snapshot.roles.find((r) => r.id === id)?.label ?? id),
  }))
  return {
    ok: true,
    data: {
      version: event.active_version,
      autonomy: autonomyEnabled() ? 'otonom' : 'konfirmasi',
      items_count: items.length,
      projected_finish: live.length ? formatClock(new Date(finish).toISOString(), zone) : null,
      now: formatClock(serverNow(event.sim_clock_at), zone),
      timezone: zone,
      curfew: formatClock(snapshot.event.curfew_at, zone),
      slack_minutes: Math.round((curfew - finish) / 60_000),
      items,
    },
  }
}

interface PatchRow {
  id: string
  rank: number
  label: string
  items_changed: number
  total_shift_seconds: number
  diff: ItemDiff[]
  impact: Array<{ level: string; role_label: string }>
  configuration_diff?: Array<{ field: string; old: string; new: string }>
}

/**
 * Buat change dan analisis preview. Penerapan hanya lewat konfirmasi koordinator di website.
 */
export async function handleDelta(session: Session, delta: Delta, summaryText: string): Promise<ToolOutcome> {
  requireCoordinator(session)
  const event = await getEvent(session.event_id)
  const snapshot = await getSnapshot(session.event_id, event.active_version)
  const zone = snapshot.event.timezone
  if (delta.type !== 'revert_decision' && delta.type !== 'revise_rundown' && delta.type !== 'configure_event') {
    const target = snapshot.items.find((i) => i.id === delta.item_id)
    if (!target) return { ok: false, error: 'Item tidak ditemukan. Panggil get_rundown_summary dulu.' }
    if (isBreak(target, snapshot)) return { ok: false, error: `${target.title} adalah istirahat (ishoma) dan tidak dapat diubah otomatis.` }
  }

  const now = serverNow(event.sim_clock_at)
  const created = await createChange(session, session.event_id, { original_text: summaryText.slice(0, 200), reference_at: now })
  await analyseChange(session, created.change_id, { delta, base_version: event.active_version, idempotency_key: `agent-${randomUUID()}` }, 'confirm')
  return finishChange(session, created.change_id, created.seq, event.active_version, zone)
}

/** Ringkas pratinjau committed; belum ada versi aktif atau brief baru. */
async function finishChange(session: Session, changeId: string, seq: number, baseVersion: number, zone: string): Promise<ToolOutcome> {
  const detail = await getChangeDetail(session, changeId)
  const patches = detail.patches as unknown as PatchRow[]
  const analysis = detail.analysis as null | { rejected?: Array<{ label: string; violations: Array<{ message: string }> }>; search_meta?: { note?: string } }
  const rejected = (analysis?.rejected ?? []).slice(0, 3)
  const clock = (iso: string) => formatClock(iso, zone)
  const candidates = patches.map((p) => ({
    rank: p.rank,
    label: p.label,
    items_changed: p.items_changed,
    total_shift_min: Math.round(p.total_shift_seconds / 60),
    changes: p.diff.map((d) => ({ item: d.title, old: d.old ? `${clock(d.old.start_at)}–${clock(d.old.end_at)}` : 'Item baru', new: d.new.status === 'cancelled' ? 'DIBATALKAN' : `${clock(d.new.start_at)}–${clock(d.new.end_at)}` })),
    action_roles: p.impact.filter((r) => r.level === 'ACTION_REQUIRED').map((r) => r.role_label),
    fyi_roles: p.impact.filter((r) => r.level === 'FYI').map((r) => r.role_label),
    configuration_changes: p.configuration_diff ?? [],
  }))
  const base = {
    change: `CH-${seq}`,
    candidate_count: patches.length,
    candidates,
    rejected_count: analysis?.rejected?.length ?? 0,
    rejected_examples: rejected.map((r) => ({ label: r.label, reasons: r.violations.map((v) => v.message).slice(0, 2) })),
    search_note: analysis?.search_meta?.note ?? null,
  }

  if (!patches.length) {
    return { ok: true, data: { ...base, applied: false, status: 'tidak_ada_opsi_lolos', note: 'Tidak ada yang diubah. Rundown aktif tetap.' } }
  }
  const best = patches[0]
  const href = `/changes/${changeId}`
  return {
    ok: true,
    proposal: { change_id: changeId, href, label: `Tinjau usulan CH-${seq}`, applied: false, preview: { base_version: baseVersion, patch_id: best.id, candidate_rank: best.rank, label: best.label, timezone: zone, diff: best.diff, configuration_diff: best.configuration_diff, candidates: patches.map(p => ({ patch_id: p.id, rank: p.rank, label: p.label, diff: p.diff, configuration_diff: p.configuration_diff })) } },
    data: { ...base, base_version: baseVersion, applied: false, status: 'menunggu_konfirmasi', recommended_option: candidates[0], review_link: href, note: 'Preview tersimpan. Rundown aktif dan brief berubah hanya setelah konfirmasi di dialog website.' },
  }
}

async function propose(session: Session, raw: unknown): Promise<ToolOutcome> {
  requireCoordinator(session)
  const args = ProposeInput.parse(raw)
  const event = await getEvent(session.event_id)
  const snapshot = await getSnapshot(session.event_id, event.active_version)
  const item = snapshot.items.find((i) => i.id === args.item_id)
  if (!item) return { ok: false, error: 'Item tidak ditemukan. Panggil get_rundown_summary dulu.' }
  if (isBreak(item, snapshot)) return { ok: false, error: `${item.title} adalah istirahat (ishoma) dan tidak dapat diubah otomatis.` }
  const built = toDelta(args, item, snapshot, serverNow(event.sim_clock_at))
  if ('error' in built) return { ok: false, error: built.error }
  return handleDelta(session, built.delta, args.summary)
}

async function editRundown(session: Session, raw: unknown): Promise<ToolOutcome> {
  requireCoordinator(session)
  const input = EditRundownInputSchema.parse(raw)
  const event = await getEvent(session.event_id)
  if (input.base_version !== event.active_version) throw new AppError('STALE_VERSION', `Rundown sudah v${event.active_version}; baca ulang versi aktif.`)
  const snapshot = await getSnapshot(session.event_id, event.active_version)
  const now = serverNow(event.sim_clock_at)
  const proposed = buildEditedRundown(snapshot, input, now)
  const delta: Delta = { type: 'revise_rundown', snapshot: proposed, is_estimate: false, reference_at: now }
  const created = await createChange(session, session.event_id, { original_text: input.summary, reference_at: now })
  await analyseChange(session, created.change_id, { delta, base_version: input.base_version, idempotency_key: `agent-edit-${randomUUID()}` }, 'confirm')
  return finishChange(session, created.change_id, created.seq, input.base_version, snapshot.event.timezone)
}

async function recommend(session: Session): Promise<ToolOutcome> {
  const event = await getEvent(session.event_id)
  const snapshot = await getSnapshot(session.event_id, event.active_version)
  const now = serverNow(event.sim_clock_at)
  const recommendations = recommendReschedules(snapshot, now)
  return { ok: true, data: { base_version: event.active_version, now, timezone: snapshot.event.timezone, recommendations, status: recommendations.length ? 'rekomendasi_siap' : 'jadwal_sudah_efektif', applied: false, note: recommendations.length ? 'Rekomendasi sudah divalidasi. Panggil edit_rundown dengan operations terpilih untuk menyiapkan dialog konfirmasi.' : 'Tidak ada pemajuan sesi yang layak untuk mengisi jeda. Gunakan edit_rundown untuk rencana spesifik atau sesi pengganti yang diminta pengguna.' } }
}

async function configureEvent(session: Session, raw: unknown): Promise<ToolOutcome> {
  requireCoordinator(session)
  const input = EditEventConfigurationInputSchema.parse(raw)
  const event = await getEvent(session.event_id)
  if (input.base_version !== event.active_version) throw new AppError('STALE_VERSION', `Rundown sudah v${event.active_version}; baca ulang versi aktif.`)
  const snapshot = await getSnapshot(session.event_id, event.active_version)
  const now = serverNow(event.sim_clock_at)
  const proposed = buildEventConfiguration(snapshot, input, now)
  const delta: Delta = { type: 'configure_event', snapshot: proposed, is_estimate: false, reference_at: now }
  const created = await createChange(session, session.event_id, { original_text: input.summary, reference_at: now })
  await analyseChange(session, created.change_id, { delta, base_version: input.base_version, idempotency_key: `agent-config-${randomUUID()}` }, 'confirm')
  return finishChange(session, created.change_id, created.seq, input.base_version, proposed.event.timezone)
}

/** Batalkan keputusan: change kompensasi → analisis terhadap versi aktif → terapkan bila lolos (aktivitas yang sudah berlangsung tidak dikembalikan). */
export async function undoDecision(session: Session, decisionId: string | null | undefined): Promise<ToolOutcome> {
  requireCoordinator(session)
  const rows = await query<{ id: string; seq: number }>(
    `SELECT d.id, c.seq FROM decisions d JOIN changes c ON c.id = d.change_id
      WHERE d.event_id = $1 AND ($2::uuid IS NULL OR d.id = $2::uuid) ORDER BY d.approved_at DESC LIMIT 1`,
    [session.event_id, decisionId ?? null],
  )
  if (!rows[0]) return { ok: false, error: 'Belum ada keputusan yang bisa dibatalkan.' }
  const event = await getEvent(session.event_id)
  const snapshot = await getSnapshot(session.event_id, event.active_version)
  const comp = await createCompensation(session, rows[0].id, { reason: `Batalkan CH-${rows[0].seq} lewat ${AGENT_NAME}` })
  await analyseChange(session, comp.change_id, { base_version: event.active_version, idempotency_key: `agent-undo-${randomUUID()}` }, 'confirm')
  return finishChange(session, comp.change_id, comp.seq, event.active_version, snapshot.event.timezone)
}

/** Ringkasan deterministik hasil tool untuk jalur tanpa AI. */
export function describeOutcome(outcome: ToolOutcome): string {
  if (!outcome.ok) return outcome.error
  const d = outcome.data as {
    applied?: boolean; status?: string; new_version?: number; briefs_sent?: number
    applied_option?: { label: string; changes: Array<{ item: string; old: string; new: string }>; action_roles: string[] }
    rejected_examples?: Array<{ reasons: string[] }>; review_link?: string
  }
  if (d.applied && d.applied_option) {
    const changes = d.applied_option.changes.map((c) => `${c.item} ${c.old} → ${c.new}`).join('; ')
    return [
      `Diterapkan otomatis: ${d.applied_option.label}. Rundown sekarang v${d.new_version}.`,
      changes ? `Perubahan: ${changes}.` : 'Jadwal item lain tetap.',
      `Brief terkirim ke ${d.briefs_sent} peran${d.applied_option.action_roles.length ? ` (${d.applied_option.action_roles.join(', ')})` : ''}.`,
      'Ishoma, slot tetap, dan curfew tetap terjaga. Tulis "batalkan perubahan terakhir" bila ingin membatalkan.',
    ].join('\n')
  }
  if (d.status === 'tidak_ada_opsi_lolos') {
    const reasons = [...new Set((d.rejected_examples ?? []).flatMap((r) => r.reasons))].slice(0, 2).join(' ')
    return `Tidak ada opsi yang lolos dalam pencarian ini, jadi rundown tidak diubah.${reasons ? `\nPenghalang: ${reasons}` : ''}`
  }
  return `Usulan siap ditinjau di ${d.review_link ?? 'halaman perubahan'}. Rundown aktif belum berubah.`
}

/** Jalankan satu tool dengan validasi input. Semua error dikembalikan sebagai hasil, tidak melempar. */
export async function executeTool(session: Session, name: string, input: unknown): Promise<ToolOutcome> {
  try {
    const parsed = validateToolInput(name, input)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    input = parsed.data
    if (name === 'get_event_context') {
      const event = await getEvent(session.event_id)
      return { ok: true, data: buildAgentContext(session, await getSnapshot(session.event_id, event.active_version), event.active_version, serverNow(event.sim_clock_at), 'confirm') }
    }
    if (name === 'get_rundown_summary') {
      SummaryInput.parse(input)
      return await summary(session)
    }
    if (name === 'propose_schedule_change') return await propose(session, input)
    if (name === 'edit_rundown') return await editRundown(session, input)
    if (name === 'edit_event_configuration') return await configureEvent(session, input)
    if (name === 'recommend_reschedule') return await recommend(session)
    if (name === 'undo_decision') return await undoDecision(session, UndoInput.parse(input).decision_id)
    if (name === 'list_changes') {
      SummaryInput.parse(input)
      const rows = await listChanges(session, session.event_id) as Array<{ seq: number; kind: string; status: string; original_text: string | null; actor_name: string; base_version: number | null }>
      return { ok: true, data: { changes: rows.slice(0, 10).map((c) => ({ change: `CH-${c.seq}`, kind: c.kind, status: c.status, text: c.original_text, reported_by: c.actor_name, base_version: c.base_version })) } }
    }
    if (name === 'get_history') {
      SummaryInput.parse(input)
      const h = await history(session, session.event_id)
      const decisions = (h.decisions as Array<Record<string, unknown>>).slice(0, 5).map((d) => ({
        change: `CH-${d.seq}`, option: d.patch_label, version: `v${d.base_version}→v${d.new_version}`, approved_by: d.approved_by, reason: d.reason,
        unread_roles: ((d.acks as Array<{ role_label: string; acknowledged_at: string | null }>) ?? []).filter((a) => !a.acknowledged_at).map((a) => a.role_label),
        read_roles: ((d.acks as Array<{ role_label: string; acknowledged_at: string | null }>) ?? []).filter((a) => a.acknowledged_at).map((a) => a.role_label),
      }))
      return { ok: true, data: { active_version: h.event.active_version, pending_acks: h.pending_acks, decisions } }
    }
    if (name === 'get_my_inbox') {
      SummaryInput.parse(input)
      const box = await inbox(session, session.event_id)
      return { ok: true, data: { role: box.role.label, unread: box.unread, briefs: box.briefs.slice(0, 5).map((b) => ({ version: b.version, level: b.level, text: b.rendered, read: !!b.acknowledged_at, superseded: !!b.superseded_by })) } }
    }
    return { ok: false, error: 'Tool tidak dikenal atau tidak diizinkan.' }
  } catch (error) {
    return { ok: false, error: messageOf(error), ...(error instanceof AppError ? { code: error.code } : {}) }
  }
}
