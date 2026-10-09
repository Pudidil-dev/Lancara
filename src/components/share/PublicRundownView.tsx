'use client'
import { Icon, Loading } from '@/components/ui'
import { usePolling } from '@/hooks/usePolling'
import { formatClock, zoneAbbrev } from '@/lib/time'
import { BRAND_WORDMARK } from '@/lib/brand'
import type { PublicItem, PublicRundown } from '@/modules/share/service'
import { countdown } from '@/components/rundown/rundown-format'

const hhmm = (iso: string, zone: string) => formatClock(iso, zone).replace('.', ':')

function status(item: PublicItem): { text: string; tone: 'success' | 'muted' | 'danger' } {
  if (item.status === 'in_progress') return { text: 'Berlangsung', tone: 'success' }
  if (item.status === 'completed') return { text: 'Selesai', tone: 'muted' }
  if (item.status === 'cancelled') return { text: 'Dibatalkan', tone: 'danger' }
  return item.locked ? { text: 'Terkunci', tone: 'muted' } : { text: 'Terjadwal', tone: 'muted' }
}

/** Halaman publik hanya baca (tanpa login, tanpa peran) dengan design system Dashboard. */
export function PublicRundownView({ token }: { token: string }) {
  const { data, error } = usePolling<PublicRundown>(`/api/public/rundown/${encodeURIComponent(token)}`, { intervalMs: 15000 })
  if (error && !data) {
    return <main className="public-page"><PublicHeader /><section className="dash-card public-empty" role="alert">
      <p className="dash-card-value">Tautan tidak berlaku</p>
      <p className="dash-card-note">{error.code === 'NOT_FOUND' ? 'Tautan rundown tidak ditemukan atau sudah dinonaktifkan oleh koordinator.' : 'Rundown belum dapat dimuat. Coba muat ulang halaman.'}</p>
    </section></main>
  }
  if (!data) return <main className="public-page"><PublicHeader /><Loading label="Memuat rundown…" /></main>
  const zone = data.event.timezone
  const now = Date.parse(data.server_now)
  const live = data.items.find((i) => i.status === 'in_progress')
  const next = data.items.find((i) => i.status === 'pending')
  const finish = data.items.filter((i) => i.status !== 'cancelled').reduce((max, i) => Math.max(max, Date.parse(i.end_at)), Number.NEGATIVE_INFINITY)
  const slack = Math.round((Date.parse(data.event.curfew_at) - finish) / 60000)
  return <main className="public-page">
    <PublicHeader updated={hhmm(data.server_now, zone)} zone={zoneAbbrev(zone)} />
    <div className="page-title-copy"><h1>{data.event.name}</h1><p>Rundown v{data.version} · Semua waktu dalam {zoneAbbrev(zone)} · Diperbarui otomatis</p></div>
    <div className="dash-summary">
      <section className="dash-card" data-accent="true" aria-label="Sedang berlangsung">
        <p className="dash-card-label">Sedang berlangsung</p><p className="dash-card-value">{live?.title ?? 'Belum ada'}</p>
        <p className="dash-card-note">{next ? (Date.parse(next.start_at) > now ? `${countdown(Date.parse(next.start_at) - now)} menuju ${next.title}` : `Berikutnya ${next.title}`) : 'Tidak ada segmen berikutnya'}</p>
      </section>
      <section className="dash-card" data-accent="true" aria-label="Berikutnya">
        <p className="dash-card-label">Berikutnya</p><p className="dash-card-value">{next?.title ?? '—'}</p>
        <p className="dash-card-note">{next ? `Mulai ${hhmm(next.start_at, zone)} · ${next.duration_min} menit` : 'Rundown sudah selesai'}</p>
      </section>
      <section className="dash-card" aria-label="Estimasi selesai">
        <p className="dash-card-label">Estimasi selesai</p>
        <p className="dash-card-value" data-tone={slack < 0 ? 'danger' : 'success'}>{Number.isFinite(finish) ? hhmm(new Date(finish).toISOString(), zone) : '—'}</p>
        <p className="dash-card-note">{slack >= 0 ? `${slack} menit sebelum batas acara` : `${-slack} menit melewati batas acara`}</p>
      </section>
    </div>
    <ul className="dash-list" aria-label={`Rundown ${data.event.name}`}>
      <li className="public-grid dash-head" aria-hidden="true"><span>NO</span><span>WAKTU</span><span>SEGMEN</span><span>DURASI</span><span>PIC</span><span>STATUS</span></li>
      {data.items.map((item, i) => {
        const s = status(item)
        return <li key={item.id} className="dash-row" data-live={item.status === 'in_progress' || undefined}>
          <div className="public-grid dash-row-line">
            <span className="dash-index">{String(i + 1).padStart(2, '0')}</span>
            <span className="dash-time">{hhmm(item.start_at, zone)}</span>
            <span className="dash-seg"><span className="dash-seg-title">{item.title}</span><span className="dash-seg-sub">{item.segment || 'Main stage'} · Segmen {String(i + 1).padStart(2, '0')}</span></span>
            <span className="dash-dur">{item.duration_min} m</span>
            <span className="dash-pic">{item.pic.join(' / ') || '—'}</span>
            <span className="dash-status" data-tone={s.tone}>{s.text}</span>
          </div>
        </li>
      })}
    </ul>
  </main>
}

function PublicHeader({ updated, zone }: { updated?: string; zone?: string }) {
  return <header className="public-header">
    <span className="public-brand"><span className="agent-logo" aria-hidden="true"><Icon name="lancara-mark" size={20} /></span>{BRAND_WORDMARK}</span>
    <span className="lc-chip">Rundown publik · hanya baca</span>
    <span className="topbar-spacer" />
    {updated && <span className="dash-card-note">Diperbarui {updated} {zone}</span>}
  </header>
}
