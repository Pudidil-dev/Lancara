import { StatusBadge } from '@/components/ui'
import { formatClock, zoneAbbrev } from '@/lib/time'
import type { Acknowledgement } from './types'
import styles from './briefs.module.css'

export function AcknowledgementList({ acks, timezone }: { acks: Acknowledgement[]; timezone: string }) {
  return <section className="stack" aria-label="Status baca brief per peran">
    <h3>Status baca per peran</h3>
    <p className="muted">Sudah dibaca menunjukkan penerimaan informasi. Tindak lanjut di lapangan perlu diperiksa terpisah.</p>
    {acks.length === 0 ? <p>Tidak ada brief yang dikirim untuk keputusan ini.</p> : <ul className={styles.list}>{acks.map(ack => <li className="stack" key={ack.brief_id} aria-label={ack.role_label}>
      <div className="row between"><strong>{ack.role_label} · v{ack.version}</strong><StatusBadge kind={ack.level} /></div>
      <div className="row"><StatusBadge kind={ack.acknowledged_at ? 'ACKNOWLEDGED' : 'PENDING_ACK'} />{ack.acknowledged_at && <span>Sudah dibaca pukul {formatClock(ack.acknowledged_at, timezone)} {zoneAbbrev(timezone)}{ack.ack_by ? ` · ${ack.ack_by}` : ''}</span>}</div>
    </li>)}</ul>}
  </section>
}
