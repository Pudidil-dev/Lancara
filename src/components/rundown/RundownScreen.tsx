'use client'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { PageActions, PageDescription } from '@/components/shell/PageHeader'
import { AgentChat } from '@/components/agent/AgentChat'
import { ConstraintAlert, Dialog, EmptyState, ErrorState, Icon, Loading } from '@/components/ui'
import type { HistoryResponse } from '@/components/briefs/types'
import { useSession } from '@/hooks/useSession'
import { usePolling } from '@/hooks/usePolling'
import { useMutation } from '@/hooks/useMutation'
import { useOnline } from '@/hooks/useOnline'
import { EVENT_ID, RUNDOWN_PATH, type ChangeSummary, type RundownResponse } from '@/hooks/types'
import { formatDuration, toIso, toMs, zoneAbbrev } from '@/lib/time'
import { evaluate, isBreakItem } from '@/modules/engine/schedule'
import type { Item, Snapshot, Violation } from '@/modules/engine/types'
import { ChangeHistoryCard, SummaryCards, hhmm } from './RundownSide'
import { ShareButton } from './ShareButton'
import { itemEnd, picLabel, roleNames } from './rundown-format'

const isFixed = (item: Item, snapshot: Snapshot) => snapshot.constraints.some((c) => c.item_id === item.id && c.type === 'fixed_start')
/** Bisa diseret: belum mulai, bukan ishoma/istirahat, bukan slot tetap. */
const isMovable = (item: Item, snapshot: Snapshot) => item.status === 'pending' && !isBreakItem(item) && !isFixed(item, snapshot)

/** Status kolom STATUS Figma: Berlangsung / Terkunci / Terjadwal (+ Selesai, Dibatalkan). */
function statusOf(item: Item, snapshot: Snapshot): { text: string; tone: 'success' | 'warning' | 'danger' | 'muted' } {
  if (item.status === 'in_progress') return { text: 'Berlangsung', tone: 'success' }
  if (item.status === 'completed') return { text: 'Selesai', tone: 'muted' }
  if (item.status === 'cancelled') return { text: 'Dibatalkan', tone: 'danger' }
  if (isFixed(item, snapshot)) return { text: 'Terkunci', tone: 'success' }
  if (isBreakItem(item)) return { text: 'Terkunci', tone: 'muted' }
  return { text: 'Terjadwal', tone: 'muted' }
}

function subtitle(item: Item, snapshot: Snapshot, index: number): string {
  const kind = isFixed(item, snapshot) ? 'Mulai tetap' : item.segment || (isBreakItem(item) ? 'Istirahat' : 'Main stage')
  return `${kind} · Segmen ${String(index + 1).padStart(2, '0')}`
}

/**
 * Susun ulang jam item pending mengikuti urutan baru: berurutan dari jam mulai pending paling awal.
 * Ishoma dan slot tetap tidak bergeser; item lain mengalir di sekitarnya. Hasil diperiksa engine sebelum disimpan.
 */
export function resequence(snapshot: Snapshot, order: string[]): Snapshot {
  const byId = new Map(snapshot.items.map((i) => [i.id, i]))
  const pending = order.map((id) => byId.get(id)!).filter((i) => i && i.status === 'pending')
  if (!pending.length) return snapshot
  let cursor = Math.min(...pending.map((i) => toMs(i.start_at)))
  const starts = new Map<string, string>()
  for (const item of pending) {
    if (!isMovable(item, snapshot)) {
      cursor = Math.max(cursor, toMs(item.start_at) + item.duration_seconds * 1000)
      continue
    }
    starts.set(item.id, toIso(cursor))
    cursor += item.duration_seconds * 1000
  }
  return { ...snapshot, items: snapshot.items.map((i) => (starts.has(i.id) ? { ...i, start_at: starts.get(i.id)! } : i)) }
}

function ItemDetail({ item, snapshot, action }: { item: Item; snapshot: Snapshot; action?: React.ReactNode }) {
  const zone = snapshot.event.timezone
  const title = (id: string) => snapshot.items.find((i) => i.id === id)?.title ?? id
  const dependencies = snapshot.dependencies.filter((d) => d.predecessor_id === item.id || d.successor_id === item.id)
  const list = (values: string[] | undefined) => (values?.length ? <ul>{values.map((v, i) => <li key={i}>{v}</li>)}</ul> : 'Belum diisi')
  return <div className="dash-detail"><dl>
    <dt>Jadwal · {zoneAbbrev(zone)}</dt><dd>{hhmm(item.start_at, zone)} – {hhmm(new Date(itemEnd(item)).toISOString(), zone)}{item.estimated_end_at && ' (estimasi selesai)'}</dd>
    <dt>Durasi / minimum</dt><dd>{formatDuration(item.duration_seconds)} / {formatDuration(item.min_duration_seconds)}</dd>
    <dt>PIC</dt><dd>{roleNames(item.pic_role_ids, snapshot).join(', ') || 'Belum diisi'}</dd>
    <dt>Perlengkapan</dt><dd>{list(item.equipment)}</dd>
    <dt>Teknis</dt><dd>{list(item.notes)}</dd>
    <dt>Batas tercatat</dt><dd>{snapshot.constraints.filter((c) => c.item_id === item.id).map((c) => <p key={c.id}>{c.type === 'fixed_start' ? 'Mulai tetap' : 'Mulai paling awal'} {hhmm(c.at, zone)}{c.note ? ` · ${c.note}` : ''}</p>)}<p>Selesai acara {hhmm(snapshot.event.curfew_at, zone)}</p></dd>
    <dt>Dependensi</dt><dd>{dependencies.length ? dependencies.map((d) => <p key={d.id}>{title(d.predecessor_id)} selesai sebelum {title(d.successor_id)} mulai</p>) : 'Tidak ada dependensi'}</dd>
    {action && <><dt>Status panggung</dt><dd>{action}</dd></>}
  </dl></div>
}

interface RowProps { item: Item; snapshot: Snapshot; index: number; open: boolean; movable: boolean; onToggle: () => void; detail: React.ReactNode }

function SortableRow({ item, snapshot, index, open, movable, onToggle, detail }: RowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled: !movable })
  const zone = snapshot.event.timezone
  const status = statusOf(item, snapshot)
  return <li ref={setNodeRef} className="dash-row" data-live={item.status === 'in_progress' || undefined} data-dragging={isDragging || undefined} style={{ transform: CSS.Transform.toString(transform), transition }}>
    <div className="dash-grid dash-row-line">
      <button type="button" ref={setActivatorNodeRef} className="dash-grip" disabled={!movable} aria-label={movable ? `Seret untuk memindah ${item.title}` : `${item.title} tidak bisa dipindah`} {...attributes} {...listeners}><Icon name="grip-horizontal" /></button>
      <button type="button" className="dash-cell-btn" aria-expanded={open} aria-controls={`detail-${item.id}`} onClick={onToggle}>
        <span className="dash-index">{String(index + 1).padStart(2, '0')}</span>
        <span className="dash-time">{hhmm(item.start_at, zone)}</span>
        <span className="dash-seg"><span className="dash-seg-title">{item.title}</span><span className="dash-seg-sub">{subtitle(item, snapshot, index)}</span></span>
        <span className="dash-dur">{Math.round(item.duration_seconds / 60)} m</span>
        <span className="dash-pic">{picLabel(item, snapshot)}</span>
        <span className="dash-status" data-tone={status.tone}>{status.text}</span>
      </button>
    </div>
    {open && <div id={`detail-${item.id}`}>{detail}</div>}
  </li>
}

export function RundownScreen() {
  const { session } = useSession()
  const { data, error, refresh } = usePolling<RundownResponse>(RUNDOWN_PATH)
  const changes = usePolling<ChangeSummary[]>(`/api/events/${EVENT_ID}/changes`)
  const history = usePolling<HistoryResponse>(session ? `/api/events/${EVENT_ID}/history` : null, { intervalMs: 10000 })
  const mutation = useMutation()
  const online = useOnline()
  const search = useSearchParams().get('q')?.trim().toLowerCase() ?? ''
  const [openId, setOpenId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [proposal, setProposal] = useState<{ snapshot: Snapshot; violations: Violation[]; moved: Item[] } | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const items = useMemo(() => (data ? [...data.snapshot.items].sort((a, b) => toMs(a.start_at) - toMs(b.start_at) || a.id.localeCompare(b.id)) : []), [data])
  if (!data) return error ? <ErrorState error={error} onRetry={refresh} /> : <Loading label="Memuat rundown…" />
  const { snapshot, version, server_now: now } = data
  const zone = snapshot.event.timezone
  const visible = search ? items.filter((i) => `${i.title} ${i.segment ?? ''} ${picLabel(i, snapshot)}`.toLowerCase().includes(search)) : items
  const disabled = mutation.pending || !online
  const canDrag = !!session && !search && !disabled

  async function changeStatus(item: Item) {
    setNotice('')
    try {
      const result = await mutation.mutate<{ new_version: number }>({ path: `/api/events/${EVENT_ID}/item-status`, body: { item_id: item.id, status: item.status === 'pending' ? 'in_progress' : 'completed', base_version: version } })
      setNotice(`${item.title} ${item.status === 'pending' ? 'mulai' : 'selesai'} · Rundown v${result.new_version}.`)
    } catch { /* Error ditampilkan di bawah. */ }
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const ids = items.map((i) => i.id)
    const order = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)))
    const firstPending = items.findIndex((i) => i.status === 'pending')
    if (order.slice(0, firstPending).some((id) => items.find((i) => i.id === id)?.status === 'pending')) {
      setNotice('Segmen yang belum mulai tidak bisa dipindah ke sebelum segmen yang sedang berlangsung atau selesai.')
      return
    }
    const next = resequence(snapshot, order)
    const moved = next.items.filter((i) => i.start_at !== snapshot.items.find((x) => x.id === i.id)?.start_at)
    if (!moved.length) return
    setProposal({ snapshot: next, moved, violations: evaluate(next, snapshot, now) })
  }

  async function saveOrder() {
    if (!proposal) return
    try {
      const result = await mutation.mutate<{ new_version: number }>({ path: `/api/events/${EVENT_ID}/setup`, method: 'PUT', body: { base_version: version, snapshot: proposal.snapshot, origin: 'reorder', note: 'Urutan rundown diubah dari dashboard' } })
      setProposal(null)
      setNotice(`Urutan disimpan · Rundown v${result.new_version}.`)
    } catch { /* Error ditampilkan di dialog. */ }
  }

  const action = (item: Item) => session && (item.status === 'pending' || item.status === 'in_progress')
    ? <button type="button" className="btn btn-compact" disabled={disabled} onClick={() => void changeStatus(item)}>{item.status === 'pending' ? 'Tandai mulai' : 'Tandai selesai'}</button> : undefined
  const latestDecision = history.data?.decisions[0]
  return <div className="stack">
    <PageDescription>Detail rundown · Rundown v{version} · Klik segmen untuk membuka informasi operasional.</PageDescription>
    {session && <PageActions><ShareButton /></PageActions>}
    {data.validation.errors.length + data.validation.missing.length > 0 && <ConstraintAlert title="DATA BELUM LENGKAP — periksa rundown" violations={[...data.validation.errors, ...data.validation.missing]} />}
    {error && <ErrorState error={error} onRetry={refresh} />}{mutation.error && !proposal && <ErrorState error={mutation.error} />}
    {items.length === 0 ? <EmptyState title="Rundown belum disiapkan." /> : <>
      <SummaryCards snapshot={snapshot} now={now} changes={changes.data} />
      <div className="dash-main">
        <div className="dash-left">
          <p role="status" aria-live="polite" className="dash-notice">{mutation.pending ? 'Menyimpan perubahan…' : notice}{search && ` Menampilkan ${visible.length} segmen untuk "${search}".`}</p>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <ul className="dash-list" aria-label={`Rundown v${version} · ${zoneAbbrev(zone)}`}>
              <li className="dash-grid dash-head" aria-hidden="true"><span /><span>NO</span><span>WAKTU</span><span>SEGMEN</span><span>DURASI</span><span>PIC</span><span>STATUS</span></li>
              <SortableContext items={visible.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                {visible.map((item) => <SortableRow key={item.id} item={item} snapshot={snapshot} index={items.indexOf(item)} open={openId === item.id} movable={canDrag && isMovable(item, snapshot)}
                  onToggle={() => setOpenId(openId === item.id ? null : item.id)} detail={<ItemDetail item={item} snapshot={snapshot} action={action(item)} />} />)}
              </SortableContext>
            </ul>
          </DndContext>
          <ChangeHistoryCard decision={latestDecision} zone={zone} />
        </div>
        <AgentChat />
      </div>
    </>}
    <Dialog open={!!proposal} title="Simpan urutan baru?" onClose={() => { setProposal(null); mutation.reset() }} busy={mutation.pending}>
      {proposal && <>
        <p>Jam segmen dihitung ulang mengikuti urutan baru. Ishoma dan slot mulai tetap tidak bergeser.</p>
        <ul>{proposal.moved.map((i) => <li key={i.id}>{i.title}: {hhmm(snapshot.items.find((x) => x.id === i.id)!.start_at, zone)} → {hhmm(i.start_at, zone)}</li>)}</ul>
        {proposal.violations.length > 0 && <ConstraintAlert title="Urutan ini melanggar batas acara" violations={proposal.violations} />}
        {mutation.error && <ErrorState error={mutation.error} />}
        <div className="row"><button type="button" className="btn" disabled={mutation.pending} onClick={() => { setProposal(null); mutation.reset() }}>Batal</button>
          <button type="button" className="btn-gradient" disabled={disabled || proposal.violations.length > 0} onClick={() => void saveOrder()}>{mutation.pending ? 'Menyimpan…' : `Simpan sebagai v${version + 1}`}</button></div>
      </>}
    </Dialog>
  </div>
}
