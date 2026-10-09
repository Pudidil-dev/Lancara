import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { AppError } from '@/lib/errors'
import { normalizeIso } from '@/lib/time'
import { analyze } from '@/modules/engine/analyze'
import type { Snapshot } from '@/modules/engine/types'

const Id = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/)
const Timestamp = z.iso.datetime({ offset: true })
const Label = z.string().trim().min(1).max(80)
const UpdateEvent = z.object({
  op: z.literal('update_event'),
  name: z.string().trim().min(1).max(120).optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  curfew_at: Timestamp.optional(),
  stage: Id.optional(),
}).strict()
const UpsertResource = z.object({
  op: z.literal('upsert_resource'), id: Id, label: Label, role_ids: z.array(Id).min(1).max(10),
}).strict()
const DeleteResource = z.object({ op: z.literal('delete_resource'), resource_id: Id }).strict()
const UpdateRole = z.object({ op: z.literal('update_role'), role_id: Id, label: Label }).strict()
const UpsertConstraint = z.object({
  op: z.literal('upsert_constraint'), id: Id, type: z.enum(['fixed_start', 'earliest_start']),
  item_id: Id, at: Timestamp, hard: z.literal(true), note: z.string().max(200).optional(),
}).strict()
const DeleteConstraint = z.object({ op: z.literal('delete_constraint'), constraint_id: Id }).strict()
const UpsertDependency = z.object({
  op: z.literal('upsert_dependency'), id: Id, predecessor_id: Id, successor_id: Id, type: z.literal('finish_before_start'),
}).strict()
const DeleteDependency = z.object({ op: z.literal('delete_dependency'), dependency_id: Id }).strict()

/** Pengaturan event saat ini; tidak menerima perubahan actor, session, secret, atau item. */
export const EditEventConfigurationInputSchema = z.object({
  base_version: z.number().int().min(1),
  summary: z.string().trim().min(3).max(200),
  operations: z.array(z.discriminatedUnion('op', [
    UpdateEvent, UpsertResource, DeleteResource, UpdateRole,
    UpsertConstraint, DeleteConstraint, UpsertDependency, DeleteDependency,
  ])).min(1).max(30),
}).strict()

export type EditEventConfigurationInput = z.infer<typeof EditEventConfigurationInputSchema>
export type EditEventConfigurationOperation = EditEventConfigurationInput['operations'][number]

const ADDITION_LIMITS = { resources: 30, constraints: 60, dependencies: 60 } as const

function removeById<T extends { id: string }>(values: T[], id: string, noun: string): T[] {
  if (!values.some(value => value.id === id)) throw new AppError('VALIDATION_ERROR', `${noun} tidak ditemukan pada acara aktif.`)
  return values.filter(value => value.id !== id)
}

/** Pertahankan posisi dan semua entri yang sudah ada; batas hanya berlaku untuk penambahan baru. */
function upsertById<T extends { id: string }>(values: T[], value: T, limit: number, noun: string): T[] {
  const index = values.findIndex(current => current.id === value.id)
  if (index < 0) {
    if (values.length >= limit) throw new AppError('VALIDATION_ERROR', `${noun} mencapai batas ${limit} entri; ubah entri yang ada.`)
    return [...values, value]
  }
  return values.map((current, position) => position === index ? value : current)
}

function validateTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('id-ID', { timeZone: timezone }).format(0)
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Zona waktu acara tidak valid. Gunakan zona IANA seperti Asia/Jakarta.')
  }
}

/**
 * Bangun konfigurasi persis pada salinan snapshot, lalu validasi dengan engine.
 * Fungsi murni: DB baru berubah setelah preview dikonfirmasi melalui approve.
 */
export function buildEventConfiguration(base: Snapshot, raw: unknown, now: string): Snapshot {
  const parsed = EditEventConfigurationInputSchema.safeParse(raw)
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Input perubahan pengaturan tidak valid.')
  const proposed = structuredClone(base)
  for (const operation of parsed.data.operations) {
    switch (operation.op) {
      case 'update_event': {
        if (Object.keys(operation).length === 1) throw new AppError('VALIDATION_ERROR', 'Isi pengaturan acara yang ingin diubah.')
        if (operation.timezone !== undefined) {
          validateTimezone(operation.timezone)
          proposed.event.timezone = operation.timezone
        }
        if (operation.name !== undefined) proposed.event.name = operation.name
        if (operation.stage !== undefined) proposed.event.stage = operation.stage
        if (operation.curfew_at !== undefined) proposed.event.curfew_at = normalizeIso(operation.curfew_at)
        break
      }
      case 'update_role': {
        const role = proposed.roles.find(value => value.id === operation.role_id)
        if (!role) throw new AppError('VALIDATION_ERROR', 'Peran tidak ditemukan pada acara aktif.')
        role.label = operation.label
        break
      }
      case 'upsert_resource': {
        const { op: _op, ...resource } = operation
        resource.role_ids = [...new Set(resource.role_ids)]
        proposed.resources = upsertById(proposed.resources, resource, ADDITION_LIMITS.resources, 'Resource')
        break
      }
      case 'delete_resource': {
        if (proposed.items.some(item => item.resource_ids.includes(operation.resource_id))) {
          throw new AppError('PATCH_BLOCKED', 'Resource masih dipakai item rundown. Lepaskan resource dari item melalui revisi rundown terlebih dahulu.')
        }
        proposed.resources = removeById(proposed.resources, operation.resource_id, 'Resource')
        break
      }
      case 'upsert_constraint': {
        const { op: _op, ...constraint } = operation
        constraint.at = normalizeIso(constraint.at)
        proposed.constraints = upsertById(proposed.constraints, constraint, ADDITION_LIMITS.constraints, 'Batas jadwal')
        break
      }
      case 'delete_constraint':
        proposed.constraints = removeById(proposed.constraints, operation.constraint_id, 'Batas jadwal')
        break
      case 'upsert_dependency': {
        const { op: _op, ...dependency } = operation
        proposed.dependencies = upsertById(proposed.dependencies, dependency, ADDITION_LIMITS.dependencies, 'Dependensi')
        break
      }
      case 'delete_dependency':
        proposed.dependencies = removeById(proposed.dependencies, operation.dependency_id, 'Dependensi')
        break
    }
  }
  if (isDeepStrictEqual(base, proposed)) throw new AppError('VALIDATION_ERROR', 'Pengaturan sama dengan acara aktif; tidak ada perubahan untuk dikonfirmasi.')
  const analysis = analyze({ base, delta: { type: 'configure_event', snapshot: proposed, is_estimate: false, reference_at: now }, analysisNow: now })
  if (!analysis.candidates.length) {
    const violations = [...analysis.blockers, ...analysis.rejected.flatMap(candidate => candidate.violations)]
    throw new AppError('PATCH_BLOCKED', violations.slice(0, 3).map(violation => violation.message).join(' ') || 'Pengaturan belum lolos pemeriksaan acara.', { violations })
  }
  return proposed
}
