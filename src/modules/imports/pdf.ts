// Pembaca PDF berteks: rekonstruksi baris dari posisi teks (x/y) agar kolom tabel tetap terpisah.
import { createHash } from 'node:crypto'
import { extractTextItems, getDocumentProxy } from 'unpdf'
import { AppError } from '@/lib/errors'
import { MAX_IMPORT_PAGES } from './types'

export interface PdfText { pageCount: number; pagesRead: number[]; lines: string[]; sha256: string }

/** Pemisah kolom pada baris hasil rekonstruksi; dipakai pembaca aturan dan prompt AI. */
export const COLUMN_SEPARATOR = ' | '

export function isPdf(bytes: Uint8Array): boolean {
  return bytes.length > 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d // %PDF-
}

/** "1-4, 6" → [1,2,3,4,6]. Kosong → semua halaman (maks 40). */
export function parsePageRange(spec: string | null | undefined, pageCount: number): number[] {
  const all = Array.from({ length: Math.min(pageCount, MAX_IMPORT_PAGES) }, (_, i) => i + 1)
  const text = (spec ?? '').trim()
  if (!text) return all
  if (!/^[\d\s,\-–]+$/.test(text)) throw new AppError('VALIDATION_ERROR', 'Halaman ditulis seperti 1-4 atau 1,3,5.')
  const pages = new Set<number>()
  for (const part of text.split(',').map((p) => p.trim()).filter(Boolean)) {
    const [a, b] = part.split(/[-–]/).map((n) => Number(n.trim()))
    const from = a
    const to = b === undefined || Number.isNaN(b) ? a : b
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) throw new AppError('VALIDATION_ERROR', `Rentang halaman "${part}" tidak valid.`)
    if (to > pageCount) throw new AppError('VALIDATION_ERROR', `Dokumen hanya punya ${pageCount} halaman.`)
    for (let p = from; p <= to; p++) pages.add(p)
  }
  const sorted = [...pages].sort((x, y) => x - y)
  if (sorted.length > MAX_IMPORT_PAGES) throw new AppError('VALIDATION_ERROR', `Maksimal ${MAX_IMPORT_PAGES} halaman per impor.`)
  return sorted
}

interface Item { str: string; x: number; y: number; width: number; height: number }

/** Kelompokkan potongan teks per baris (y sama), urutkan kiri→kanan, beri pemisah kolom bila jarak lebar. */
export function itemsToLines(items: Item[]): string[] {
  const rows: Array<{ y: number; parts: Item[] }> = []
  for (const item of items) {
    if (!item.str.trim()) continue
    const tolerance = Math.max(2, (item.height || 10) * 0.4)
    const row = rows.find((r) => Math.abs(r.y - item.y) <= tolerance)
    if (row) row.parts.push(item)
    else rows.push({ y: item.y, parts: [item] })
  }
  rows.sort((a, b) => b.y - a.y)
  return rows
    .map(({ parts }) => {
      parts.sort((a, b) => a.x - b.x)
      let line = ''
      let end = -Infinity
      for (const part of parts) {
        const gap = part.x - end
        const height = part.height || 10
        if (line) line += gap > height * 1.6 ? COLUMN_SEPARATOR : gap > height * 0.15 ? ' ' : ''
        line += part.str.trim()
        end = part.x + part.width
      }
      return line.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim()
    })
    .filter(Boolean)
}

export async function readPdf(bytes: Uint8Array, pageSpec: string | null): Promise<PdfText> {
  if (!isPdf(bytes)) throw new AppError('VALIDATION_ERROR', 'Berkas bukan PDF yang valid.')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  let extracted: { totalPages: number; items: Item[][] }
  try {
    // unpdf memakai buffer ini; salin agar Uint8Array asli tidak ter-detach.
    const pdf = await getDocumentProxy(new Uint8Array(bytes))
    extracted = await extractTextItems(pdf)
  } catch {
    throw new AppError('VALIDATION_ERROR', 'PDF tidak dapat dibaca. Pastikan berkas tidak rusak atau terkunci kata sandi.')
  }
  const pagesRead = parsePageRange(pageSpec, extracted.totalPages)
  const lines = pagesRead.flatMap((page) => itemsToLines(extracted.items[page - 1] ?? []))
  if (!lines.length) throw new AppError('VALIDATION_ERROR', 'Tidak ada teks di PDF. Dokumen hasil scan/foto belum didukung; gunakan PDF berteks.')
  return { pageCount: extracted.totalPages, pagesRead, lines: lines.slice(0, 1500), sha256 }
}
