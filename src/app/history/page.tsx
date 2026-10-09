'use client'

import { AppShell } from '@/components/shell/AppShell'
import { EmptyState, ErrorState, Loading, StatusBadge } from '@/components/ui'
import { DecisionCard } from '@/components/briefs/DecisionCard'
import type { HistoryResponse } from '@/components/briefs/types'
import styles from '@/components/briefs/briefs.module.css'
import { useSession } from '@/hooks/useSession'
import { usePolling } from '@/hooks/usePolling'
import { EVENT_ID } from '@/hooks/types'
import { formatClock, zoneAbbrev } from '@/lib/time'

const SOURCE_LABEL: Record<string, string> = { seed: 'Data demo awal', setup: 'Pengaturan rundown', item_status: 'Status aktivitas', decision: 'Keputusan' }

export default function HistoryPage() {
  const { session } = useSession()
  const query = usePolling<HistoryResponse>(session ? `/api/events/${EVENT_ID}/history` : null)
  const data = query.data
  const relatedChanges = Object.fromEntries((data?.decisions ?? []).map(decision => [decision.id, decision.seq]))
  return <AppShell title="Riwayat"><div className="stack">
    {!data && !query.error && <Loading label="Memuat riwayat keputusan…" />}
    {query.error && <ErrorState error={query.error} onRetry={() => void query.refresh()} />}
    {data && <>
      <section className="card row between" aria-label="Ringkasan status baca">
        <div><p className="eyebrow">BRIEF BELUM DIBACA</p><strong className="metric">{data.pending_acks}</strong><p className="muted">Jumlah brief yang belum dikonfirmasi oleh penerimanya.</p></div>
        <StatusBadge kind={data.pending_acks > 0 ? 'PENDING_ACK' : 'ACKNOWLEDGED'} label={data.pending_acks > 0 ? `${data.pending_acks} brief belum dibaca` : 'Semua brief sudah dibaca'} />
      </section>
      <section aria-label="Timeline keputusan" className="stack">
        <h2>Keputusan · Rundown aktif v{data.event.active_version}</h2>
        {data.decisions.length === 0 ? <EmptyState title="Belum ada keputusan yang disetujui." /> : <div className="timeline">{data.decisions.map(decision => <DecisionCard key={decision.id} decision={decision} timezone={data.event.timezone} relatedChanges={relatedChanges} />)}</div>}
      </section>
      <section className="card stack" aria-label="Semua versi rundown">
        <h2>Semua versi rundown</h2>
        <ol className={styles.list}>{data.versions.map(version => <li className={styles.version} key={version.number}>
          <div className="row between"><strong>v{version.number}{version.parent_number !== null ? ` · dari v${version.parent_number}` : ''}</strong><span>{SOURCE_LABEL[version.source] ?? version.source}</span></div>
          <p>{version.note ?? 'Tanpa catatan tambahan.'}</p>
          <p className="muted">{version.actor_name ?? 'Sistem'} · {formatClock(version.created_at, data.event.timezone)} {zoneAbbrev(data.event.timezone)}</p>
        </li>)}</ol>
      </section>
    </>}
  </div></AppShell>
}
