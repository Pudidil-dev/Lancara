'use client'
import { Icon, Loading } from '@/components/ui'
import { usePolling } from '@/hooks/usePolling'
import { formatClock, zoneAbbrev, zoneOffsetMs } from '@/lib/time'
import { BRAND_WORDMARK } from '@/lib/brand'
import type { PublicItem, PublicRundown } from '@/modules/share/service'

const hhmm = (iso: string, zone: string) => formatClock(iso, zone).replace('.', ':')
const range = (item: PublicItem, zone: string) => `${hhmm(item.start_at, zone)}–${hhmm(item.end_at, zone)}`
const BREAK = /\b(ishoma|istirahat|break|coffee|makan|sholat|salat)\b/i

/** Keterangan publik: tipe segmen saja (tanpa PIC/kru/catatan internal) + status yang memengaruhi pengunjung. */
function description(item: PublicItem): string {
  const parts = [item.segment || (BREAK.test(item.title) ? 'Waktu istirahat, ibadah, dan makan.' : '')]
  if (item.status === 'cancelled') parts.unshift('Dibatalkan')
  if (item.status === 'completed') parts.unshift('Selesai')
  return parts.filter(Boolean).join(' · ')
}

function longDate(iso: string, zone: string): string {
  return new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: zone }).format(new Date(iso))
}

function utcLabel(iso: string, zone: string): string {
  const hours = zoneOffsetMs(Date.parse(iso), zone) / 3_600_000
  return `UTC${hours >= 0 ? '+' : '−'}${Math.abs(hours)}`
}

/** Halaman publik hanya baca (Figma Public UI Rundown 201:1203): tanpa login, tanpa peran, tanpa data kru. */
export function PublicRundownView({ token }: { token: string }) {
  const { data, error } = usePolling<PublicRundown>(`/api/public/rundown/${encodeURIComponent(token)}`, { intervalMs: 15000 })
  if (error && !data) {
    return <main className="public-page"><PublicHeader /><div className="public-body"><section className="public-card public-empty" role="alert">
      <h1 className="public-card-title">Tautan tidak berlaku</h1>
      <p>{error.code === 'NOT_FOUND' ? 'Tautan rundown tidak ditemukan atau sudah dinonaktifkan oleh koordinator.' : 'Rundown belum dapat dimuat. Coba muat ulang halaman.'}</p>
    </section></div></main>
  }
  if (!data) return <main className="public-page"><PublicHeader /><div className="public-body"><Loading label="Memuat rundown…" /></div></main>
  const zone = data.event.timezone
  const abbrev = zoneAbbrev(zone)
  const active = data.items.filter((i) => i.status !== 'cancelled')
  const live = data.items.find((i) => i.status === 'in_progress')
  const next = data.items.find((i) => i.status === 'pending')
  const first = active[0]
  const last = active.reduce<PublicItem | undefined>((max, i) => (!max || Date.parse(i.end_at) > Date.parse(max.end_at) ? i : max), undefined)
  const current = live ?? next
  const afterCurrent = current ? data.items.slice(data.items.indexOf(current) + 1).find((i) => i.status === 'pending') : undefined
  return <main className="public-page">
    <PublicHeader />
    <div className="public-body">
      <div className="public-identity">
        <div className="public-title-row">
          <h1>{data.event.name}</h1>
          <span className="ripple-badge" data-tone="brand">Rundown publik</span>
        </div>
        <p>{first && last ? `${longDate(first.start_at, zone)}  ·  ${hhmm(first.start_at, zone)}–${hhmm(last.end_at, zone)} ${abbrev}` : 'Jadwal belum tersedia'}</p>
      </div>
      <div className="public-columns">
        <section className="public-rundown" aria-labelledby="public-rundown-title">
          <h2 id="public-rundown-title">Rundown acara</h2>
          <div className="public-card public-agenda">
            {data.items.length === 0 && <p className="public-agenda-empty">Rundown belum disiapkan.</p>}
            <ol>
              {data.items.map((item) => (
                <li key={item.id} className="public-agenda-row" data-live={item.status === 'in_progress' || undefined} data-status={item.status}>
                  <span className="public-agenda-time">{range(item, zone)}</span>
                  <span className="public-agenda-copy">
                    <span className="public-agenda-title">{item.title}{item.status === 'in_progress' && <span className="sr-only"> (sedang berlangsung)</span>}</span>
                    {description(item) && <span className="public-agenda-desc">{description(item)}</span>}
                  </span>
                  <span className="public-agenda-dur">{item.duration_min} menit</span>
                </li>
              ))}
            </ol>
          </div>
        </section>
        <aside className="public-aside" aria-label="Informasi pengunjung">
          <section className="public-card public-current" aria-label="Segmen saat ini">
            <span className="ripple-badge" data-tone="brand">{live ? 'SEDANG BERLANGSUNG' : next ? 'SEGMEN BERIKUTNYA' : 'ACARA SELESAI'}</span>
            <p className="public-current-title">{current?.title ?? 'Semua segmen selesai'}</p>
            {current && <p className="public-current-time">{range(current, zone)} {abbrev}</p>}
            <hr />
            <p className="public-current-label">Berikutnya</p>
            <p className="public-current-next">{(live ? next : afterCurrent)?.title ?? 'Tidak ada segmen berikutnya'}</p>
          </section>
          <section className="public-card public-notes">
            <h2>Informasi untuk pengunjung</h2>
            <p>Waktu dapat berubah mengikuti kondisi acara. Periksa kembali halaman ini sebelum sesi dimulai.</p>
            <h3>Lokasi acara</h3>
            <p>Akan diumumkan oleh penyelenggara.</p>
          </section>
        </aside>
      </div>
      <p className="public-footer">Semua waktu dalam {abbrev} ({utcLabel(data.server_now, zone)})</p>
    </div>
  </main>
}

function PublicHeader() {
  return <header className="public-header">
    <span className="public-brand"><Icon name="lancara-mark" size={22} />{BRAND_WORDMARK}</span>
  </header>
}
