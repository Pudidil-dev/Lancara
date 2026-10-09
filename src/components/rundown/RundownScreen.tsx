'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { PageActions, PageDescription } from '@/components/shell/PageHeader'
import { ConstraintAlert, Dialog, EmptyState, ErrorState, Loading, RundownHead, RundownRow } from '@/components/ui'
import { useSession } from '@/hooks/useSession'
import { usePolling } from '@/hooks/usePolling'
import { useMutation } from '@/hooks/useMutation'
import { useOnline } from '@/hooks/useOnline'
import { EVENT_ID, RUNDOWN_PATH, type ChangeSummary, type RundownResponse } from '@/hooks/types'
import { addSeconds, formatClock, formatDuration, formatRange, localDate, localToUtc, zoneAbbrev } from '@/lib/time'
import type { Item, Snapshot } from '@/modules/engine/types'
import { GuardedLimits, LatestChange, SummaryCards, VersionLine } from './RundownSide'
import { itemEnd, minutesLabel, picLabel, productionRoleCount, roleNames, rowStatus, rowSubtitle } from './rundown-format'

function ItemDetail({ item, snapshot }: { item: Item; snapshot: Snapshot }) {
  const zone = snapshot.event.timezone
  const title = (id: string) => snapshot.items.find(i => i.id === id)?.title ?? id
  const dependencies = snapshot.dependencies.filter(d => d.predecessor_id === item.id || d.successor_id === item.id)
  const resources = item.resource_ids.map(id => snapshot.resources.find(r => r.id === id)?.label ?? id)
  return <div><h3>{item.title}</h3><span className="muted">{item.id}</span><dl>
    <dt>Jadwal · {zoneAbbrev(zone)}</dt><dd>{formatRange(item.start_at, new Date(itemEnd(item)).toISOString(), zone)}{item.estimated_end_at && ' (estimasi selesai)'}</dd>
    <dt>Durasi / minimum</dt><dd>{formatDuration(item.duration_seconds)} / {formatDuration(item.min_duration_seconds)}</dd>
    <dt>PIC</dt><dd>{roleNames(item.pic_role_ids, snapshot).join(', ') || 'Belum diisi'}</dd>
    <dt>Resource</dt><dd>{resources.join(', ') || 'Tidak ada'}</dd>
    <dt>Batas tercatat</dt><dd>{snapshot.constraints.filter(c => c.item_id === item.id).map(c => <p key={c.id}>{c.id} · {c.type === 'fixed_start' ? 'Mulai tetap' : 'Mulai paling awal'} {formatClock(c.at, zone)}{c.note ? ` · ${c.note}` : ''}</p>)}<p>C-CURFEW · Selesai acara {formatClock(snapshot.event.curfew_at, zone)}</p></dd>
    <dt>Dependensi</dt><dd>{dependencies.length ? dependencies.map(d => <p key={d.id}>{d.id} · {title(d.predecessor_id)} selesai sebelum {title(d.successor_id)} mulai</p>) : 'Tidak ada dependensi'}</dd>
    <dt>Boleh ditukar</dt><dd>{item.swappable ? 'Ya' : 'Tidak'}</dd></dl></div>
}

export function RundownScreen() {
  const { session } = useSession()
  const { data, error, refresh, lastRefreshed } = usePolling<RundownResponse>(RUNDOWN_PATH)
  const changes = usePolling<ChangeSummary[]>(`/api/events/${EVENT_ID}/changes`)
  const mutation = useMutation()
  const online = useOnline()
  const router = useRouter()
  const [openId, setOpenId] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [clock, setClock] = useState('')
  const [notice, setNotice] = useState('')
  const coordinator = session?.capability === 'coordinator'
  if (!data) return error ? <ErrorState error={error} onRetry={refresh} /> : <Loading label="Memuat rundown…" />
  const { snapshot, version, server_now: now } = data
  const zone = snapshot.event.timezone
  const items = [...snapshot.items].sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at) || a.id.localeCompare(b.id))
  const finished = items.filter(i => i.status === 'completed').length
  const visible = showAll ? items : items.filter(i => i.status !== 'completed')
  const disabled = mutation.pending || !online
  const finish = items.filter(i => i.status !== 'cancelled').reduce((max, i) => Math.max(max, itemEnd(i)), 0)
  const slackMin = Math.round((Date.parse(snapshot.event.curfew_at) - finish) / 60000)
  async function changeStatus(item: Item) {
    setNotice('')
    try {
      const result = await mutation.mutate<{ new_version: number }>({ path: `/api/events/${EVENT_ID}/item-status`, body: { item_id: item.id, status: item.status === 'pending' ? 'in_progress' : 'completed', base_version: version } })
      setNotice(`${item.title} ${item.status === 'pending' ? 'mulai' : 'selesai'} · Rundown v${result.new_version}.`)
    } catch { /* Shared error state preserves retry intent. */ }
  }
  async function setSimClock(at: string | null) {
    setNotice('')
    try { await mutation.mutate({ path: `/api/events/${EVENT_ID}/sim-clock`, body: { sim_clock_at: at }, idempotent: false }); setNotice('Jam simulasi diperbarui.') } catch { /* Error rendered below. */ }
  }
  async function resetDemo() {
    try { await mutation.mutate({ path: '/api/demo/reset', idempotent: false }); router.replace('/login') } catch { /* Error rendered below. */ }
  }
  const action = (item: Item) => coordinator && (item.status === 'pending' || item.status === 'in_progress')
    ? <button type="button" className="btn btn-compact" disabled={disabled} onClick={() => void changeStatus(item)} aria-label={`${item.status === 'pending' ? 'Mulai' : 'Selesai'} ${item.title}`}>{item.status === 'pending' ? 'Mulai' : 'Selesai'}</button> : undefined
  return <div className="stack">
    <PageDescription>{items.length} item · {productionRoleCount(snapshot)} peran produksi · Semua waktu dalam {zoneAbbrev(zone)}</PageDescription>
    <PageActions><Link className="btn btn-primary" href="/changes/new">Laporkan perubahan</Link></PageActions>
    {data.validation.errors.length + data.validation.missing.length > 0 && <ConstraintAlert title="DATA BELUM LENGKAP — periksa rundown" violations={[...data.validation.errors, ...data.validation.missing]} />}
    {error && <ErrorState error={error} onRetry={refresh} />}{mutation.error && <ErrorState error={mutation.error} />}
    <div role="status" aria-live="polite">{mutation.pending ? 'Menyimpan perubahan…' : notice}</div>
    {items.length === 0 ? <EmptyState title="Rundown belum disiapkan." action={coordinator ? <Link className="btn" href="/rundown/setup">Siapkan rundown</Link> : undefined} /> : <>
      <SummaryCards snapshot={snapshot} now={now} changes={changes.data} />
      <div className="rundown-board">
        <section className="panel" aria-labelledby="rundown-title">
          <div className="panel-heading"><h2 id="rundown-title" className="h3">Rundown utama</h2><span className="muted small">{visible.length} dari {items.length} item</span>{finished > 0 && <button type="button" className="link-button" aria-pressed={showAll} onClick={() => setShowAll(v => !v)}>{showAll ? 'Sembunyikan yang selesai' : `Tampilkan ${finished} selesai`}</button>}</div>
          <div className="rundown-list" role="table" aria-label={`Rundown v${version} · ${zoneAbbrev(zone)}`}>
            <RundownHead />
            {visible.map(item => {
              const status = rowStatus(item, snapshot)
              return <RundownRow key={item.id} id={item.id} live={item.status === 'in_progress'} time={formatClock(item.start_at, zone)} title={item.title} subtitle={rowSubtitle(item, snapshot)}
                duration={minutesLabel(item.duration_seconds)} pic={picLabel(item, snapshot)} status={status.text} tone={status.tone} action={action(item)}
                expanded={openId === item.id} onToggle={() => setOpenId(openId === item.id ? null : item.id)} detail={<ItemDetail item={item} snapshot={snapshot} />} />
            })}
          </div>
          <div className="rundown-footer"><strong>Selesai {formatClock(new Date(finish).toISOString(), zone)}</strong><span className="muted small">Batas acara {formatClock(snapshot.event.curfew_at, zone)} · {slackMin >= 0 ? `Sisa ${slackMin} menit` : `Lewat ${-slackMin} menit`}</span></div>
        </section>
        <div className="panel-side">
          <LatestChange changes={changes.data} />
          <GuardedLimits snapshot={snapshot} />
          <VersionLine version={version} syncedAt={lastRefreshed} zone={zone} />
        </div>
      </div>
    </>}
    {coordinator && data.demo_mode && <section className="card stack" aria-labelledby="clock-heading"><div className="row between"><h2 id="clock-heading">Jam simulasi (demo)</h2><span className="metric">{formatClock(now, zone)} {zoneAbbrev(zone)}</span></div><div className="row"><button className="btn" disabled={disabled} onClick={() => void setSimClock(addSeconds(now, 300))}>+5 mnt</button><button className="btn" disabled={disabled} onClick={() => void setSimClock(addSeconds(now, 900))}>+15 mnt</button><button className="btn" disabled={disabled} onClick={() => void setSimClock(null)}>Kembali ke jam default</button></div><form className="row" onSubmit={e => { e.preventDefault(); if (clock) void setSimClock(localToUtc(localDate(now, zone), clock, zone)) }}><div className="field"><label htmlFor="sim-clock">Set jam ({zoneAbbrev(zone)})</label><input id="sim-clock" type="time" required value={clock} onChange={e => setClock(e.target.value)} /></div><button className="btn" disabled={disabled || !clock}>Set jam</button></form><button className="btn btn-danger" disabled={disabled} onClick={() => setResetOpen(true)}>Reset data demo</button></section>}
    <Dialog open={resetOpen} title="Reset data demo?" onClose={() => setResetOpen(false)} busy={mutation.pending}><p>Seluruh perubahan, keputusan, dan brief demo akan dihapus. Semua akun akan keluar. Rundown kembali ke data awal.</p><div className="row"><button className="btn" disabled={mutation.pending} onClick={() => setResetOpen(false)}>Batal</button><button className="btn btn-danger" disabled={disabled} onClick={() => void resetDemo()}>{mutation.pending ? 'Mereset…' : 'Ya, reset data demo'}</button></div>{mutation.error && <ErrorState error={mutation.error} />}</Dialog>
  </div>
}
