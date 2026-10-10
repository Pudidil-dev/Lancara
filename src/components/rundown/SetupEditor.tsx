'use client'
import { resolvePic } from '@/modules/events/pic'
import Link from 'next/link'
import { useMemo, useState, type ReactNode } from 'react'
import { PageActions, PageDescription } from '@/components/shell/PageHeader'
import { ConstraintAlert, Dialog, ErrorState, Icon, Loading , Label, Input, Button, NativeSelect, NativeSelectOption } from '@/components/ui'
import { useSession } from '@/hooks/useSession'
import { usePolling } from '@/hooks/usePolling'
import { useMutation } from '@/hooks/useMutation'
import { useOnline } from '@/hooks/useOnline'
import type { RundownResponse } from '@/hooks/types'
import { useEvent } from '@/hooks/useEvent'
import { formatClock, localDate, localToUtc, zoneAbbrev } from '@/lib/time'
import { ApiError } from '@/lib/api-client'
import type { Item, Snapshot, Violation } from '@/modules/engine/types'
import { validateSnapshot } from '@/modules/engine/validate'
import styles from './rundown.module.css'
import { productionRoleCount } from './rundown-format'

export function SetupScreen() {
  const { rundownPath: RUNDOWN_PATH } = useEvent()
  const { session, loading } = useSession()
  const query = usePolling<RundownResponse>(RUNDOWN_PATH)
  if (loading || !session) return <Loading label="Memuat sesi…" />
  if (!query.data) return query.error ? <ErrorState error={query.error} onRetry={query.refresh} /> : <Loading label="Memuat setup…" />
  return <SetupEditor data={query.data} />
}

type FieldIssue = { field?: string; item_id?: string | null; constraint_id?: string; message: string }
function errorIssues(details: unknown): FieldIssue[] {
  return Array.isArray(details) ? details.filter((x): x is FieldIssue => typeof x === 'object' && x !== null && typeof x.message === 'string') : []
}
const locked = (item: Item) => item.status === 'completed' || item.status === 'in_progress'
const hhmm = (iso: string, zone: string) => formatClock(iso, zone).replace('.', ':')

function SetupEditor({ data }: { data: RundownResponse }) {
  const EVENT_ID = data.event.id
  // Initial draft is captured once; later polling only updates the active-version banner.
  const [draft, setDraft] = useState<Snapshot>(() => structuredClone(data.snapshot))
  const [selectedId, setSelectedId] = useState<string | undefined>(() => data.snapshot.items.find(i => i.status === 'pending')?.id ?? data.snapshot.items[0]?.id)
  const [baseVersion, setBaseVersion] = useState(data.version)
  const [note, setNote] = useState('')
  const [notice, setNotice] = useState('')
  const [reloadOpen, setReloadOpen] = useState(false)
  const [clientError, setClientError] = useState<ApiError | null>(null)
  const mutation = useMutation()
  const online = useOnline()
  const disabled = mutation.pending || !online
  const zone = draft.event.timezone
  const date = localDate(draft.event.curfew_at, zone)
  const issues = [...errorIssues(mutation.error?.details), ...errorIssues(clientError?.details)]
  const serverVersion = mutation.error?.code === 'STALE_VERSION' && mutation.error.details && typeof mutation.error.details === 'object' && 'active_version' in mutation.error.details ? Number(mutation.error.details.active_version) : data.version
  const stale = baseVersion < data.version || mutation.error?.code === 'STALE_VERSION'
  const live = useMemo(() => validateSnapshot(draft), [draft])
  const problems = live.errors.length + live.missing.length
  const item = draft.items.find(i => i.id === selectedId) ?? draft.items[0]
  const index = item ? draft.items.indexOf(item) : -1

  function changeSnapshot(update: (snapshot: Snapshot) => Snapshot) { setDraft(update); setNotice(''); setClientError(null) }
  function updateItem(id: string, update: Partial<Item>) { changeSnapshot(s => ({ ...s, items: s.items.map(i => i.id === id ? { ...i, ...update } : i) })) }
  function toUtc(value: string, current: string) {
    try { return localToUtc(localDate(current, zone), value, zone) }
    catch { setClientError(new ApiError('VALIDATION_ERROR', 'Isi jam lokal yang valid.', 422, null, null)); return current }
  }
  function fieldError(field: string, itemId?: string, idx?: number) {
    const messages = issues.filter(i => i.field === field && (!itemId || i.item_id === itemId) || (idx !== undefined && i.field === `snapshot.items.${idx}.${field}`) || (!itemId && i.field === `snapshot.event.${field}`)).map(i => i.message)
    return messages.length ? <span id={`err-${itemId ?? 'event'}-${field}`} className={styles.fieldError}>{messages.join(' ')}</span> : null
  }
  function field(id: string, label: string, control: ReactNode, issue?: ReactNode) { return <div className="field"><Label htmlFor={id}>{label}</Label>{control}{issue}</div> }
  function roleChecks(selected: string[], onChange: (next: string[]) => void, prefix: string) {
    return <div className={styles.checks}>{draft.roles.map(role => <Label className="check-label" key={role.id} htmlFor={`${prefix}-${role.id}`}><Input id={`${prefix}-${role.id}`} type="checkbox" checked={selected.includes(role.id)} onChange={e => onChange(e.target.checked ? [...selected, role.id] : selected.filter(id => id !== role.id))} />{role.label}</Label>)}</div>
  }
  function addItem() {
    const id = `item-${crypto.randomUUID().slice(0, 8)}`
    changeSnapshot(s => ({ ...s, items: [...s.items, { id, title: 'Aktivitas baru', start_at: localToUtc(date, '19:00', zone), duration_seconds: 900, min_duration_seconds: 300, estimated_end_at: null, status: 'pending', pic_role_ids: [], resource_ids: [], swappable: true }] }))
    setSelectedId(id)
  }
  function removeItem(id: string) {
    changeSnapshot(s => ({ ...s, items: s.items.filter(i => i.id !== id), constraints: s.constraints.filter(c => c.item_id !== id), dependencies: s.dependencies.filter(d => d.predecessor_id !== id && d.successor_id !== id) }))
    setSelectedId(undefined)
  }
  async function save() {
    setNotice(''); setClientError(null)
    const validation = validateSnapshot(draft)
    if (validation.errors.length) { setClientError(new ApiError('VALIDATION_ERROR', 'Perbaiki isian setup sebelum menyimpan.', 422, null, validation.errors)); return }
    try {
      const result = await mutation.mutate<{ new_version: number }>({ path: `/api/events/${EVENT_ID}/setup`, method: 'PUT', body: { base_version: baseVersion, snapshot: draft, note } })
      setBaseVersion(result.new_version); setNotice(`Setup tersimpan sebagai Rundown v${result.new_version}.`)
    } catch { /* Draft and mutation key survive all error responses. */ }
  }
  function reload() { setDraft(structuredClone(data.snapshot)); setBaseVersion(data.version); mutation.reset(); setNotice('Versi terkini dimuat.'); setClientError(null); setReloadOpen(false) }
  const clientViolations = errorIssues(clientError?.details) as Violation[]
  const itemDeps = item ? draft.dependencies.filter(d => d.predecessor_id === item.id || d.successor_id === item.id) : []
  const itemTitle = (id: string) => draft.items.find(i => i.id === id)?.title ?? id

  return <form id="setup-form" className="setup-columns" onSubmit={e => { e.preventDefault(); void save() }}>
    <PageDescription>Lengkapi data operasional sebelum acara dimulai. Semua waktu dalam {zoneAbbrev(zone)}.</PageDescription>
    <PageActions>
      <Button asChild variant="outline"><Link className="btn" href="/">Kembali ke dashboard</Link></Button>
      <Button variant="default" type="submit" form="setup-form" className="btn btn-primary" disabled={disabled || stale}>{mutation.pending ? 'Menyimpan setup…' : 'Simpan perubahan'}</Button>
    </PageActions>

    <div className="setup-main">
      <div role="status" aria-live="polite">{mutation.pending ? 'Menyimpan setup…' : notice}</div>
      {stale && <div className="alert alert-action" role="status"><strong>⚠ Rundown sudah berubah ke v{serverVersion}. Muat ulang.</strong><p>Draft Anda tetap tersedia. Muat ulang mengganti draft dengan versi server terkini.</p><Button variant="outline" type="button" className="btn" disabled={mutation.pending} onClick={() => setReloadOpen(true)}>Muat ulang versi terkini</Button></div>}
      {mutation.error && <ErrorState error={mutation.error} />}{clientError && <ErrorState error={clientError} />}{clientViolations.length > 0 && <ConstraintAlert title="Periksa isian setup" violations={clientViolations} />}

      {item ? <section className="setup-card" aria-labelledby="edit-item-title">
        <div className="card-title-row"><h2 id="edit-item-title" className="h3">Edit item · {item.title || 'Tanpa judul'}</h2><span className="muted small">{item.id}</span></div>
        <div className="field-pair">
          {field('edit-item', 'Aktivitas yang diedit', <NativeSelect id="edit-item" value={item.id} onChange={e => setSelectedId(e.target.value)}>{draft.items.map(i => <NativeSelectOption key={i.id} value={i.id}>{i.title} · {i.id}</NativeSelectOption>)}</NativeSelect>)}
          {field(`title-${item.id}`, 'Nama segmen', <Input id={`title-${item.id}`} maxLength={120} value={item.title} aria-describedby={`err-${item.id}-title`} onChange={e => updateItem(item.id, { title: e.target.value })} />, fieldError('title', item.id, index))}
          {field(`start-${item.id}`, `Waktu mulai (${zoneAbbrev(zone)})`, <Input id={`start-${item.id}`} required type="time" value={hhmm(item.start_at, zone)} aria-describedby={`err-${item.id}-start_at`} disabled={locked(item)} onChange={e => updateItem(item.id, { start_at: toUtc(e.target.value, item.start_at) })} />, fieldError('start_at', item.id, index))}
          {field(`duration-${item.id}`, 'Durasi (menit)', <Input id={`duration-${item.id}`} type="number" required min={1} step={1} value={item.duration_seconds / 60} disabled={locked(item)} aria-describedby={`err-${item.id}-duration_seconds`} onChange={e => updateItem(item.id, { duration_seconds: Number(e.target.value) * 60 })} />, fieldError('duration_seconds', item.id, index))}
          {field(`minimum-${item.id}`, 'Durasi minimum (menit)', <Input id={`minimum-${item.id}`} type="number" required min={1} step={1} value={item.min_duration_seconds / 60} aria-describedby={`err-${item.id}-min_duration_seconds`} onChange={e => updateItem(item.id, { min_duration_seconds: Number(e.target.value) * 60 })} />, fieldError('min_duration_seconds', item.id, index))}
          <div className="field"><span className="label-text">Penjadwalan</span><Label className="check-label" htmlFor={`swap-${item.id}`}><Input id={`swap-${item.id}`} type="checkbox" checked={item.swappable} disabled={locked(item)} onChange={e => updateItem(item.id, { swappable: e.target.checked })} />Boleh ditukar</Label></div>
        </div>
        <hr className="divider" />
        {field(`pic-${item.id}`, 'PIC (tulis bebas)', <Input id={`pic-${item.id}`} maxLength={200} value={item.pic_text ?? item.pic_role_ids.map(id => draft.roles.find(r => r.id === id)?.label ?? id).join(', ')} placeholder="Mis. Sidiq, Audio" aria-describedby={`err-${item.id}-pic_role_ids`} onChange={e => updateItem(item.id, resolvePic(e.target.value, draft.roles))} />, fieldError('pic_role_ids', item.id, index))}
        <fieldset className={styles.fieldset}><legend>Resource</legend><div className={styles.checks}>{draft.resources.map(resource => <Label key={resource.id} className="check-label"><Input type="checkbox" checked={item.resource_ids.includes(resource.id)} onChange={e => updateItem(item.id, { resource_ids: e.target.checked ? [...item.resource_ids, resource.id] : item.resource_ids.filter(id => id !== resource.id) })} />{resource.label}</Label>)}</div>{fieldError('resource_ids', item.id, index)}</fieldset>
        <div><h3 className="label-text">Dependensi</h3>{itemDeps.length ? itemDeps.map(d => <p key={d.id} className="muted">{itemTitle(d.predecessor_id)} harus selesai sebelum {itemTitle(d.successor_id)} dimulai. ({d.id})</p>) : <p className="muted">Tidak ada dependensi untuk item ini. Atur di kartu Dependensi aktivitas.</p>}</div>
        <fieldset className={`${styles.fieldset} stack`}><legend>Batas {item.title}</legend>{draft.constraints.filter(c => c.item_id === item.id).map(c => <div className="stack" key={c.id}><p className="muted">{c.id}</p><div className="field-pair">
          {field(`constraint-type-${c.id}`, `Jenis batas ${c.id}`, <NativeSelect id={`constraint-type-${c.id}`} value={c.type} onChange={e => changeSnapshot(s => ({ ...s, constraints: s.constraints.map(x => x.id === c.id ? { ...x, type: e.target.value as 'fixed_start' | 'earliest_start' } : x) }))}><NativeSelectOption value="fixed_start">Mulai tetap</NativeSelectOption><NativeSelectOption value="earliest_start">Mulai paling awal</NativeSelectOption></NativeSelect>)}
          {field(`constraint-at-${c.id}`, `Jam batas ${c.id}`, <Input id={`constraint-at-${c.id}`} type="time" required value={hhmm(c.at, zone)} onChange={e => changeSnapshot(s => ({ ...s, constraints: s.constraints.map(x => x.id === c.id ? { ...x, at: toUtc(e.target.value, x.at) } : x) }))} />)}
          {field(`constraint-note-${c.id}`, `Catatan ${c.id}`, <Input id={`constraint-note-${c.id}`} maxLength={200} value={c.note ?? ''} onChange={e => changeSnapshot(s => ({ ...s, constraints: s.constraints.map(x => x.id === c.id ? { ...x, note: e.target.value } : x) }))} />)}
        </div><Button variant="destructive" type="button" className="btn btn-danger" onClick={() => changeSnapshot(s => ({ ...s, constraints: s.constraints.filter(x => x.id !== c.id) }))}>Hapus batas {c.id}</Button></div>)}
          <Button variant="outline" type="button" className="btn" disabled={mutation.pending || draft.constraints.length >= 60} onClick={() => changeSnapshot(s => ({ ...s, constraints: [...s.constraints, { id: `C-${crypto.randomUUID().slice(0, 8)}`, item_id: item.id, type: 'earliest_start', at: item.start_at, hard: true }] }))}>Tambah batas {item.title}</Button></fieldset>
        {locked(item)
          ? <div className="notice" data-tone="warning"><Icon name="lock" size={20} /><span><span className="notice-title">Item terkunci</span><span className="notice-body">Item berlangsung atau selesai tidak dapat dipindahkan otomatis; jam mulai dan durasi dikunci.</span></span></div>
          : <div className="notice"><Icon name="alert" size={20} /><span><span className="notice-title">{item.swappable ? 'Waktu mulai fleksibel' : 'Waktu mulai tidak fleksibel'}</span><span className="notice-body">{item.swappable ? 'Boleh digeser atau ditukar; durasi minimum dan dependensi tetap harus dipenuhi.' : 'Item ini tidak ditukar oleh mesin; hanya dapat bergeser mengikuti batas dan dependensi.'}</span></span></div>}
        <div className="row"><Button variant="outline" type="button" className="btn" disabled={mutation.pending || draft.items.length >= 30} onClick={addItem}>Tambah aktivitas</Button><Button variant="destructive" type="button" className="btn btn-danger" disabled={mutation.pending || locked(item)} onClick={() => removeItem(item.id)}>Hapus aktivitas {item.title}</Button></div>
      </section> : <section className="setup-card"><h2 className="h3">Rundown belum disiapkan.</h2><Button variant="default" type="button" className="btn btn-primary" onClick={addItem}>Tambah aktivitas</Button></section>}

      <section className="setup-card" aria-labelledby="resource-title"><h2 id="resource-title" className="h3">Penanggung jawab resource</h2>{draft.resources.map(resource => <fieldset key={resource.id} className={styles.fieldset}><legend>{resource.label} · {resource.id}</legend>{roleChecks(resource.role_ids, next => changeSnapshot(s => ({ ...s, resources: s.resources.map(r => r.id === resource.id ? { ...r, role_ids: next } : r) })), `resource-${resource.id}`)}{issues.filter(i => i.constraint_id === `RES-${resource.id}`).map((i, n) => <p key={n} className={styles.fieldError}>{i.message}</p>)}</fieldset>)}</section>

      <section className="setup-card" aria-labelledby="dependency-title"><div className="card-title-row"><h2 id="dependency-title" className="h3">Dependensi aktivitas</h2><Button variant="outline" type="button" className="btn" disabled={mutation.pending || draft.items.length < 2 || draft.dependencies.length >= 60} onClick={() => changeSnapshot(s => ({ ...s, dependencies: [...s.dependencies, { id: `DEP-${crypto.randomUUID().slice(0, 8)}`, predecessor_id: s.items[0]!.id, successor_id: s.items[1]!.id, type: 'finish_before_start' }] }))}>Tambah dependensi</Button></div>{draft.dependencies.length === 0 && <p className="muted">Tidak ada dependensi tercatat.</p>}{draft.dependencies.map(d => <fieldset className={`${styles.fieldset} stack`} key={d.id}><legend>{d.id}</legend><div className="field-pair">
        {field(`pre-${d.id}`, `Selesai lebih dahulu ${d.id}`, <NativeSelect id={`pre-${d.id}`} value={d.predecessor_id} onChange={e => changeSnapshot(s => ({ ...s, dependencies: s.dependencies.map(x => x.id === d.id ? { ...x, predecessor_id: e.target.value } : x) }))}>{draft.items.map(i => <NativeSelectOption key={i.id} value={i.id}>{i.title} · {i.id}</NativeSelectOption>)}</NativeSelect>)}
        {field(`post-${d.id}`, `Kemudian mulai ${d.id}`, <NativeSelect id={`post-${d.id}`} value={d.successor_id} onChange={e => changeSnapshot(s => ({ ...s, dependencies: s.dependencies.map(x => x.id === d.id ? { ...x, successor_id: e.target.value } : x) }))}>{draft.items.map(i => <NativeSelectOption key={i.id} value={i.id}>{i.title} · {i.id}</NativeSelectOption>)}</NativeSelect>)}
      </div><Button variant="destructive" type="button" className="btn btn-danger" disabled={mutation.pending} onClick={() => changeSnapshot(s => ({ ...s, dependencies: s.dependencies.filter(x => x.id !== d.id) }))}>Hapus dependensi {d.id}</Button></fieldset>)}</section>

      <section className="setup-card" aria-labelledby="note-title"><h2 id="note-title" className="h3">Catatan versi</h2>{field('setup-note', 'Catatan perubahan setup', <Input id="setup-note" maxLength={200} value={note} onChange={e => setNote(e.target.value)} />)}<p className="muted small">Draft dari v{baseVersion}. Tersimpan setelah server menyetujui; gunakan tombol Simpan perubahan di kanan atas.</p></section>
    </div>

    <aside className="setup-side" aria-label="Panduan setup">
      {problems === 0
        ? <div className="notice" data-tone="success" role="status"><Icon name="check" size={20} /><span><span className="notice-title">Data siap dianalisis</span><span className="notice-body">{draft.items.length} item · {productionRoleCount(draft)} peran terkait · Tidak ada referensi yang hilang.</span></span></div>
        : <div className="notice" data-tone="danger" role="status"><Icon name="alert" size={20} /><span><span className="notice-title">DATA BELUM LENGKAP</span><span className="notice-body">{problems} isian perlu diperbaiki sebelum analisis dapat berjalan.</span></span></div>}
      <section className="setup-card" aria-labelledby="event-setup-title"><h2 id="event-setup-title" className="h3">Batas acara</h2>
        {field('event-name', 'Nama acara', <Input id="event-name" maxLength={120} required value={draft.event.name} onChange={e => changeSnapshot(s => ({ ...s, event: { ...s.event, name: e.target.value } }))} />)}
        {field('curfew', `Jam selesai maksimal / curfew (${zoneAbbrev(zone)})`, <Input id="curfew" type="time" required value={hhmm(draft.event.curfew_at, zone)} onChange={e => changeSnapshot(s => ({ ...s, event: { ...s.event, curfew_at: toUtc(e.target.value, s.event.curfew_at) } }))} />, fieldError('curfew_at'))}
        <dl className="fact-list">{draft.constraints.filter(c => c.type === 'fixed_start').map(c => <div key={c.id}><dt>{itemTitle(c.item_id)} · mulai tetap</dt><dd>{hhmm(c.at, zone)} {zoneAbbrev(zone)}</dd></div>)}</dl>
      </section>
      <section className="setup-card" aria-labelledby="why-title"><h2 id="why-title" className="h3">Kenapa data ini penting?</h2>
        <p className="muted">PIC menentukan penerima brief. Dependensi menjaga urutan. Resource membantu mendeteksi benturan penggunaan.</p>
        <p className="muted small">Item berlangsung atau selesai tidak dapat dipindahkan otomatis.</p>
      </section>
    </aside>

    <Dialog open={reloadOpen} title="Muat ulang versi terkini?" onClose={() => setReloadOpen(false)}><p>Draft yang belum disimpan akan diganti dengan Rundown v{data.version} dari server.</p><div className="row"><Button variant="outline" type="button" className="btn" onClick={() => setReloadOpen(false)}>Pertahankan draft</Button><Button variant="default" type="button" className="btn btn-primary" onClick={reload}>Ya, muat ulang</Button></div></Dialog>
  </form>
}
