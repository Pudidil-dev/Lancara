import Link from 'next/link'
import { Icon } from '@/components/ui'
import type { ChangeSummary } from '@/hooks/types'
import { formatClock, zoneAbbrev } from '@/lib/time'
import type { Snapshot } from '@/modules/engine/types'
import { countdown, projectedFinishMs } from './rundown-format'

const PENDING = new Set<ChangeSummary['status']>(['draft', 'needs_clarification', 'preview_ready'])
export const pendingChanges = (changes: ChangeSummary[] | null | undefined) => (changes ?? []).filter((c) => PENDING.has(c.status))

const STATUS_LABEL: Record<string, string> = { preview_ready: 'Perlu ditinjau', needs_clarification: 'Perlu klarifikasi', draft: 'Draf' }
const snippet = (text: string | null, max = 56) => (text ? (text.length > max ? `${text.slice(0, max - 1)}…` : text) : 'Kabar manual')

/** Tiga kartu ringkasan (Figma "Live event summary"). */
export function SummaryCards({ snapshot, now, changes }: { snapshot: Snapshot; now: string; changes: ChangeSummary[] | null }) {
  const zone = snapshot.event.timezone
  const nowMs = Date.parse(now)
  const sorted = [...snapshot.items].sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))
  const live = sorted.find((i) => i.status === 'in_progress')
  const next = sorted.find((i) => i.status === 'pending')
  const waiting = pendingChanges(changes)
  const latest = waiting[0]
  const finish = projectedFinishMs(snapshot)
  const curfew = Date.parse(snapshot.event.curfew_at)
  const slackMin = Math.round((curfew - finish) / 60000)
  const nextNote = next ? (Date.parse(next.start_at) > nowMs ? `${countdown(Date.parse(next.start_at) - nowMs)} menuju ${next.title}` : `${next.title} seharusnya sudah mulai`) : 'Tidak ada item berikutnya'
  return (
    <div className="summary-grid">
      <section className="summary-card" aria-label="Sedang berlangsung">
        <p className="summary-label">SEDANG BERLANGSUNG</p>
        <p className="summary-value" data-tone="brand">{live?.title ?? 'Belum ada'}</p>
        <p className="summary-note">{nextNote}</p>
      </section>
      <section className="summary-card" aria-label="Perlu ditinjau">
        <p className="summary-label">PERLU DITINJAU</p>
        <p className="summary-value" data-tone={waiting.length ? 'warning' : undefined}>{waiting.length ? `${waiting.length} perubahan` : 'Tidak ada'}</p>
        <p className="summary-note">{latest ? `${snippet(latest.original_text, 40)} · dilaporkan ${latest.actor_name}` : 'Semua kabar sudah ditangani'}</p>
      </section>
      <section className="summary-card" aria-label="Estimasi selesai">
        <p className="summary-label">ESTIMASI SELESAI</p>
        <p className="summary-value" data-tone={slackMin < 0 ? 'danger' : undefined}>{formatClock(new Date(finish).toISOString(), zone)}</p>
        <p className="summary-note">{slackMin >= 0 ? `${slackMin} menit sebelum batas acara` : `${-slackMin} menit melewati batas acara`}</p>
      </section>
    </div>
  )
}

/** Panel "Latest change" (Figma): kabar terbaru yang menunggu keputusan. */
export function LatestChange({ changes }: { changes: ChangeSummary[] | null }) {
  const latest = pendingChanges(changes)[0]
  return (
    <section className="panel" aria-labelledby="latest-change-title">
      <div className="row between">
        <span className="badge badge-warning">{latest ? STATUS_LABEL[latest.status] : 'Tidak ada antrean'}</span>
        {latest && <span className="muted small">CH-{latest.seq}</span>}
      </div>
      <h2 id="latest-change-title">{latest ? snippet(latest.original_text, 48) : 'Belum ada kabar menunggu'}</h2>
      <p className="muted">{latest ? 'Tinjau tafsiran, dampak, dan opsi sebelum menyetujui. Rundown aktif belum berubah.' : 'Kabar baru yang dilaporkan akan muncul di sini sampai diputuskan.'}</p>
      {latest && <p className="muted small">{latest.actor_name}</p>}
      <Link className="btn btn-primary" href={latest ? `/changes/${latest.id}` : '/changes/new'}>{latest ? 'Tinjau perubahan' : 'Laporkan perubahan'}</Link>
    </section>
  )
}

/** Panel "Batas yang dijaga": slot tetap yang belum lewat + batas selesai acara. */
export function GuardedLimits({ snapshot }: { snapshot: Snapshot }) {
  const zone = snapshot.event.timezone
  const fixed = snapshot.constraints
    .filter((c) => c.type === 'fixed_start')
    .map((c) => ({ c, item: snapshot.items.find((i) => i.id === c.item_id) }))
    .filter((x) => x.item && x.item.status === 'pending')
    .sort((a, b) => Date.parse(a.c.at) - Date.parse(b.c.at))
  return (
    <section className="panel" aria-labelledby="limits-title">
      <h2 id="limits-title" className="h3">Batas yang dijaga</h2>
      {fixed.map(({ c, item }) => (
        <div className="limit-row" key={c.id}>
          <Icon name="lock" size={20} />
          <span><span className="limit-value">{formatClock(c.at, zone)}</span><span className="limit-label">Slot {item!.title} tetap</span></span>
        </div>
      ))}
      <div className="limit-row">
        <Icon name="lock" size={20} />
        <span><span className="limit-value">{formatClock(snapshot.event.curfew_at, zone)}</span><span className="limit-label">Batas selesai acara</span></span>
      </div>
      <p className="muted small">Opsi penyesuaian selalu diperiksa terhadap batas ini.</p>
    </section>
  )
}

export function VersionLine({ version, syncedAt, zone }: { version: number; syncedAt: string | null; zone: string }) {
  return (
    <p className="version-line"><Icon name="history" size={20} />Rundown v{version}{syncedAt ? ` · tersinkron ${formatClock(syncedAt, zone)} ${zoneAbbrev(zone)}` : ''}</p>
  )
}

