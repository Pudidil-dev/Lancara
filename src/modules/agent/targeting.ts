import type { Item, Snapshot } from '@/modules/engine/types'
import { buildEditedRundown, EditRundownInputSchema } from './rescheduling'
import { formatClock } from '@/lib/time'

const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ')
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Nama lengkap, nama sebelum keterangan, serta ID; huruf/angka pembeda tetap dipertahankan. */
export function itemAliases(item: Pick<Item, 'id' | 'title'>): string[] {
  return [...new Set([item.title, item.title.split(/\s+[—–-]\s+|:/u)[0], item.id.replace(/[-_]/g, ' ')].map(normalize).filter(Boolean))]
}

export function matchNamedItems(text: string, items: Array<Pick<Item, 'id' | 'title'>>): string[] {
  const words = ` ${normalize(text)} `
  const matches = items.flatMap(item => itemAliases(item).flatMap(alias => {
    const match = new RegExp(` ${escape(alias)}(?= )`).exec(words)
    return match ? [{ id: item.id, alias, at: match.index, end: match.index + alias.length + 1 }] : []
  }))
  const specific = matches.filter(match => !matches.some(other => other.alias.length > match.alias.length && other.at <= match.at && other.end >= match.end))
  return [...new Set(specific.sort((a, b) => a.at - b.at || b.alias.length - a.alias.length).map(match => match.id))]
}

export function requestedMoveClock(text: string): string | undefined {
  if (!/\b(?:ubah|mengubah|ganti|mengganti|pindah\w*|geser\w*|majukan|mundurkan)\b/i.test(text)) return undefined
  const explicit = /(?:\bke|menjadi|jadi)\s*(?:jam\s*)?([01]?\d|2[0-3])[:.]([0-5]\d)\b/i.exec(text)
  const clocks = [...text.matchAll(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g)]
  const selected = explicit ?? (clocks.length === 1 ? clocks[0] : null)
  return selected ? `${selected[1].padStart(2, '0')}:${selected[2]}` : undefined
}

export interface TargetFocus { item_ids: string[]; source: 'message' | 'history' | 'none'; ambiguous: boolean; requested_start_hhmm?: string; unknown_name?: string }
export function resolveTargetFocus(message: string, history: Array<{ role: string; text: string }>, snapshot: Snapshot): TargetFocus {
  const current = matchNamedItems(message, snapshot.items)
  if (current.length) return { item_ids: current, source: 'message', ambiguous: current.length > 1 && /\b(?:atau|salah satu)\b/i.test(message), requested_start_hhmm: requestedMoveClock(message) }
  const unknown = /\btalent\s+([a-z0-9])\b/i.exec(message)
  if (unknown) return { item_ids: [], source: 'message', ambiguous: false, unknown_name: unknown[0] }
  if (/\b(?:itu|tadi|tersebut|yang sama|dia|jadwalnya|ganti|lanjut|pakai|setuju|oke|ok)\b/i.test(message)) {
    for (const turn of [...history].reverse()) {
      if (turn.role !== 'user') continue
      const ids = matchNamedItems(turn.text, snapshot.items)
      if (ids.length) return { item_ids: ids, source: 'history', ambiguous: ids.length > 1 && /\b(?:atau|salah satu)\b/i.test(turn.text), requested_start_hhmm: requestedMoveClock(message) ?? requestedMoveClock(turn.text) }
    }
  }
  return { item_ids: [], source: 'none', ambiguous: false }
}

/** Teks history membantu rujukan; hanya snapshot server menentukan ID dan kelayakan. */
export function guardRequestedTarget(snapshot: Snapshot, focus: TargetFocus, name: string, input: unknown, now: string): string | null {
  if (!focus.item_ids.length || !['propose_schedule_change', 'edit_rundown'].includes(name)) return null
  const labels = focus.item_ids.map(id => snapshot.items.find(i => i.id === id)?.title ?? id).join(', ')
  if (focus.ambiguous) return `Target belum tunggal (${labels}). Tanyakan segmen yang dimaksud sebelum membuat pratinjau.`
  if (name === 'propose_schedule_change') {
    if (focus.requested_start_hhmm) return `Pengguna meminta pemindahan tepat ke ${focus.requested_start_hhmm}. Gunakan edit_rundown, bukan kabar earliest_start yang bisa menggeser ke jam lain.`
    const id = (input as { item_id?: string })?.item_id
    return id && focus.item_ids.includes(id) ? null : `Permintaan menyebut ${labels}. Gunakan item_id ${focus.item_ids.join(', ')}; jangan mengganti segmen lain.`
  }
  const parsed = EditRundownInputSchema.safeParse(input)
  if (!parsed.success) return null // Validator tool mengembalikan error schema lengkap.
  // Referensi posisi untuk create saja tidak berarti item acuan perlu diganti.
  if (parsed.data.operations.every(op => op.op === 'create')) return null
  try {
    const proposed = buildEditedRundown(snapshot, parsed.data, now)
    const touched = focus.item_ids.some(id => JSON.stringify(snapshot.items.find(i => i.id === id)) !== JSON.stringify(proposed.items.find(i => i.id === id)))
    if (touched && focus.requested_start_hhmm && !focus.item_ids.some(id => {
      const item = proposed.items.find(i => i.id === id)
      return item && formatClock(item.start_at, snapshot.event.timezone).replace('.', ':') === focus.requested_start_hhmm
    })) return `Jam target pengguna adalah ${focus.requested_start_hhmm}, tetapi rencana memberi jam lain. Pertahankan jam yang diminta atau jelaskan batas penghalangnya.`
    return touched ? null : `Rencana tidak menyentuh ${labels} (${focus.item_ids.join(', ')}), padahal itulah target pengguna. Perbaiki operations untuk target tersebut; segmen lain hanya boleh menjadi penyesuaian pendukung.`
  } catch { return null } // Error kelayakan tetap berasal dari tool/engine.
}
