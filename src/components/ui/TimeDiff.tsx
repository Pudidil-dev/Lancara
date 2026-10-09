import { formatRange } from '@/lib/time'
export function TimeDiff({ oldStart, oldEnd, newStart, newEnd, timezone, cancelled = false }: { oldStart: string; oldEnd: string; newStart: string; newEnd: string; timezone: string; cancelled?: boolean }) {
  return <div className="time-diff"><span><small>Lama</small> {formatRange(oldStart, oldEnd, timezone)}</span><span aria-hidden="true">→</span><span><small>Baru</small> {cancelled ? 'DIBATALKAN' : formatRange(newStart, newEnd, timezone)}</span></div>
}
