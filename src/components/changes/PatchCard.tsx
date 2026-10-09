import { StatusBadge, TimeDiff } from '@/components/ui'
import { formatDuration } from '@/lib/time'
import type { Patch } from './types'
import styles from './changes.module.css'

export function PatchCard({ patch, timezone, selected, onSelect, disabled }: { patch: Patch; timezone: string; selected: boolean; onSelect?: () => void; disabled: boolean }) {
  return <article className={`card stack ${styles.patch} ${selected ? styles.selected : ''}`} aria-label={`Opsi ${patch.rank}: ${patch.label}`}>
    <div className="row between"><span className="eyebrow">OPSI {patch.rank}</span>{selected && <StatusBadge kind="FYI" label="Dipilih" />}</div>
    <h2>{patch.label}</h2>
    <p className="muted">Kandidat <code>{patch.candidate_id}</code></p>
    <p>{patch.items_changed} item berubah · total geser {formatDuration(patch.total_shift_seconds)}</p>
    <div>{patch.diff.map(diff => <div className={styles.diff} key={diff.item_id}>
      <h3>{diff.title}</h3><p className="muted">{diff.item_id}</p>
      <TimeDiff oldStart={diff.old.start_at} oldEnd={diff.old.end_at} newStart={diff.new.start_at} newEnd={diff.new.end_at} timezone={timezone} cancelled={diff.new.status === 'cancelled'} />
      {diff.old.duration_seconds !== diff.new.duration_seconds && <p className="muted">Durasi {formatDuration(diff.old.duration_seconds)} → {formatDuration(diff.new.duration_seconds)}</p>}
      {diff.old.status !== diff.new.status && <div className="row"><StatusBadge kind={diff.old.status} /><span aria-hidden="true">→</span><StatusBadge kind={diff.new.status} /></div>}
    </div>)}</div>
    <details><summary>Dampak per peran ({patch.impact.length})</summary><div className="stack">{patch.impact.map(role => <section key={role.role_id} className={styles.diff}>
      <div className="row"><strong>{role.role_label}</strong><StatusBadge kind={role.level} /></div>
      {role.entries.length ? <ul>{role.entries.map((entry, i) => <li key={`${entry.item_id}-${i}`}>
        <strong>{entry.title}</strong> · {entry.reason}{entry.dependency_id && <span> · {entry.dependency_id}</span>}
        {entry.old && entry.new && <TimeDiff oldStart={entry.old.start_at} oldEnd={entry.old.end_at} newStart={entry.new.start_at} newEnd={entry.new.end_at} timezone={timezone} cancelled={entry.status === 'cancelled'} />}
      </li>)}</ul> : <p className="muted">Tidak ada perubahan untuk peran ini; tidak menerima brief.</p>}
    </section>)}</div></details>
    {onSelect && <button type="button" className={`btn btn-full ${selected ? 'btn-primary' : ''}`} aria-pressed={selected} onClick={onSelect} disabled={disabled}>{selected ? 'Opsi dipilih' : 'Pilih opsi ini'}</button>}
  </article>
}
