import { randomUUID } from 'node:crypto'
import { computeImpact, diffSnapshots } from '@/modules/engine/impact'
import { endIso } from '@/modules/engine/schedule'
import type { ItemDiff, RoleImpact, Snapshot } from '@/modules/engine/types'
import type { Session } from '@/lib/session'
import type { NotificationOrigin, NotificationPayload } from './types'

const text = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200)

export interface PayloadInput {
  base: Snapshot
  proposed: Snapshot
  version: number
  baseVersion: number
  session: Session
  origin: NotificationOrigin
  committedAt: string
  diff?: ItemDiff[]
  impact?: RoleImpact[]
  decision?: NonNullable<NotificationPayload['decision']>
  importFilename?: string
}

export function buildPayload(input: PayloadInput): NotificationPayload {
  const { base, proposed, origin } = input
  const diff = input.diff ?? diffSnapshots(base, proposed)
  const impact = input.impact ?? computeImpact(base, proposed, diff, null)
  const active = proposed.items.filter(item => item.status !== 'cancelled')
  const ends = active.map(endIso).sort((a, b) => Date.parse(a) - Date.parse(b))
  const config = (['name', 'timezone', 'curfew_at'] as const).filter(field => base.event[field] !== proposed.event[field])
    .map(field => ({ field, old: text(base.event[field]), new: text(proposed.event[field]) }))
  const payload: NotificationPayload = {
    schema_version: 1, kind: 'schedule.version.committed',
    idempotency_key: `notify:${proposed.event.id}:v${input.version}`, correlation_id: randomUUID(),
    event: { id: proposed.event.id, name: text(proposed.event.name), timezone: proposed.event.timezone, curfew_at: proposed.event.curfew_at },
    version: input.version, base_version: input.baseVersion, origin, committed_at: input.committedAt,
    actor: { actor_id: input.session.actor_id, display_name: text(input.session.display_name) },
    changes: origin === 'import' || origin === 'settings' ? [] : [...diff]
      .sort((a, b) => Math.abs(b.start_shift_seconds) - Math.abs(a.start_shift_seconds) || a.item_id.localeCompare(b.item_id))
      .slice(0, 30).map(({ start_shift_seconds, details: _details, ...entry }) => ({ ...entry, title: text(entry.title), shift_minutes: Math.round(start_shift_seconds / 60) })),
    items_changed: diff.length,
    projected_finish_at: ends.at(-1) ?? proposed.event.curfew_at,
    impact: impact.map(role => ({ ...role, role_label: text(role.role_label), entries: role.entries.map(entry => ({ ...entry, title: text(entry.title), reason: text(entry.reason) })) })),
    roles: proposed.roles.map(role => ({ ...role, label: text(role.label) })),
    ...(config.length ? { config_changes: config } : {}),
    ...(input.decision ? { decision: { ...input.decision, patch_label: text(input.decision.patch_label), reason: text(input.decision.reason) } } : {}),
  }
  if (origin === 'import') payload.import_summary = {
    item_count: proposed.items.length,
    first_start_at: active.map(item => item.start_at).sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null,
    last_end_at: ends.at(-1) ?? null,
    filename: text(input.importFilename ?? ''),
  }
  return payload
}
