import type { ItemStatus } from '@/modules/engine/types'
export type BadgeKind = 'BLOCKER' | 'ACTION_REQUIRED' | 'FYI' | 'UNCHANGED' | 'APPROVED' | 'ACKNOWLEDGED' | 'PENDING_ACK' | 'OLD_REVISION' | 'STALE' | ItemStatus
const kinds: Record<BadgeKind, [string, string, string]> = {
  BLOCKER: ['blocker', '!', 'Batas dilanggar'], ACTION_REQUIRED: ['action', '!', 'AKSI DIPERLUKAN'], FYI: ['fyi', 'i', 'INFO'], UNCHANGED: ['unchanged', '−', 'Tidak berubah'],
  APPROVED: ['success', '✓', 'Disetujui'], ACKNOWLEDGED: ['success', '✓', 'Sudah dibaca'], PENDING_ACK: ['action', '○', 'Belum dibaca'], OLD_REVISION: ['unchanged', '↶', 'Brief versi lama'],
  STALE: ['action', '↻', 'Versi berubah'], pending: ['unchanged', '○', 'Belum mulai'], in_progress: ['fyi', '▶', 'Berlangsung'], completed: ['success', '✓', 'Selesai'], cancelled: ['blocker', '×', 'Dibatalkan'],
}
export function StatusBadge({ kind, label }: { kind: BadgeKind; label?: string }) {
  const [tone, icon, text] = kinds[kind]
  return <span className={`badge badge-${tone}`}><span aria-hidden="true">{icon}</span>{label ?? text}</span>
}
