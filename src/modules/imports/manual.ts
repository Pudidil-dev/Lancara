// Isian manual "Siapkan Data": aman dipakai di klien (tanpa dependensi server).
import type { ManualRow, RawRow } from './types'

const CLOCK = /^([01]?\d|2[0-3])[:.]([0-5]\d)$/

function clock(text: string): string | null {
  const m = CLOCK.exec(text.trim())
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null
}

/** Kolom "Waktu": "15:30" atau rentang "15:30–16:00" (titik/strip/en dash/"s.d." diterima). */
export function parseWaktu(text: string): { start: string; end: string | null } | null {
  const parts = text.split(/\s*(?:[-–—]|s\.?d\.?|sampai)\s*/i).filter(Boolean)
  if (parts.length < 1 || parts.length > 2) return null
  const start = clock(parts[0])
  const end = parts[1] ? clock(parts[1]) : null
  if (!start || (parts[1] && !end)) return null
  return { start, end }
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))
const fromMin = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

/** Durasi efektif: isian durasi, atau selisih rentang jam (lewat tengah malam = hari berikutnya). */
export function manualDuration(row: Pick<ManualRow, 'start_hhmm' | 'end_hhmm' | 'duration_min'>): number | null {
  if (row.duration_min) return row.duration_min
  if (!row.end_hhmm) return null
  return (toMin(row.end_hhmm) - toMin(row.start_hhmm) + 1440) % 1440 || null
}

/** Label kolom WAKTU Figma: "15:30–16:00". */
export function manualRange(row: Pick<ManualRow, 'start_hhmm' | 'end_hhmm' | 'duration_min'>): string {
  const duration = manualDuration(row)
  const end = row.end_hhmm ?? (duration ? fromMin(toMin(row.start_hhmm) + duration) : null)
  return end ? `${row.start_hhmm}–${end}` : row.start_hhmm
}

const list = (text: string, separator: RegExp) => text.split(separator).map((v) => v.trim()).filter(Boolean)
/** Potong teks panjang menjadi butir ≤ 200 karakter (batas skema item). */
const chunks = (lines: string[]) => lines.flatMap((line) => line.match(/[\s\S]{1,200}(?=\s|$)|[\s\S]{1,200}/g) ?? []).map((v) => v.trim()).filter(Boolean)

export function manualToRaw(row: ManualRow): RawRow {
  return {
    start_hhmm: row.start_hhmm,
    end_hhmm: row.end_hhmm,
    duration_min: manualDuration(row),
    title: row.title,
    segment: null,
    pic: list(row.pic, /[,;\n]/).slice(0, 10),
    involved: chunks(list(row.involved, /[,;\n]/)).slice(0, 20),
    equipment: chunks(list(row.equipment, /[,;\n]/)).slice(0, 20),
    notes: chunks(list(row.notes, /\n/)).slice(0, 20),
    fixed_start: false,
  }
}
