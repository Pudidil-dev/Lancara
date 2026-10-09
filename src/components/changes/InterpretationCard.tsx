import { StatusBadge } from '@/components/ui'
import { addSeconds, formatClock, formatRange, zoneAbbrev } from '@/lib/time'
import type { ChangeDetail } from './types'
import { CHANGE_TYPE_LABELS, interpretationOf } from './types'

export function InterpretationCard({ detail }: { detail: ChangeDetail }) {
  const interpretation = interpretationOf(detail)
  const delta = detail.change.confirmed_delta ?? interpretation?.delta
  const partial = delta ?? interpretation?.partial
  const item = partial && 'item_id' in partial ? detail.items.find(i => i.id === partial.item_id) : null
  const timezone = detail.event.timezone
  return <section className="card stack" aria-label="Ringkasan tafsiran">
    <h2>Tafsiran kabar</h2>
    {detail.change.kind === 'compensation' ? <p>Kompensasi membuat versi baru terhadap rundown terkini. Aktivitas yang sudah berlangsung tetap terkunci.</p> : <>
      <p><strong>Item:</strong> {partial?.type === 'revise_rundown' ? 'Rundown acara' : item ? `${item.id} · ${item.title}` : 'Perlu klarifikasi'}</p>
      {item && <p className="muted">Jadwal aktif {formatRange(item.start_at, item.estimated_end_at ?? addSeconds(item.start_at, item.duration_seconds), timezone)} {zoneAbbrev(timezone)}</p>}
      <p><strong>Jenis:</strong> {partial?.type ? CHANGE_TYPE_LABELS[partial.type] : 'Perlu klarifikasi'}</p>
      {partial && 'value' in partial && partial.value && <p><strong>Nilai:</strong> {formatClock(partial.value, timezone, detail.server_now)} {zoneAbbrev(timezone)}</p>}
      {partial?.is_estimate && <StatusBadge kind="FYI" label="Perkiraan" />}
    </>}
    {interpretation?.notes.length ? <ul>{interpretation.notes.map((note, index) => <li key={index}>{note}</li>)}</ul> : null}
    <p className="muted">Penafsir: {detail.change.parse_provider ?? interpretation?.provider ?? 'Form manual'}{detail.change.parse_ms !== null && ` · ${detail.change.parse_ms} ms`}</p>
  </section>
}
