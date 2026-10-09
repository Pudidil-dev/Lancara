import { formatRange } from '@/lib/time'
import type { ImpactLevel, RoleImpactEntry } from '@/modules/engine/types'

export interface BriefPayload {
  change_id: string
  change_seq: number
  version: number
  event_name: string
  timezone: string
  role_id: string
  role_label: string
  level: Exclude<ImpactLevel, 'BLOCKER' | 'UNCHANGED'>
  entries: RoleImpactEntry[]
  decision_reason: string
  approved_by: string
  kind: 'report' | 'correction' | 'compensation'
}

const LEVEL_LABEL = { ACTION_REQUIRED: 'AKSI DIPERLUKAN', FYI: 'INFO (FYI)' } as const

/** Template deterministik = brief resmi MVP (narasi AI tidak memengaruhi commit). */
export function renderBrief(p: BriefPayload): string {
  const lines = [
    `[${LEVEL_LABEL[p.level]}] CH-${p.change_seq} · Rundown v${p.version}`,
    `Untuk: ${p.role_label}`,
    ...p.entries.map((e) => {
      if (e.old && e.new) {
        const oldR = formatRange(e.old.start_at, e.old.end_at, p.timezone)
        const newR = e.status === 'cancelled' ? 'DIBATALKAN' : formatRange(e.new.start_at, e.new.end_at, p.timezone)
        return `• ${e.title}: Lama ${oldR} → Baru ${newR} (${e.reason})`
      }
      return `• ${e.title}: ${e.reason}`
    }),
    `Alasan koordinator: ${p.decision_reason}`,
    `Disetujui: ${p.approved_by}`,
    'Tekan "Sudah dibaca" setelah membaca. Dibaca ≠ aksi selesai.',
  ]
  return lines.join('\n')
}
