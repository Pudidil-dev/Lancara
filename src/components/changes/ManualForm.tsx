'use client'
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
  const initial = detail.change.confirmed_delta?.type !== 'revert_decision' ? detail.change.confirmed_delta : null
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
      {choices?.options?.length ? <div className="stack" role="radiogroup" aria-label={choices.message}>{choices.options.map(option => <label className="check-label" key={option.id}>
        <input type="radio" name="clarification-item" value={option.id} checked={itemId === option.id} onChange={() => setItemId(option.id)} />
        <span>{option.title} · {option.id} · {formatRange(option.start_at, option.end_at, timezone)}</span>
      </label>)}</div> : null}
      <div className="field"><label htmlFor="manual-item">Item (ID, judul, jadwal)</label><select id="manual-item" value={itemId} onChange={e => setItemId(e.target.value)} required>
        <option value="">Pilih item rundown</option>{detail.items.map(item => <option key={item.id} value={item.id}>{item.id} · {item.title} · {formatRange(item.start_at, item.estimated_end_at ?? addSeconds(item.start_at, item.duration_seconds), timezone)}</option>)}
      </select></div>
    </fieldset>
    <div className="field"><label htmlFor="manual-type">Jenis perubahan</label><select id="manual-type" value={type} onChange={e => setType(e.target.value as ManualDelta['type'])} disabled={disabled} required><option value="">Pilih jenis perubahan</option>{(['earliest_start', 'active_end_estimate', 'cancel_item'] as const).map(kind => <option value={kind} key={kind}>{CHANGE_TYPE_LABELS[kind]}</option>)}</select></div>
    {type && type !== 'cancel_item' && <div className="field"><label htmlFor="manual-value">{type === 'earliest_start' ? 'Mulai paling awal' : 'Estimasi selesai'} ({zoneAbbrev(timezone)})</label><input id="manual-value" type="datetime-local" value={value} onChange={e => setValue(e.target.value)} required disabled={disabled} aria-describedby="manual-value-note" /><p id="manual-value-note" className="muted">Isi jam absolut yang sudah dikonfirmasi kepada pelapor, termasuk untuk kabar relatif seperti “40 menit lagi”.</p></div>}
    <div className="field"><label htmlFor="manual-reference">Waktu acuan kabar ({zoneAbbrev(timezone)}){needsReference ? ' — wajib diklarifikasi' : ' — opsional'}</label><input id="manual-reference" type="datetime-local" value={reference} onChange={e => setReference(e.target.value)} required={needsReference} disabled={disabled} /></div>
    {type && type !== 'cancel_item' && <label className="check-label"><input type="checkbox" checked={estimate} onChange={e => setEstimate(e.target.checked)} disabled={disabled} /> Nilai ini merupakan perkiraan</label>}
    {validation && <p role="alert" className="alert alert-blocker">! {validation}</p>}
    <button className="btn btn-primary" type="submit" disabled={disabled || !complete}>{pending ? 'Menghitung dampak…' : 'Konfirmasi tafsiran'}</button>
  </form>
}
