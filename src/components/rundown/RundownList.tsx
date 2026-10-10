'use client'
import Link from 'next/link'
import { useState } from 'react'
import { EmptyState, ErrorState, Icon, Loading } from '@/components/ui'
import { useMutation } from '@/hooks/useMutation'
import { useOnline } from '@/hooks/useOnline'
import { usePolling } from '@/hooks/usePolling'
import { formatClock, zoneAbbrev } from '@/lib/time'
import type { RundownStatus, RundownSummary } from '@/modules/events/rundown-list'

type Filter = 'all' | RundownStatus
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'Semua' },
  { id: 'live', label: 'Berlangsung' },
  { id: 'upcoming', label: 'Akan datang' },
  { id: 'done', label: 'Selesai' },
]
const STATUS: Record<RundownStatus, { label: string; tone: 'success' | 'brand' | 'neutral' | 'warning' }> = {
  live: { label: 'Berlangsung', tone: 'success' },
  upcoming: { label: 'Akan datang', tone: 'brand' },
  done: { label: 'Selesai', tone: 'neutral' },
  empty: { label: 'Belum ada segmen', tone: 'warning' },
}

const hhmm = (iso: string, zone: string) => formatClock(iso, zone).replace('.', ':')
const part = (iso: string, zone: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('id-ID', { ...options, timeZone: zone }).format(new Date(iso))

function meta(r: RundownSummary): string {
  if (!r.start_at || !r.end_at) return 'Jadwal belum diisi'
  const day = part(r.start_at, r.timezone, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  return `${day} · ${hhmm(r.start_at, r.timezone)}–${hhmm(r.end_at, r.timezone)} ${zoneAbbrev(r.timezone)} · ${r.item_count} segmen`
}

/** Halaman Rundown: semua rundown akun (berlangsung, akan datang, selesai). Kartu = Figma Lancara/Public event card (196:289). */
export function RundownList() {
  const list = usePolling<{ rundowns: RundownSummary[] }>('/api/rundowns', { intervalMs: 30000 })
  const selection = useMutation()
  const online = useOnline()
  const [filter, setFilter] = useState<Filter>('all')
  const [opening, setOpening] = useState<string | null>(null)

  if (!list.data) return list.error ? <ErrorState error={list.error} onRetry={list.refresh} /> : <Loading label="Memuat daftar rundown…" />
  const rundowns = list.data.rundowns
  const count = (id: Filter) => (id === 'all' ? rundowns.length : rundowns.filter((r) => r.status === id).length)
  const visible = filter === 'all' ? rundowns : rundowns.filter((r) => r.status === filter)

  /** Rundown lain dijadikan event aktif sesi dulu, lalu dashboard dibuka ulang dengan konteks baru. */
  async function open(r: RundownSummary, target: '/' | '/rundown/setup') {
    if (r.active) return window.location.assign(target)
    setOpening(r.id)
    try {
      await selection.mutate({ path: '/api/session/event', method: 'PUT', body: { event_id: r.id } })
      window.location.assign(target)
    } catch { setOpening(null) }
  }

  return (
    <div className="rl-page">
      <div className="notif-actions">
        <div className="notif-filters" role="group" aria-label="Saring rundown">
          {FILTERS.map((f) => <button key={f.id} type="button" className="ripple-btn" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label} ({count(f.id)})</button>)}
        </div>
      </div>
      {selection.error && <ErrorState error={selection.error} />}
      {visible.length === 0
        ? <EmptyState title={rundowns.length ? 'Tidak ada rundown pada filter ini.' : 'Belum ada rundown.'} action={<Link href="/rundown/new" className="btn-gradient">Tambah Rundown<Icon name="plus" /></Link>} />
        : <ul className="rl-list" aria-label="Daftar rundown">
            {visible.map((r) => {
              const status = STATUS[r.status]
              const busy = opening === r.id
              return <li key={r.id} className="rl-card" data-active={r.active || undefined} data-status={r.status}>
                <div className="rl-date" aria-hidden="true">
                  <span className="rl-day">{r.start_at ? part(r.start_at, r.timezone, { day: 'numeric' }) : '—'}</span>
                  <span className="rl-month">{r.start_at ? part(r.start_at, r.timezone, { month: 'short' }).replace('.', '').toUpperCase() : 'TBA'}</span>
                </div>
                <div className="rl-summary">
                  <div className="rl-title-row"><h2>{r.name}</h2><span className="ripple-badge" data-tone={status.tone}>{status.label}</span></div>
                  <p className="rl-meta">{meta(r)}</p>
                  <p className="rl-sub">{r.active ? 'Ditampilkan di Dashboard · ' : ''}Rundown v{r.version}{r.current_title ? ` · Sedang: ${r.current_title}` : ''}</p>
                </div>
                <div className="rl-actions">
                  <button type="button" className="ripple-btn" disabled={!!opening || !online} onClick={() => void open(r, '/rundown/setup')}>Edit</button>
                  <button type="button" className="ripple-btn rl-primary" disabled={!!opening || !online} onClick={() => void open(r, '/')}>{busy ? 'Membuka…' : 'Lihat rundown'}</button>
                </div>
              </li>
            })}
          </ul>}
    </div>
  )
}
