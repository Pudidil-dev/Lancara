'use client'
import { useRef, useState, type FormEvent } from 'react'
import { Dialog, ErrorState, Icon , Label, Input, Textarea, Button } from '@/components/ui'
import { useOnline } from '@/hooks/useOnline'
import type { ApiError } from '@/lib/api-client'
import { BREAK_PATTERN } from '@/modules/engine/schedule'
import type { RoleRef } from '@/modules/engine/types'
import { splitPic } from '@/modules/events/pic'
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

function RowEditor({ row, roles, busy, error, onSave, onDelete, onCancel, onClearError }: { row: ImportRow; roles: RoleRef[]; busy: boolean; error: ApiError | null; onSave: (row: ImportRow) => void; onDelete: () => void; onCancel: () => void; onClearError: () => void }) {
  const [draft, setDraft] = useState({ title: row.title, segment: row.segment ?? '', start: row.start_hhmm, duration: String(row.duration_min), pic: row.pic_names.join(', '), equipment: row.equipment.join('\n'), notes: row.notes.join('\n'), fixed: row.fixed_start })
  const [confirmDelete, setConfirmDelete] = useState(false)
  const online = useOnline()
  const id = `row-${row.row_no}`
  const duration = Number(draft.duration)
  const valid = draft.title.trim() && /^([01]\d|2[0-3]):[0-5]\d$/.test(draft.start) && Number.isInteger(duration) && duration >= 1 && duration <= 1440
  function submit(event: FormEvent) {
    event.preventDefault()
    if (busy || !online || !valid || confirmDelete) return
    onSave({ ...row, title: draft.title.trim().slice(0, 120), segment: draft.segment.trim().slice(0, 80) || null, start_hhmm: draft.start, duration_min: duration, pic_names: splitPic(draft.pic), equipment: lines(draft.equipment), notes: lines(draft.notes), fixed_start: draft.fixed })
  }
  return (
    <form className="review-editor" onSubmit={submit} aria-label={`Lengkapi ${row.title}`}>
      {confirmDelete ? <div className="stack">
        <h3>Hapus segmen ini?</h3>
        <p><strong>{row.title}</strong> akan dihapus dari draft impor. Urutan segmen berikutnya akan diperbarui.</p>
      </div> : <>
      {row.flags.length > 0 && <ul className="review-flags">{row.flags.map((f) => <li key={f.code}>{f.message}</li>)}</ul>}
      <fieldset className="review-editor-fields" disabled={busy}>
      <div className="review-editor-grid">
        <div className="field"><Label htmlFor={`${id}-title`}>Segmen</Label><Input id={`${id}-title`} value={draft.title} maxLength={120} required onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></div>
        <div className="field"><Label htmlFor={`${id}-start`}>Jam mulai</Label><Input id={`${id}-start`} type="time" value={draft.start} required onChange={(e) => setDraft({ ...draft, start: e.target.value })} /></div>
        <div className="field"><Label htmlFor={`${id}-dur`}>Durasi (menit)</Label><Input id={`${id}-dur`} type="number" min={1} max={1440} value={draft.duration} required onChange={(e) => setDraft({ ...draft, duration: e.target.value })} /></div>
      </div>
      <div className="field"><Label htmlFor={`${id}-seg`}>Tipe segmen</Label><Input id={`${id}-seg`} value={draft.segment} maxLength={80} placeholder="Main stage, Performance, Diskusi…" onChange={(e) => setDraft({ ...draft, segment: e.target.value })} /></div>
      <div className="field"><Label htmlFor={`${id}-pic`}>PIC</Label><Input id={`${id}-pic`} value={draft.pic} maxLength={200} placeholder="Tulis bebas, mis. Sidiq, Audio" onChange={(e) => setDraft({ ...draft, pic: e.target.value })} /></div>
      <div className="review-editor-grid">
        <div className="field"><Label htmlFor={`${id}-eq`}>Perlengkapan (satu per baris)</Label><Textarea id={`${id}-eq`} value={draft.equipment} onChange={(e) => setDraft({ ...draft, equipment: e.target.value })} /></div>
        <div className="field review-editor-notes"><Label htmlFor={`${id}-notes`}>Teknis (satu per baris)</Label><Textarea id={`${id}-notes`} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></div>
      </div>
      <Label className="row"><Input type="checkbox" checked={draft.fixed} onChange={(e) => setDraft({ ...draft, fixed: e.target.checked })} />Mulai tetap (tidak boleh digeser saat penyesuaian jadwal)</Label>
      </fieldset>
      </>}
      {error && <ErrorState error={error} />}
      {!online && <p className="alert alert-action" role="status"><Icon name="alert" /> Tidak ada koneksi. Hubungkan internet untuk menyimpan perubahan.</p>}
      <div className="review-editor-actions">
        {confirmDelete ? <>
          <Button variant="outline" type="button" autoFocus className="btn" disabled={busy} onClick={() => { setConfirmDelete(false); onClearError() }}>Kembali ke form</Button>
          <Button variant="destructive" type="button" className="btn btn-danger" disabled={busy || !online} onClick={onDelete}>{busy ? 'Menghapus…' : 'Ya, hapus baris'}</Button>
        </> : <>
          <Button variant="outline" type="button" className="btn" disabled={busy} onClick={onCancel}>Batal</Button>
          <Button variant="destructive" type="button" className="btn btn-danger" disabled={busy || !online} onClick={() => { setConfirmDelete(true); onClearError() }}>Hapus baris</Button>
          <Button variant="default" type="submit" className="btn btn-primary" disabled={busy || !online || !valid}>{busy ? 'Menyimpan…' : 'Simpan baris'}</Button>
        </>}
      </div>
    </form>
  )
}

/** Langkah 3 "Tinjau & lengkapi data rundown" (Figma 66:2949). */
export function ReviewStep({ record, eventName, roles, saving, saveError, onClearError, onSaveRows }: { record: ImportRecord; eventName: string; roles: RoleRef[]; saving: boolean; saveError: ApiError | null; onClearError: () => void; onSaveRows: (rows: ImportRow[]) => Promise<boolean> }) {
  const [expanded, setExpanded] = useState(false)
  const [openRow, setOpenRow] = useState<number | null>(record.draft.rows[0]?.row_no ?? null)
  const [editing, setEditing] = useState<number | null>(null)
  const savingRef = useRef(false)
  const rows = record.draft.rows
  const shown = expanded ? rows : rows.slice(0, COLLAPSED_ROWS)
  const applied = record.status !== 'draft'
  const editingRow = rows.find(row => row.row_no === editing)
  async function save(next: ImportRow[], open: number | null) {
    if (saving || savingRef.current) return
    savingRef.current = true
    try {
      if (await onSaveRows(next.map((r, i) => ({ ...r, row_no: i + 1 })))) { setOpenRow(open); setEditing(null) }
    } finally { savingRef.current = false }
  }
  function closeEditor() {
    if (saving || savingRef.current) return
    setEditing(null)
    onClearError()
  }
  const pages = record.draft.source.pages_read
  return (
    <>
      {record.draft.warnings.map((w) => <p key={w} className="lc-alert" data-tone="warning">{w}</p>)}
      <section className="review-table" aria-labelledby="review-title">
        <div className="review-heading">
          <h2 id="review-title">#1 | {record.settings.name || eventName}</h2>
          <span className="review-count">{shown.length} dari {rows.length} item</span>
        </div>
        <p className="review-small" style={{ padding: '0 20px 12px', margin: 0 }}>
          {record.draft.parser === 'manual'
            ? `Diisi manual · ${rows.length} poin rundown`
            : <>Dibaca {record.draft.parser === 'ai' ? 'oleh AI Lancara' : 'dari pola tabel'} · {record.draft.source.filename} · halaman {pages.length > 3 ? `${pages[0]}–${pages[pages.length - 1]}` : pages.join(', ')}</>}
        </p>
        <div className="review-grid review-cols" aria-hidden="true"><span>NO</span><span>WAKTU</span><span>SEGMEN</span><span>DURASI</span><span>PIC</span><span>PERLENGKAPAN</span><span>TEKNIS</span></div>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {shown.map((row) => {
            const open = openRow === row.row_no
            const state = rowState(row)
            const list = (values: string[]) => (values.length ? <ul>{values.map((v, i) => <li key={i}>{v}</li>)}</ul> : <span data-tone="warning">Belum diisi</span>)
            return <li key={row.row_no} className="review-row" data-open={open || undefined}>
              <Button variant="ghost" type="button" className="review-grid review-row-btn" aria-expanded={open} onClick={() => setOpenRow(open ? null : row.row_no)}>
                <span className="dash-index">{String(row.row_no).padStart(2, '0')}</span>
                <span className="review-time">{row.start_hhmm}</span>
                <span className="dash-seg"><span className="dash-seg-title">{row.title}</span><span className="dash-seg-sub">{subtitle(row)}</span></span>
                <span className="review-muted">{row.duration_min} m</span>
                <span className="review-muted">{row.pic_role_ids.length ? row.pic_role_ids.map((id) => roles.find((r) => r.id === id)?.label.replace(/^PIC\s+/i, '') ?? id).join(' / ') : row.pic_names.join(' / ') || '—'}</span>
                <span className="review-small" data-tone={open ? undefined : state.tone}>{open ? list(row.equipment) : state.text}</span>
                <span className="review-small" data-tone={open ? undefined : state.tone}>{open ? list(row.notes) : state.text}</span>
              </Button>
              {open && !applied && <div className="review-row-flags">
                {row.flags.length > 0 && <ul className="review-flags">{row.flags.map((f) => <li key={f.code}>{f.message}</li>)}</ul>}
                <Button variant="outline" type="button" className="review-edit-link" aria-haspopup="dialog" onClick={() => { onClearError(); setEditing(row.row_no) }}>Lengkapi data segmen ini</Button>
              </div>}
            </li>
          })}
        </ul>
        {rows.length > COLLAPSED_ROWS && <Button variant="ghost" type="button" className="review-toggle" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          <Icon name={expanded ? 'chevrons-down-up' : 'chevron-down'} />{expanded ? 'Ringkas tabel' : `Tampilkan semua ${rows.length} item`}
        </Button>}
      </section>
      {editingRow && !applied && <Dialog open title={`Lengkapi ${editingRow.title}`} className="review-editor-dialog" busy={saving} onClose={closeEditor}>
        <RowEditor key={`${record.id}-${editingRow.row_no}`} row={editingRow} roles={roles} busy={saving} error={saveError} onClearError={onClearError} onCancel={closeEditor}
          onSave={(next) => void save(rows.map(row => row.row_no === editingRow.row_no ? next : row), editingRow.row_no)}
          onDelete={() => void save(rows.filter(row => row.row_no !== editingRow.row_no), null)} />
      </Dialog>}
    </>
  )
}
