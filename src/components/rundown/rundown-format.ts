import { formatClock } from '@/lib/time'
import { endMs } from '@/modules/engine/schedule'
import type { Item, Snapshot } from '@/modules/engine/types'
import type { RundownTone } from '@/components/ui'

/** Akhir efektif item: sesi aktif memakai estimasi selesai (sama dengan engine), bukan mulai + durasi rencana. */
export function itemEnd(item: Item): number {
  return endMs(item)
}

export function minutesLabel(seconds: number): string {
  return `${Math.round(seconds / 60)} m`
}

export function roleNames(ids: string[], snapshot: Snapshot): string[] {
  return ids.map((id) => snapshot.roles.find((r) => r.id === id)?.label ?? id)
}

/** Figma menyingkat PIC ("Stage / Audio"): buang awalan "PIC " dan gabung dengan " / ". */
export function picLabel(item: Item, snapshot: Snapshot): string {
  const names = roleNames(item.pic_role_ids, snapshot).map((n) => n.replace(/^PIC\s+/i, ''))
  return names.length ? names.join(' / ') : 'PIC belum diisi'
}

export function rowStatus(item: Item, snapshot: Snapshot): { text: string; tone: RundownTone } {
  if (item.status === 'in_progress') return { text: 'Berlangsung', tone: 'success' }
  if (item.status === 'completed') return { text: 'Selesai', tone: 'success' }
  if (item.status === 'cancelled') return { text: 'Dibatalkan', tone: 'danger' }
  const fixed = snapshot.constraints.some((c) => c.item_id === item.id && c.type === 'fixed_start')
  return { text: fixed ? 'Slot tetap' : 'Terjadwal', tone: 'muted' }
}

export function rowSubtitle(item: Item, snapshot: Snapshot): string {
  const zone = snapshot.event.timezone
  const parts: string[] = []
  if (item.status === 'in_progress' || item.status === 'completed') parts.push('Terkunci')
  for (const c of snapshot.constraints.filter((x) => x.item_id === item.id)) {
    parts.push(c.type === 'fixed_start' ? 'Mulai tetap' : `Paling awal ${formatClock(c.at, zone)}`)
  }
  if (item.status === 'pending' && item.swappable) parts.push('Boleh ditukar')
  parts.push(item.id)
  return parts.join(' · ')
}

export function countdown(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h} j ${pad(m)} mnt` : `${pad(m)}:${pad(s)}`
}

/** Perkiraan selesai = akhir terakhir dari item aktif (bukan dibatalkan). */
export function projectedFinishMs(snapshot: Snapshot): number {
  return snapshot.items.filter((i) => i.status !== 'cancelled').reduce((max, i) => Math.max(max, itemEnd(i)), Number.NEGATIVE_INFINITY)
}

export function productionRoleCount(snapshot: Snapshot): number {
  return new Set(snapshot.items.flatMap((i) => i.pic_role_ids)).size
}
