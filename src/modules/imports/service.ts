// Alur impor PDF: unggah → ekstraksi (AI, cadangan aturan) → draft tersimpan → edit opsional → aktivasi sebagai versi baru.
// Isian manual memakai draft dan aktivasi yang sama.
import { createHash } from 'node:crypto'
import { serverNow } from '@/lib/clock'
import { query } from '@/lib/db'
import { env } from '@/lib/env'
import { AppError, notFound } from '@/lib/errors'
import { log } from '@/lib/logger'
import { requireCoordinator, requireEvent, type Session } from '@/lib/session'
import { localDate } from '@/lib/time'
import { validateSnapshot } from '@/modules/engine/validate'
import { getEvent, getSnapshot, saveSetup } from '@/modules/events/service'
import { aiExtractRows, ImportAiUnavailableError } from './ai-extract'
import { manualToRaw } from './manual'
import { buildSnapshot, matchRole, normalizeRows } from './normalize'
import { readPdf } from './pdf'
import { ruleExtractRows } from './rule-extract'
import {
  IMPORTS_PER_MINUTE,
  ImportRowSchema,
  ImportSettingsSchema,
  MAX_IMPORT_ROWS,
  type ImportDraft,
  type ImportFlag,
  type ImportRecord,
  type ImportRow,
  type ImportSettings,
  type ManualImportInput,
  type RawRow,
} from './types'

const MANUAL_FILENAME = 'Isian manual'

function parseSettings(raw: unknown): ImportSettings {
  const parsed = ImportSettingsSchema.safeParse(raw)
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Pengaturan acara tidak valid.')
  return parsed.data
}

async function rateLimit(session: Session) {
  const key = `import:${session.session_id}`
  const recent = await query<{ n: string }>(`SELECT count(*) AS n FROM parse_usage WHERE session_id = $1 AND at > now() - interval '1 minute'`, [key])
  if (Number(recent[0].n) >= IMPORTS_PER_MINUTE) throw new AppError('RATE_LIMITED', 'Terlalu banyak unggahan. Tunggu sebentar lalu coba lagi.')
  await query('INSERT INTO parse_usage (session_id) VALUES ($1)', [key])
}

/** AI lebih dulu; bila tidak tersedia atau tidak menemukan baris, pembaca aturan dipakai. */
async function extractRows(lines: string[]): Promise<{ raw: RawRow[]; parser: 'ai' | 'rule'; warnings: string[] }> {
  const cfg = env()
  try {
    const raw = await aiExtractRows(lines, {
      provider: cfg.AI_PROVIDER,
      model: cfg.AI_MODEL,
      anthropicKey: cfg.ANTHROPIC_API_KEY,
      openaiBaseUrl: cfg.OPENAI_BASE_URL,
      openaiKey: cfg.OPENAI_API_KEY,
    })
    if (raw.length) return { raw, parser: 'ai', warnings: [] }
    throw new ImportAiUnavailableError('AI tidak menemukan baris.')
  } catch (error) {
    if (!(error instanceof ImportAiUnavailableError)) throw error
    log('warn', 'import_ai_fallback', { reason: error.message })
    const raw = ruleExtractRows(lines)
    return { raw, parser: 'rule', warnings: cfg.AI_PROVIDER === 'rule' ? [] : ['AI Lancara tidak tersedia; data dibaca dengan pola tabel. Periksa hasilnya sebelum diaktifkan.'] }
  }
}

function toRecord(row: { id: string; status: ImportRecord['status']; settings: ImportSettings; draft: ImportDraft; applied_version: number | null; created_at: Date | string }): ImportRecord {
  return { id: row.id, status: row.status, settings: row.settings, draft: row.draft, applied_version: row.applied_version, created_at: new Date(row.created_at).toISOString() }
}

export async function createImport(session: Session, eventId: string, input: { filename: string; bytes: Uint8Array; pages: string | null; settings: unknown }): Promise<ImportRecord> {
  requireEvent(session, eventId)
  requireCoordinator(session)
  const settings = parseSettings(input.settings)
  if (!/\.pdf$/i.test(input.filename)) throw new AppError('VALIDATION_ERROR', 'Format berkas harus PDF (.pdf).')
  await rateLimit(session)
  const pdf = await readPdf(input.bytes, input.pages)
  const event = await getEvent(eventId)
  const snapshot = await getSnapshot(eventId, event.active_version)
  const extracted = await extractRows(pdf.lines)
  if (!extracted.raw.length) throw new AppError('VALIDATION_ERROR', 'Tidak menemukan baris rundown berjam di PDF. Pastikan setiap segmen diawali jam mulai (mis. 08:30).')
  const { rows, warnings } = normalizeRows(extracted.raw, snapshot.roles)
  const draft: ImportDraft = {
    source: { filename: input.filename, sha256: pdf.sha256, size_bytes: input.bytes.byteLength, page_count: pdf.pageCount, pages_read: pdf.pagesRead },
    parser: extracted.parser,
    rows,
    warnings: [...extracted.warnings, ...warnings],
  }
  const inserted = await query<{ id: string; created_at: Date }>(
    `INSERT INTO rundown_imports (event_id, actor_id, filename, kind, sha256, size_bytes, page_count, pages_read, row_count, parser, settings, draft)
     VALUES ($1, $2, $3, 'pdf', $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id, created_at`,
    [eventId, session.actor_id, input.filename, pdf.sha256, input.bytes.byteLength, pdf.pageCount, input.pages?.trim() || null, rows.length, extracted.parser, JSON.stringify(settings), JSON.stringify(draft)],
  )
  // Isi dokumen tidak pernah dilog; hanya metadata.
  log('info', 'import_created', { import_id: inserted[0].id, parser: extracted.parser, rows: rows.length, pages: pdf.pagesRead.length })
  return { id: inserted[0].id, status: 'draft', settings, draft, applied_version: null, created_at: new Date(inserted[0].created_at).toISOString() }
}

/** Isian manual (Figma "Siapkan Data"): baris dinormalisasi seperti hasil baca PDF agar langkah tinjau sama. */
export async function createManualImport(session: Session, eventId: string, input: ManualImportInput): Promise<ImportRecord> {
  requireEvent(session, eventId)
  requireCoordinator(session)
  await rateLimit(session)
  const event = await getEvent(eventId)
  const snapshot = await getSnapshot(eventId, event.active_version)
  const { rows, warnings } = normalizeRows(input.rows.map(manualToRaw), snapshot.roles)
  const json = JSON.stringify(input.rows)
  const draft: ImportDraft = {
    source: { filename: MANUAL_FILENAME, sha256: createHash('sha256').update(json).digest('hex'), size_bytes: Buffer.byteLength(json), page_count: 1, pages_read: [] },
    parser: 'manual',
    rows,
    warnings,
  }
  const inserted = await query<{ id: string; created_at: Date }>(
    `INSERT INTO rundown_imports (event_id, actor_id, filename, kind, sha256, size_bytes, page_count, pages_read, row_count, parser, settings, draft)
     VALUES ($1, $2, $3, 'manual', $4, $5, 1, NULL, $6, 'manual', $7, $8) RETURNING id, created_at`,
    [eventId, session.actor_id, MANUAL_FILENAME, draft.source.sha256, draft.source.size_bytes, rows.length, JSON.stringify(input.settings), JSON.stringify(draft)],
  )
  log('info', 'import_created', { import_id: inserted[0].id, parser: 'manual', rows: rows.length })
  return { id: inserted[0].id, status: 'draft', settings: input.settings, draft, applied_version: null, created_at: new Date(inserted[0].created_at).toISOString() }
}

async function loadImport(eventId: string, importId: string): Promise<ImportRecord> {
  if (!/^[0-9a-f-]{36}$/i.test(importId)) throw notFound('Impor')
  const rows = await query<Parameters<typeof toRecord>[0]>('SELECT id, status, settings, draft, applied_version, created_at FROM rundown_imports WHERE id = $1 AND event_id = $2', [importId, eventId])
  if (!rows[0]) throw notFound('Impor')
  return toRecord(rows[0])
}

export async function getImport(session: Session, eventId: string, importId: string): Promise<ImportRecord> {
  requireEvent(session, eventId)
  requireCoordinator(session)
  return loadImport(eventId, importId)
}

/** Flag PIC/durasi dihitung ulang setelah koordinator melengkapi data; flag lain dipertahankan. */
function reflag(row: ImportRow, previous: ImportRow | undefined): ImportRow {
  const keep = row.flags.filter((f) => !['PIC_UNKNOWN', 'PIC_MISSING', 'DURATION_GUESSED'].includes(f.code))
  const flags: ImportFlag[] = [...keep]
  if (!row.pic_role_ids.length) flags.push(row.pic_names.length ? { level: 'warn', code: 'PIC_UNKNOWN', message: `PIC ${row.pic_names.join(', ')} ditulis bebas; peran sistem memakai default Koordinator.` } : { level: 'warn', code: 'PIC_MISSING', message: 'PIC belum tertulis.' })
  const guessed = previous?.flags.find((f) => f.code === 'DURATION_GUESSED')
  if (guessed && previous?.duration_min === row.duration_min) flags.push(guessed)
  return { ...row, flags }
}

export async function updateImportRows(session: Session, eventId: string, importId: string, input: { rows: unknown; settings?: unknown }): Promise<ImportRecord> {
  requireEvent(session, eventId)
  requireCoordinator(session)
  const parsed = ImportRowSchema.array().min(1).max(MAX_IMPORT_ROWS).safeParse(input.rows)
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Data baris tidak valid.', parsed.error.issues.slice(0, 5))
  const current = await loadImport(eventId, importId)
  if (current.status !== 'draft') throw new AppError('INVALID_STATE', 'Impor ini sudah diaktifkan atau dibuang.')
  const event = await getEvent(eventId)
  const roleList = (await getSnapshot(eventId, event.active_version)).roles
  const roles = new Set(roleList.map((r) => r.id))
  // PIC teks bebas: peran sistem diturunkan dari nama yang ditulis.
  const picRoles = (row: ImportRow) => row.pic_names.length
    ? [...new Set(row.pic_names.flatMap((name) => { const id = matchRole(name, roleList); return id ? [id] : [] }))]
    : row.pic_role_ids.filter((id) => roles.has(id))
  const rows = parsed.data.map((row, i) => reflag({ ...row, row_no: i + 1, pic_role_ids: picRoles(row) }, current.draft.rows[i]))
  const settings = input.settings === undefined ? current.settings : parseSettings(input.settings)
  const draft: ImportDraft = { ...current.draft, rows }
  await query(`UPDATE rundown_imports SET draft = $3, settings = $4, row_count = $5, updated_at = now() WHERE id = $1 AND event_id = $2 AND status = 'draft'`, [importId, eventId, JSON.stringify(draft), JSON.stringify(settings), rows.length])
  return { ...current, settings, draft }
}

/** Aktivasi: data impor MENIMPA rundown aktif (item lama diganti seluruhnya) di atas versi terbaru, tanpa konflik versi; idempoten dan divalidasi engine. */
export async function applyImport(session: Session, eventId: string, importId: string, input: { base_version: number; idempotency_key: string }) {
  requireEvent(session, eventId)
  requireCoordinator(session)
  const record = await loadImport(eventId, importId)
  if (record.status === 'applied') return { new_version: record.applied_version!, import_id: importId, replayed: true }
  if (record.status !== 'draft') throw new AppError('INVALID_STATE', 'Impor ini sudah dibuang.')
  const event = await getEvent(eventId)
  const base = await getSnapshot(eventId, event.active_version)
  // Tanggal acara mengikuti rundown aktif (atau jam server bila rundown kosong).
  const anchor = base.items[0]?.start_at ?? serverNow(event.sim_clock_at)
  const snapshot = buildSnapshot(record.draft.rows, record.settings, base, localDate(anchor, base.event.timezone))
  const { errors } = validateSnapshot(snapshot)
  if (errors.length) throw new AppError('VALIDATION_ERROR', 'Rundown belum bisa diaktifkan: perbaiki data berikut.', errors)
  const result = await saveSetup(session, eventId, { base_version: event.active_version, snapshot, idempotency_key: input.idempotency_key, origin: 'import', import_filename: record.draft.source.filename, note: (record.draft.parser === 'manual' ? 'Isian manual (Tambah Rundown)' : `Impor PDF ${record.draft.source.filename}`).slice(0, 200) })
  await query(`UPDATE rundown_imports SET status = 'applied', applied_version = $3, updated_at = now() WHERE id = $1 AND event_id = $2 AND status = 'draft'`, [importId, eventId, result.new_version])
  log('info', 'import_applied', { import_id: importId, version: result.new_version, items: snapshot.items.length })
  return { new_version: result.new_version, import_id: importId, replayed: result.replayed }
}
