import { createHash } from 'node:crypto'
import { toMs } from '@/lib/time'
import { diffSnapshots, computeImpact } from './impact'
import { cloneSnapshot, evaluate, isActive, LOCKED_STATUSES, propagate, sortByStart, type Plan } from './schedule'
import { validateSnapshot } from './validate'
import { diffConfiguration, validateConfiguration, validateRevision } from './revision'
import { isDeepStrictEqual } from 'node:util'
import {
  ENGINE_VERSION,
  type AnalysisResult,
  type Candidate,
  type Delta,
  type RejectedCandidate,
  type Snapshot,
  type Strategy,
  type Violation,
} from './types'

export const SEARCH_LIMITS = { candidates: 200, items: 15, maxReturned: 3, trimRounds: 12 } as const

interface Draft {
  strategy: Strategy
  label: string
  proposed: Snapshot
}

/** Hash canonical (engine_version + jadwal usulan) → candidate ID stabil, bukan UUID acak. */
export function candidateIdFor(proposed: Snapshot, constraints = proposed.constraints): string {
  const canonical = sortByStart(proposed.items)
    .map((i) => JSON.stringify([i.id, i.title, i.start_at, i.duration_seconds, i.min_duration_seconds, i.status, i.estimated_end_at, i.pic_role_ids, i.pic_text ?? '', i.resource_ids, i.swappable]))
    .join(';')
  const cons = [...constraints].sort((a, b) => a.id.localeCompare(b.id)).map((c) => JSON.stringify([c.id, c.type, c.item_id, c.at, c.hard, c.note ?? ''])).join(';')
  const config = JSON.stringify([
    [proposed.event.id, proposed.event.name, proposed.event.timezone, proposed.event.curfew_at, proposed.event.stage],
    [...proposed.roles].sort((a, b) => a.id.localeCompare(b.id)).map(role => [role.id, role.label]),
    [...proposed.resources].sort((a, b) => a.id.localeCompare(b.id)).map(resource => [resource.id, resource.label, resource.role_ids]),
    [...proposed.dependencies].sort((a, b) => a.id.localeCompare(b.id)).map(dependency => [dependency.id, dependency.predecessor_id, dependency.successor_id, dependency.type]),
  ])
  return 'P-' + createHash('sha256').update(`${ENGINE_VERSION}#${canonical}#${cons}#${config}`).digest('hex').slice(0, 10)
}

function blockerResult(analysisNow: string, blockers: Violation[]): AnalysisResult {
  return {
    engine_version: ENGINE_VERSION,
    analysis_now: analysisNow,
    blockers,
    candidates: [],
    rejected: [],
    search: { strategies: [], generated: 0, evaluated: 0, valid: 0, limit_candidates: SEARCH_LIMITS.candidates, limit_items: SEARCH_LIMITS.items, truncated: false, note: 'Analisis diblok sebelum pencarian kandidat.' },
  }
}

/** Terapkan delta terkonfirmasi pada salinan snapshot. Tidak memutasi input. */
export function applyDelta(base: Snapshot, delta: Delta): { working: Snapshot; violations: Violation[] } {
  const working = cloneSnapshot(base)
  if (delta.type === 'revert_decision') return { working, violations: [] }
  if (delta.type === 'revise_rundown') return { working: cloneSnapshot(delta.snapshot), violations: validateRevision(base, delta.snapshot) }
  if (delta.type === 'configure_event') return { working: cloneSnapshot(delta.snapshot), violations: validateConfiguration(base, delta.snapshot) }
  const item = working.items.find((i) => i.id === delta.item_id)
  const invalid = (message: string): { working: Snapshot; violations: Violation[] } => ({
    working,
    violations: [{ rule: 'INVALID_DELTA', constraint_id: 'DELTA', item_id: delta.item_id, message }],
  })
  if (!item) return invalid(`Item ${delta.item_id} tidak ditemukan pada versi ini.`)

  if (delta.type === 'earliest_start') {
    if (item.status !== 'pending') {
      return { working, violations: [{ rule: 'LOCKED_ITEM', constraint_id: `LOCK-${item.id}`, item_id: item.id, message: `${item.title} sudah ${item.status === 'cancelled' ? 'dibatalkan' : 'berlangsung/selesai'}; batas mulai tidak dapat diubah.` }] }
    }
    const existing = working.constraints.find((c) => c.item_id === item.id && c.type === 'earliest_start')
    const id = existing?.id ?? `C-EARLY-${item.id}`
    working.constraints = [
      ...working.constraints.filter((c) => !(c.item_id === item.id && c.type === 'earliest_start')),
      { id, type: 'earliest_start', item_id: item.id, at: new Date(toMs(delta.value)).toISOString(), hard: true, note: 'Dari kabar terkonfirmasi' },
    ]
    return { working, violations: [] }
  }

  if (delta.type === 'active_end_estimate') {
    if (item.status !== 'in_progress') return invalid(`${item.title} tidak sedang berlangsung; gunakan jenis perubahan lain.`)
    if (toMs(delta.value) <= toMs(item.start_at)) return invalid('Estimasi selesai harus setelah waktu mulai.')
    item.estimated_end_at = new Date(toMs(delta.value)).toISOString()
    return { working, violations: [] }
  }

  // cancel_item
  if (item.status !== 'pending') {
    return { working, violations: [{ rule: 'LOCKED_ITEM', constraint_id: `LOCK-${item.id}`, item_id: item.id, message: `${item.title} sudah ${item.status}; hanya item belum mulai yang dapat dibatalkan.` }] }
  }
  item.status = 'cancelled'
  return { working, violations: [] }
}

function pendingOrder(working: Snapshot): string[] {
  return sortByStart(working.items.filter((i) => i.status === 'pending')).map((i) => i.id)
}

function lastBoundaryIndex(working: Snapshot, order: string[], beforeIndex: number): number {
  for (let k = beforeIndex - 1; k >= 0; k--) {
    if (working.constraints.some((c) => c.item_id === order[k] && c.type === 'fixed_start')) return k
  }
  return -1
}

/**
 * Pangkas item fleksibel (urutan tetap berdasarkan ID item) sampai durasi minimum agar
 * item berikutnya kembali ke anchor / slot tetap / curfew. Kombinasi lain belum dicari.
 */
function trimPlan(working: Snapshot, plan: Plan, analysisNow: string): Plan | null {
  const durations = new Map(plan.durations)
  const byId = new Map(working.items.map((i) => [i.id, i]))
  let trimmed = false
  for (let round = 0; round < SEARCH_LIMITS.trimRounds; round++) {
    const { snapshot, pushedByCursor } = propagate(working, { ...plan, durations })
    const violations = evaluate(snapshot, working, analysisNow)
    const fixedViolation = violations.find((v) => v.rule === 'FIXED_START' && v.actual && v.limit && toMs(v.actual) > toMs(v.limit))
    const curfewViolation = violations.find((v) => v.rule === 'CURFEW')
    const targets: Array<{ index: number; overrun: number }> = []
    if (fixedViolation?.item_id) {
      targets.push({ index: plan.order.indexOf(fixedViolation.item_id), overrun: toMs(fixedViolation.actual!) - toMs(fixedViolation.limit!) })
    } else if (curfewViolation?.actual && curfewViolation.limit) {
      targets.push({ index: plan.order.length, overrun: toMs(curfewViolation.actual) - toMs(curfewViolation.limit) })
    } else {
      for (const p of pushedByCursor) targets.push({ index: plan.order.indexOf(p.item_id), overrun: p.overrun_ms })
    }

    let progressed = false
    for (const target of targets) {
      if (target.index < 0) continue
      const from = lastBoundaryIndex(working, plan.order, target.index) + 1
      const trimmable = plan.order
        .slice(from, target.index)
        .filter((id) => (durations.get(id) ?? byId.get(id)!.duration_seconds) > byId.get(id)!.min_duration_seconds)
        .sort()
      let remaining = Math.ceil(target.overrun / 1000)
      for (const id of trimmable) {
        if (remaining <= 0) break
        const current = durations.get(id) ?? byId.get(id)!.duration_seconds
        const cut = Math.min(remaining, current - byId.get(id)!.min_duration_seconds)
        durations.set(id, current - cut)
        remaining -= cut
        progressed = progressed || cut > 0
      }
      if (progressed) break
    }
    if (!progressed) break
    trimmed = true
  }
  return trimmed ? { ...plan, durations } : null
}

function generateDrafts(working: Snapshot, analysisNow: string): { drafts: Draft[]; truncated: boolean } {
  const order = pendingOrder(working)
  const byId = new Map(working.items.map((i) => [i.id, i]))
  const anchorsByPosition = order.map((id) => toMs(byId.get(id)!.start_at))
  const anchorsFor = (o: string[]) => new Map(o.map((id, k) => [id, anchorsByPosition[k]]))
  const drafts: Draft[] = []
  let truncated = order.length > SEARCH_LIMITS.items
  const searchOrder = order.slice(0, SEARCH_LIMITS.items)
  const push = (d: Draft) => {
    if (drafts.length >= SEARCH_LIMITS.candidates) {
      truncated = true
      return
    }
    drafts.push(d)
  }

  const plans: Array<{ strategy: Strategy; label: string; plan: Plan }> = [
    { strategy: 'shift', label: 'Geser maju item berikutnya', plan: { order, durations: new Map(), anchors: anchorsFor(order) } },
  ]
  for (let i = 0; i < searchOrder.length; i++) {
    for (let j = i + 1; j < searchOrder.length; j++) {
      const a = byId.get(searchOrder[i])!
      const b = byId.get(searchOrder[j])!
      if (!a.swappable || !b.swappable) continue
      const swapped = [...order]
      swapped[i] = order[j]
      swapped[j] = order[i]
      plans.push({ strategy: 'swap', label: `Tukar ${a.title} ↔ ${b.title}`, plan: { order: swapped, durations: new Map(), anchors: anchorsFor(swapped) } })
    }
  }

  for (const p of plans) {
    push({ strategy: p.strategy, label: p.label, proposed: propagate(working, p.plan).snapshot })
    const trimmed = trimPlan(working, p.plan, analysisNow)
    if (trimmed) {
      const names = [...trimmed.durations.keys()].map((id) => byId.get(id)!.title).join(', ')
      push({
        strategy: p.strategy === 'swap' ? 'swap_trim' : 'trim',
        label: `${p.strategy === 'swap' ? p.label + ' + pangkas' : 'Pangkas'} ${names} (≥ durasi minimum)`,
        proposed: propagate(working, trimmed).snapshot,
      })
    }
  }
  return { drafts, truncated }
}

/** Kandidat pembatalan keputusan: kembalikan item yang diubah keputusan ke nilai sebelumnya, terhadap versi terkini. */
function reversalDraft(current: Snapshot, delta: Extract<Delta, { type: 'revert_decision' }>): { draft: Draft; violations: Violation[] } {
  const proposed = cloneSnapshot(current)
  const violations: Violation[] = []
  const before = new Map(delta.before.items.map((i) => [i.id, i]))
  const after = new Map(delta.after.items.map((i) => [i.id, i]))
  for (const item of proposed.items) {
    const b = before.get(item.id)
    const a = after.get(item.id)
    if (!b && a) {
      if (LOCKED_STATUSES.has(item.status)) violations.push({ rule: 'LOCKED_ITEM', constraint_id: `LOCK-${item.id}`, item_id: item.id, message: `${item.title} sudah berlangsung/selesai; penambahan tidak dapat dibatalkan.` })
      else item.status = 'cancelled'
      continue
    }
    if (!b || !a) continue
    const changedByDecision =
      !isDeepStrictEqual(a, b)
    if (!changedByDecision) continue
    if (LOCKED_STATUSES.has(item.status) && (item.status !== b.status || item.title !== b.title || !isDeepStrictEqual(item.pic_role_ids, b.pic_role_ids) || !isDeepStrictEqual(item.resource_ids, b.resource_ids))) {
      violations.push({ rule: 'LOCKED_ITEM', constraint_id: `LOCK-${item.id}`, item_id: item.id, message: `${item.title} sudah ${item.status === 'completed' ? 'selesai' : 'berlangsung'}; aktivitas fisik tidak dapat dikembalikan.` })
      continue
    }
    if (item.status === 'in_progress' && b.status === 'in_progress') {
      item.estimated_end_at = b.estimated_end_at
      continue
    }
    if (item.status === 'completed') continue
    item.start_at = b.start_at
    item.duration_seconds = b.duration_seconds
    item.status = b.status === 'cancelled' || b.status === 'pending' ? b.status : item.status
    item.title = b.title
    item.pic_role_ids = [...b.pic_role_ids]
    if (b.pic_text === undefined) delete item.pic_text
    else item.pic_text = b.pic_text
    item.resource_ids = [...b.resource_ids]
    item.swappable = b.swappable
  }
  const beforeCons = new Map(delta.before.constraints.map((c) => [c.id, c]))
  const afterCons = new Map(delta.after.constraints.map((c) => [c.id, c]))
  const touched = new Set([...beforeCons.keys(), ...afterCons.keys()].filter((id) => JSON.stringify(beforeCons.get(id)) !== JSON.stringify(afterCons.get(id))))
  proposed.constraints = [
    ...proposed.constraints.filter((c) => !touched.has(c.id)),
    ...[...touched].map((id) => beforeCons.get(id)).filter((c): c is NonNullable<typeof c> => !!c),
  ]
  const beforeDeps = new Map(delta.before.dependencies.map(d => [d.id, d]))
  const afterDeps = new Map(delta.after.dependencies.map(d => [d.id, d]))
  const touchedDeps = new Set([...beforeDeps.keys(), ...afterDeps.keys()].filter(id => !isDeepStrictEqual(beforeDeps.get(id), afterDeps.get(id))))
  proposed.dependencies = [
    ...proposed.dependencies.filter(d => !touchedDeps.has(d.id)),
    ...[...touchedDeps].map(id => beforeDeps.get(id)).filter((d): d is NonNullable<typeof d> => !!d),
  ].sort((a, b) => a.id.localeCompare(b.id))
  for (const field of ['name', 'timezone', 'stage', 'curfew_at'] as const) {
    if (delta.before.event[field] !== delta.after.event[field]) proposed.event[field] = delta.before.event[field]
  }
  const beforeRoles = new Map(delta.before.roles.map(role => [role.id, role]))
  const afterRoles = new Map(delta.after.roles.map(role => [role.id, role]))
  if (!isDeepStrictEqual([...beforeRoles.keys()].sort(), [...afterRoles.keys()].sort())) {
    violations.push({ rule: 'INVALID_DELTA', constraint_id: 'CONFIGURATION', item_id: null, message: 'Pembatalan konfigurasi tidak boleh mengubah ID/keanggotaan peran.' })
  } else {
    for (const role of proposed.roles) {
      const b = beforeRoles.get(role.id)
      const a = afterRoles.get(role.id)
      if (b && a && b.label !== a.label) role.label = b.label
    }
  }
  const beforeResources = new Map(delta.before.resources.map(resource => [resource.id, resource]))
  const afterResources = new Map(delta.after.resources.map(resource => [resource.id, resource]))
  const touchedResources = new Set([...beforeResources.keys(), ...afterResources.keys()].filter(id => !isDeepStrictEqual(beforeResources.get(id), afterResources.get(id))))
  proposed.resources = [
    ...proposed.resources.filter(resource => !touchedResources.has(resource.id)),
    ...[...touchedResources].map(id => beforeResources.get(id)).filter((resource): resource is NonNullable<typeof resource> => !!resource).map(resource => structuredClone(resource)),
  ].sort((a, b) => a.id.localeCompare(b.id))
  proposed.items = sortByStart(proposed.items)
  return { draft: { strategy: 'revert', label: 'Kembalikan item yang diubah keputusan ke jadwal sebelumnya', proposed }, violations }
}

export interface AnalyzeInput {
  base: Snapshot
  delta: Delta
  analysisNow: string
}

/**
 * Pipeline engine deterministik: validasi → delta → kandidat (geser/tukar/pangkas) → validasi hard constraint
 * → dampak → deduplikasi → ranking. Tidak membaca jam sistem, DB, atau model.
 */
export function analyze({ base, delta, analysisNow }: AnalyzeInput): AnalysisResult {
  const { errors, missing } = validateSnapshot(base)
  if (errors.length || missing.length) return blockerResult(analysisNow, [...errors, ...missing])

  let working: Snapshot
  let drafts: Draft[]
  let truncated = false
  let preViolations: Violation[] = []
  if (delta.type === 'revise_rundown' || delta.type === 'configure_event') {
    const violations = delta.type === 'configure_event' ? validateConfiguration(base, delta.snapshot) : validateRevision(base, delta.snapshot)
    if (violations.length) return blockerResult(analysisNow, violations)
    working = base
    drafts = [{ strategy: 'keep', label: delta.type === 'configure_event' ? 'Perbarui konfigurasi acara' : 'Revisi rundown sesuai rekomendasi', proposed: cloneSnapshot(delta.snapshot) }]
  } else if (delta.type === 'revert_decision') {
    working = base
    const r = reversalDraft(base, delta)
    drafts = [r.draft]
    preViolations = r.violations
  } else {
    const applied = applyDelta(base, delta)
    if (applied.violations.length) return blockerResult(analysisNow, applied.violations)
    working = applied.working
    const generated = generateDrafts(working, analysisNow)
    drafts = generated.drafts
    truncated = generated.truncated
  }

  const seen = new Set<string>()
  const valid: Candidate[] = []
  const rejected: RejectedCandidate[] = []
  for (const d of drafts) {
    const id = candidateIdFor(d.proposed)
    if (seen.has(id)) continue
    seen.add(id)
    const structure = validateSnapshot(d.proposed)
    const violations = [...preViolations, ...structure.errors, ...structure.missing, ...evaluate(d.proposed, working, analysisNow)]
    if (violations.length) {
      rejected.push({ candidate_id: id, strategy: d.strategy, label: d.label, violations })
      continue
    }
    const diff = diffSnapshots(base, d.proposed)
    const configurationDiff = delta.type === 'configure_event' || delta.type === 'revert_decision' ? diffConfiguration(base, d.proposed) : []
    const changedTiming = diff.filter((x) => isActive(d.proposed.items.find((i) => i.id === x.item_id)!) || (x.kind !== 'added' && x.changes.includes('status')))
    valid.push({
      candidate_id: id,
      rank: 0,
      strategy: diff.length === 0 && d.strategy === 'shift' ? 'keep' : d.strategy,
      label: diff.length === 0 && d.strategy === 'shift' ? 'Pertahankan jadwal (hanya perbarui batas)' : d.label,
      items_changed: changedTiming.length,
      total_start_shift_seconds: diff.reduce((sum, x) => sum + Math.abs(x.start_shift_seconds), 0),
      diff,
      ...(configurationDiff.length ? { configuration_diff: configurationDiff } : {}),
      proposed: d.proposed,
      violations: [],
      impact: computeImpact(base, d.proposed, diff, delta),
    })
  }

  valid.sort((a, b) => a.items_changed - b.items_changed || a.total_start_shift_seconds - b.total_start_shift_seconds || a.candidate_id.localeCompare(b.candidate_id))
  const candidates = valid.slice(0, SEARCH_LIMITS.maxReturned).map((c, k) => ({ ...c, rank: k + 1 }))
  rejected.sort((a, b) => a.violations.length - b.violations.length || a.candidate_id.localeCompare(b.candidate_id))

  return {
    engine_version: ENGINE_VERSION,
    analysis_now: analysisNow,
    blockers: [],
    candidates,
    rejected: rejected.slice(0, 12),
    search: {
      strategies: [...new Set(drafts.map((d) => d.strategy))],
      generated: drafts.length,
      evaluated: seen.size,
      valid: valid.length,
      limit_candidates: SEARCH_LIMITS.candidates,
      limit_items: SEARCH_LIMITS.items,
      truncated,
      note: delta.type === 'configure_event' || delta.type === 'revise_rundown' ? 'Validasi satu usulan persis; perubahan menunggu konfirmasi koordinator.' : 'Pencarian terbatas (geser, tukar pasangan, pangkas ke minimum). Bukan optimasi global; opsi lain mungkin ada.',
    },
  }
}

/** Validasi ulang saat approve: kandidat tersimpan terhadap snapshot aktif + jam server terkini. */
export function revalidate(proposed: Snapshot, active: Snapshot, analysisNow: string, delta: Delta): Violation[] {
  const structure = validateSnapshot(proposed)
  if (structure.errors.length || structure.missing.length) return [...structure.errors, ...structure.missing]
  if (delta.type === 'revise_rundown' || delta.type === 'configure_event') {
    const violations = delta.type === 'configure_event' ? validateConfiguration(active, proposed) : validateRevision(active, proposed)
    if (!isDeepStrictEqual(proposed, delta.snapshot)) violations.push({ rule: 'INVALID_DELTA', constraint_id: 'REVISION', item_id: null, message: 'Usulan tidak sama dengan pratinjau yang dikonfirmasi.' })
    return [...violations, ...evaluate(proposed, active, analysisNow)]
  }
  if (delta.type === 'revert_decision') {
    const reversal = reversalDraft(active, delta)
    const violations = [...reversal.violations]
    if (!isDeepStrictEqual(proposed, reversal.draft.proposed)) violations.push({ rule: 'INVALID_DELTA', constraint_id: 'REVERSAL', item_id: null, message: 'Usulan pembatalan berbeda dari perubahan yang dipratinjau.' })
    return [...violations, ...evaluate(proposed, active, analysisNow)]
  }
  const applied = applyDelta(active, delta)
  if (applied.violations.length) return applied.violations
  return evaluate(proposed, applied.working, analysisNow)
}
