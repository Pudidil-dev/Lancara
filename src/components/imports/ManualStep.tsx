'use client'
import { useState, type FormEvent } from 'react'
import { Dialog, Icon , Label, Textarea, Input, Button } from '@/components/ui'
import { RundownCellsView, RundownTable, minutesText } from '@/components/rundown/RundownTable'
import { manualDuration, manualRange, parseWaktu } from '@/modules/imports/manual'
import type { ManualRow } from '@/modules/imports/types'

export interface ManualDraftRow extends ManualRow { id: string }

interface FormState { waktu: string; title: string; durasi: string; pic: string; involved: string; equipment: string; notes: string }
const EMPTY: FormState = { waktu: '', title: '', durasi: '', pic: '', involved: '', equipment: '', notes: '' }

function toForm(row: ManualDraftRow): FormState {
  return {
    waktu: row.end_hhmm ? `${row.start_hhmm}–${row.end_hhmm}` : row.start_hhmm,
    title: row.title,
    durasi: row.duration_min ? String(row.duration_min) : '',
    pic: row.pic,
    involved: row.involved,
    equipment: row.equipment,
    notes: row.notes,
  }
}

/** Validasi ringan isian overlay; mengembalikan baris atau pesan galat per kolom. */
export function formToRow(form: FormState): { row: ManualRow } | { errors: Partial<Record<keyof FormState, string>> } {
  const errors: Partial<Record<keyof FormState, string>> = {}
  const waktu = parseWaktu(form.waktu)
  if (!waktu) errors.waktu = 'Isi jam mulai, mis. 15:30 atau 15:30–16:00.'
  if (!form.title.trim()) errors.title = 'Segmen wajib diisi.'
  const durasiText = form.durasi.trim().replace(/\s*(mnt|menit|m)$/i, '')
  const durasi = durasiText ? Number(durasiText) : null
  if (durasiText && (!Number.isInteger(durasi) || durasi! < 1 || durasi! > 1440)) errors.durasi = 'Durasi dalam menit (1–1440).'
  if (waktu && !durasiText && !waktu.end) errors.durasi = 'Isi durasi (menit) atau rentang waktu.'
  if (waktu?.end && durasi && manualDuration({ start_hhmm: waktu.start, end_hhmm: waktu.end, duration_min: null }) !== durasi) errors.durasi = 'Durasi tidak sama dengan rentang waktu.'
  if (Object.keys(errors).length || !waktu) return { errors }
  return {
    row: {
      start_hhmm: waktu.start,
      end_hhmm: waktu.end,
      duration_min: durasi,
      title: form.title.trim().slice(0, 120),
      pic: form.pic.trim().slice(0, 400),
      involved: form.involved.trim().slice(0, 1000),
      equipment: form.equipment.trim().slice(0, 2000),
      notes: form.notes.trim().slice(0, 2000),
    },
  }
}

function Field({ id, label, value, error, onChange, multiline = false, wide = false, placeholder }: { id: keyof FormState; label: string; value: string; error?: string; onChange: (v: string) => void; multiline?: boolean; wide?: boolean; placeholder?: string }) {
  const props = { id: `point-${id}`, value, placeholder, 'aria-invalid': error ? true : undefined, 'aria-describedby': error ? `point-${id}-error` : undefined }
  return (
    <div className="point-field" data-wide={wide || undefined}>
      <Label htmlFor={props.id}>{label}</Label>
      {multiline ? <Textarea {...props} maxLength={2000} onChange={(e) => onChange(e.target.value)} /> : <Input {...props} maxLength={id === 'involved' ? 1000 : 120} onChange={(e) => onChange(e.target.value)} />}
      {error && <span className="point-error" id={`point-${id}-error`}>{error}</span>}
    </div>
  )
}

/** Overlay "Tambahkan poin rundown" (Figma 179:2324). */
function PointDialog({ open, initial, onClose, onSubmit, onDelete }: { open: boolean; initial: ManualDraftRow | null; onClose: () => void; onSubmit: (row: ManualRow) => void; onDelete?: () => void }) {
  const [form, setForm] = useState<FormState>(initial ? toForm(initial) : EMPTY)
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({})
  const set = (key: keyof FormState) => (value: string) => setForm((f) => ({ ...f, [key]: value }))
  function submit(event: FormEvent) {
    event.preventDefault()
    const result = formToRow(form)
    if ('errors' in result) return setErrors(result.errors)
    onSubmit(result.row)
  }
  return (
    <Dialog open={open} title={initial ? 'Ubah poin rundown' : 'Tambahkan poin rundown'} onClose={onClose} className="point-dialog">
      <form className="point-form" onSubmit={submit} noValidate>
        <Field id="waktu" label="Waktu" value={form.waktu} error={errors.waktu} onChange={set('waktu')} placeholder="15:30–16:00" />
        <Field id="title" label="Segmen" value={form.title} error={errors.title} onChange={set('title')} />
        <Field id="durasi" label="Durasi" value={form.durasi} error={errors.durasi} onChange={set('durasi')} placeholder="Menit, mis. 30" />
        <Field id="pic" label="PIC" value={form.pic} onChange={set('pic')} />
        <Field id="involved" label="Pihak yang terlibat" value={form.involved} onChange={set('involved')} wide />
        <Field id="equipment" label="Perlengkapan" value={form.equipment} onChange={set('equipment')} multiline wide />
        <Field id="notes" label="Teknis" value={form.notes} onChange={set('notes')} multiline wide />
        <Button variant="default" type="submit" className="btn-gradient btn-block point-submit">{initial ? 'Simpan Poin' : 'Tambah Poin'}<Icon name={initial ? 'check' : 'plus'} /></Button>
        {onDelete && <Button variant="destructive" type="button" className="point-delete" onClick={onDelete}>Hapus poin ini</Button>}
      </form>
    </Dialog>
  )
}

let counter = 0
const newId = () => `p${Date.now().toString(36)}${(counter++).toString(36)}`

/** Langkah 2 isi manual "Siapkan Data" (Figma 179:1704): tabel rundown + overlay tambah/ubah poin. */
export function ManualStep({ title, rows, onChange }: { title: string; rows: ManualDraftRow[]; onChange: (rows: ManualDraftRow[]) => void }) {
  const [dialog, setDialog] = useState<{ mode: 'add' } | { mode: 'edit'; row: ManualDraftRow } | null>(null)
  const close = () => setDialog(null)
  const editing = dialog?.mode === 'edit' ? dialog.row : null
  return (
    <>
      <RundownTable title={title} count={rows.length} label="Poin rundown manual"
        action={<Button variant="default" type="button" className="btn-gradient" onClick={() => setDialog({ mode: 'add' })}>Tambah Poin<Icon name="plus" /></Button>}>
        {rows.length === 0 && <li className="rt-empty">Belum ada poin. Tekan “Tambah Poin” untuk mengisi rundown.</li>}
        {rows.map((row, index) => (
          <li key={row.id} className="rt-row">
            <div className="rt-grid">
              <span className="rt-no">{index + 1}.</span>
              <Button variant="ghost" type="button" className="rt-cells" aria-label={`Ubah poin ${index + 1}: ${row.title}`} onClick={() => setDialog({ mode: 'edit', row })}>
                <RundownCellsView cells={{
                  waktu: manualRange(row),
                  segmen: row.title,
                  durasi: minutesText(manualDuration(row) ?? 0),
                  pic: row.pic,
                  involved: row.involved,
                  equipment: row.equipment,
                  notes: row.notes,
                }} />
              </Button>
            </div>
          </li>
        ))}
      </RundownTable>
      {dialog && <PointDialog key={editing?.id ?? 'new'} open initial={editing} onClose={close}
        onSubmit={(row) => {
          onChange(editing ? rows.map((r) => (r.id === editing.id ? { ...row, id: r.id } : r)) : [...rows, { ...row, id: newId() }])
          close()
        }}
        onDelete={editing ? () => { onChange(rows.filter((r) => r.id !== editing.id)); close() } : undefined} />}
    </>
  )
}
