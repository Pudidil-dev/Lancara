import type { Violation } from '@/modules/engine/types'
import { formatClock, isValidIso } from '@/lib/time'
export function ConstraintAlert({ violations, title = 'DATA BELUM LENGKAP', timezone = 'Asia/Jakarta' }: { violations: Violation[]; title?: string; timezone?: string }) {
  const value = (v: string) => isValidIso(v) && v.includes('T') ? formatClock(v, timezone) : v
  if (!violations.length) return null
  return <section className="alert alert-blocker" role="alert"><h3>! {title}</h3><ul>{violations.map((v, i) => <li key={`${v.constraint_id}-${i}`}><strong>{v.constraint_id}</strong> · {v.message}{v.field && <span> · {v.field}</span>}{v.actual && <span> · Aktual: {value(v.actual)}</span>}{v.limit && <span> · Batas: {value(v.limit)}</span>}</li>)}</ul></section>
}
