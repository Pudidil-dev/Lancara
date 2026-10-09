// Kontrak ekstraksi bersama untuk semua provider. Provider (aturan / model AI) hanya menghasilkan Extraction;
// konversi ke delta dilakukan deterministik di sini. AI tidak menentukan penerima, batas, atau feasibility (NFR-05).
import { z } from 'zod'
import { addSeconds, formatClock, localDate, localToUtc, toMs } from '@/lib/time'
import { endIso } from '@/modules/engine/schedule'
import type { Delta, Snapshot } from '@/modules/engine/types'

export const ExtractionSchema = z.object({
  type: z.enum(['earliest_start', 'active_end_estimate', 'cancel_item']).nullable(),
  item_ids: z.array(z.string()).max(12),
  time_hhmm: z
    .string()
    .regex(/^\d{1,2}[:.]\d{2}$/)
    .nullable(),
  offset_minutes: z.number().int().min(-600).max(600).nullable(),
  offset_base: z.enum(['reference', 'planned_start', 'planned_end']).nullable(),
  is_estimate: z.boolean(),
  notes: z.array(z.string()).max(5),
}).strict()
export type Extraction = z.infer<typeof ExtractionSchema>

export interface Question {
  kind: 'item' | 'reference_at' | 'value' | 'type'
  message: string
  options?: Array<{ id: string; title: string; start_at: string; end_at: string; status: string }>
}

export interface Interpretation {
  status: 'ok' | 'needs_clarification'
  delta: Delta | null
  /** Bagian yang sudah dipahami (untuk mengisi form manual). */
  partial: { type: Extraction['type']; item_id: string | null; value: string | null; is_estimate: boolean }
  questions: Question[]
  notes: string[]
  provider: string
}

const TYPE_LABEL: Record<string, string> = {
  earliest_start: 'mulai paling awal',
  active_end_estimate: 'estimasi selesai sesi aktif',
  cancel_item: 'pembatalan item',
}

export function typeLabel(type: string | null): string {
  return type ? (TYPE_LABEL[type] ?? type) : '—'
}

export function resolveExtraction(ex: Extraction, snapshot: Snapshot, referenceAt: string | null, provider: string): Interpretation {
  const tz = snapshot.event.timezone
  const questions: Question[] = []
  const notes = [...ex.notes]
  const ids = [...new Set(ex.item_ids)].filter((id) => snapshot.items.some((i) => i.id === id))
  const options = ids.map((id) => {
    const i = snapshot.items.find((x) => x.id === id)!
    return { id, title: i.title, start_at: i.start_at, end_at: endIso(i), status: i.status }
  })

  let type = ex.type
  if (!type) questions.push({ kind: 'type', message: 'Jenis perubahan belum jelas: terlambat, molor, atau dibatalkan?' })

  let itemId: string | null = ids.length === 1 ? ids[0] : null
  if (!itemId && type === 'active_end_estimate') {
    const active = snapshot.items.filter((i) => i.status === 'in_progress')
    if (active.length === 1) {
      itemId = active[0].id
      notes.push(`Item tidak disebut; diasumsikan sesi aktif ${active[0].title}.`)
    }
  }
  if (!itemId) {
    const nameHint = options[0]?.title.split(/\s+/)[0]
    questions.push({
      kind: 'item',
      message: ids.length > 1 ? `${nameHint ?? 'Item'} yang mana?` : 'Item rundown mana yang dimaksud?',
      options: ids.length > 1 ? options : undefined,
    })
  }

  const item = itemId ? snapshot.items.find((i) => i.id === itemId)! : null
  let value: string | null = null
  if (type && type !== 'cancel_item') {
    if (ex.time_hhmm) {
      const day = localDate(referenceAt ?? item?.start_at ?? snapshot.event.curfew_at, tz)
      value = localToUtc(day, ex.time_hhmm.replace('.', ':'), tz)
    } else if (ex.offset_minutes !== null) {
      const base = ex.offset_base ?? 'reference'
      if (base === 'reference') {
        if (!referenceAt) questions.push({ kind: 'reference_at', message: `"${ex.offset_minutes} menit lagi" dihitung dari jam berapa? Isi waktu acuan kabar.` })
        else value = addSeconds(referenceAt, ex.offset_minutes * 60)
      } else if (item) {
        value = addSeconds(base === 'planned_start' ? item.start_at : endIso(item), ex.offset_minutes * 60)
      }
    } else {
      questions.push({ kind: 'value', message: type === 'earliest_start' ? 'Jam berapa paling cepat bisa mulai?' : 'Perkiraan selesai jam berapa?' })
    }
  }

  if (item && type === 'earliest_start' && item.status === 'in_progress') {
    type = 'active_end_estimate'
    notes.push(`${item.title} sedang berlangsung; dibaca sebagai estimasi selesai.`)
    if (value && toMs(value) <= toMs(item.start_at)) value = null
  }

  if (value) notes.push(`Nilai dibaca: ${formatClock(value, tz)}${ex.is_estimate ? ' (perkiraan)' : ''}.`)

  const partial = { type, item_id: itemId, value, is_estimate: ex.is_estimate }
  if (questions.length || !type || !itemId || (type !== 'cancel_item' && !value)) {
    return { status: 'needs_clarification', delta: null, partial, questions, notes, provider }
  }

  const delta: Delta =
    type === 'cancel_item'
      ? { type, item_id: itemId, is_estimate: false, reference_at: referenceAt }
      : { type, item_id: itemId, value: value!, is_estimate: ex.is_estimate, reference_at: referenceAt }
  return { status: 'ok', delta, partial, questions: [], notes, provider }
}
