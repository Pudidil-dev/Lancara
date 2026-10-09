'use client'

import { ErrorState, Loading, StatusBadge, TimeDiff , Button } from '@/components/ui'
import { useMutation } from '@/hooks/useMutation'
import { useOnline } from '@/hooks/useOnline'
import { formatClock, zoneAbbrev } from '@/lib/time'
import type { AckResult, Brief } from './types'
import styles from './briefs.module.css'

export function BriefCard({ brief, acknowledgedAt, onAcknowledged, onShowRevision }: {
  brief: Brief
  acknowledgedAt: string | null
  onAcknowledged: (result: AckResult) => void
  onShowRevision: (id: string) => void
}) {
  const mutation = useMutation()
  const online = useOnline()
  const { payload } = brief
  async function acknowledge() {
    try {
      const result = await mutation.mutate<AckResult>({ path: `/api/briefs/${brief.id}/ack`, idempotent: false })
      onAcknowledged(result)
    } catch { /* The API error remains visible and no acknowledgement is inferred. */ }
  }
  return <article id={`brief-${brief.id}`} tabIndex={-1} className={`card stack ${styles.brief}`} aria-labelledby={`brief-title-${brief.id}`}>
    <div className="row between">
      <StatusBadge kind={brief.level} />
      <span className="version-tag">CH-{payload.change_seq} · v{brief.version}</span>
    </div>
    <h2 id={`brief-title-${brief.id}`}>CH-{payload.change_seq} · v{brief.version} · Brief untuk {payload.role_label}</h2>
    {brief.superseded_by && <div className="stack">
      <StatusBadge kind="OLD_REVISION" label="Brief versi lama" />
      <p className="muted">Membaca versi ini tidak menandai revisi baru sebagai sudah dibaca.</p>
      <Button asChild variant="outline"><a className="btn" href={`#brief-${brief.superseded_by.id}`} onClick={event => {
        event.preventDefault()
        onShowRevision(brief.superseded_by!.id)
      }}>Lihat revisi terbaru · CH-{brief.superseded_by.change_seq} v{brief.superseded_by.version}</a></Button>
    </div>}
    <ul className={styles.list}>{payload.entries.map((entry, index) => <li className="stack" key={`${entry.item_id}-${index}`}>
      <h3>{entry.title}</h3>
      <span className="muted">{entry.item_id}</span>
      {entry.old && entry.new ? <TimeDiff oldStart={entry.old.start_at} oldEnd={entry.old.end_at} newStart={entry.new.start_at} newEnd={entry.new.end_at} timezone={payload.timezone} cancelled={entry.status === 'cancelled'} /> : entry.status === 'cancelled' ? <StatusBadge kind="cancelled" label="DIBATALKAN" /> : null}
      <p>{entry.reason}</p>
    </li>)}</ul>
    <div className="stack">
      <p><strong>Alasan koordinator:</strong> {payload.decision_reason}</p>
      <p className="muted">Disetujui oleh {payload.approved_by}</p>
    </div>
    <div className={`stack ${styles.ack}`}>
      {acknowledgedAt ? <div className="stack">
        <StatusBadge kind="ACKNOWLEDGED" />
        <p>Sudah dibaca pukul {formatClock(acknowledgedAt, payload.timezone)} {zoneAbbrev(payload.timezone)} untuk perubahan CH-{payload.change_seq} versi {brief.version}{brief.ack_by ? ` · ${brief.ack_by}` : ''}.</p>
      </div> : <>
        <Button variant="default" className="btn btn-primary btn-full" disabled={mutation.pending || !online} onClick={() => void acknowledge()}>Sudah dibaca</Button>
        <p className="muted">Konfirmasi bahwa Anda sudah membaca brief; status aksi lapangan tetap terpisah.</p>
      </>}
      {mutation.pending && <Loading label="Mencatat sudah dibaca…" />}
      {mutation.error && <ErrorState error={mutation.error} onRetry={online ? () => void acknowledge() : undefined} />}
    </div>
  </article>
}
