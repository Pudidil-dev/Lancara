'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog, ErrorState, Loading, StatusBadge, TimeDiff } from '@/components/ui'
import { useMutation } from '@/hooks/useMutation'
import { useOnline } from '@/hooks/useOnline'
import { formatClock, zoneAbbrev } from '@/lib/time'
import { AcknowledgementList } from './AcknowledgementList'
import type { HistoryDecision } from './types'
import styles from './briefs.module.css'

const KIND_LABEL = { report: 'Laporan', correction: 'Koreksi', compensation: 'Kompensasi' }

export function DecisionCard({ decision, timezone, relatedChanges }: {
  decision: HistoryDecision
  timezone: string
  relatedChanges: Record<string, number>
}) {
  const [expanded, setExpanded] = useState(false)
  const [dialog, setDialog] = useState<'correction' | 'compensation' | null>(null)
  const [text, setText] = useState('')
  const mutation = useMutation()
  const online = useOnline()
  const router = useRouter()

  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)')
    const update = () => setExpanded(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  function openDialog(kind: 'correction' | 'compensation') {
    mutation.reset()
    setText('')
    setDialog(kind)
  }

  async function createDraft() {
    if (!dialog) return
    try {
      const result = await mutation.mutate<{ change_id: string }>({
        path: `/api/decisions/${decision.id}/${dialog === 'correction' ? 'corrections' : 'compensations'}`,
        body: dialog === 'correction' ? { original_text: text.trim() || null } : { reason: text.trim() || null },
        idempotent: false,
      })
      router.push(`/changes/${result.change_id}`)
    } catch { /* Keep dialog and input intact; server response controls success. */ }
  }

  return <article className={styles.decision} aria-label={`Keputusan CH-${decision.seq} v${decision.new_version}`}>
    <details className="card stack" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary>
        <h2>CH-{decision.seq} · {KIND_LABEL[decision.kind]}</h2>
        <p className="muted">v{decision.base_version} → v{decision.new_version} · {decision.patch_label}</p>
      </summary>
      <div className="stack">
        <div className="row between"><StatusBadge kind="APPROVED" /><span className="muted">Disetujui pukul {formatClock(decision.approved_at, timezone)} {zoneAbbrev(timezone)}</span></div>
        <Link href={`/changes/${decision.change_id}`}>Lihat perubahan CH-{decision.seq}</Link>
        <div className="stack"><h3>Kabar asli</h3><blockquote className={styles.quote}>{decision.original_text ?? 'Kabar diisi melalui form manual.'}</blockquote><p className="muted">Dilaporkan oleh {decision.reported_by}</p></div>
        {decision.corrects_decision_id && <p>Koreksi atas {relatedChanges[decision.corrects_decision_id] ? `CH-${relatedChanges[decision.corrects_decision_id]}` : 'keputusan sebelumnya'}.</p>}
        {decision.compensates_decision_id && <p>Kompensasi atas {relatedChanges[decision.compensates_decision_id] ? `CH-${relatedChanges[decision.compensates_decision_id]}` : 'keputusan sebelumnya'}.</p>}
        <section className="stack" aria-label="Perubahan jadwal">
          <h3>{decision.patch_label}</h3>
          <ul className={styles.list}>{decision.diff.map(diff => <li className="stack" key={diff.item_id}>
            <strong>{diff.title}</strong><span className="muted">{diff.item_id}</span>
            <TimeDiff oldStart={diff.old.start_at} oldEnd={diff.old.end_at} newStart={diff.new.start_at} newEnd={diff.new.end_at} timezone={timezone} cancelled={diff.new.status === 'cancelled'} />
            {diff.changes.includes('status') && <div className="row"><span className="muted">Status lama</span><StatusBadge kind={diff.old.status} /><span aria-hidden="true">→</span><span className="muted">Status baru</span><StatusBadge kind={diff.new.status} /></div>}
          </li>)}</ul>
        </section>
        <p><strong>Alasan koordinator:</strong> {decision.reason}</p>
        <p className="muted">Penyetuju: {decision.approved_by}</p>
        <AcknowledgementList acks={decision.acks} timezone={timezone} />
        <div className={`row ${styles.actions}`}>
          <button className="btn" disabled={!online} onClick={() => openDialog('correction')}>Ajukan koreksi</button>
          <button className="btn btn-danger" disabled={!online} onClick={() => openDialog('compensation')}>Batalkan keputusan</button>
        </div>
      </div>
    </details>
    <Dialog open={dialog !== null} title={`${dialog === 'correction' ? 'Ajukan koreksi' : 'Batalkan keputusan'} CH-${decision.seq}`} onClose={() => setDialog(null)} busy={mutation.pending}>
      <form className="stack" onSubmit={event => { event.preventDefault(); void createDraft() }}>
        {dialog === 'compensation' ? <p>Pembatalan membuat versi kompensasi baru setelah tafsiran dikonfirmasi dan opsi disetujui. Riwayat tetap tersimpan. Aktivitas yang sudah berlangsung tidak bisa dikembalikan.</p> : <p>Koreksi membuat kabar baru yang mereferensikan keputusan ini. Tafsiran dan opsi tetap perlu diperiksa sebelum disetujui.</p>}
        <div className="field">
          <label htmlFor={`decision-text-${decision.id}`}>{dialog === 'correction' ? 'Kabar koreksi (opsional)' : 'Alasan pembatalan (opsional)'}</label>
          <textarea id={`decision-text-${decision.id}`} maxLength={dialog === 'compensation' ? 500 : 2000} rows={4} value={text} onChange={event => setText(event.target.value)} disabled={mutation.pending} />
        </div>
        {dialog === 'correction' && <p className="muted">Biarkan kosong untuk menggunakan form manual.</p>}
        <div aria-live="polite">{mutation.pending && <Loading label="Membuat draft perubahan…" />}</div>
        {mutation.error && <ErrorState error={mutation.error} />}
        <div className="row">
          <button className="btn" type="button" disabled={mutation.pending} onClick={() => setDialog(null)}>Kembali</button>
          <button className="btn btn-primary" type="submit" disabled={mutation.pending || !online}>{dialog === 'compensation' ? 'Lanjut ke konfirmasi' : 'Buat draft koreksi'}</button>
        </div>
      </form>
    </Dialog>
  </article>
}
