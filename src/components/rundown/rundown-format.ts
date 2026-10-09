import { endMs } from '@/modules/engine/schedule'
import type { Item, Snapshot } from '@/modules/engine/types'

/** Akhir efektif item: sesi aktif memakai estimasi selesai (sama dengan engine), bukan mulai + durasi rencana. */
export function itemEnd(item: Item): number {
  return endMs(item)
}

export function roleNames(ids: string[], snapshot: Snapshot): string[] {
  return ids.map((id) => snapshot.roles.find((r) => r.id === id)?.label ?? id)
}

/** Figma menyingkat PIC ("Stage / Audio"): buang awalan "PIC " dan gabung dengan " / ". */
export function picLabel(item: Item, snapshot: Snapshot): string {
  const names = roleNames(item.pic_role_ids, snapshot).map((n) => n.replace(/^PIC\s+/i, ''))
  return names.length ? names.join(' / ') : 'PIC belum diisi'
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
