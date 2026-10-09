// Pembaca berbasis aturan (tanpa AI): baris yang diawali jam menjadi item; header kolom memetakan sel.
import { COLUMN_SEPARATOR } from './pdf'
import type { RawRow } from './types'

type Column = 'time' | 'title' | 'segment' | 'duration' | 'pic' | 'equipment' | 'notes'

const HEADER: Array<[Column, RegExp]> = [
  ['time', /^(waktu|jam|time|pukul|wib)$/i],
  ['title', /^(segmen|acara|mata acara|kegiatan|agenda|aktivitas|sesi|rundown|nama segmen)$/i],
  ['segment', /^(tipe|jenis|kategori|lokasi|tipe segmen)$/i],
  ['duration', /^(durasi|duration|lama)$/i],
  ['pic', /^(pic|penanggung jawab|pj|petugas|pengisi acara|pengisi)$/i],
  ['equipment', /^(perlengkapan|peralatan|kebutuhan|equipment|properti|alat)$/i],
  ['notes', /^(teknis|catatan|keterangan|notes|deskripsi|catatan teknis|instruksi)$/i],
]

const TIME = /^(\d{1,2})[.:](\d{2})(?::\d{2})?\s*(?:wib|wita|wit)?\s*(?:(?:-|–|—|s\.?\s?d\.?|sampai|to)\s*(\d{1,2})[.:](\d{2})(?::\d{2})?\s*(?:wib|wita|wit)?)?/i
const BULLET = /^[•·\-*–]\s+/
const FIXED = /\b(mulai tetap|jam tetap|fixed|tidak boleh (di)?geser)\b/i

const hhmm = (h: string, m: string) => {
  const hour = Number(h)
  const minute = Number(m)
  return hour <= 23 && minute <= 59 ? `${String(hour).padStart(2, '0')}:${m}` : null
}

/** "30'", "30 menit", "30 m", "00:30", "1 jam 15 menit" → menit. */
export function parseDuration(text: string): number | null {
  const t = text.trim().toLowerCase()
  const clock = /^(\d{1,2}):(\d{2})$/.exec(t)
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]) || null
  const hours = /(\d+(?:[.,]\d+)?)\s*(?:jam|j|h|hour|hours)\b/.exec(t)
  const minutes = /(\d+)\s*(?:'|’|menit|mnt|min|m)(?![a-z])/.exec(t)
  if (!hours && !minutes) return /^\d{1,3}$/.test(t) ? Number(t) || null : null
  const total = (hours ? Math.round(Number(hours[1].replace(',', '.')) * 60) : 0) + (minutes ? Number(minutes[1]) : 0)
  return total > 0 ? total : null
}

const splitList = (text: string) => text.split(/\s*;\s*|\s*•\s*/).map((s) => s.trim()).filter(Boolean)
const splitPic = (text: string) => text.split(/\s*(?:\/|,|&|\bdan\b|\+)\s*/i).map((s) => s.trim()).filter(Boolean)

function detectHeader(cells: string[]): Column[] | null {
  const mapped = cells.map((cell) => HEADER.find(([, re]) => re.test(cell.trim()))?.[0] ?? null)
  return mapped.includes('time') && mapped.includes('title') ? (mapped as Column[]) : null
}

function emptyRow(start: string, end: string | null): RawRow {
  return { start_hhmm: start, end_hhmm: end, duration_min: null, title: '', segment: null, pic: [], equipment: [], notes: [], fixed_start: false }
}

/** Isi sel ke kolom; tanpa header: sel pertama judul, durasi dikenali dari pola, sisanya catatan. */
function fillCells(row: RawRow, cells: string[], columns: Column[] | null) {
  cells.forEach((cell, i) => {
    const value = cell.trim()
    if (!value) return
    const column = columns?.[i] ?? (!row.title ? 'title' : parseDuration(value) && row.duration_min === null ? 'duration' : 'notes')
    if (column === 'title') row.title = row.title ? `${row.title} ${value}` : value
    else if (column === 'segment') row.segment = row.segment ? `${row.segment} ${value}` : value
    else if (column === 'duration') row.duration_min = parseDuration(value) ?? row.duration_min
    else if (column === 'pic') row.pic.push(...splitPic(value))
    else if (column === 'equipment') row.equipment.push(...splitList(value))
    else if (column === 'notes') row.notes.push(...splitList(value))
  })
}

export function ruleExtractRows(lines: string[]): RawRow[] {
  const rows: RawRow[] = []
  let columns: Column[] | null = null
  for (const line of lines) {
    const cells = line.split(COLUMN_SEPARATOR).map((c) => c.trim())
    const header = detectHeader(cells)
    if (header) { columns = header; continue }
    const match = TIME.exec(cells[0] ?? '')
    const start = match ? hhmm(match[1], match[2]) : null
    if (start) {
      const end = match![3] ? hhmm(match![3], match![4]) : null
      const row = emptyRow(start, end)
      // Sisa teks pada sel pertama sesudah jam (format "09:00 Pembukaan") dianggap judul.
      const rest = (cells[0] ?? '').slice(match![0].length).replace(/^[\s|:–—-]+/, '').trim()
      // Dengan header, indeks sel = indeks kolom (sel jam dikosongkan); tanpa header, sel dibaca berurutan.
      fillCells(row, columns ? ['', ...cells.slice(1)] : [rest, ...cells.slice(1)].filter(Boolean), columns)
      if (rest && columns && !row.title) row.title = rest
      row.fixed_start = FIXED.test(`${row.segment ?? ''} ${row.title} ${row.notes.join(' ')}`)
      if (row.title) rows.push(row)
      continue
    }
    const previous = rows[rows.length - 1]
    if (!previous) continue
    // Baris lanjutan: butir catatan, atau sel bertingkat dari tabel berkolom.
    if (BULLET.test(line)) previous.notes.push(line.replace(BULLET, '').trim())
    else if (columns && cells.length > 1) fillCells(previous, cells, columns)
    else if (line.length <= 200) previous.notes.push(line)
  }
  return rows.map((r) => ({ ...r, notes: r.notes.slice(0, 20), equipment: r.equipment.slice(0, 20), pic: [...new Set(r.pic)].slice(0, 10) }))
}
