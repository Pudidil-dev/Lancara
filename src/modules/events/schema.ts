import { z } from 'zod'

const Iso = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Timestamp ISO tidak valid')
const Id = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/, 'ID hanya huruf, angka, - dan _')

export const ItemSchema = z.object({
  id: Id,
  title: z.string().max(120),
  start_at: Iso,
  duration_seconds: z.number().int(),
  min_duration_seconds: z.number().int(),
  estimated_end_at: Iso.nullable(),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
  pic_role_ids: z.array(Id).max(10),
  resource_ids: z.array(Id).max(10),
  swappable: z.boolean(),
  segment: z.string().max(80).nullable().optional(),
  involved: z.array(z.string().min(1).max(200)).max(20).optional(),
  equipment: z.array(z.string().min(1).max(200)).max(20).optional(),
  notes: z.array(z.string().min(1).max(200)).max(20).optional(),
})

export const SnapshotSchema = z.object({
  event: z.object({ id: Id, name: z.string().min(1).max(120), timezone: z.string().min(1).max(64), curfew_at: Iso, stage: Id }),
  roles: z.array(z.object({ id: Id, label: z.string().min(1).max(80) })).max(30),
  // Jadwal sehari penuh; pencarian kombinasi engine tetap dibatasi terpisah.
  items: z.array(ItemSchema).max(60),
  dependencies: z
    .array(z.object({ id: Id, predecessor_id: Id, successor_id: Id, type: z.literal('finish_before_start') }))
    .max(60),
  constraints: z
    .array(
      z.object({
        id: Id,
        type: z.enum(['fixed_start', 'earliest_start']),
        item_id: Id,
        at: Iso,
        hard: z.literal(true),
        note: z.string().max(200).optional(),
      }),
    )
    .max(60),
  resources: z.array(z.object({ id: Id, label: z.string().min(1).max(80), role_ids: z.array(Id).max(10) })).max(30),
})

/** Delta yang boleh dikirim client (revert_decision hanya dibangun server). */
export const DeltaInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('earliest_start'), item_id: Id, value: Iso, is_estimate: z.boolean(), reference_at: Iso.nullable() }),
  z.object({ type: z.literal('active_end_estimate'), item_id: Id, value: Iso, is_estimate: z.boolean(), reference_at: Iso.nullable() }),
  z.object({ type: z.literal('cancel_item'), item_id: Id, is_estimate: z.literal(false), reference_at: Iso.nullable() }),
])
