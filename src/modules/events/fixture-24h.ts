// Profil demo 24 jam: 06.00 sampai 06.00 keesokan hari (WIB), 9–10 Okt 2026, curfew 06.00.
// Ishoma tetap: 04.00, 12.00, 15.00, 18.00, 19.30 (terkunci, tidak bisa digeser).
// Dipakai lewat `npm run db:seed -- --reset --profile=24h`. Fixture 12 item (fixture.ts) tetap default untuk tes.
import { localToUtc } from '@/lib/time'
import type { Constraint, Dependency, Item, ItemStatus, Snapshot } from '@/modules/engine/types'
import { DEMO_DATE, DEMO_EVENT_ID, DEMO_ROLES, DEMO_TZ } from './fixture'

const DAY_START_HOUR = 6
const BASE_MS = Date.parse(localToUtc(DEMO_DATE, '06:00', DEMO_TZ))

/** Jam dinding "HH:MM" → ISO. Jam sebelum 06.00 dihitung sebagai hari berikutnya. */
const atClock = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  const dayOffset = h < DAY_START_HOUR ? 24 * 60 : 0
  return new Date(BASE_MS + (h * 60 + m - DAY_START_HOUR * 60 + dayOffset) * 60_000).toISOString()
}

interface Row {
  id: string
  title: string
  start: string
  minutes: number
  status?: ItemStatus
  pic: string[]
  res?: string[]
  swappable?: boolean
  minMinutes?: number
}

const ROWS: Row[] = [
  // Pagi–siang (selesai sebelum jam simulasi 13.20)
  { id: 'standby-pagi', title: 'Standby & Cek Sistem', start: '06:00', minutes: 30, status: 'completed', pic: ['stage'] },
  { id: 'highlight-1', title: 'Highlight Hari Pertama', start: '06:30', minutes: 30, status: 'completed', pic: ['led'], res: ['res-led'] },
  { id: 'talkshow-pagi', title: 'Talkshow Pagi: Komunitas Gamer', start: '07:00', minutes: 60, status: 'completed', pic: ['mc', 'audio'], res: ['res-mic'] },
  { id: 'akustik-pagi', title: 'Sesi Akustik Pagi', start: '08:00', minutes: 45, status: 'completed', pic: ['audio', 'lo'], res: ['res-band', 'res-mic'] },
  { id: 'qna-chat', title: 'Q&A Penonton via Chat', start: '08:45', minutes: 30, status: 'completed', pic: ['mc', 'led'], res: ['res-mic', 'res-led'] },
  { id: 'stand-up', title: 'Talent C — Stand-up Komedi', start: '09:15', minutes: 45, status: 'completed', pic: ['lo', 'audio'], res: ['res-mic', 'res-light'] },
  { id: 'video-sponsor-pagi', title: 'Video Sponsor Pagi', start: '10:00', minutes: 30, status: 'completed', pic: ['led'], res: ['res-led'] },
  { id: 'workshop-desain', title: 'Workshop Singkat Desain', start: '10:30', minutes: 45, status: 'completed', pic: ['lo'] },
  { id: 'talent-d', title: 'Talent D — Band Lokal', start: '11:15', minutes: 45, status: 'completed', pic: ['audio', 'lo'], res: ['res-band', 'res-mic', 'res-light'] },
  { id: 'ishoma-siang', title: 'Ishoma Siang', start: '12:00', minutes: 30, status: 'completed', pic: ['stage'] },
  { id: 'talent-e', title: 'Talent E — Penyanyi Solo', start: '12:30', minutes: 45, status: 'completed', pic: ['audio'], res: ['res-mic'] },
  // Sedang berlangsung pada jam simulasi 13.20
  { id: 'talent-f', title: 'Talent F — Band Utama', start: '13:15', minutes: 30, status: 'in_progress', pic: ['audio', 'lo'], res: ['res-band', 'res-mic', 'res-light'], swappable: false, minMinutes: 25 },
  // Sore–malam (belum mulai)
  { id: 'bincang-media', title: 'Bincang Media Partner', start: '13:45', minutes: 30, pic: ['mc'], res: ['res-mic'] },
  { id: 'sesi-foto', title: 'Sesi Foto Komunitas', start: '14:15', minutes: 45, pic: ['led'], res: ['res-led'] },
  { id: 'ishoma-sore', title: 'Ishoma Sore', start: '15:00', minutes: 30, pic: ['stage'] },
  { id: 'talkshow-industri', title: 'Talkshow Industri Kreatif', start: '15:30', minutes: 45, pic: ['mc', 'lo'], res: ['res-mic', 'res-led'] },
  { id: 'lomba-konten', title: 'Lomba Konten Peserta', start: '16:15', minutes: 45, pic: ['mc', 'led'], res: ['res-led', 'res-mic'] },
  { id: 'talent-g', title: 'Talent G — Akustik Duo', start: '17:00', minutes: 60, pic: ['audio', 'lo'], res: ['res-mic'] },
  { id: 'ishoma-petang', title: 'Ishoma Petang', start: '18:00', minutes: 30, pic: ['stage'] },
  { id: 'sponsor-1', title: 'Sponsor Sesi 1', start: '18:30', minutes: 30, pic: ['mc', 'led'], res: ['res-led'] },
  { id: 'keynote', title: 'Keynote Komunitas', start: '19:00', minutes: 30, pic: ['mc', 'lo'], res: ['res-mic', 'res-led'] },
  { id: 'ishoma-malam', title: 'Ishoma Malam', start: '19:30', minutes: 30, pic: ['stage'] },
  { id: 'panel-malam', title: 'Panel Komunitas', start: '20:00', minutes: 45, pic: ['mc', 'stage'], res: ['res-panel', 'res-mic'], minMinutes: 30 },
  { id: 'tribute', title: 'Video Tribute Komunitas', start: '20:45', minutes: 15, pic: ['led'], res: ['res-led'] },
  { id: 'sponsor-2', title: 'Sponsor Sesi 2', start: '21:00', minutes: 30, pic: ['mc', 'led'], res: ['res-led'] },
  { id: 'talent-h', title: 'Talent H — Penampilan Utama', start: '21:30', minutes: 60, pic: ['audio', 'lo', 'lighting'], res: ['res-band', 'res-light', 'res-mic'], minMinutes: 45 },
  { id: 'talent-i', title: 'Talent I — Penutup Musik', start: '22:30', minutes: 30, pic: ['audio', 'lo'], res: ['res-band', 'res-light', 'res-mic'] },
  { id: 'dj-malam', title: 'Sesi DJ Malam', start: '23:00', minutes: 60, pic: ['audio', 'led'], res: ['res-light', 'res-led'] },
  // Dini hari (menuju ishoma subuh 04.00)
  { id: 'doa-refleksi', title: 'Doa & Refleksi Tim', start: '00:00', minutes: 20, pic: ['stage'] },
  { id: 'talkshow-dini', title: 'Talkshow Dini Hari: Komunitas Gamer', start: '00:20', minutes: 40, pic: ['mc', 'audio'], res: ['res-mic'] },
  { id: 'akustik-malam', title: 'Sesi Akustik Malam', start: '01:00', minutes: 60, pic: ['audio', 'lo'], res: ['res-band', 'res-mic'] },
  { id: 'trivia-tengah', title: 'Lomba Trivia Tengah Malam', start: '02:00', minutes: 45, pic: ['mc', 'lo'], res: ['res-mic'] },
  { id: 'qna-dini', title: 'Q&A Penonton Dini Hari', start: '02:45', minutes: 30, pic: ['mc', 'led'], res: ['res-mic', 'res-led'] },
  { id: 'cek-subuh', title: 'Persiapan Subuh & Cek Panggung', start: '03:15', minutes: 45, pic: ['stage', 'lighting'], res: ['res-light'] },
  { id: 'ishoma-subuh', title: 'Ishoma Subuh', start: '04:00', minutes: 30, pic: ['stage'] },
  { id: 'senam-pagi', title: 'Senam Pagi Bersama', start: '04:30', minutes: 30, pic: ['mc', 'led'], res: ['res-mic', 'res-led'] },
  { id: 'sunrise', title: 'Sunrise Session: Opening Hari Kedua', start: '05:00', minutes: 20, pic: ['mc', 'audio'], res: ['res-mic', 'res-band'] },
  { id: 'closing', title: 'Closing & Beres Panggung', start: '05:20', minutes: 30, pic: ['mc', 'lighting'], res: ['res-light', 'res-mic'], swappable: false },
]

function toItem(row: Row): Item {
  return {
    id: row.id,
    title: row.title,
    start_at: atClock(row.start),
    duration_seconds: row.minutes * 60,
    min_duration_seconds: (row.minMinutes ?? row.minutes) * 60,
    estimated_end_at: null,
    status: row.status ?? 'pending',
    pic_role_ids: [...row.pic],
    resource_ids: [...(row.res ?? [])],
    swappable: row.swappable ?? true,
  }
}

const DEPENDENCIES: Dependency[] = [
  { id: 'D-24-02', predecessor_id: 'talent-f', successor_id: 'talent-g', type: 'finish_before_start' },
  { id: 'D-24-03', predecessor_id: 'keynote', successor_id: 'panel-malam', type: 'finish_before_start' },
  { id: 'D-24-04', predecessor_id: 'panel-malam', successor_id: 'talent-h', type: 'finish_before_start' },
  { id: 'D-24-05', predecessor_id: 'talent-i', successor_id: 'closing', type: 'finish_before_start' },
  { id: 'D-24-06', predecessor_id: 'doa-refleksi', successor_id: 'closing', type: 'finish_before_start' },
]

const CONSTRAINTS: Constraint[] = [
  { id: 'C-FIX-keynote', type: 'fixed_start', item_id: 'keynote', at: atClock('19:00'), hard: true, note: 'Keynote mulai tetap 19.00' },
  { id: 'C-FIX-sponsor-2', type: 'fixed_start', item_id: 'sponsor-2', at: atClock('21:00'), hard: true, note: 'Sponsor sesi 2 tetap 21.00' },
  { id: 'C-EARLY-panel', type: 'earliest_start', item_id: 'panel-malam', at: atClock('20:00'), hard: true, note: 'Panelis tersedia sejak 20.00' },
]

/** Snapshot 24 jam (06.00 → 06.00). Jam simulasi 13.20 WIB: talent F sedang berlangsung, sisanya belum mulai. */
export function demoSnapshot24h(): Snapshot {
  return {
    event: { id: DEMO_EVENT_ID, name: 'Maraton Komunitas 24 Jam (fiktif)', timezone: DEMO_TZ, curfew_at: new Date(BASE_MS + 24 * 60 * 60_000).toISOString(), stage: 'main' },
    roles: DEMO_ROLES.map(({ id, label }) => ({ id, label })),
    resources: [
      { id: 'res-mic', label: 'Wireless Mic', role_ids: ['audio', 'mc'] },
      { id: 'res-band', label: 'Backline Band', role_ids: ['audio', 'stage'] },
      { id: 'res-led', label: 'Konten LED', role_ids: ['led'] },
      { id: 'res-light', label: 'Cue Lighting', role_ids: ['lighting'] },
      { id: 'res-panel', label: 'Set Panel (sofa & meja)', role_ids: ['stage'] },
    ],
    items: ROWS.map(toItem),
    dependencies: DEPENDENCIES.map(dependency => ({ ...dependency })),
    constraints: CONSTRAINTS.map(constraint => ({ ...constraint })),
  }
}

export const DEMO_24H_CLOCK = atClock('13:20')
