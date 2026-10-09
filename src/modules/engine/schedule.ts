import { toIso, toMs } from '@/lib/time'
import type { Item, Snapshot, Violation } from './types'

export const LOCKED_STATUSES = new Set(['in_progress', 'completed'])

export function isActive(item: Item): boolean {
  return item.status !== 'cancelled'
}

/** Akhir efektif item: sesi aktif memakai estimasi selesai bila ada. */
export function endMs(item: Item): number {
  if (item.estimated_end_at && item.status !== 'pending') return toMs(item.estimated_end_at)
  return toMs(item.start_at) + item.duration_seconds * 1000
}

export function endIso(item: Item): string {
  return toIso(endMs(item))
}

export function sortByStart(items: Item[]): Item[] {
  return [...items].sort((a, b) => toMs(a.start_at) - toMs(b.start_at) || a.id.localeCompare(b.id))
}

export function cloneSnapshot(s: Snapshot): Snapshot {
  return structuredClone(s)
}

function constraintFor(snapshot: Snapshot, itemId: string, type: 'fixed_start' | 'earliest_start') {
  return snapshot.constraints.find((c) => c.item_id === itemId && c.type === type)
}

export interface Plan {
  order: string[]
  durations: Map<string, number>
  anchors: Map<string, number>
}

export interface Scheduled {
  snapshot: Snapshot
  /** Item yang mulai lebih lambat dari anchor karena didorong item sebelumnya (bukan earliest_start). */
  pushedByCursor: Array<{ item_id: string; overrun_ms: number }>
}

/**
 * Propagasi waktu untuk urutan item pending. Item terkunci (sedang/sudah berlangsung) tidak dipindah.
 * start = max(anchor, earliest_start, akhir item sebelumnya di panggung, akhir pendahulu dependensi);
 * slot fixed tidak dimajukan (gap diizinkan) dan benturan dibiarkan agar validasi menolaknya.
 */
export function propagate(working: Snapshot, plan: Plan): Scheduled {
  const next = cloneSnapshot(working)
  const byId = new Map(next.items.map((i) => [i.id, i]))
  const locked = next.items.filter((i) => isActive(i) && LOCKED_STATUSES.has(i.status))
  let cursor = locked.reduce((max, i) => Math.max(max, endMs(i)), Number.NEGATIVE_INFINITY)
  const pushedByCursor: Scheduled['pushedByCursor'] = []

  for (const id of plan.order) {
    const item = byId.get(id)
    if (!item) continue
    const duration = plan.durations.get(id) ?? item.duration_seconds
    const anchor = plan.anchors.get(id) ?? toMs(item.start_at)
    const earliest = constraintFor(next, id, 'earliest_start')
    const fixed = constraintFor(next, id, 'fixed_start')
    const depEnd = next.dependencies
      .filter((d) => d.successor_id === id)
      .map((d) => byId.get(d.predecessor_id))
      .filter((p): p is Item => !!p && isActive(p) && (LOCKED_STATUSES.has(p.status) || plan.order.indexOf(p.id) < plan.order.indexOf(id)))
      .reduce((max, p) => Math.max(max, endMs(p)), Number.NEGATIVE_INFINITY)

    const lowerNoCursor = Math.max(anchor, earliest ? toMs(earliest.at) : Number.NEGATIVE_INFINITY, fixed ? toMs(fixed.at) : Number.NEGATIVE_INFINITY)
    const start = Math.max(lowerNoCursor, cursor, depEnd)
    if (start > lowerNoCursor) pushedByCursor.push({ item_id: id, overrun_ms: start - lowerNoCursor })

    item.start_at = toIso(start)
    item.duration_seconds = duration
    cursor = start + duration * 1000
  }

  next.items = sortByStart(next.items)
  return { snapshot: next, pushedByCursor }
}

function overlap(a: Item, b: Item): boolean {
  return toMs(a.start_at) < endMs(b) && toMs(b.start_at) < endMs(a)
}

/**
 * Validasi seluruh hard constraint terhadap jadwal usulan.
 * `reference` = snapshot kerja (sesudah delta) untuk memeriksa item terkunci.
 */
export function evaluate(proposed: Snapshot, reference: Snapshot, analysisNow: string): Violation[] {
  const out: Violation[] = []
  const now = toMs(analysisNow)
  const curfew = toMs(proposed.event.curfew_at)
  const byId = new Map(proposed.items.map((i) => [i.id, i]))
  const refById = new Map(reference.items.map((i) => [i.id, i]))
  const active = sortByStart(proposed.items.filter(isActive))

  for (const ref of reference.items) {
    const item = byId.get(ref.id)
    if (!item || !LOCKED_STATUSES.has(ref.status)) continue
    const moved =
      item.start_at !== ref.start_at ||
      item.status !== ref.status ||
      (ref.status === 'completed' && item.duration_seconds !== ref.duration_seconds) ||
      item.estimated_end_at !== ref.estimated_end_at
    if (moved) {
      out.push({
        rule: 'LOCKED_ITEM',
        constraint_id: `LOCK-${ref.id}`,
        item_id: ref.id,
        message: `${ref.title} ${ref.status === 'completed' ? 'sudah selesai' : 'sedang berlangsung'}; jadwalnya dikunci.`,
      })
    }
  }

  for (const item of active) {
    const start = toMs(item.start_at)
    if (item.status === 'pending') {
      const fixed = constraintFor(proposed, item.id, 'fixed_start')
      if (fixed && start !== toMs(fixed.at)) {
        out.push({ rule: 'FIXED_START', constraint_id: fixed.id, item_id: item.id, message: `${item.title} wajib mulai tepat pada slot tetap.`, actual: item.start_at, limit: fixed.at })
      }
      const earliest = constraintFor(proposed, item.id, 'earliest_start')
      if (earliest && start < toMs(earliest.at)) {
        out.push({ rule: 'EARLIEST_START', constraint_id: earliest.id, item_id: item.id, message: `${item.title} belum bisa mulai sebelum batas paling awal.`, actual: item.start_at, limit: earliest.at })
      }
      if (item.duration_seconds < item.min_duration_seconds) {
        out.push({ rule: 'MIN_DURATION', constraint_id: `MIN-${item.id}`, item_id: item.id, message: `Durasi ${item.title} di bawah minimum.`, actual: String(item.duration_seconds), limit: String(item.min_duration_seconds) })
      }
      if (start < now) {
        out.push({ rule: 'PAST_START', constraint_id: `NOW-${item.id}`, item_id: item.id, message: `${item.title} dijadwalkan di masa lalu (sebelum jam analisis).`, actual: item.start_at, limit: analysisNow })
      }
    }
    if (endMs(item) > curfew) {
      out.push({ rule: 'CURFEW', constraint_id: 'C-CURFEW', item_id: item.id, message: `${item.title} melewati batas selesai acara.`, actual: endIso(item), limit: proposed.event.curfew_at })
    }
  }

  for (const d of proposed.dependencies) {
    const pred = byId.get(d.predecessor_id)
    const succ = byId.get(d.successor_id)
    if (!pred || !succ || !isActive(succ)) continue
    if (!isActive(pred)) {
      out.push({ rule: 'DEPENDENCY_CANCELLED', constraint_id: d.id, item_id: succ.id, message: `${succ.title} membutuhkan ${pred.title} selesai, tetapi ${pred.title} dibatalkan. Ubah dependensi lewat setup.` })
    } else if (toMs(succ.start_at) < endMs(pred)) {
      out.push({ rule: 'DEPENDENCY', constraint_id: d.id, item_id: succ.id, message: `${succ.title} harus mulai setelah ${pred.title} selesai.`, actual: succ.start_at, limit: endIso(pred) })
    }
  }

  for (let i = 0; i + 1 < active.length; i++) {
    const a = active[i]
    const b = active[i + 1]
    if (overlap(a, b)) {
      out.push({ rule: 'STAGE_OVERLAP', constraint_id: `STAGE-${proposed.event.stage}`, item_id: b.id, message: `${a.title} dan ${b.title} tumpang tindih di panggung yang sama.`, actual: b.start_at, limit: endIso(a) })
    }
  }

  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i]
      const b = active[j]
      const shared = a.resource_ids.filter((r) => b.resource_ids.includes(r))
      if (shared.length && overlap(a, b)) {
        out.push({ rule: 'RESOURCE_OVERLAP', constraint_id: `RES-${shared[0]}`, item_id: b.id, message: `Resource ${shared[0]} dipakai bersamaan oleh ${a.title} dan ${b.title}.` })
      }
    }
  }

  // Item yang hilang dari usulan dianggap pelanggaran referensi (tidak boleh menghapus item).
  for (const id of refById.keys()) {
    if (!byId.has(id)) out.push({ rule: 'INVALID_REFERENCE', constraint_id: `ITEM-${id}`, item_id: id, message: `Item ${id} hilang dari usulan.` })
  }

  return out
}
