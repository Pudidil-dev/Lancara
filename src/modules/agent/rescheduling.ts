import { z } from 'zod'
import { AppError } from '@/lib/errors'
import { formatClock, toMs } from '@/lib/time'
import { analyze } from '@/modules/engine/analyze'
import { endMs, isActive, isBreakItem, sortByStart } from '@/modules/engine/schedule'
import type { Candidate, Item, Snapshot } from '@/modules/engine/types'
import { resolveEventClock } from './time'

const Id = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/)
const Clock = z.string().regex(/^([01]?\d|2[0-3])[:.][0-5]\d$/)
const Minutes = z.number().int().min(1).max(720)
const Create = z.object({
  op: z.literal('create'), id: Id, title: z.string().trim().min(1).max(120), start_hhmm: Clock,
  duration_minutes: Minutes, min_duration_minutes: Minutes, pic_role_ids: z.array(Id).min(1).max(10),
  resource_ids: z.array(Id).max(10), swappable: z.boolean(), after_item_id: Id.nullish(),
}).strict()
const Update = z.object({
  op: z.literal('update'), item_id: Id, start_hhmm: Clock.optional(), duration_minutes: Minutes.optional(),
  title: z.string().trim().min(1).max(120).optional(), pic_role_ids: z.array(Id).min(1).max(10).optional(),
  resource_ids: z.array(Id).max(10).optional(), swappable: z.boolean().optional(),
}).strict()
const Delete = z.object({ op: z.literal('delete'), item_id: Id }).strict()
const Reorder = z.object({ op: z.literal('reorder'), item_ids: z.array(Id).min(1).max(60) }).strict()
export const EditRundownInputSchema = z.object({
  base_version: z.number().int().min(1), summary: z.string().trim().min(3).max(200),
  operations: z.array(z.discriminatedUnion('op', [Create, Update, Delete, Reorder])).min(1).max(60),
}).strict()
export type EditRundownInput = z.infer<typeof EditRundownInputSchema>
export type EditRundownOperation = EditRundownInput['operations'][number]

export const isProtected = (item: Item, snapshot: Snapshot) => isBreakItem(item) || snapshot.constraints.some(c => c.item_id === item.id && /ishoma|istirahat|sholat|makan/i.test(c.note ?? ''))

/** Bangun rencana dengan ID server; tidak mengubah DB, constraint global, atau input. */
export function buildEditedRundown(base: Snapshot, input: EditRundownInput, now: string): Snapshot {
  const proposed = structuredClone(base)
  for (const op of input.operations) {
    if (op.op === 'reorder') {
      const pending = proposed.items.filter(i => i.status === 'pending')
      const ids = new Set(op.item_ids)
      if (ids.size !== op.item_ids.length || ids.size !== pending.length || pending.some(i => !ids.has(i.id))) throw new AppError('VALIDATION_ERROR', 'Urutan harus memuat semua item pending tepat sekali.')
      let cursor = Math.max(toMs(now), Math.min(...pending.map(i => toMs(i.start_at))), ...proposed.items.filter(i => i.status === 'in_progress' || i.status === 'completed').map(endMs))
      const byId = new Map(proposed.items.map(i => [i.id, i]))
      for (const id of op.item_ids) {
        const item = byId.get(id)!
        const fixed = proposed.constraints.find(c => c.item_id === id && c.type === 'fixed_start')
        const earliest = proposed.constraints.find(c => c.item_id === id && c.type === 'earliest_start')
        if (!fixed && !isProtected(item, base)) item.start_at = new Date(Math.max(cursor, earliest ? toMs(earliest.at) : -Infinity)).toISOString()
        cursor = Math.max(cursor, endMs(item))
      }
      let index = 0
      proposed.items = proposed.items.map(item => item.status === 'pending' ? byId.get(op.item_ids[index++])! : item)
      continue
    }
    if (op.op === 'create') {
      if (proposed.items.some(i => i.id === op.id)) throw new AppError('VALIDATION_ERROR', 'ID item baru sudah dipakai.')
      const after = op.after_item_id ? proposed.items.find(i => i.id === op.after_item_id) : null
      if (op.after_item_id && !after) throw new AppError('VALIDATION_ERROR', 'Posisi sisipan tidak ditemukan.')
      const item: Item = {
        id: op.id, title: op.title, start_at: resolveEventClock(base, op.start_hhmm, after?.start_at ?? now),
        duration_seconds: op.duration_minutes * 60, min_duration_seconds: op.min_duration_minutes * 60,
        status: 'pending', estimated_end_at: null, pic_role_ids: op.pic_role_ids, resource_ids: op.resource_ids, swappable: op.swappable,
      }
      const index = after ? proposed.items.indexOf(after) + 1 : proposed.items.length
      proposed.items.splice(index, 0, item)
      continue
    }
    const item = proposed.items.find(i => i.id === op.item_id)
    if (!item) throw new AppError('VALIDATION_ERROR', 'Item tidak ditemukan pada rundown aktif.')
    if (item.status !== 'pending' || isProtected(item, base)) throw new AppError('PATCH_BLOCKED', `${item.title} dikunci; pilih sesi pending yang fleksibel.`)
    if (op.op === 'delete') {
      item.status = 'cancelled'
      proposed.dependencies = proposed.dependencies.filter(d => d.predecessor_id !== item.id && d.successor_id !== item.id)
      continue
    }
    if (Object.keys(op).length <= 2) throw new AppError('VALIDATION_ERROR', 'Update harus berisi perubahan.')
    if (op.start_hhmm !== undefined) item.start_at = resolveEventClock(base, op.start_hhmm, item.start_at)
    if (op.duration_minutes !== undefined) item.duration_seconds = op.duration_minutes * 60
    if (op.title !== undefined) item.title = op.title
    if (op.pic_role_ids !== undefined) item.pic_role_ids = op.pic_role_ids
    if (op.resource_ids !== undefined) item.resource_ids = op.resource_ids
    if (op.swappable !== undefined) item.swappable = op.swappable
  }
  const analysis = analyze({ base, delta: { type: 'revise_rundown', snapshot: proposed, is_estimate: false, reference_at: now }, analysisNow: now })
  if (!analysis.candidates.length) {
    const violations = [...analysis.blockers, ...analysis.rejected.flatMap(r => r.violations)]
    throw new AppError('PATCH_BLOCKED', violations.slice(0, 3).map(v => v.message).join(' ') || 'Rencana belum lolos pemeriksaan jadwal.', { violations })
  }
  if (!analysis.candidates[0].diff.length) throw new AppError('VALIDATION_ERROR', 'Rencana ini sama dengan rundown aktif.')
  return proposed
}

export interface RescheduleRecommendation {
  rank: number; label: string; operations: EditRundownOperation[]; diff: Candidate['diff']; action_roles: string[]
}

/** Coba pengisi jeda dari sesi yang ada, termasuk sesi di luar batas pencarian tukar legacy. */
export function recommendReschedules(base: Snapshot, now: string): RescheduleRecommendation[] {
  const active = sortByStart(base.items.filter(isActive))
  const nowMs = toMs(now)
  const gaps: Array<{ start: number; end: number; cancelled: boolean }> = []
  for (let index = 0; index < active.length; index++) {
    const start = Math.max(endMs(active[index]), nowMs)
    const end = index + 1 < active.length ? toMs(active[index + 1].start_at) : toMs(base.event.curfew_at)
    if (end - start < 60_000) continue
    // Dahulukan bagian jeda yang ditinggalkan sesi batal.
    const cancelled = base.items.filter(i => i.status === 'cancelled' && toMs(i.start_at) >= start && toMs(i.start_at) < end)
    for (const item of cancelled) gaps.push({ start: toMs(item.start_at), end: Math.min(endMs(item), end), cancelled: true })
    gaps.push({ start, end, cancelled: false })
  }
  const recommendations: Array<RescheduleRecommendation & { priority: number; fill: number; shift: number }> = []
  const seen = new Set<string>()
  let attempts = 0
  for (const gap of gaps.sort((a, b) => Number(b.cancelled) - Number(a.cancelled) || a.start - b.start)) {
    for (const item of active) {
      if (++attempts > 3600) break
      if (item.status !== 'pending' || !item.swappable || isProtected(item, base) || toMs(item.start_at) <= gap.start || item.duration_seconds * 1000 > gap.end - gap.start || base.constraints.some(c => c.item_id === item.id && c.type === 'fixed_start')) continue
      const operation: EditRundownOperation = { op: 'update', item_id: item.id, start_hhmm: formatClock(new Date(gap.start).toISOString(), base.event.timezone) }
      const fingerprint = JSON.stringify(operation)
      if (seen.has(fingerprint)) continue
      seen.add(fingerprint)
      try {
        const proposed = buildEditedRundown(base, { base_version: 1, summary: 'Isi jeda rundown', operations: [operation] }, now)
        // Jam ambigu di event beberapa hari harus benar-benar menunjuk gap yang dipilih.
        if (toMs(proposed.items.find(i => i.id === item.id)!.start_at) !== gap.start) continue
        const candidate = analyze({ base, delta: { type: 'revise_rundown', snapshot: proposed, is_estimate: false, reference_at: now }, analysisNow: now }).candidates[0]
        recommendations.push({ rank: 0, label: `Majukan ${item.title} ke ${operation.start_hhmm}`, operations: [operation], diff: candidate.diff, action_roles: candidate.impact.filter(r => r.level === 'ACTION_REQUIRED').map(r => r.role_label), priority: gap.cancelled ? 0 : 1, fill: item.duration_seconds, shift: toMs(item.start_at) - gap.start })
      } catch (error) { if (!(error instanceof AppError)) throw error }
    }
  }
  return recommendations.sort((a, b) => a.priority - b.priority || a.shift - b.shift || b.fill - a.fill || a.label.localeCompare(b.label)).slice(0, 3).map(({ priority: _priority, fill: _fill, shift: _shift, ...recommendation }, index) => ({ ...recommendation, rank: index + 1 }))
}
