'use client'
import { useState, type FormEvent } from 'react'
import { Icon } from '@/components/ui'
import { BREAK_PATTERN } from '@/modules/engine/schedule'
import type { RoleRef } from '@/modules/engine/types'
import type { ImportRecord, ImportRow } from '@/modules/imports/types'

const COLLAPSED_ROWS = 6
const lines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 20)

/** Ringkasan kolom PERLENGKAPAN/TEKNIS saat baris tertutup (Figma: Terkunci / Perlu ditinjau / Terjadwal). */
function rowState(row: ImportRow): { text: string; tone?: 'warning' } {
  if (row.flags.length) return { text: 'Perlu ditinjau', tone: 'warning' }
  if (row.fixed_start || BREAK_PATTERN.test(row.title)) return { text: 'Terkunci' }
  return { text: 'Terjadwal' }
}

function subtitle(row: ImportRow): string {
  const kind = row.fixed_start ? 'Mulai tetap' : row.segment || (BREAK_PATTERN.test(row.title) ? 'Istirahat' : 'Main stage')
  return `${kind} · Segmen ${String(row.row_no).padStart(2, '0')}`
}

function RowEditor({ row, roles, busy, onSave, onDelete }: { row: ImportRow; roles: RoleRef[]; busy: boolean; onSave: (row: ImportRow) => void; onDelete: () => void }) {
  const [draft, setDraft] = useState({ title: row.title, segment: row.segment ?? '', start: row.start_hhmm, duration: String(row.duration_min), pic: row.pic_role_ids, equipment: row.equipment.join('\n'), notes: row.notes.join('\n'), fixed: row.fixed_start })
  const id = `row-${row.row_no}`
  const duration = Number(draft.duration)
  const valid = draft.title.trim() && /^\d{2}:\d{2}$/.test(draft.start) && Number.isInteger(duration) && duration >= 1 && duration <= 1440
  function submit(event: FormEvent) {
    event.preventDefault()
    if (!valid) return
    onSave({ ...row, title: draft.title.trim().slice(0, 120), segment: draft.segment.trim().slice(0, 80) || null, start_hhmm: draft.start, duration_min: duration, pic_role_ids: draft.pic, equipment: lines(draft.equipment), notes: lines(draft.notes), fixed_start: draft.fixed })
  }
  return (
    <form className="review-editor" onSubmit={submit} aria-label={`Lengkapi ${row.title}`}>
      {row.flags.length > 0 && <ul className="review-flags">{row.flags.map((f) => <li key={f.code}>{f.message}</li>)}</ul>}
      <div className="review-editor-grid">
        <div className="field"><label htmlFor={`${id}-title`}>Segmen</label><input id={`${id}-title`} value={draft.title} maxLength={120} required onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></div>
        <div className="field"><label htmlFor={`${id}-start`}>Jam mulai</label><input id={`${id}-start`} type="time" value={draft.start} required onChange={(e) => setDraft({ ...draft, start: e.target.value })} /></div>
        <div className="field"><label htmlFor={`${id}-dur`}>Durasi (menit)</label><input id={`${id}-dur`} type="number" min={1} max={1440} value={draft.duration} required onChange={(e) => setDraft({ ...draft, duration: e.target.value })} /></div>
      </div>
      <div className="field"><label htmlFor={`${id}-seg`}>Tipe segmen</label><input id={`${id}-seg`} value={draft.segment} maxLength={80} placeholder="Main stage, Performance, Diskusi…" onChange={(e) => setDraft({ ...draft, segment: e.target.value })} /></div>
      <fieldset className="role-chips">
        <legend>PIC {row.pic_names.length > 0 && <span className="muted">(tertulis: {row.pic_names.join(', ')})</span>}</legend>
        {roles.map((r) => <label key={r.id}><input type="checkbox" checked={draft.pic.includes(r.id)} onChange={(e) => setDraft({ ...draft, pic: e.target.checked ? [...draft.pic, r.id] : draft.pic.filter((x) => x !== r.id) })} />{r.label}</label>)}
      </fieldset>
      <div className="review-editor-grid">
        <div className="field"><label htmlFor={`${id}-eq`}>Perlengkapan (satu per baris)</label><textarea id={`${id}-eq`} value={draft.equipment} onChange={(e) => setDraft({ ...draft, equipment: e.target.value })} /></div>
        <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor={`${id}-notes`}>Teknis (satu per baris)</label><textarea id={`${id}-notes`} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></div>
      </div>
      <label className="row"><input type="checkbox" checked={draft.fixed} onChange={(e) => setDraft({ ...draft, fixed: e.target.checked })} />Mulai tetap (tidak boleh digeser saat penyesuaian jadwal)</label>
      <div className="row">
        <button type="submit" className="btn-gradient" disabled={busy || !valid}>{busy ? 'Menyimpan…' : 'Simpan baris'}</button>
        <button type="button" className="btn btn-compact" disabled={busy} onClick={onDelete}>Hapus baris</button>
      </div>
    </form>
  )
}

/** Langkah 3 "Tinjau & lengkapi data rundown" (Figma 66:2949). */
export function ReviewStep({ record, eventName, roles, saving, onSaveRows }: { record: ImportRecord; eventName: string; roles: RoleRef[]; saving: boolean; onSaveRows: (rows: ImportRow[]) => Promise<boolean> }) {
  const [expanded, setExpanded] = useState(false)
  const [openRow, setOpenRow] = useState<number | null>(record.draft.rows[0]?.row_no ?? null)
  const [editing, setEditing] = useState<number | null>(null)
  const rows = record.draft.rows
  const shown = expanded ? rows : rows.slice(0, COLLAPSED_ROWS)
  const applied = record.status !== 'draft'
  async function save(next: ImportRow[], open: number | null) {
    if (await onSaveRows(next.map((r, i) => ({ ...r, row_no: i + 1 })))) { setOpenRow(open); setEditing(null) }
  }
  const pages = record.draft.source.pages_read
  return (
    <>
      {record.draft.warnings.map((w) => <p key={w} className="lc-alert" data-tone="warning">{w}</p>)}
      <section className="review-table" aria-labelledby="review-title">
        <div className="review-heading">
          <h2 id="review-title">#1 | {record.settings.name || eventName}</h2>
          {rows.length > COLLAPSED_ROWS && <button type="button" className="review-toggle" aria-expanded={expanded} aria-label={expanded ? 'Ringkas tabel' : 'Tampilkan semua item'} onClick={() => setExpanded((v) => !v)}><Icon name="chevrons-down-up" /></button>}
          <span className="review-count">{shown.length} dari {rows.length} item</span>
        </div>
        <p className="review-small" style={{ padding: '0 20px 12px', margin: 0 }}>
          Dibaca {record.draft.parser === 'ai' ? 'oleh AI Lancara' : 'dari pola tabel'} · {record.draft.source.filename} · halaman {pages.length > 3 ? `${pages[0]}–${pages[pages.length - 1]}` : pages.join(', ')}
        </p>
        <div className="review-grid review-cols" aria-hidden="true"><span>NO</span><span>WAKTU</span><span>SEGMEN</span><span>DURASI</span><span>PIC</span><span>PERLENGKAPAN</span><span>TEKNIS</span></div>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {shown.map((row) => {
            const open = openRow === row.row_no
            const state = rowState(row)
            const list = (values: string[]) => (values.length ? <ul>{values.map((v, i) => <li key={i}>{v}</li>)}</ul> : <span data-tone="warning">Belum diisi</span>)
            return <li key={row.row_no} className="review-row" data-open={open || undefined}>
              <button type="button" className="review-grid review-row-btn" aria-expanded={open} onClick={() => setOpenRow(open ? null : row.row_no)}>
                <span className="dash-index">{String(row.row_no).padStart(2, '0')}</span>
                <span className="review-time">{row.start_hhmm}</span>
                <span className="dash-seg"><span className="dash-seg-title">{row.title}</span><span className="dash-seg-sub">{subtitle(row)}</span></span>
                <span className="review-muted">{row.duration_min} m</span>
                <span className="review-muted">{row.pic_role_ids.length ? row.pic_role_ids.map((id) => roles.find((r) => r.id === id)?.label.replace(/^PIC\s+/i, '') ?? id).join(' / ') : row.pic_names.join(' / ') || '—'}</span>
                <span className="review-small" data-tone={open ? undefined : state.tone}>{open ? list(row.equipment) : state.text}</span>
                <span className="review-small" data-tone={open ? undefined : state.tone}>{open ? list(row.notes) : state.text}</span>
              </button>
              {open && !applied && editing !== row.row_no && <div className="review-row-flags">
                {row.flags.length > 0 && <ul className="review-flags">{row.flags.map((f) => <li key={f.code}>{f.message}</li>)}</ul>}
                <button type="button" className="review-edit-link" onClick={() => setEditing(row.row_no)}>Lengkapi data segmen ini</button>
              </div>}
              {open && !applied && editing === row.row_no && <RowEditor key={JSON.stringify(row)} row={row} roles={roles} busy={saving}
                onSave={(next) => void save(rows.map((r) => (r.row_no === row.row_no ? next : r)), row.row_no)}
                onDelete={() => void save(rows.filter((r) => r.row_no !== row.row_no), null)} />}
            </li>
          })}
        </ul>
      </section>
    </>
  )
}
