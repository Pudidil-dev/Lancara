'use client'
import { useEffect, useId, useState } from 'react'
import { Dialog, ErrorState, Icon, Loading, type IconName , Label, Input, Button } from '@/components/ui'
import { useMutation } from '@/hooks/useMutation'
import { useOnline } from '@/hooks/useOnline'
import { usePolling } from '@/hooks/usePolling'
import type { RundownResponse } from '@/hooks/types'
import { useEvent } from '@/hooks/useEvent'
import { zoneAbbrev } from '@/lib/time'
import type { TelegramGroup as ServerTelegramGroup } from '@/modules/notifier/types'
import styles from './notifier.module.css'

type TelegramGroup = Omit<ServerTelegramGroup, 'created_at'> & { created_at: string }
interface LinkResult { link: string; expires_at: string }

const STATUS: Record<string, { text: string; tone: string; icon: IconName }> = {
  pending: { text: 'Menunggu proses', tone: 'warning', icon: 'clock' },
  approved: { text: 'Disetujui', tone: 'success', icon: 'check' },
  revoked: { text: 'Dicabut', tone: 'neutral', icon: 'lock' },
  bot_removed: { text: 'Bot dikeluarkan', tone: 'danger', icon: 'alert' },
  ready: { text: 'Siap dikirim', tone: 'brand', icon: 'send' },
  queued: { text: 'Dalam antrean', tone: 'neutral', icon: 'clock' },
  done: { text: 'Selesai', tone: 'success', icon: 'check' },
  expired: { text: 'Kedaluwarsa', tone: 'neutral', icon: 'timer-off' },
  sending: { text: 'Mengirim', tone: 'brand', icon: 'send' },
  sent: { text: 'Terkirim', tone: 'success', icon: 'check' },
  retry: { text: 'Menunggu kirim ulang', tone: 'warning', icon: 'clock' },
  ambiguous: { text: 'Perlu dicek di grup', tone: 'warning', icon: 'help-circle' },
  skipped: { text: 'Dilewati', tone: 'neutral', icon: 'lock' },
  dead: { text: 'Gagal terkirim', tone: 'danger', icon: 'alert' },
}

export function NotifierStatus({ status, label }: { status: string; label?: string }) {
  const value = STATUS[status] ?? { text: 'Status belum tersedia', tone: 'neutral', icon: 'info' as const }
  return <span className={`badge badge-${value.tone}`}><Icon name={value.icon} />{label ?? value.text}</span>
}

export function notifierTime(iso: string, timezone: string): string {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return 'Waktu belum tersedia'
  return `${new Intl.DateTimeFormat('id-ID', { timeZone: timezone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)} ${zoneAbbrev(timezone)}`
}

function safeTelegramLink(value: string, kind: 'start' | 'startgroup'): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 't.me' && !url.username && !url.password && !url.port
      && /^\/[A-Za-z0-9_]+$/.test(url.pathname) && /^[A-Za-z0-9_-]{1,64}$/.test(url.searchParams.get(kind) ?? '')
      && [...url.searchParams.keys()].length === 1 && !url.hash ? url.href : null
  } catch { return null }
}

function TelegramLink({ result, kind, timezone }: { result: LinkResult; kind: 'start' | 'startgroup'; timezone: string }) {
  const inputId = useId()
  const [notice, setNotice] = useState('')
  const [expired, setExpired] = useState(Date.parse(result.expires_at) <= Date.now())
  const link = safeTelegramLink(result.link, kind)
  useEffect(() => {
    const refresh = () => setExpired(!Number.isFinite(Date.parse(result.expires_at)) || Date.parse(result.expires_at) <= Date.now())
    refresh()
    const timer = setInterval(refresh, 1000)
    return () => clearInterval(timer)
  }, [result.expires_at])
  async function copy() {
    if (!link || expired) return
    try { await navigator.clipboard.writeText(link); setNotice('Tautan disalin.') }
    catch { setNotice('Pilih tautan di kolom lalu salin secara manual.') }
  }
  if (!link) return <p className="alert alert-blocker" role="alert"><Icon name="alert" /> Tautan Telegram tidak valid. Buat tautan baru.</p>
  const label = kind === 'startgroup' ? 'Tautan hubungkan grup' : 'Tautan Telegram saya'
  return <div className={styles.linkBox}>
    <p>{kind === 'startgroup' ? 'Buka Telegram, pilih grup kru, lalu kembali ke sini untuk menyetujui grup.' : 'Buka Telegram dan tekan Start. Tautan akun akan muncul di sini setelah berhasil.'}</p>
    <div className="field"><Label htmlFor={inputId}>{label}</Label><div className={styles.linkRow}><Input id={inputId} value={expired ? '' : link} readOnly onFocus={(event) => event.target.select()} /><Button variant="outline" className="btn" type="button" disabled={expired} onClick={() => void copy()}><Icon name="share" />Salin tautan</Button></div></div>
    <div className={styles.actions}>{!expired && <Button asChild variant="default"><a className="btn btn-primary" href={link} target="_blank" rel="noopener noreferrer"><Icon name="arrow-right" />Buka Telegram</a></Button>}<span className={styles.muted}>{expired ? 'Tautan kedaluwarsa. Buat tautan baru.' : `Sekali pakai · berlaku hingga ${notifierTime(result.expires_at, timezone)}`}</span></div>
    <p className={styles.notice} role="status" aria-live="polite">{notice && <><Icon name="info" />{notice}</>}</p>
  </div>
}

function GroupCard({ group, enabled, timezone, refresh }: { group: TelegramGroup; enabled: boolean; timezone: string; refresh: () => Promise<void> }) {
  const GROUPS_PATH = `/api/events/${group.event_id}/telegram/groups`
  const action = useMutation()
  const online = useOnline()
  const [draft, setDraft] = useState<{ topic: string; include: boolean } | null>(null)
  const [notice, setNotice] = useState('')
  const [revokeOpen, setRevokeOpen] = useState(false)
  const topic = draft?.topic ?? group.message_thread_id ?? ''
  const include = draft?.include ?? group.include_public_link
  const topicValid = !topic || (/^[1-9]\d*$/.test(topic) && Number.isSafeInteger(Number(topic)))
  const editable = group.status === 'pending' || group.status === 'approved'
  const busy = action.pending || !online || !enabled
  async function update(kind: 'approve' | 'revoke' | 'settings') {
    if (!topicValid && kind !== 'revoke') return
    setNotice('')
    try {
      await action.mutate({ path: `${GROUPS_PATH}/${encodeURIComponent(group.id)}`, method: 'PATCH', idempotent: false,
        body: kind === 'revoke' ? { action: 'revoke' } : { action: 'approve', message_thread_id: topic ? Number(topic) : null, include_public_link: include } })
      await refresh()
      setDraft(null)
      setRevokeOpen(false)
      setNotice(kind === 'approve' ? 'Grup disetujui. Perubahan berikutnya akan dikirim ke grup ini.' : kind === 'revoke' ? 'Grup dicabut. Notifikasi berikutnya tidak dikirim ke grup ini.' : 'Pengaturan grup tersimpan.')
    } catch { /* Hook menyimpan error dan intent untuk percobaan berikutnya. */ }
  }
  const title = group.title_snapshot || 'Grup Telegram'
  return <article className={styles.group} aria-label={`Grup ${title}`}>
    <div className={styles.header}><div className={styles.copy}><h3>{title}</h3><p className={styles.muted}>Didaftarkan {notifierTime(group.created_at, timezone)}</p></div><NotifierStatus status={group.status} label={group.status === 'pending' ? 'Menunggu persetujuan' : undefined} /></div>
    {group.status === 'pending' && <p className={styles.muted}>Cocokkan nama grup sebelum menyetujui. Grup ini belum menerima notifikasi.</p>}
    {group.status === 'bot_removed' && <p className={styles.muted}>Hubungkan kembali grup melalui tautan baru agar bot dapat mengirim notifikasi.</p>}
    {editable && <div className={styles.groupFields}>
      <Label className="field"><span>ID topik Telegram (opsional)</span><Input inputMode="numeric" value={topic} disabled={busy} aria-invalid={!topicValid || undefined} onChange={(event) => setDraft({ topic: event.target.value, include })} placeholder="Kosongkan untuk grup utama" />{!topicValid && <span className="muted">Isi dengan bilangan bulat positif.</span>}</Label>
      <div className={styles.copy}><Label className="check-label"><Input type="checkbox" checked={include} disabled={busy} onChange={(event) => setDraft({ topic, include: event.target.checked })} />Sertakan tautan rundown publik</Label><p className={styles.muted}>Gunakan tautan publik yang telah diaktifkan lewat tombol Bagikan pada dashboard.</p></div>
    </div>}
    <div className={styles.actions}>
      {group.status === 'pending' && <Button variant="default" type="button" className="btn btn-primary" disabled={busy || !topicValid} onClick={() => void update('approve')}><Icon name="check" />{action.pending ? 'Menyimpan…' : 'Setujui grup'}</Button>}
      {group.status === 'approved' && <Button variant="outline" type="button" className="btn" disabled={busy || !draft || !topicValid} onClick={() => void update('settings')}><Icon name="check" />{action.pending ? 'Menyimpan…' : 'Simpan pengaturan grup'}</Button>}
      {editable && <Button variant="destructive" type="button" className="btn btn-danger" disabled={busy} onClick={() => { action.reset(); setRevokeOpen(true) }}><Icon name="lock" />Cabut grup</Button>}
    </div>
    {action.error && !revokeOpen && <ErrorState error={action.error} />}
    <p className={styles.notice} role="status" aria-live="polite">{notice && <><Icon name="check" />{notice}</>}</p>
    <Dialog open={revokeOpen} title="Cabut grup Telegram" onClose={() => setRevokeOpen(false)} busy={action.pending}>
      <p>Hentikan notifikasi ke {title}? Pesan yang belum dikirim akan dilewati.</p>
      {action.error && <ErrorState error={action.error} />}
      <div className={styles.actions}><Button variant="outline" type="button" className="btn" disabled={action.pending} onClick={() => setRevokeOpen(false)}>Batal</Button><Button variant="destructive" type="button" className="btn btn-danger" disabled={busy} onClick={() => void update('revoke')}><Icon name="lock" />{action.pending ? 'Mencabut…' : 'Ya, cabut grup'}</Button></div>
    </Dialog>
  </article>
}

export function TelegramSettings() {
  const { eventId: EVENT_ID, rundownPath: RUNDOWN_PATH } = useEvent()
  const GROUPS_PATH = EVENT_ID ? `/api/events/${EVENT_ID}/telegram/groups` : null
  const groups = usePolling<{ enabled: boolean; groups: TelegramGroup[] }>(GROUPS_PATH, { intervalMs: 10000 })
  const rundown = usePolling<RundownResponse>(RUNDOWN_PATH, { intervalMs: 30000 })
  const create = useMutation()
  const online = useOnline()
  const [link, setLink] = useState<LinkResult | null>(null)
  const timezone = rundown.data?.event.timezone ?? 'Asia/Jakarta'
  async function createLink() {
    try { setLink(await create.mutate<LinkResult>({ path: `/api/events/${EVENT_ID}/telegram/group-codes`, idempotent: false })) }
    catch { /* Tautan baru hanya muncul setelah server membuat kode. */ }
  }
  return <section className={`card ${styles.section}`} aria-labelledby="telegram-settings-title">
    <div className={styles.header}><div className={styles.copy}><h2 id="telegram-settings-title">Notifikasi Telegram</h2><p className={styles.muted}>Ringkasan perubahan rundown yang sudah tersimpan dikirim ke grup yang Anda setujui.</p></div><Button variant="outline" type="button" className="btn" disabled={!online} onClick={() => void groups.refresh()}><Icon name="history" />Perbarui grup</Button></div>
    <p className="alert alert-info"><Icon name="info" /> Telegram mengirim notifikasi satu arah. Perubahan rundown tetap dikelola di aplikasi.</p>
    {groups.data && !groups.data.enabled && <p className="alert alert-action"><Icon name="alert" /> Notifikasi Telegram belum diaktifkan untuk aplikasi ini. Hubungi pengelola aplikasi untuk mengaktifkannya.</p>}
    <div className={styles.header}><h3>Grup penerima</h3><Button variant="default" type="button" className="btn btn-primary" disabled={create.pending || !online || !groups.data?.enabled} onClick={() => void createLink()}><Icon name="plus" />{create.pending ? 'Membuat tautan…' : link ? 'Buat tautan grup baru' : 'Hubungkan grup'}</Button></div>
    {create.error && <ErrorState error={create.error} />}
    {link && <TelegramLink key={link.link} result={link} kind="startgroup" timezone={timezone} />}
    {groups.error && <ErrorState error={groups.error} onRetry={() => void groups.refresh()} />}
    {!groups.data && !groups.error && <Loading label="Memuat grup Telegram…" />}
    {groups.data?.groups.length === 0 && <p className={styles.muted}>Belum ada grup penerima. Hubungkan grup, kemudian cocokkan namanya sebelum menyetujui.</p>}
    <div className={styles.list}>{groups.data?.groups.map((group) => <GroupCard key={group.id} group={group} enabled={groups.data!.enabled} timezone={timezone} refresh={groups.refresh} />)}</div>
  </section>
}
