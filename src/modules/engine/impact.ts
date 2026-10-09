import { toMs } from '@/lib/time'
import { endIso, isActive } from './schedule'
import type { Delta, ImpactLevel, Item, ItemDiff, RoleImpact, RoleImpactEntry, Snapshot } from './types'

export function diffSnapshots(base: Snapshot, proposed: Snapshot): ItemDiff[] {
  const out: ItemDiff[] = []
  const baseById = new Map(base.items.map((i) => [i.id, i]))
  for (const p of proposed.items) {
    const b = baseById.get(p.id)
    if (!b) {
      out.push({ kind: 'added', item_id: p.id, title: p.title, old: null, new: { start_at: p.start_at, end_at: endIso(p), duration_seconds: p.duration_seconds, status: p.status }, changes: ['added'], start_shift_seconds: 0 })
      continue
    }
    const changes: Extract<ItemDiff, { kind?: 'changed' }>['changes'] = []
    if (b.start_at !== p.start_at) changes.push('start')
    if (b.duration_seconds !== p.duration_seconds) changes.push('duration')
    if (b.status !== p.status) changes.push('status')
    if (b.estimated_end_at !== p.estimated_end_at) changes.push('end_estimate')
    if (b.title !== p.title) changes.push('title')
    if (JSON.stringify(b.pic_role_ids) !== JSON.stringify(p.pic_role_ids)) changes.push('pic')
    if (JSON.stringify(b.resource_ids) !== JSON.stringify(p.resource_ids)) changes.push('resources')
    if (b.swappable !== p.swappable) changes.push('swappable')
    if (!changes.length) continue
    const details: NonNullable<ItemDiff['details']> = []
    const roles = (ids: string[], snapshot: Snapshot) => ids.map(id => snapshot.roles.find(r => r.id === id)?.label ?? id).join(', ') || 'Tidak ada'
    const resources = (ids: string[], snapshot: Snapshot) => ids.map(id => snapshot.resources.find(r => r.id === id)?.label ?? id).join(', ') || 'Tidak ada'
    if (changes.includes('title')) details.push({ field: 'Judul', old: b.title, new: p.title })
    if (changes.includes('pic')) details.push({ field: 'PIC', old: roles(b.pic_role_ids, base), new: roles(p.pic_role_ids, proposed) })
    if (changes.includes('resources')) details.push({ field: 'Resource', old: resources(b.resource_ids, base), new: resources(p.resource_ids, proposed) })
    if (changes.includes('swappable')) details.push({ field: 'Fleksibel', old: b.swappable ? 'Ya' : 'Tidak', new: p.swappable ? 'Ya' : 'Tidak' })
    out.push({
      item_id: p.id,
      title: p.title,
      old: { start_at: b.start_at, end_at: endIso(b), duration_seconds: b.duration_seconds, status: b.status },
      new: { start_at: p.start_at, end_at: endIso(p), duration_seconds: p.duration_seconds, status: p.status },
      changes,
      start_shift_seconds: Math.round((toMs(p.start_at) - toMs(b.start_at)) / 1000),
      ...(details.length ? { details } : {}),
    })
  }
  return out.sort((a, b) => toMs(a.old?.start_at ?? a.new.start_at) - toMs(b.old?.start_at ?? b.new.start_at) || a.item_id.localeCompare(b.item_id))
}

function reasonFor(d: ItemDiff): string {
  if (d.kind === 'added') return 'Item baru'
  if (d.changes.includes('status') && d.new.status === 'cancelled') return 'Item dibatalkan'
  if (d.changes.includes('end_estimate')) return 'Estimasi selesai sesi aktif berubah'
  const parts: string[] = []
  if (d.changes.includes('start')) parts.push(d.start_shift_seconds > 0 ? 'Jam mulai mundur' : 'Jam mulai maju')
  if (d.changes.includes('duration')) parts.push('durasi dipangkas/berubah')
  if (d.changes.includes('status')) parts.push(`status menjadi ${d.new.status}`)
  return parts.join(', ') || 'Item berubah'
}

function rolesOfItem(snapshot: Snapshot, item: Item): string[] {
  const fromResources = snapshot.resources.filter((r) => item.resource_ids.includes(r.id)).flatMap((r) => r.role_ids)
  return [...new Set([...item.pic_role_ids, ...fromResources])]
}

const RANK: Record<ImpactLevel, number> = { BLOCKER: 3, ACTION_REQUIRED: 2, FYI: 1, UNCHANGED: 0 }

/**
 * Aturan dampak (02-technical-design.md):
 * item berubah → PIC + peran resource ACTION REQUIRED; pendahulu langsung berubah tetapi item tetap → PIC FYI;
 * batas waktu diperbarui tanpa perubahan jadwal → PIC FYI; selebihnya UNCHANGED (tanpa brief).
 */
export function computeImpact(base: Snapshot, proposed: Snapshot, diff: ItemDiff[], delta: Delta | null): RoleImpact[] {
  const byRole = new Map<string, { level: ImpactLevel; entries: RoleImpactEntry[] }>()
  const add = (roleId: string, level: ImpactLevel, entry: RoleImpactEntry) => {
    const cur = byRole.get(roleId) ?? { level: 'UNCHANGED' as ImpactLevel, entries: [] }
    byRole.set(roleId, { level: RANK[level] > RANK[cur.level] ? level : cur.level, entries: [...cur.entries, entry] })
  }
  const proposedById = new Map(proposed.items.map((i) => [i.id, i]))
  const baseById = new Map(base.items.map(i => [i.id, i]))
  const changed = new Set(diff.map((d) => d.item_id))

  for (const d of diff) {
    const item = proposedById.get(d.item_id)
    if (!item) continue
    const former = baseById.get(d.item_id)
    const affected = new Set([...rolesOfItem(proposed, item), ...(former ? rolesOfItem(base, former) : [])])
    for (const roleId of affected) {
      add(roleId, 'ACTION_REQUIRED', {
        item_id: d.item_id,
        title: d.title,
        reason: reasonFor(d),
        ...(d.old ? { old: { start_at: d.old.start_at, end_at: d.old.end_at } } : {}),
        new: { start_at: d.new.start_at, end_at: d.new.end_at },
        status: d.new.status,
      })
    }
  }

  // Konfigurasi tetap dapat mengubah penanggung jawab/batas meskipun jam item tidak berubah.
  if (delta?.type === 'configure_event' || delta?.type === 'revert_decision') {
    const changedEvent = (['name', 'timezone', 'stage', 'curfew_at'] as const).some(field => base.event[field] !== proposed.event[field])
    const beforeResources = new Map(base.resources.map(resource => [resource.id, resource]))
    const afterResources = new Map(proposed.resources.map(resource => [resource.id, resource]))
    const beforeRoles = new Map(base.roles.map(role => [role.id, role.label]))
    for (const item of proposed.items.filter(isActive).filter(item => item.status !== 'completed')) {
      if (changedEvent) {
        for (const roleId of rolesOfItem(proposed, item)) add(roleId, 'FYI', { item_id: item.id, title: item.title, reason: 'Konfigurasi acara diperbarui; jadwal item tetap.' })
      }
      for (const resourceId of item.resource_ids) {
        const before = beforeResources.get(resourceId)
        const after = afterResources.get(resourceId)
        if (!before || !after) continue
        const reassigned = JSON.stringify([...before.role_ids].sort()) !== JSON.stringify([...after.role_ids].sort())
        if (reassigned || before.label !== after.label) {
          for (const roleId of new Set([...before.role_ids, ...after.role_ids])) add(roleId, reassigned ? 'ACTION_REQUIRED' : 'FYI', {
            item_id: item.id, title: item.title, reason: `Resource ${after.label}: ${reassigned ? 'peran penanggung jawab berubah' : 'nama diperbarui'}; jadwal item tetap.`,
          })
        }
      }
      const beforeConstraints = base.constraints.filter(constraint => constraint.item_id === item.id)
      const afterConstraints = proposed.constraints.filter(constraint => constraint.item_id === item.id)
      const beforeDependencies = base.dependencies.filter(dependency => dependency.successor_id === item.id)
      const afterDependencies = proposed.dependencies.filter(dependency => dependency.successor_id === item.id)
      if (JSON.stringify(beforeConstraints) !== JSON.stringify(afterConstraints) || JSON.stringify(beforeDependencies) !== JSON.stringify(afterDependencies)) {
        for (const roleId of rolesOfItem(proposed, item)) add(roleId, 'FYI', { item_id: item.id, title: item.title, reason: 'Batas/dependensi item diperbarui; jadwal item tetap.' })
      }
      for (const roleId of rolesOfItem(proposed, item)) {
        const role = proposed.roles.find(role => role.id === roleId)
        if (role && beforeRoles.get(roleId) !== role.label) add(roleId, 'FYI', { item_id: item.id, title: item.title, reason: `Nama peran diperbarui menjadi ${role.label}; tanggung jawab tetap.` })
      }
    }
  }

  for (const dep of proposed.dependencies) {
    if (!changed.has(dep.predecessor_id) || changed.has(dep.successor_id)) continue
    const succ = proposedById.get(dep.successor_id)
    const pred = proposedById.get(dep.predecessor_id)
    if (!succ || !pred || !isActive(succ)) continue
    for (const roleId of succ.pic_role_ids) {
      add(roleId, 'FYI', {
        item_id: succ.id,
        title: succ.title,
        reason: `Pendahulu ${pred.title} berubah (dependensi ${dep.id}); jadwal Anda tetap.`,
        dependency_id: dep.id,
      })
    }
  }

  if (delta && delta.type === 'earliest_start' && !changed.has(delta.item_id)) {
    const item = proposedById.get(delta.item_id)
    if (item) {
      for (const roleId of rolesOfItem(proposed, item)) {
        add(roleId, 'FYI', { item_id: item.id, title: item.title, reason: 'Batas mulai paling awal diperbarui; jadwal tetap.' })
      }
    }
  }

  const labels = new Map([...base.roles, ...proposed.roles].map((r) => [r.id, r.label]))
  const allRoles = [...new Set([...proposed.roles.map((r) => r.id), ...byRole.keys()])]
  return allRoles
    .map((roleId) => {
      const found = byRole.get(roleId)
      return {
        role_id: roleId,
        role_label: labels.get(roleId) ?? roleId,
        level: found?.level ?? 'UNCHANGED',
        entries: found?.entries ?? [],
      }
    })
    .sort((a, b) => RANK[b.level] - RANK[a.level] || a.role_id.localeCompare(b.role_id))
}
