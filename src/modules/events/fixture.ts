// Fixture demo fiktif: 12 item, satu panggung, Asia/Jakarta, 9 Okt 2026, jam simulasi 18.40 WIB.
// Enam item terakhir mengikuti PRD §9 (Opening…Closing). Oracle penerima ada di tests/fixtures/oracle.ts.
import { localToUtc } from '@/lib/time'
import type { Constraint, Item, Snapshot } from '@/modules/engine/types'

export const DEMO_EVENT_ID = 'evt-ripple-demo'
export const DEMO_TZ = 'Asia/Jakarta'
export const DEMO_DATE = '2026-10-09'
export const DEMO_CLOCK = localToUtc(DEMO_DATE, '18:40', DEMO_TZ)

export const at = (hhmm: string) => localToUtc(DEMO_DATE, hhmm, DEMO_TZ)

export const DEMO_ROLES = [
  { id: 'koordinator', label: 'Koordinator / Stage Manager', capability: 'coordinator' as const },
  { id: 'audio', label: 'PIC Audio', capability: 'crew' as const },
  { id: 'lighting', label: 'PIC Lighting', capability: 'crew' as const },
  { id: 'led', label: 'PIC LED / Visual', capability: 'crew' as const },
  { id: 'mc', label: 'MC', capability: 'crew' as const },
  { id: 'lo', label: 'LO Talent', capability: 'crew' as const },
  { id: 'stage', label: 'Stage Crew', capability: 'crew' as const },
]

export const DEMO_ACTORS = [
  { id: 'act-rina', role_id: 'koordinator', display_name: 'Rina (Koordinator)' },
  { id: 'act-bayu', role_id: 'audio', display_name: 'Bayu (Audio)' },
  { id: 'act-sari', role_id: 'lighting', display_name: 'Sari (Lighting)' },
  { id: 'act-dimas', role_id: 'led', display_name: 'Dimas (LED)' },
  { id: 'act-maya', role_id: 'mc', display_name: 'Maya (MC)' },
  { id: 'act-andi', role_id: 'lo', display_name: 'Andi (LO Talent)' },
  { id: 'act-joko', role_id: 'stage', display_name: 'Joko (Stage Crew)' },
]

const MIN = 60

function item(
  id: string,
  title: string,
  start: string,
  minutes: number,
  opts: Partial<Pick<Item, 'status' | 'pic_role_ids' | 'resource_ids' | 'swappable'>> & { minMinutes?: number } = {},
): Item {
  return {
    id,
    title,
    start_at: at(start),
    duration_seconds: minutes * MIN,
    min_duration_seconds: (opts.minMinutes ?? minutes) * MIN,
    estimated_end_at: null,
    status: opts.status ?? 'pending',
    pic_role_ids: opts.pic_role_ids ?? [],
    resource_ids: opts.resource_ids ?? [],
    swappable: opts.swappable ?? true,
  }
}

export function demoSnapshot(): Snapshot {
  const constraints: Constraint[] = [
    { id: 'C-FIX-keynote', type: 'fixed_start', item_id: 'keynote', at: at('18:45'), hard: true, note: 'Keynote mulai tetap 18.45' },
    { id: 'C-FIX-sponsor', type: 'fixed_start', item_id: 'sponsor', at: at('19:45'), hard: true, note: 'Slot sponsor tetap 19.45' },
    { id: 'C-EARLY-panel', type: 'earliest_start', item_id: 'panel', at: at('19:15'), hard: true, note: 'Panelis tersedia sejak 19.15' },
  ]
  return {
    event: { id: DEMO_EVENT_ID, name: 'Malam Apresiasi Komunitas 2026 (fiktif)', timezone: DEMO_TZ, curfew_at: at('21:00'), stage: 'main' },
    roles: DEMO_ROLES.map(({ id, label }) => ({ id, label })),
    resources: [
      { id: 'res-mic', label: 'Wireless Mic', role_ids: ['audio'] },
      { id: 'res-band', label: 'Backline Band', role_ids: ['audio', 'stage'] },
      { id: 'res-led', label: 'Konten LED', role_ids: ['led'] },
      { id: 'res-light', label: 'Cue Lighting', role_ids: ['lighting'] },
      { id: 'res-panel', label: 'Set Panel (sofa & meja)', role_ids: ['stage'] },
    ],
    items: [
      item('briefing', 'Briefing Kru', '16:00', 30, { status: 'completed', pic_role_ids: ['stage'] }),
      item('soundcheck', 'Soundcheck Final', '16:30', 30, { status: 'completed', pic_role_ids: ['audio'], resource_ids: ['res-band'] }),
      item('open-gate', 'Open Gate & Registrasi', '17:00', 30, { status: 'completed', pic_role_ids: ['lo'] }),
      item('talent-a', 'Talent A — Akustik', '17:30', 30, { status: 'completed', pic_role_ids: ['lo', 'audio'], resource_ids: ['res-band', 'res-mic'] }),
      item('sambutan', 'Sambutan Panitia', '18:00', 15, { status: 'completed', pic_role_ids: ['mc'], resource_ids: ['res-mic'] }),
      item('teaser', 'Video Teaser', '18:15', 15, { status: 'completed', pic_role_ids: ['led'], resource_ids: ['res-led'] }),
      item('opening', 'Opening', '18:30', 15, { status: 'in_progress', pic_role_ids: ['mc'], resource_ids: ['res-mic', 'res-light'], swappable: false, minMinutes: 10 }),
      item('keynote', 'Keynote', '18:45', 30, { pic_role_ids: ['mc', 'lo'], resource_ids: ['res-mic', 'res-led'] }),
      item('talent-b', 'Talent B', '19:15', 30, { pic_role_ids: ['lo', 'audio'], resource_ids: ['res-band', 'res-light'] }),
      item('sponsor', 'Sponsor', '19:45', 20, { pic_role_ids: ['mc', 'led'], resource_ids: ['res-led'] }),
      item('panel', 'Panel', '20:05', 30, { pic_role_ids: ['mc', 'stage'], resource_ids: ['res-panel', 'res-mic'], minMinutes: 20 }),
      item('closing', 'Closing', '20:35', 10, { pic_role_ids: ['mc', 'lighting'], resource_ids: ['res-light', 'res-mic'], swappable: false }),
    ],
    dependencies: [
      { id: 'D-01', predecessor_id: 'soundcheck', successor_id: 'talent-b', type: 'finish_before_start' },
      { id: 'D-03', predecessor_id: 'talent-b', successor_id: 'closing', type: 'finish_before_start' },
      { id: 'D-04', predecessor_id: 'sponsor', successor_id: 'closing', type: 'finish_before_start' },
      { id: 'D-05', predecessor_id: 'panel', successor_id: 'closing', type: 'finish_before_start' },
    ],
    constraints,
  }
}
