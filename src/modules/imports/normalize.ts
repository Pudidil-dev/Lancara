// Normalisasi baris impor → baris review (flag "Perlu ditinjau") → snapshot rundown yang divalidasi engine.
import { addSeconds, localToUtc } from '@/lib/time'
import { BREAK_PATTERN } from '@/modules/engine/schedule'
import type { Constraint, Item, RoleRef, Snapshot } from '@/modules/engine/types'
import { defaultPicRole } from '@/modules/events/default-pic'
import { MAX_IMPORT_ROWS, type ImportFlag, type ImportRow, type ImportSettings, type RawRow } from './types'

const DEFAULT_DURATION_MIN = 15
const norm = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

/** Nama di dokumen → pola peran. Urutan penting: "stage manager" lebih dulu dari "stage". */
const SYNONYMS: Array<[RegExp, RegExp]> = [
  [/\b(stage ?manager|sm|koordinator|korlap|floor ?director|fd)\b/, /koordinator|stage manager/],
  [/\b(audio|sound|soundman|sound engineer|foh|operator audio)\b/, /audio/],
  [/\b(lighting|lampu|light|lightingman|lightning)\b/, /lighting/],
  [/\b(led|visual|multimedia|vj|video|konten|operator av|av)\b/, /led|visual/],
  [/\b(mc|host|pembawa acara|presenter|emcee)\b/, /\bmc\b/],
  [/\b(lo|liaison|talent|artist|artis|pengisi acara)\b/, /\blo\b|talent/],
  [/\b(stage|crew|kru|panggung|runner|stage crew)\b/, /stage crew|\bstage\b/],
]

/** Cocokkan nama PIC ke peran event; null bila tidak dikenal (koordinator memilih saat review). */
export function matchRole(name: string, roles: RoleRef[]): string | null {
  const n = norm(name)
  if (!n) return null
  const direct = roles.find((r) => norm(r.id) === n || norm(r.label) === n || norm(r.label.replace(/^pic\s+/i, '')) === n)
  if (direct) return direct.id
  for (const [namePattern, rolePattern] of SYNONYMS) {
    if (!namePattern.test(n)) continue
    const role = roles.find((r) => rolePattern.test(norm(`${r.id} ${r.label}`)))
    if (role) return role.id
  }
  return null
}

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

/** Menit absolut sejak 00:00 hari acara; jam yang turun dari baris sebelumnya dianggap lewat tengah malam. */
export function absoluteStarts(starts: string[]): number[] {
  let offset = 0
  let previous = -1
  return starts.map((hhmm) => {
    let value = toMinutes(hhmm) + offset
    // Turun lebih dari 3 jam = hari berikutnya; turun sedikit = baris tidak urut (diberi flag tumpang tindih).
    if (previous >= 0 && value < previous - 180) {
      offset += 24 * 60
      value += 24 * 60
    }
    previous = value
    return value
  })
}

export function normalizeRows(raw: RawRow[], roles: RoleRef[]): { rows: ImportRow[]; warnings: string[] } {
  const warnings: string[] = []
  const source = raw.filter((r) => r.title.trim())
  if (source.length > MAX_IMPORT_ROWS) warnings.push(`Dokumen berisi ${source.length} segmen; hanya ${MAX_IMPORT_ROWS} pertama yang dibaca.`)
  const rows = source.slice(0, MAX_IMPORT_ROWS)
  const starts = absoluteStarts(rows.map((r) => r.start_hhmm))
  let previousEnd = -1
  const result = rows.map((row, i): ImportRow => {
    const flags: ImportFlag[] = []
    const start = starts[i]
    let duration = row.duration_min
    if (!duration && row.end_hhmm) {
      const diff = (toMinutes(row.end_hhmm) - toMinutes(row.start_hhmm) + 1440) % 1440
      duration = diff || null
    }
    if (!duration) {
      const next = starts[i + 1]
      duration = next !== undefined && next > start ? next - start : DEFAULT_DURATION_MIN
      flags.push({ level: 'warn', code: 'DURATION_GUESSED', message: next !== undefined && next > start ? 'Durasi dihitung dari jam segmen berikutnya.' : `Durasi tidak tertulis; diisi ${DEFAULT_DURATION_MIN} menit.` })
    }
    if (i > 0 && start >= 24 * 60 && starts[i - 1] < 24 * 60) flags.push({ level: 'warn', code: 'OVERNIGHT', message: 'Segmen melewati tengah malam (hari berikutnya).' })
    if (previousEnd > start) flags.push({ level: 'warn', code: 'OVERLAP', message: 'Jam mulai bertabrakan dengan segmen sebelumnya.' })
    previousEnd = Math.max(previousEnd, start + duration)
    const mapped = row.pic.map((name) => ({ name, role: matchRole(name, roles) }))
    const unknown = mapped.filter((m) => !m.role).map((m) => m.name)
    const matchedIds = [...new Set(mapped.flatMap(m => m.role ? [m.role] : []))].slice(0, 10)
    const fallback = !matchedIds.length ? defaultPicRole(roles) : undefined
    if (!row.pic.length) flags.push({ level: 'warn', code: 'PIC_MISSING', message: fallback ? `PIC belum tertulis; diisi default ${fallback.label}. Periksa penanggung jawabnya.` : 'PIC belum tertulis.' })
    if (unknown.length) flags.push({ level: 'warn', code: 'PIC_UNKNOWN', message: `PIC ${unknown.join(', ')} ditulis bebas; peran sistem memakai default Koordinator.` })
    const title = row.title.replace(/\s+/g, ' ').trim()
    if (title.length > 120) flags.push({ level: 'warn', code: 'TITLE_TRUNCATED', message: 'Judul dipotong 120 karakter.' })
    return {
      row_no: i + 1,
      start_hhmm: row.start_hhmm,
      duration_min: Math.min(duration, 24 * 60),
      title: title.slice(0, 120),
      segment: row.segment?.trim().slice(0, 80) || null,
      pic_names: [...new Set(row.pic.map((p) => p.slice(0, 80)))].slice(0, 10),
      pic_role_ids: matchedIds.length ? matchedIds : fallback ? [fallback.id] : [],
      involved: (row.involved ?? []).map((p) => p.slice(0, 200)).slice(0, 20),
      equipment: row.equipment.map((e) => e.slice(0, 200)).slice(0, 20),
      notes: row.notes.map((n) => n.slice(0, 200)).slice(0, 20),
      fixed_start: row.fixed_start,
      flags,
    }
  })
  return { rows: result, warnings }
}

/** Slug ASCII untuk ID item (^[a-zA-Z0-9_-]+$), unik dalam satu impor. */
export function slugIds(titles: string[]): string[] {
  const used = new Set<string>()
  return titles.map((title, i) => {
    const base = norm(title).replace(/ /g, '-').slice(0, 40).replace(/-+$/, '') || `segmen-${i + 1}`
    let id = base
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`
    used.add(id)
    return id
  })
}

/**
 * Snapshot baru dari draft: semua item pending, jam lokal → UTC pada tanggal acara, lewat tengah malam → hari berikutnya.
 * Peran dan resource event dipertahankan; dependensi lama dibuang karena item lama diganti.
 */
export function buildSnapshot(rows: ImportRow[], settings: ImportSettings, base: Snapshot, dateYmd: string): Snapshot {
  const tz = settings.timezone
  const ids = slugIds(rows.map((r) => r.title))
  const starts = absoluteStarts(rows.map((r) => r.start_hhmm))
  const knownRoles = new Set(base.roles.map((r) => r.id))
  const fallback = defaultPicRole(base.roles)
  const at = (minutes: number) => addSeconds(localToUtc(dateYmd, '00:00', tz), minutes * 60)
  const items: Item[] = rows.map((row, i) => ({
    id: ids[i],
    title: row.title,
    start_at: at(starts[i]),
    duration_seconds: row.duration_min * 60,
    min_duration_seconds: row.duration_min * 60,
    estimated_end_at: null,
    status: 'pending',
    pic_role_ids: row.pic_role_ids.some(id => knownRoles.has(id))
      ? row.pic_role_ids.filter(id => knownRoles.has(id))
      : fallback ? [fallback.id] : [],
    resource_ids: [],
    swappable: !row.fixed_start && !BREAK_PATTERN.test(row.title),
    segment: row.segment,
    pic_text: row.pic_names.length ? row.pic_names.join(', ').slice(0, 200) : undefined,
    involved: row.involved,
    equipment: row.equipment,
    notes: row.notes,
  }))
  const constraints: Constraint[] = rows.flatMap((row, i) =>
    row.fixed_start ? [{ id: `C-FIX-${ids[i]}`.slice(0, 64), type: 'fixed_start' as const, item_id: ids[i], at: items[i].start_at, hard: true as const, note: `${row.title} mulai tetap ${row.start_hhmm}`.slice(0, 200) }] : [],
  )
  const lastEnd = Math.max(...rows.map((r, i) => starts[i] + r.duration_min), 0)
  let curfew: number
  if (settings.curfew_hhmm) {
    curfew = toMinutes(settings.curfew_hhmm)
    // Batas selesai sebelum segmen pertama berarti lewat tengah malam.
    while (rows.length && curfew <= starts[0]) curfew += 24 * 60
  } else {
    curfew = Math.ceil((lastEnd + 30) / 5) * 5
  }
  return {
    event: { ...base.event, name: settings.name, timezone: tz, curfew_at: at(curfew) },
    roles: base.roles,
    resources: base.resources,
    items,
    dependencies: [],
    constraints,
  }
}
