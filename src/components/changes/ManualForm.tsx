'use client'
import { Label, Input, NativeSelect, NativeSelectOption, Button } from '@/components/ui'

import { useState, type FormEvent } from 'react'
import { addSeconds, formatClock, formatRange, localDate, localToUtc, zoneAbbrev } from '@/lib/time'
import type { ChangeDetail, ManualDelta } from './types'
import { CHANGE_TYPE_LABELS, interpretationOf } from './types'
import styles from './changes.module.css'

export function localInput(iso: string, timezone: string) {
  return `${localDate(iso, timezone)}T${formatClock(iso, timezone).replace('.', ':')}`
}
export function inputToIso(value: string, timezone: string) {
  const [date, time] = value.split('T')
  if (!date || !time) throw new Error('Tanggal dan jam belum lengkap.')
  return localToUtc(date, time, timezone)
}
export function ManualForm({ detail, disabled, pending, onConfirm }: { detail: ChangeDetail; disabled: boolean; pending: boolean; onConfirm: (delta: ManualDelta) => Promise<void> }) {
  const interpretation = interpretationOf(detail)
  const delta = detail.change.confirmed_delta
  const initial = delta && delta.type !== 'revert_decision' && delta.type !== 'revise_rundown' && delta.type !== 'configure_event' ? delta : null
  const partial = initial ?? interpretation?.partial
  const timezone = detail.event.timezone
  const [type, setType] = useState<ManualDelta['type'] | ''>(partial?.type ?? '')
  const [itemId, setItemId] = useState(partial?.item_id ?? '')
  const [value, setValue] = useState(partial && 'value' in partial && partial.value ? localInput(partial.value, timezone) : '')
  const [reference, setReference] = useState(detail.change.reference_at ? localInput(detail.change.reference_at, timezone) : '')
  const [estimate, setEstimate] = useState(partial?.is_estimate ?? false)
  const [validation, setValidation] = useState('')
  const needsReference = interpretation?.questions.some(q => q.kind === 'reference_at') ?? false
  const choices = interpretation?.questions.find(q => q.kind === 'item')
  const complete = !!itemId && !!type && (type === 'cancel_item' || !!value) && (!needsReference || !!reference)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (disabled || !type || !itemId) return
    setValidation('')
    try {
      const reference_at = reference ? inputToIso(reference, timezone) : null
      const delta: ManualDelta = type === 'cancel_item'
        ? { type, item_id: itemId, is_estimate: false, reference_at }
        : { type, item_id: itemId, value: inputToIso(value, timezone), is_estimate: estimate, reference_at }
      await onConfirm(delta)
    } catch (error) {
      setValidation((error as Error).message)
    }
  }
  return <form onSubmit={submit} className="card stack" aria-label="Form tafsiran manual">
    <h2>Periksa dan konfirmasi tafsiran</h2>
    <p className="muted">Form manual selalu tersedia. Konfirmasi menghitung dampak; persetujuan keputusan dilakukan setelah opsi diperiksa.</p>
    {interpretation?.questions.length ? <div className="alert alert-action" id="clarification-questions"><h3>? Kabar perlu klarifikasi</h3><ul>{interpretation.questions.map(q => <li key={q.kind}>{q.message}</li>)}</ul></div> : null}
    <fieldset disabled={disabled} className={styles.question}><legend>Item rundown</legend>
      {choices?.options?.length ? <div className="stack" role="radiogroup" aria-label={choices.message}>{choices.options.map(option => <Label className="check-label" key={option.id}>
        <Input type="radio" name="clarification-item" value={option.id} checked={itemId === option.id} onChange={() => setItemId(option.id)} />
        <span>{option.title} · {option.id} · {formatRange(option.start_at, option.end_at, timezone)}</span>
      </Label>)}</div> : null}
      <div className="field"><Label htmlFor="manual-item">Item (ID, judul, jadwal)</Label><NativeSelect id="manual-item" value={itemId} onChange={e => setItemId(e.target.value)} required>
        <NativeSelectOption value="">Pilih item rundown</NativeSelectOption>{detail.items.map(item => <NativeSelectOption key={item.id} value={item.id}>{item.id} · {item.title} · {formatRange(item.start_at, item.estimated_end_at ?? addSeconds(item.start_at, item.duration_seconds), timezone)}</NativeSelectOption>)}
      </NativeSelect></div>
    </fieldset>
    <div className="field"><Label htmlFor="manual-type">Jenis perubahan</Label><NativeSelect id="manual-type" value={type} onChange={e => setType(e.target.value as ManualDelta['type'])} disabled={disabled} required><NativeSelectOption value="">Pilih jenis perubahan</NativeSelectOption>{(['earliest_start', 'active_end_estimate', 'cancel_item'] as const).map(kind => <NativeSelectOption value={kind} key={kind}>{CHANGE_TYPE_LABELS[kind]}</NativeSelectOption>)}</NativeSelect></div>
    {type && type !== 'cancel_item' && <div className="field"><Label htmlFor="manual-value">{type === 'earliest_start' ? 'Mulai paling awal' : 'Estimasi selesai'} ({zoneAbbrev(timezone)})</Label><Input id="manual-value" type="datetime-local" value={value} onChange={e => setValue(e.target.value)} required disabled={disabled} aria-describedby="manual-value-note" /><p id="manual-value-note" className="muted">Isi jam absolut yang sudah dikonfirmasi kepada pelapor, termasuk untuk kabar relatif seperti “40 menit lagi”.</p></div>}
    <div className="field"><Label htmlFor="manual-reference">Waktu acuan kabar ({zoneAbbrev(timezone)}){needsReference ? ' — wajib diklarifikasi' : ' — opsional'}</Label><Input id="manual-reference" type="datetime-local" value={reference} onChange={e => setReference(e.target.value)} required={needsReference} disabled={disabled} /></div>
    {type && type !== 'cancel_item' && <Label className="check-label"><Input type="checkbox" checked={estimate} onChange={e => setEstimate(e.target.checked)} disabled={disabled} /> Nilai ini merupakan perkiraan</Label>}
    {validation && <p role="alert" className="alert alert-blocker">! {validation}</p>}
    <Button variant="default" className="btn btn-primary" type="submit" disabled={disabled || !complete}>{pending ? 'Menghitung dampak…' : 'Konfirmasi tafsiran'}</Button>
  </form>
}
