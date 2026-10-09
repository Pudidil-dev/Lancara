import Link from 'next/link'
import type { HistoryDecision } from '@/components/briefs/types'
import type { ChangeSummary } from '@/hooks/types'
import { formatClock } from '@/lib/time'
import type { Snapshot } from '@/modules/engine/types'
import { countdown, projectedFinishMs } from './rundown-format'

const PENDING = new Set<ChangeSummary['status']>(['draft', 'needs_clarification', 'preview_ready'])
export const pendingChanges = (changes: ChangeSummary[] | null | undefined) => (changes ?? []).filter((c) => PENDING.has(c.status))

const snippet = (text: string | null, max = 56) => (text ? (text.length > max ? `${text.slice(0, max - 1)}…` : text) : 'Kabar manual')
/** Jam "18:30" seperti Figma (titik dua). */
export const hhmm = (iso: string, zone: string) => formatClock(iso, zone).replace('.', ':')

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
  const slackMin = Math.round((Date.parse(snapshot.event.curfew_at) - finish) / 60000)
  const nextNote = next ? (Date.parse(next.start_at) > nowMs ? `${countdown(Date.parse(next.start_at) - nowMs)} menuju ${next.title}` : `${next.title} seharusnya sudah mulai`) : 'Tidak ada segmen berikutnya'
  const review = (
    <>
      <p className="dash-card-label">Perlu ditinjau</p>
      <p className="dash-card-value">{waiting.length ? `${waiting.length} Perubahan` : 'Tidak ada'}</p>
      <p className="dash-card-note">{latest ? `${snippet(latest.original_text, 36)} - dilaporkan ${latest.actor_name}` : 'Semua kabar sudah ditangani'}</p>
    </>
  )
  return (
    <div className="dash-summary">
      <section className="dash-card" data-accent="true" aria-label="Sedang berlangsung">
        <p className="dash-card-label">Sedang berlangsung</p>
        <p className="dash-card-value">{live?.title ?? 'Belum ada'}</p>
        <p className="dash-card-note">{nextNote}</p>
      </section>
      {latest
        ? <Link className="dash-card" data-accent="true" href={`/changes/${latest.id}`} aria-label={`Perlu ditinjau: ${waiting.length} perubahan`}>{review}</Link>
        : <section className="dash-card" data-accent="true" aria-label="Perlu ditinjau">{review}</section>}
      <section className="dash-card" aria-label="Estimasi selesai">
        <p className="dash-card-label">Estimasi selesai</p>
        <p className="dash-card-value" data-tone={slackMin < 0 ? 'danger' : 'success'}>{Number.isFinite(finish) ? hhmm(new Date(finish).toISOString(), zone) : '—'}</p>
        <p className="dash-card-note">{slackMin >= 0 ? `${slackMin} menit sebelum batas acara` : `${-slackMin} menit melewati batas acara`}</p>
      </section>
    </div>
  )
}

/** Kartu "Riwayat perubahan · Selisih dari jadwal awal" dari keputusan terbaru. */
export function ChangeHistoryCard({ decision, zone }: { decision: HistoryDecision | undefined; zone: string }) {
  const moved = (decision?.diff ?? [])
    .filter((d) => d.old && d.new && d.changes.includes('start'))
    .sort((a, b) => Math.abs(b.start_shift_seconds) - Math.abs(a.start_shift_seconds))[0]
  const cancelled = (decision?.diff ?? []).find((d) => d.new?.status === 'cancelled')
  const minutes = moved ? Math.round(moved.start_shift_seconds / 60) : 0
  const badge = moved ? (minutes > 0 ? `Terlambat ${minutes} menit` : `Maju ${-minutes} menit`) : cancelled ? 'Dibatalkan' : decision ? 'Diperbarui' : 'Belum ada'
  const reason = decision?.original_text ?? decision?.reason
  const target = moved ?? cancelled ?? decision?.diff[0]
  const text = decision
    ? `Rundown berubah ${target?.title ?? decision.patch_label} ${moved ? (minutes > 0 ? 'dimundurkan' : 'dimajukan') : cancelled ? 'dibatalkan' : 'diperbarui'}${reason ? ` dikarenakan ${reason.replace(/\.$/, '')}` : ''}`
    : 'Perubahan yang disetujui akan tampil di sini beserta selisih dari jadwal awal.'
  return (
    <section className="dash-left" aria-labelledby="history-card-title">
      <p className="dash-history-label">Riwayat perubahan</p>
      <div className="dash-history">
        <div className="dash-history-head">
          <h2 id="history-card-title">Selisih dari jadwal awal</h2>
          <span className="lc-badge" data-tone={moved && minutes < 0 ? 'success' : undefined}>{badge}</span>
        </div>
        {moved?.old && moved.new && <p className="dash-history-shift">{`${hhmm(moved.old.start_at, zone)}  →  ${hhmm(moved.new.start_at, zone)}`}</p>}
        <p className="dash-history-text">{text}</p>
        {decision && <Link className="template-link" href="/history">Lihat riwayat lengkap · Rundown v{decision.new_version}</Link>}
      </div>
    </section>
  )
}
