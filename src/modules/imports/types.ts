// Kontrak impor rundown dari PDF. Draft disimpan di rundown_imports.draft (jsonb) dan ditinjau sebelum aktivasi.
import { z } from 'zod'

export const MAX_IMPORT_BYTES = 4 * 1024 * 1024 // batas body Vercel 4,5 MB
export const MAX_IMPORT_PAGES = 40
export const MAX_IMPORT_ROWS = 60 // sama dengan batas SnapshotSchema.items
export const IMPORTS_PER_MINUTE = 5

const Hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Jam harus HH:MM')
const Line = z.string().trim().min(1).max(200)

/** Pengaturan acara dari langkah 1 (Figma "Pengaturan acara"). */
export const ImportSettingsSchema = z.object({
  name: z.string().trim().min(1, 'Nama acara wajib diisi.').max(120),
  timezone: z.enum(['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura']),
  curfew_hhmm: Hhmm.nullable(),
})
export type ImportSettings = z.infer<typeof ImportSettingsSchema>

export const FLAG_CODES = ['PIC_UNKNOWN', 'PIC_MISSING', 'DURATION_GUESSED', 'OVERNIGHT', 'OVERLAP', 'TITLE_TRUNCATED'] as const
export type FlagCode = (typeof FLAG_CODES)[number]
export interface ImportFlag { level: 'error' | 'warn'; code: FlagCode; message: string }

/** Satu baris rundown hasil ekstraksi atau isian manual (kolom Figma: Waktu, Segmen, Durasi, PIC, Pihak yang terlibat, Perlengkapan, Teknis). */
export const ImportRowSchema = z.object({
  row_no: z.number().int().min(1),
  start_hhmm: Hhmm,
  duration_min: z.number().int().min(1).max(24 * 60),
  title: z.string().trim().min(1).max(120),
  segment: z.string().trim().max(80).nullable(),
  pic_names: z.array(z.string().trim().min(1).max(80)).max(10),
  pic_role_ids: z.array(z.string().min(1).max(64)).max(10),
  involved: z.array(Line).max(20).default([]),
  equipment: z.array(Line).max(20),
  notes: z.array(Line).max(20),
  fixed_start: z.boolean(),
  flags: z.array(z.object({ level: z.enum(['error', 'warn']), code: z.enum(FLAG_CODES), message: z.string().max(300) })).max(10),
})
export type ImportRow = z.infer<typeof ImportRowSchema>

export interface ImportDraft {
  source: { filename: string; sha256: string; size_bytes: number; page_count: number; pages_read: number[] }
  parser: 'rule' | 'ai' | 'manual'
  rows: ImportRow[]
  warnings: string[]
}

/** Baris mentah sebelum dinormalisasi; dihasilkan pembaca aturan maupun AI. */
export interface RawRow {
  start_hhmm: string
  end_hhmm: string | null
  duration_min: number | null
  title: string
  segment: string | null
  pic: string[]
  involved?: string[]
  equipment: string[]
  notes: string[]
  fixed_start: boolean
}

export interface ImportRecord {
  id: string
  status: 'draft' | 'applied' | 'discarded'
  settings: ImportSettings
  draft: ImportDraft
  applied_version: number | null
  created_at: string
}

/** Satu poin dari overlay "Tambahkan poin rundown" (Figma 179:2324). Teks daftar dipisah koma/baris di server. */
export const ManualRowSchema = z
  .object({
    start_hhmm: Hhmm,
    end_hhmm: Hhmm.nullable(),
    duration_min: z.number().int().min(1).max(24 * 60).nullable(),
    title: z.string().trim().min(1, 'Segmen wajib diisi.').max(120),
    pic: z.string().trim().max(400),
    involved: z.string().trim().max(1000),
    equipment: z.string().trim().max(2000),
    notes: z.string().trim().max(2000),
  })
  .refine((row) => row.duration_min !== null || row.end_hhmm !== null, { message: 'Isi durasi atau jam selesai.', path: ['duration_min'] })
export type ManualRow = z.infer<typeof ManualRowSchema>

export const ManualImportInputSchema = z.object({
  settings: ImportSettingsSchema,
  rows: z.array(ManualRowSchema).min(1, 'Tambahkan minimal satu poin rundown.').max(MAX_IMPORT_ROWS),
})
export type ManualImportInput = z.infer<typeof ManualImportInputSchema>
