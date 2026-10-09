import { isValidIso, toMs } from '@/lib/time'
import type { Snapshot, Violation } from './types'

const STATUSES = new Set(['pending', 'in_progress', 'completed', 'cancelled'])

export interface SnapshotValidation {
  /** Kesalahan struktural: tolak saat simpan setup (FR-01). */
  errors: Violation[]
  /** Data wajib kosong: boleh disimpan, tetapi analisis diblok (DATA BELUM LENGKAP). */
  missing: Violation[]
}

function v(rule: Violation['rule'], constraintId: string, itemId: string | null, message: string, field?: string): Violation {
  return { rule, constraint_id: constraintId, item_id: itemId, message, ...(field ? { field } : {}) }
}

function findCycle(snapshot: Snapshot): string[] | null {
  const next = new Map<string, string[]>()
  for (const d of snapshot.dependencies) {
    next.set(d.predecessor_id, [...(next.get(d.predecessor_id) ?? []), d.successor_id])
  }
  const state = new Map<string, 'visiting' | 'done'>()
  const path: string[] = []
  const visit = (id: string): string[] | null => {
    if (state.get(id) === 'done') return null
    if (state.get(id) === 'visiting') return [...path.slice(path.indexOf(id)), id]
    state.set(id, 'visiting')
    path.push(id)
    for (const n of [...(next.get(id) ?? [])].sort()) {
      const found = visit(n)
      if (found) return found
    }
    path.pop()
    state.set(id, 'done')
    return null
  }
  for (const id of [...next.keys()].sort()) {
    const found = visit(id)
    if (found) return found
  }
  return null
}

export function validateSnapshot(snapshot: Snapshot): SnapshotValidation {
  const errors: Violation[] = []
  const missing: Violation[] = []
  const roleIds = new Set(snapshot.roles.map((r) => r.id))
  const resourceIds = new Set(snapshot.resources.map((r) => r.id))
  const itemIds = new Set<string>()

  if (!isValidIso(snapshot.event.curfew_at)) {
    errors.push(v('MISSING_DATA', 'C-CURFEW', null, 'Batas selesai acara (curfew) belum diisi atau tidak valid.', 'curfew_at'))
  }
  if (snapshot.items.length === 0) {
    missing.push(v('MISSING_DATA', 'SETUP', null, 'Rundown belum disiapkan.', 'items'))
  }

  for (const item of snapshot.items) {
    if (!item.id || itemIds.has(item.id)) {
      errors.push(v('INVALID_REFERENCE', `ITEM-${item.id || '?'}`, item.id || null, `ID item "${item.id}" kosong atau ganda.`, 'id'))
    }
    itemIds.add(item.id)
    if (!item.title?.trim()) missing.push(v('MISSING_DATA', `ITEM-${item.id}`, item.id, `Item ${item.id} belum memiliki judul.`, 'title'))
    if (!isValidIso(item.start_at)) errors.push(v('MISSING_DATA', `ITEM-${item.id}`, item.id, `Waktu mulai ${item.id} tidak valid.`, 'start_at'))
    if (!Number.isInteger(item.duration_seconds) || item.duration_seconds <= 0) {
      errors.push(v('INVALID_DURATION', `ITEM-${item.id}`, item.id, `Durasi ${item.id} harus bilangan bulat positif.`, 'duration_seconds'))
    }
    if (!Number.isInteger(item.min_duration_seconds) || item.min_duration_seconds <= 0 || item.min_duration_seconds > item.duration_seconds) {
      errors.push(v('INVALID_DURATION', `MIN-${item.id}`, item.id, `Durasi minimum ${item.id} harus > 0 dan ≤ durasi.`, 'min_duration_seconds'))
    }
    if (!STATUSES.has(item.status)) errors.push(v('MISSING_DATA', `ITEM-${item.id}`, item.id, `Status ${item.id} tidak dikenal.`, 'status'))
    if (item.estimated_end_at !== null && (!isValidIso(item.estimated_end_at) || (isValidIso(item.start_at) && toMs(item.estimated_end_at) <= toMs(item.start_at)))) {
      errors.push(v('INVALID_DURATION', `ITEM-${item.id}`, item.id, `Estimasi selesai ${item.id} harus setelah waktu mulai.`, 'estimated_end_at'))
    }
    if (item.pic_role_ids.length === 0 && item.status !== 'cancelled') {
      missing.push(v('MISSING_DATA', `ITEM-${item.id}`, item.id, `DATA BELUM LENGKAP — ${item.title} belum memiliki PIC.`, 'pic_role_ids'))
    }
    for (const r of item.pic_role_ids) {
      if (!roleIds.has(r)) errors.push(v('INVALID_REFERENCE', `ITEM-${item.id}`, item.id, `PIC "${r}" pada ${item.id} tidak ada.`, 'pic_role_ids'))
    }
    for (const r of item.resource_ids) {
      if (!resourceIds.has(r)) errors.push(v('INVALID_REFERENCE', `ITEM-${item.id}`, item.id, `Resource "${r}" pada ${item.id} tidak ada.`, 'resource_ids'))
    }
  }

  for (const res of snapshot.resources) {
    if (res.role_ids.length === 0) {
      missing.push(v('MISSING_DATA', `RES-${res.id}`, null, `DATA BELUM LENGKAP — Resource ${res.label} belum memiliki peran penanggung jawab.`, 'role_ids'))
    }
    for (const r of res.role_ids) {
      if (!roleIds.has(r)) errors.push(v('INVALID_REFERENCE', `RES-${res.id}`, null, `Peran "${r}" pada resource ${res.id} tidak ada.`, 'role_ids'))
    }
  }

  const depIds = new Set<string>()
  for (const d of snapshot.dependencies) {
    if (depIds.has(d.id)) errors.push(v('INVALID_REFERENCE', d.id, null, `ID dependensi ${d.id} ganda.`))
    depIds.add(d.id)
    if (!itemIds.has(d.predecessor_id) || !itemIds.has(d.successor_id)) {
      errors.push(v('INVALID_REFERENCE', d.id, d.successor_id, `Dependensi ${d.id} merujuk item yang tidak ada.`))
    }
    if (d.predecessor_id === d.successor_id) errors.push(v('DEPENDENCY_CYCLE', d.id, d.successor_id, `Dependensi ${d.id} merujuk dirinya sendiri.`))
  }
  const cycle = findCycle(snapshot)
  if (cycle) errors.push(v('DEPENDENCY_CYCLE', 'DAG', cycle[0] ?? null, `Siklus dependensi: ${cycle.join(' → ')}.`))

  const constraintIds = new Set<string>()
  for (const c of snapshot.constraints) {
    if (constraintIds.has(c.id)) errors.push(v('INVALID_REFERENCE', c.id, c.item_id, `ID batas ${c.id} ganda.`))
    constraintIds.add(c.id)
    if (!itemIds.has(c.item_id)) errors.push(v('INVALID_REFERENCE', c.id, c.item_id, `Batas ${c.id} merujuk item yang tidak ada.`))
    if (!isValidIso(c.at)) errors.push(v('MISSING_DATA', c.id, c.item_id, `Waktu pada batas ${c.id} tidak valid.`, 'at'))
  }

  return { errors, missing }
}
