'use client'
import { useEffect, useState } from 'react'
import { Dialog, ErrorState, Icon, Loading } from '@/components/ui'
import { checkRequest, useMutation } from '@/hooks/useMutation'
import { useOnline } from '@/hooks/useOnline'
import { usePolling } from '@/hooks/usePolling'
import { EVENT_ID, RUNDOWN_PATH, type RundownResponse } from '@/hooks/types'
import { ApiError } from '@/lib/api-client'
import { NotifierStatus, notifierTime } from './TelegramSettings'
import styles from './notifier.module.css'

interface Delivery {
  id: string
  group_id: string
  group_title: string | null
  status: string
  attempts: number
  error_code: string | null
  sent_at: string | null
  telegram_message_id: number | null
}
interface NotificationEntry {
  id: string
  version: number
  origin: string
  status: string
  summary_text: string | null
  summary_source: string | null
  created_at: string
  deliveries: Delivery[]
}
const ORIGINS: Record<string, string> = { decision: 'Persetujuan perubahan', manual_edit: 'Edit rundown', reorder: 'Urutan rundown', import: 'Impor rundown', settings: 'Pengaturan acara' }
const PATH = `/api/events/${EVENT_ID}/notifications`

function DeliveryActions({ delivery, refresh }: { delivery: Delivery; refresh: () => Promise<void> }) {
  const action = useMutation()
  const online = useOnline()
  const [open, setOpen] = useState(false)
  const [checked, setChecked] = useState(false)
  const [notice, setNotice] = useState('')
  const [requestedKind, setRequestedKind] = useState<'retry' | 'mark_sent'>('retry')
  const [recovery, setRecovery] = useState<'checking' | 'unknown' | 'not_found' | null>(null)
  const ambiguous = delivery.status === 'ambiguous'
  const busy = action.pending || recovery === 'checking'
  async function complete(kind: 'retry' | 'mark_sent') {
    setOpen(false)
    setChecked(false)
    setRecovery(null)
    action.reset()
    setNotice(kind === 'mark_sent' ? 'Ditandai sudah terkirim berdasarkan pemeriksaan Anda.' : 'Permintaan kirim ulang tersimpan. Status akan diperbarui setelah pengiriman.')
    await refresh()
  }
  async function reconcile(key: string) {
    setRecovery('checking')
    try {
      const status = await checkRequest(key)
      if (status.status === 'committed') await complete(requestedKind)
      else setRecovery('not_found')
    } catch { setRecovery('unknown') }
  }
  useEffect(() => {
    if (recovery === 'checking' && action.key && online) void reconcile(action.key)
    // Pemeriksaan selalu memakai key intent yang gagal, tanpa membuat mutation baru.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recovery, action.key, online])
  async function submit(kind: 'retry' | 'mark_sent') {
    if (busy || (ambiguous && !checked) || (recovery && (recovery !== 'not_found' || kind !== requestedKind))) return
    setRequestedKind(kind)
    setNotice('')
    try {
      await action.mutate({ path: `${PATH}/deliveries/${encodeURIComponent(delivery.id)}/retry`, body: { action: kind } })
      await complete(kind)
    } catch (error) {
      if (error instanceof ApiError && ['NETWORK', 'TIMEOUT'].includes(error.code)) setRecovery('checking')
      // Key tetap sama saat tindakan yang sama dicoba lagi.
    }
  }
  return <>
    {(delivery.status === 'dead' || ambiguous) && <div className={styles.actions}><button type="button" className="btn" disabled={!online || action.pending} onClick={() => { setOpen(true); setChecked(false); setNotice('') }}><Icon name={ambiguous ? 'help-circle' : 'send'} />{ambiguous ? 'Periksa pengiriman' : 'Kirim ulang'}</button></div>}
    <p className={styles.notice} role="status" aria-live="polite">{notice && <><Icon name="check" />{notice}</>}</p>
    <Dialog open={open} title={ambiguous ? 'Periksa pengiriman Telegram' : 'Kirim ulang notifikasi'} busy={busy} onClose={() => setOpen(false)}>
      <div className={styles.dialog}>
        <p>Grup: <strong>{delivery.group_title || 'Grup Telegram'}</strong></p>
        {ambiguous ? <><p className="alert alert-action"><Icon name="alert" /> Telegram belum mengonfirmasi hasil pengiriman. Periksa grup terlebih dahulu karena pesan mungkin sudah ada. Kirim ulang dapat menghasilkan pesan duplikat.</p><label className="check-label"><input type="checkbox" checked={checked} disabled={busy} onChange={(event) => setChecked(event.target.checked)} />Saya sudah memeriksa pesan di grup Telegram</label></> : <p>Kirim kembali ringkasan perubahan yang sama ke grup ini?</p>}
        {recovery === 'checking' && <Loading label="Memeriksa status permintaan…" />}
        {recovery === 'unknown' && <p className="alert alert-action"><Icon name="help-circle" /> Status permintaan belum dapat dipastikan. Periksa status sebelum mengirim tindakan baru.</p>}
        {recovery === 'not_found' && <p className="alert alert-info"><Icon name="info" /> Permintaan belum tercatat. Coba tindakan yang sama; percobaan ini memakai kode permintaan yang sama.</p>}
        {action.error && <ErrorState error={action.error} />}
        <div className={styles.actions}><button type="button" className="btn" disabled={busy} onClick={() => setOpen(false)}>Batal</button>{recovery === 'unknown' && <button type="button" className="btn" disabled={!online || !action.key} onClick={() => setRecovery('checking')}><Icon name="history" />Periksa status permintaan</button>}{ambiguous && <button type="button" className="btn" disabled={!online || busy || !checked || (!!recovery && (recovery !== 'not_found' || requestedKind !== 'mark_sent'))} onClick={() => void submit('mark_sent')}><Icon name="check" />Sudah terkirim</button>}<button type="button" className="btn btn-primary" disabled={!online || busy || (ambiguous && !checked) || (!!recovery && (recovery !== 'not_found' || requestedKind !== 'retry'))} onClick={() => void submit('retry')}><Icon name="send" />{action.pending ? 'Menyimpan…' : ambiguous ? 'Belum ada, kirim ulang' : 'Ya, kirim ulang'}</button></div>
      </div>
    </Dialog>
  </>
}

export function NotificationLog() {
  const query = usePolling<{ outboxes: NotificationEntry[] }>(PATH, { intervalMs: 10000 })
  const rundown = usePolling<RundownResponse>(RUNDOWN_PATH, { intervalMs: 30000 })
  const online = useOnline()
  const timezone = rundown.data?.event.timezone ?? 'Asia/Jakarta'
  return <section className={`card ${styles.section}`} aria-labelledby="notification-log-title">
    <div className={styles.header}><div className={styles.copy}><h2 id="notification-log-title">Log notifikasi</h2><p className={styles.muted}>“Terkirim” berarti pesan diterima Telegram. Status “Sudah dibaca” tetap tercatat melalui brief di aplikasi.</p></div><button type="button" className="btn" disabled={!online} onClick={() => void query.refresh()}><Icon name="history" />Perbarui log</button></div>
    {query.error && <ErrorState error={query.error} onRetry={() => void query.refresh()} />}
    {!query.data && !query.error && <Loading label="Memuat log notifikasi…" />}
    {query.data?.outboxes.length === 0 && <p className={styles.muted}>Belum ada notifikasi. Perubahan rundown yang berhasil tersimpan akan tercatat di sini.</p>}
    <div className={styles.list}>{query.data?.outboxes.map((entry) => <article className={styles.version} key={entry.id} aria-label={`Notifikasi rundown v${entry.version}`}>
      <div className={styles.header}><div className={styles.copy}><h3>Rundown v{entry.version}</h3><p className={styles.muted}>{ORIGINS[entry.origin] ?? 'Perubahan rundown'} · {notifierTime(entry.created_at, timezone)}</p></div><NotifierStatus status={entry.status} /></div>
      <p className={styles.summary}>{entry.summary_text || 'Ringkasan sedang disiapkan.'}</p>
      {entry.summary_source && <p className={styles.muted}><Icon name={entry.summary_source === 'llm' ? 'lancara' : 'list-checks'} /> {entry.summary_source === 'llm' ? 'Ringkasan AI' : 'Ringkasan template'}</p>}
      {entry.deliveries.length === 0 && <p className={styles.muted}>{entry.status === 'expired' ? 'Notifikasi melewati batas waktu pengiriman.' : entry.status === 'done' ? 'Tidak ada grup yang disetujui saat notifikasi diproses.' : 'Pengiriman belum disiapkan.'}</p>}
      {entry.deliveries.map((delivery) => <div className={styles.delivery} key={delivery.id} aria-label={`Pengiriman ke ${delivery.group_title || 'grup Telegram'}`}>
        <div className={styles.header}><strong>{delivery.group_title || 'Grup Telegram'}</strong><NotifierStatus status={delivery.status} /></div>
        <div className={styles.metadata}><span>{delivery.attempts} percobaan</span>{delivery.error_code && <span>Kode kegagalan: {delivery.error_code}</span>}{delivery.sent_at && <span>Diterima {notifierTime(delivery.sent_at, timezone)}</span>}{delivery.telegram_message_id != null && <span>ID pesan: {delivery.telegram_message_id}</span>}</div>
        <DeliveryActions delivery={delivery} refresh={query.refresh} />
      </div>)}
    </article>)}</div>
  </section>
}
