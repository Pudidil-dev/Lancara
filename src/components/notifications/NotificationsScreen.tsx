'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { ErrorState, Loading , Button } from '@/components/ui'
import { useEvent } from '@/hooks/useEvent'
import { useMutation } from '@/hooks/useMutation'
import { useOnline } from '@/hooks/useOnline'
import { usePolling } from '@/hooks/usePolling'
import type { NotificationCategory, NotificationFeed, NotificationItem } from '@/modules/notifications/feed'

/** Badge kategori (Ripple/Badge): label selalu tertulis, warna hanya penguat. */
const CATEGORY: Record<NotificationCategory, { label: string; tone: 'warning' | 'brand' | 'success' | 'neutral' }> = {
  review: { label: 'Perlu ditinjau', tone: 'warning' },
  change: { label: 'Perubahan', tone: 'brand' },
  crew: { label: 'Konfirmasi kru', tone: 'success' },
  reminder: { label: 'Pengingat', tone: 'neutral' },
  rundown: { label: 'Rundown', tone: 'brand' },
  team: { label: 'Tim', tone: 'neutral' },
}

export function timeAgo(iso: string, nowMs: number): string {
  const minutes = Math.max(0, Math.floor((nowMs - Date.parse(iso)) / 60_000))
  if (minutes < 1) return 'Baru saja'
  if (minutes < 60) return `${minutes} menit lalu`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} jam lalu`
  return `${Math.floor(hours / 24)} hari lalu`
}

function Row({ item, now, onOpen }: { item: NotificationItem; now: number; onOpen: (item: NotificationItem) => void }) {
  const category = CATEGORY[item.category]
  return (
    <li>
      <Button variant="ghost" type="button" className="notif-row" data-unread={item.unread || undefined} onClick={() => onOpen(item)}>
        <span className="notif-copy">
          <span className="notif-title">
            <span className="notif-title-text">{item.title}</span>
            {item.unread && <span className="notif-dot"><span className="sr-only">Belum dibaca</span></span>}
          </span>
          <span className="notif-desc">{item.description}</span>
        </span>
        <span className="notif-meta">
          <span className="ripple-badge" data-tone={category.tone}>{category.label}</span>
          <time className="notif-time" dateTime={item.at}>{timeAgo(item.at, now)}</time>
        </span>
      </Button>
    </li>
  )
}

/** Halaman Notifikasi (Figma 221:464 kosong, 221:465 belum dibaca, 221:466 sudah dibaca). */
export function NotificationsScreen() {
  const { eventId } = useEvent()
  const router = useRouter()
  const online = useOnline()
  const feed = usePolling<NotificationFeed>(eventId ? `/api/events/${eventId}/notifications/feed` : null, { intervalMs: 15000 })
  const read = useMutation()
  const [filter, setFilter] = useState<'all' | 'unread'>('all')

  if (!feed.data) return feed.error ? <ErrorState error={feed.error} onRetry={feed.refresh} /> : <Loading label="Memuat notifikasi…" />
  const { items, unread } = feed.data
  const visible = filter === 'unread' ? items.filter((item) => item.unread) : items
  const now = Date.now()
  const readPath = `/api/events/${eventId}/notifications/read`

  async function open(item: NotificationItem) {
    if (item.unread && online) {
      try { await read.mutate({ path: readPath, body: { keys: [item.key] }, idempotent: false }) } catch { /* Navigasi tetap jalan; status baca dicoba lagi lain kali. */ }
    }
    router.push(item.href)
  }
  async function markAll() {
    try { await read.mutate({ path: readPath, body: { all: true }, idempotent: false }) } catch { /* Error ditampilkan di bawah filter. */ }
  }

  return (
    <div className="notif-page">
      <div className="notif-heading">
        <div className="notif-heading-title">
          <h1>Notifikasi</h1>
          <span className="ripple-badge" data-tone={unread ? 'brand' : 'neutral'}>{unread} belum dibaca</span>
        </div>
        <p>Pantau perubahan rundown, konfirmasi kru, dan pengingat acara.</p>
      </div>
      <div className="notif-actions">
        <div className="notif-filters" role="group" aria-label="Saring notifikasi">
          <Button variant="ghost" type="button" className="ripple-btn" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Semua ({items.length})</Button>
          <Button variant="ghost" type="button" className="ripple-btn" aria-pressed={filter === 'unread'} onClick={() => setFilter('unread')}>Belum dibaca ({unread})</Button>
        </div>
        <Button variant="ghost" type="button" className="ripple-btn" disabled={!unread || read.pending || !online} onClick={() => void markAll()}>{read.pending ? 'Menandai…' : 'Tandai semua dibaca'}</Button>
      </div>
      {read.error && <ErrorState error={read.error} />}
      {visible.length
        ? <ul className="notif-list" aria-label={filter === 'unread' ? 'Notifikasi belum dibaca' : 'Semua notifikasi'}>
            {visible.map((item) => <Row key={item.key} item={item} now={now} onOpen={(target) => void open(target)} />)}
          </ul>
        : <div className="notif-list notif-empty">
            <strong>{filter === 'unread' && items.length ? 'Semua notifikasi sudah dibaca' : 'Belum ada notifikasi'}</strong>
            <p>{filter === 'unread' && items.length ? 'Notifikasi baru akan muncul di sini dengan tanda titik ungu.' : 'Perubahan rundown, konfirmasi kru, dan pengingat acara akan muncul di sini.'}</p>
          </div>}
    </div>
  )
}
