import { formatClock, localDate, zoneAbbrev } from '@/lib/time'
import { endIso, sortByStart } from '@/modules/engine/schedule'
import type { Snapshot } from '@/modules/engine/types'

/** Hanya data yang aman untuk dikirim ke model: tanpa ID sesi, ID akun, roles, batas, atau secret. */
export interface SupportContext {
  event: { name: string; timezone: string; version: number; now: string }
  you: { name: string; role: string; capability: 'coordinator' | 'crew' }
  items: Array<{ title: string; start: string; end: string; status: string }>
}

export function buildSupportContext(
  you: { display_name: string; role_label: string; capability: 'coordinator' | 'crew' },
  snapshot: Snapshot,
  version: number,
  now: string,
): SupportContext {
  const zone = snapshot.event.timezone
  return {
    event: { name: snapshot.event.name, timezone: `${zone} (${zoneAbbrev(zone)})`, version, now: formatClock(now, zone) },
    you: { name: you.display_name, role: you.role_label, capability: you.capability },
    items: sortByStart(snapshot.items).slice(0, 30).map((item) => ({
      title: item.title,
      start: formatClock(item.start_at, zone),
      end: formatClock(endIso(item), zone),
      status: item.status,
    })),
  }
}

/** Snapshot JSON untuk loop agent; hanya field aplikasi, tanpa credential atau identitas session. */
export function buildAgentContext<Who extends { display_name: string; role_label: string; capability: 'coordinator' | 'crew' }>(
  you: Who, snapshot: Snapshot, version: number, now: string, mode: 'auto' | 'confirm',
) {
  const zone = snapshot.event.timezone
  return {
    schema_version: 'ripple-agent-context.v1',
    event: { id: snapshot.event.id, name: snapshot.event.name, stage: snapshot.event.stage, timezone: zone, date: localDate(sortByStart(snapshot.items)[0]?.start_at ?? now, zone), version, server_now: now, now_local: formatClock(now, zone), curfew_at: snapshot.event.curfew_at, curfew_local: formatClock(snapshot.event.curfew_at, zone) },
    actor: { name: you.display_name, role: you.role_label, capability: you.capability },
    execution: { mode: 'confirm', mutations_require: 'coordinator_session_and_website_confirmation', source_of_truth: 'server', requested_mode: mode },
    rundown: {
      items: sortByStart(snapshot.items).map(item => ({ id: item.id, title: item.title, start_at: item.start_at, end_at: endIso(item), start_local: formatClock(item.start_at, zone), end_local: formatClock(endIso(item), zone), duration_seconds: item.duration_seconds, min_duration_seconds: item.min_duration_seconds, estimated_end_at: item.estimated_end_at, status: item.status, swappable: item.swappable, pic_role_ids: [...item.pic_role_ids], resource_ids: [...item.resource_ids] })),
      constraints: snapshot.constraints.map(c => ({ id: c.id, item_id: c.item_id, type: c.type, at: c.at, hard: c.hard, note: c.note ?? null })),
      dependencies: snapshot.dependencies.map(d => ({ id: d.id, predecessor_id: d.predecessor_id, successor_id: d.successor_id, type: d.type })),
      roles: snapshot.roles.map(role => ({ id: role.id, label: role.label })),
      resources: snapshot.resources.map(resource => ({ id: resource.id, label: resource.label, role_ids: [...resource.role_ids] })),
    },
  }
}
