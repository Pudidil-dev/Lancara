import { isDeepStrictEqual } from 'node:util'
import { formatClock, localDate, zoneAbbrev } from '@/lib/time'
import { BREAK_PATTERN, isBreakItem } from './schedule'
import { validateSnapshot } from './validate'
import type { ConfigurationDiff, Constraint, Dependency, Resource, Snapshot, Violation } from './types'

/** Revisi CRUD adalah rencana persis, tanpa melonggarkan batas atau menghapus riwayat item. */
export function validateRevision(base: Snapshot, proposed: Snapshot): Violation[] {
  const structure = validateSnapshot(proposed)
  if (structure.errors.length || structure.missing.length) return [...structure.errors, ...structure.missing]
  const out: Violation[] = []
  const invalid = (message: string, itemId: string | null = null, rule: Violation['rule'] = 'INVALID_DELTA') => {
    out.push({ rule, constraint_id: itemId ? `REV-${itemId}` : 'REVISION', item_id: itemId, message })
  }
  for (const key of ['event', 'roles', 'resources', 'constraints'] as const) {
    if (!isDeepStrictEqual(base[key], proposed[key])) invalid(`Revisi jadwal tidak boleh mengubah ${key}.`)
  }
  const proposedById = new Map(proposed.items.map(i => [i.id, i]))
  const cancelled = new Set<string>()
  for (const before of base.items) {
    const after = proposedById.get(before.id)
    if (!after) { invalid('Item lama harus dibatalkan, bukan dihapus dari riwayat.', before.id); continue }
    if (isDeepStrictEqual(before, after)) continue
    const protectedItem = isBreakItem(before) || base.constraints.some(c => c.item_id === before.id && /ishoma|istirahat|sholat|makan/i.test(c.note ?? ''))
    if (protectedItem) invalid(`${before.title} adalah istirahat yang dikunci.`, before.id, 'BREAK_LOCKED')
    if (before.status !== 'pending') invalid(`${before.title} sudah berlangsung, selesai, atau dibatalkan; item dikunci.`, before.id, 'LOCKED_ITEM')
    if (after.status !== 'pending' && after.status !== 'cancelled') invalid('Revisi hanya boleh mempertahankan pending atau membatalkan item.', before.id)
    if (before.min_duration_seconds !== after.min_duration_seconds || before.estimated_end_at !== after.estimated_end_at) invalid('Durasi minimum dan estimasi item tidak dapat diubah lewat revisi.', before.id)
    if (before.status === 'pending' && after.status === 'cancelled') cancelled.add(before.id)
  }
  const oldIds = new Set(base.items.map(i => i.id))
  for (const item of proposed.items) {
    if (!oldIds.has(item.id) && (item.status !== 'pending' || item.estimated_end_at !== null)) invalid('Item baru harus pending tanpa estimasi selesai.', item.id)
  }
  const deps = new Map(proposed.dependencies.map(d => [d.id, d]))
  for (const dep of base.dependencies) {
    const next = deps.get(dep.id)
    if (!next && (cancelled.has(dep.predecessor_id) || cancelled.has(dep.successor_id))) continue
    if (!isDeepStrictEqual(dep, next)) invalid('Dependensi hanya boleh dilepas dari item yang baru dibatalkan.', dep.successor_id)
    deps.delete(dep.id)
  }
  if (deps.size) invalid('Revisi tidak boleh menambahkan dependensi baru.')
  return out
}

/** Konfigurasi boleh berubah, tetapi identitas event/akun dan semua nilai item tetap. */
export function validateConfiguration(base: Snapshot, proposed: Snapshot): Violation[] {
  const structure = validateSnapshot(proposed)
  if (structure.errors.length || structure.missing.length) return [...structure.errors, ...structure.missing]
  const out: Violation[] = []
  const invalid = (message: string, rule: Violation['rule'] = 'INVALID_DELTA') => {
    out.push({ rule, constraint_id: 'CONFIGURATION', item_id: null, message })
  }
  if (base.event.id !== proposed.event.id) invalid('Identitas event tidak boleh diubah.')
  if (!proposed.event.name.trim()) invalid('Nama acara wajib diisi.')
  try {
    new Intl.DateTimeFormat('id-ID', { timeZone: proposed.event.timezone })
  } catch {
    invalid('Zona waktu harus berupa zona IANA yang valid.', 'INVALID_REFERENCE')
  }
  const oldRoleIds = base.roles.map(role => role.id).sort()
  const newRoleIds = proposed.roles.map(role => role.id).sort()
  if (!isDeepStrictEqual(oldRoleIds, newRoleIds)) invalid('Konfigurasi hanya boleh mengubah nama peran yang sudah ada, bukan ID/keanggotaan akun.')
  if (proposed.roles.some(role => !role.label.trim())) invalid('Nama peran wajib diisi.')
  if (new Set(proposed.resources.map(resource => resource.id)).size !== proposed.resources.length) invalid('ID resource tidak boleh ganda.', 'INVALID_REFERENCE')
  if (proposed.resources.some(resource => !resource.label.trim())) invalid('Nama resource wajib diisi.')
  const constraintPairs = proposed.constraints.map(constraint => `${constraint.item_id}:${constraint.type}`)
  if (new Set(constraintPairs).size !== constraintPairs.length) invalid('Satu item hanya boleh memiliki satu batas dari setiap jenis; ubah batas yang sudah ada.', 'INVALID_REFERENCE')
  if (!isDeepStrictEqual(base.items, proposed.items)) invalid('Konfigurasi event tidak boleh mengubah item rundown; gunakan revisi rundown tersendiri.')
  for (const item of base.items) {
    const beforeProtected = isBreakItem(item) || base.constraints.some(constraint => constraint.item_id === item.id && BREAK_PATTERN.test(constraint.note ?? ''))
    const after = proposed.items.find(entry => entry.id === item.id)
    const afterProtected = !!after && (isBreakItem(after) || proposed.constraints.some(constraint => constraint.item_id === item.id && BREAK_PATTERN.test(constraint.note ?? '')))
    if (beforeProtected && !afterProtected) out.push({ rule: 'BREAK_LOCKED', constraint_id: `BREAK-${item.id}`, item_id: item.id, message: `${item.title} adalah istirahat yang dikunci; penanda perlindungannya harus tetap pada item yang sama.` })
  }
  return out
}

/** Ringkasan konfigurasi murni untuk pratinjau/konfirmasi, tanpa menyimpan kolom DB tambahan. */
export function diffConfiguration(base: Snapshot, proposed: Snapshot): ConfigurationDiff[] {
  const out: ConfigurationDiff[] = []
  const add = (field: string, old: string | undefined, next: string | undefined) => {
    if (old !== next) out.push({ field, old: old ?? '—', new: next ?? '—' })
  }
  const clock = (value: string, snapshot: Snapshot) => `${localDate(value, snapshot.event.timezone)} ${formatClock(value, snapshot.event.timezone)} ${zoneAbbrev(snapshot.event.timezone)}`
  add('Nama acara', base.event.name, proposed.event.name)
  add('Zona waktu', base.event.timezone, proposed.event.timezone)
  add('Panggung', base.event.stage, proposed.event.stage)
  if (base.event.curfew_at !== proposed.event.curfew_at) add('Batas selesai acara', clock(base.event.curfew_at, base), clock(proposed.event.curfew_at, proposed))
  const roles = new Map(proposed.roles.map(role => [role.id, role.label]))
  for (const role of [...base.roles].sort((a, b) => a.id.localeCompare(b.id))) add(`Nama peran ${role.label}`, role.label, roles.get(role.id))
  const changedRows = <T extends { id: string }>(oldRows: T[], newRows: T[], describe: (row: T, snapshot: Snapshot) => string, label: (row: T, snapshot: Snapshot) => string, category: string) => {
    const before = new Map(oldRows.map(row => [row.id, row]))
    const after = new Map(newRows.map(row => [row.id, row]))
    for (const id of [...new Set([...before.keys(), ...after.keys()])].sort()) {
      const old = before.get(id)
      const next = after.get(id)
      if (isDeepStrictEqual(old, next)) continue
      const field = old && next ? `${category} ${label(old, base)}` : old ? `${category} dihapus: ${label(old, base)}` : `${category} baru: ${label(next!, proposed)}`
      add(field, old ? describe(old, base) : undefined, next ? describe(next, proposed) : undefined)
    }
  }
  const resourceText = (resource: Resource, snapshot: Snapshot) => `${resource.label} · ${resource.role_ids.map(id => snapshot.roles.find(role => role.id === id)?.label ?? id).join(', ')}`
  changedRows(base.resources, proposed.resources, resourceText, resource => resource.label, 'Resource')
  const itemLabel = (id: string, snapshot: Snapshot) => snapshot.items.find(item => item.id === id)?.title ?? id
  const constraintText = (constraint: Constraint, snapshot: Snapshot) => `${itemLabel(constraint.item_id, snapshot)} · ${constraint.type === 'fixed_start' ? 'Mulai tetap' : 'Mulai paling awal'} · ${clock(constraint.at, snapshot)}${constraint.note ? ` · ${constraint.note}` : ''}`
  changedRows(base.constraints, proposed.constraints, constraintText, (constraint, snapshot) => itemLabel(constraint.item_id, snapshot), 'Batas')
  const dependencyText = (dependency: Dependency, snapshot: Snapshot) => `${itemLabel(dependency.predecessor_id, snapshot)} → ${itemLabel(dependency.successor_id, snapshot)}`
  changedRows(base.dependencies, proposed.dependencies, dependencyText, dependencyText, 'Dependensi')
  return out
}
