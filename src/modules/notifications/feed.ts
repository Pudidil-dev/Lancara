// Feed halaman Notifikasi (Figma 221:464–466). Fungsi murni: dipakai service dan diuji tanpa database.
import { formatClock, toMs } from '@/lib/time'
import type { RoleImpactEntry, Snapshot } from '@/modules/engine/types'

export const NOTIFICATION_CATEGORIES = ['review', 'change', 'crew', 'reminder', 'rundown', 'team'] as const
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]

export interface NotificationItem {
  key: string
  category: NotificationCategory
  title: string
  description: string
  /** ISO UTC; urutan feed dan label "N menit lalu". */
  at: string
  href: string
  unread: boolean
}

export interface NotificationFeed {
  items: NotificationItem[]
  unread: number
  total: number
}

/** Segmen yang dimulai dalam jendela ini (menit, jam acara) menjadi "Pengingat". */
export const REMINDER_WINDOW_MIN = 30
export const FEED_LIMIT = 60

const hhmm = (iso: string, tz: string) => formatClock(iso, tz).replace('.', ':')
export const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text)

/**
 * Pengingat segmen pending yang mulai ≤ 30 menit lagi menurut jam acara (bisa jam simulasi).
 * Waktu notifikasi dipetakan ke jam nyata: saat pengingat "berbunyi" = mulai − 30 menit.
 */
export function reminderNotifications(snapshot: Snapshot, eventNowIso: string, realNowMs: number): Omit<NotificationItem, 'unread'>[] {
  const now = toMs(eventNowIso)
  const tz = snapshot.event.timezone
  return snapshot.items
    .filter((item) => item.status === 'pending')
    .filter((item) => {
      const start = toMs(item.start_at)
      return start > now && start - now <= REMINDER_WINDOW_MIN * 60_000
    })
    .map((item) => {
      const firedAt = toMs(item.start_at) - REMINDER_WINDOW_MIN * 60_000
      return {
        key: `reminder:${item.id}:${item.start_at}`.slice(0, 120),
        category: 'reminder' as const,
        title: `${clip(item.title, 80)} segera dimulai`,
        description: `Segmen dimulai pukul ${hhmm(item.start_at, tz)}. Pastikan PIC dan perlengkapan siap.`,
        at: new Date(realNowMs - Math.max(0, now - firedAt)).toISOString(),
        href: '/rundown',
      }
    })
}

/** Judul/deskripsi keputusan dari entri brief pertama yang punya jam lama dan baru. */
export function decisionCopy(input: { entries: RoleImpactEntry[]; timezone: string; approvedBy: string; newVersion: number; changeSeq: number; reason: string }): { title: string; description: string } {
  const moved = input.entries.find((e) => e.old && e.new && e.status !== 'cancelled' && e.old.start_at !== e.new.start_at)
  if (moved?.old && moved.new) {
    return {
      title: `Jadwal ${clip(moved.title, 80)} diperbarui`,
      description: `Waktu bergeser dari ${hhmm(moved.old.start_at, input.timezone)} ke ${hhmm(moved.new.start_at, input.timezone)}. Perubahan disetujui ${input.approvedBy}.`,
    }
  }
  const cancelled = input.entries.find((e) => e.status === 'cancelled')
  if (cancelled) return { title: `${clip(cancelled.title, 80)} dibatalkan`, description: `Segmen dibatalkan pada Rundown v${input.newVersion}. Perubahan disetujui ${input.approvedBy}.` }
  return { title: `Rundown v${input.newVersion} diperbarui (CH-${input.changeSeq})`, description: clip(`${input.reason} · Disetujui ${input.approvedBy}.`, 200) }
}

/** Gabungkan sumber, urutkan terbaru, potong, dan tandai belum dibaca. */
export function buildFeed(sources: Omit<NotificationItem, 'unread'>[], readKeys: ReadonlySet<string>, filter: 'all' | 'unread' = 'all'): NotificationFeed {
  const seen = new Set<string>()
  const all = sources
    .filter((item) => (seen.has(item.key) ? false : (seen.add(item.key), true)))
    .sort((a, b) => toMs(b.at) - toMs(a.at) || a.key.localeCompare(b.key))
    .slice(0, FEED_LIMIT)
    .map((item) => ({ ...item, unread: !readKeys.has(item.key) }))
  const unread = all.filter((item) => item.unread).length
  return { items: filter === 'unread' ? all.filter((item) => item.unread) : all, unread, total: all.length }
}
