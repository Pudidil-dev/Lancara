'use client'
import Link from 'next/link'
import { useEffect, useId, useState } from 'react'
import { Dialog, ErrorState, Icon, Loading, type IconName } from '@/components/ui'
import { useMutation } from '@/hooks/useMutation'
import { useOnline } from '@/hooks/useOnline'
import { usePolling } from '@/hooks/usePolling'
import { EVENT_ID, RUNDOWN_PATH, type RundownResponse } from '@/hooks/types'
import { zoneAbbrev } from '@/lib/time'
import type { TelegramGroup as ServerTelegramGroup } from '@/modules/notifier/types'
import styles from './notifier.module.css'

type TelegramGroup = Omit<ServerTelegramGroup, 'created_at'> & { created_at: string }
interface TelegramAccount {
  telegram_user_id: string
  username_snapshot: string | null
  display_snapshot: string | null
  private_status: string
  linked_at: string
}
interface TelegramMe {
  enabled: boolean
  registered: boolean
  account: TelegramAccount | null
  pic_roles: Array<{ event_id: string; role_id: string }>
}
interface LinkResult { link: string; expires_at: string }
const GROUPS_PATH = `/api/events/${EVENT_ID}/telegram/groups`

const STATUS: Record<string, { text: string; tone: string; icon: IconName }> = {
  pending: { text: 'Menunggu proses', tone: 'warning', icon: 'clock' },
  approved: { text: 'Disetujui', tone: 'success', icon: 'check' },
  revoked: { text: 'Dicabut', tone: 'neutral', icon: 'lock' },
  bot_removed: { text: 'Bot dikeluarkan', tone: 'danger', icon: 'alert' },
  ready: { text: 'Siap dikirim', tone: 'brand', icon: 'send' },
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
    <div className="field"><label htmlFor={inputId}>{label}</label><div className={styles.linkRow}><input id={inputId} value={expired ? '' : link} readOnly onFocus={(event) => event.target.select()} /><button className="btn" type="button" disabled={expired} onClick={() => void copy()}><Icon name="share" />Salin tautan</button></div></div>
    <div className={styles.actions}>{!expired && <a className="btn btn-primary" href={link} target="_blank" rel="noopener noreferrer"><Icon name="arrow-right" />Buka Telegram</a>}<span className={styles.muted}>{expired ? 'Tautan kedaluwarsa. Buat tautan baru.' : `Sekali pakai · berlaku hingga ${notifierTime(result.expires_at, timezone)}`}</span></div>
    <p className={styles.notice} role="status" aria-live="polite">{notice && <><Icon name="info" />{notice}</>}</p>
  </div>
}

function GroupCard({ group, enabled, timezone, refresh }: { group: TelegramGroup; enabled: boolean; timezone: string; refresh: () => Promise<void> }) {
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
      <label className="field"><span>ID topik Telegram (opsional)</span><input inputMode="numeric" value={topic} disabled={busy} aria-invalid={!topicValid || undefined} onChange={(event) => setDraft({ topic: event.target.value, include })} placeholder="Kosongkan untuk grup utama" />{!topicValid && <span className="muted">Isi dengan bilangan bulat positif.</span>}</label>
      <div className={styles.copy}><label className="check-label"><input type="checkbox" checked={include} disabled={busy} onChange={(event) => setDraft({ topic, include: event.target.checked })} />Sertakan tautan rundown publik</label><p className={styles.muted}>Gunakan tautan publik yang telah diaktifkan lewat tombol Bagikan pada dashboard.</p></div>
    </div>}
    <div className={styles.actions}>
      {group.status === 'pending' && <button type="button" className="btn btn-primary" disabled={busy || !topicValid} onClick={() => void update('approve')}><Icon name="check" />{action.pending ? 'Menyimpan…' : 'Setujui grup'}</button>}
      {group.status === 'approved' && <button type="button" className="btn" disabled={busy || !draft || !topicValid} onClick={() => void update('settings')}><Icon name="check" />{action.pending ? 'Menyimpan…' : 'Simpan pengaturan grup'}</button>}
      {editable && <button type="button" className="btn btn-danger" disabled={busy} onClick={() => { action.reset(); setRevokeOpen(true) }}><Icon name="lock" />Cabut grup</button>}
    </div>
    {action.error && !revokeOpen && <ErrorState error={action.error} />}
    <p className={styles.notice} role="status" aria-live="polite">{notice && <><Icon name="check" />{notice}</>}</p>
    <Dialog open={revokeOpen} title="Cabut grup Telegram" onClose={() => setRevokeOpen(false)} busy={action.pending}>
      <p>Hentikan notifikasi ke {title}? Pesan yang belum dikirim akan dilewati.</p>
      {action.error && <ErrorState error={action.error} />}
      <div className={styles.actions}><button type="button" className="btn" disabled={action.pending} onClick={() => setRevokeOpen(false)}>Batal</button><button type="button" className="btn btn-danger" disabled={busy} onClick={() => void update('revoke')}><Icon name="lock" />{action.pending ? 'Mencabut…' : 'Ya, cabut grup'}</button></div>
    </Dialog>
  </article>
}

function MyTelegram({ timezone, roles }: { timezone: string; roles: RundownResponse['snapshot']['roles'] | null }) {
  const me = usePolling<TelegramMe>('/api/me/telegram', { intervalMs: 10000 })
  const linkAction = useMutation()
  const picAction = useMutation()
  const unlinkAction = useMutation()
  const online = useOnline()
  const [link, setLink] = useState<LinkResult | null>(null)
  const [draftRoles, setDraftRoles] = useState<string[] | null>(null)
  const [unlinkOpen, setUnlinkOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const account = me.data?.account
  useEffect(() => { if (account) setLink(null) }, [account])
  const selected = draftRoles ?? me.data?.pic_roles.filter((role) => role.event_id === EVENT_ID).map((role) => role.role_id) ?? []
  const busy = linkAction.pending || picAction.pending || unlinkAction.pending
  const disabled = busy || !online || !me.data?.enabled
  async function makeLink() {
    setNotice('')
    try { setLink(await linkAction.mutate<LinkResult>({ path: '/api/me/telegram/link-token', idempotent: false })) }
    catch { /* Tidak ada sukses sebelum respons server. */ }
  }
  async function saveRoles() {
    setNotice('')
    try {
      await picAction.mutate({ path: '/api/me/telegram/pic-roles', method: 'PUT', idempotent: false, body: { event_id: EVENT_ID, role_ids: selected } })
      await me.refresh()
      setDraftRoles(null)
      setNotice('Peran PIC tersimpan.')
    } catch { /* Pilihan lokal tetap tersedia untuk percobaan ulang. */ }
  }
  async function unlink() {
    setNotice('')
    try {
      await unlinkAction.mutate({ path: '/api/me/telegram', method: 'DELETE', idempotent: false })
      await me.refresh()
      setUnlinkOpen(false)
      setLink(null)
      setNotice('Tautan Telegram diputus. Akun ini tidak lagi di-mention.')
    } catch { /* Dialog tetap terbuka bila server gagal. */ }
  }
  return <div className={styles.subsection}>
    <div className={styles.copy}><h3>Telegram saya</h3><p className={styles.muted}>Hubungkan akun dan pilih peran PIC agar Anda disebut saat peran tersebut terdampak.</p></div>
    {me.error && <ErrorState error={me.error} onRetry={() => void me.refresh()} />}
    {!me.data && !me.error && <Loading label="Memuat akun Telegram…" />}
    {me.data && !me.data.registered && <p className="alert alert-info"><Icon name="info" /> Akun demo belum dapat ditautkan ke Telegram. <Link href="/register">Daftar akun Lancara</Link>, lalu masuk dengan akun tersebut untuk menghubungkan Telegram dan memilih peran PIC.</p>}
    {me.data?.registered && <>
      {account ? <div className={styles.header}><div className={styles.copy}><div className={styles.identity}><strong>{account.display_snapshot || (account.username_snapshot ? `@${account.username_snapshot}` : 'Akun Telegram')}</strong><span className="badge badge-success"><Icon name="check" />Terhubung</span></div><p className={styles.muted}>Terhubung {notifierTime(account.linked_at, timezone)}{account.username_snapshot && account.display_snapshot ? ` · @${account.username_snapshot}` : ''}</p>{account.private_status === 'blocked' && <p className="alert alert-action"><Icon name="alert" /> Bot diblokir di chat pribadi. Notifikasi grup tetap dapat dikirim.</p>}</div><button type="button" className="btn btn-danger" disabled={disabled} onClick={() => { unlinkAction.reset(); setUnlinkOpen(true) }}><Icon name="lock" />Putuskan tautan</button></div>
        : <div className={styles.actions}><span className="badge badge-neutral"><Icon name="info" />Belum terhubung</span><button type="button" className="btn" disabled={disabled} onClick={() => void makeLink()}><Icon name="share" />{linkAction.pending ? 'Membuat tautan…' : link ? 'Buat tautan akun baru' : 'Hubungkan Telegram saya'}</button></div>}
      {!account && link && <TelegramLink key={link.link} result={link} kind="start" timezone={timezone} />}
      <fieldset className={styles.roleFields} disabled={disabled || !roles}>
        <legend>Peran PIC saya untuk acara ini</legend>
        {(roles ?? []).map((role) => <label key={role.id} className="check-label"><input type="checkbox" checked={selected.includes(role.id)} onChange={(event) => setDraftRoles(event.target.checked ? [...selected, role.id] : selected.filter((id) => id !== role.id))} />{role.label}</label>)}
      </fieldset>
      {!roles && <p className={styles.muted}>Menunggu daftar peran dari rundown.</p>}
      <div className={styles.actions}><button type="button" className="btn" disabled={disabled || !roles || draftRoles === null} onClick={() => void saveRoles()}><Icon name="check" />{picAction.pending ? 'Menyimpan…' : 'Simpan peran PIC'}</button>{!account && <p className={styles.muted}>Peran yang dipilih akan di-mention setelah Telegram terhubung.</p>}</div>
    </>}
    {(linkAction.error || picAction.error) && <ErrorState error={(linkAction.error ?? picAction.error)!} />}
    <p className={styles.notice} role="status" aria-live="polite">{notice && <><Icon name="check" />{notice}</>}</p>
    <Dialog open={unlinkOpen} title="Putuskan tautan Telegram" busy={unlinkAction.pending} onClose={() => setUnlinkOpen(false)}><p>Akun Telegram Anda tidak akan lagi disebut dalam notifikasi perubahan rundown.</p>{unlinkAction.error && <ErrorState error={unlinkAction.error} />}<div className={styles.actions}><button className="btn" type="button" disabled={busy} onClick={() => setUnlinkOpen(false)}>Batal</button><button className="btn btn-danger" type="button" disabled={disabled} onClick={() => void unlink()}><Icon name="lock" />{unlinkAction.pending ? 'Memutuskan…' : 'Ya, putuskan tautan'}</button></div></Dialog>
  </div>
}

export function TelegramSettings() {
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
    <div className={styles.header}><div className={styles.copy}><h2 id="telegram-settings-title">Notifikasi Telegram</h2><p className={styles.muted}>Ringkasan perubahan rundown yang sudah tersimpan dikirim ke grup yang Anda setujui.</p></div><button type="button" className="btn" disabled={!online} onClick={() => void groups.refresh()}><Icon name="history" />Perbarui grup</button></div>
    <p className="alert alert-info"><Icon name="info" /> Telegram mengirim notifikasi satu arah. Konfirmasi perubahan dan “Sudah dibaca” tetap dilakukan di aplikasi.</p>
    {groups.data && !groups.data.enabled && <p className="alert alert-action"><Icon name="alert" /> Notifikasi Telegram belum diaktifkan untuk aplikasi ini. Hubungi pengelola aplikasi untuk mengaktifkannya.</p>}
    <div className={styles.header}><h3>Grup penerima</h3><button type="button" className="btn btn-primary" disabled={create.pending || !online || !groups.data?.enabled} onClick={() => void createLink()}><Icon name="plus" />{create.pending ? 'Membuat tautan…' : link ? 'Buat tautan grup baru' : 'Hubungkan grup'}</button></div>
    {create.error && <ErrorState error={create.error} />}
    {link && <TelegramLink key={link.link} result={link} kind="startgroup" timezone={timezone} />}
    {groups.error && <ErrorState error={groups.error} onRetry={() => void groups.refresh()} />}
    {!groups.data && !groups.error && <Loading label="Memuat grup Telegram…" />}
    {groups.data?.groups.length === 0 && <p className={styles.muted}>Belum ada grup penerima. Hubungkan grup, kemudian cocokkan namanya sebelum menyetujui.</p>}
    <div className={styles.list}>{groups.data?.groups.map((group) => <GroupCard key={group.id} group={group} enabled={groups.data!.enabled} timezone={timezone} refresh={groups.refresh} />)}</div>
    <MyTelegram timezone={timezone} roles={rundown.data?.snapshot.roles ?? null} />
  </section>
}
