'use client'

import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'
import { Dialog, Icon, StatusBadge, TimeDiff , Label, NativeSelect, NativeSelectOption, Button, Textarea } from '@/components/ui'
import { checkRequest, useMutation } from '@/hooks/useMutation'
import { useOnline } from '@/hooks/useOnline'
import { refreshQueries } from '@/hooks/usePolling'
import { ApiError } from '@/lib/api-client'
import { userErrorMessage } from '@/lib/error-feedback'
import { formatDuration, formatRange, zoneAbbrev } from '@/lib/time'
import type { ItemDiff } from '@/modules/engine/types'
import type { ApprovalResult } from '@/components/changes/types'

interface ConfigurationDiff { field: string; old: string; new: string }
interface ScheduleCandidate { patch_id: string; rank: number; label: string; diff: ItemDiff[]; configuration_diff?: ConfigurationDiff[] }
export interface ScheduleProposal {
  change_id: string
  href: string
  label: string
  applied?: boolean
  version?: number
  preview?: {
    base_version: number
    patch_id: string
    candidate_rank: number
    label: string
    timezone: string
    diff: ItemDiff[]
    configuration_diff?: ConfigurationDiff[]
    candidates?: ScheduleCandidate[]
  }
}

function ConfigurationChanges({ diff }: { diff?: ConfigurationDiff[] }) {
  if (!diff?.length) return null
  return <ul className="agent-preview-diff" aria-label="Pratinjau pengaturan acara">{diff.map((entry, index) => <li className="stack" key={`${entry.field}-${index}`}>
    <strong>{entry.field}</strong>
    <div className="time-diff"><span><small>Lama</small> {entry.old}</span><span aria-hidden="true">→</span><span><small>Baru</small> {entry.new}</span></div>
  </li>)}</ul>
}

function ScheduleDiff({ diff, timezone }: { diff: ItemDiff[]; timezone: string }) {
  return <ul className="agent-preview-diff" aria-label="Pratinjau perubahan jadwal">{diff.map(item => <li className="stack" key={item.item_id}>
    <strong>{item.title}</strong>
    {item.old ? <>
      <TimeDiff oldStart={item.old.start_at} oldEnd={item.old.end_at} newStart={item.new.start_at} newEnd={item.new.end_at} timezone={timezone} cancelled={item.new.status === 'cancelled'} />
      {item.old.duration_seconds !== item.new.duration_seconds && <p className="muted small">Durasi {formatDuration(item.old.duration_seconds)} → {formatDuration(item.new.duration_seconds)}</p>}
      {item.old.status !== item.new.status && <div className="row"><StatusBadge kind={item.old.status} /><span aria-hidden="true">→</span><StatusBadge kind={item.new.status} /></div>}
    </> : <p><Icon name="plus" /> Item baru · {formatRange(item.new.start_at, item.new.end_at, timezone)}</p>}
    {item.details?.map(detail => <p className="small" key={detail.field}>{detail.field}: {detail.old} → {detail.new}</p>)}
  </li>)}</ul>
}

export function SchedulePreview({ proposal, canConfirm }: { proposal: ScheduleProposal; canConfirm: boolean }) {
  const preview = proposal.preview
  const uid = useId()
  const mutation = useMutation()
  const online = useOnline()
  const [open, setOpen] = useState(false)
  const [selectedId, setSelectedId] = useState(preview?.patch_id ?? '')
  const [reason, setReason] = useState('Rekomendasi AI Agent disetujui koordinator')
  const [committed, setCommitted] = useState<ApprovalResult | null>(null)
  const [failure, setFailure] = useState<ApiError | null>(null)
  const [recovery, setRecovery] = useState<'idle' | 'checking' | 'retry' | 'unknown'>('idle')
  const attempted = useRef<{ patch_id: string; base_version: number; reason: string } | null>(null)
  const reconciledKey = useRef<string | null>(null)
  const submissionBusy = useRef(false)

  function finish(result: ApprovalResult, needsRefresh = true) {
    setCommitted(result)
    setOpen(false)
    setRecovery('idle')
    setFailure(null)
    attempted.current = null
    mutation.reset()
    if (needsRefresh) refreshQueries()
  }

  async function reconcile(key: string) {
    setRecovery('checking')
    try {
      const status = await checkRequest<ApprovalResult>(key)
      if (status.status === 'committed') finish(status.result)
      else setRecovery('retry')
    } catch { setRecovery('unknown') }
  }

  useEffect(() => {
    if (recovery !== 'checking' || !mutation.key || reconciledKey.current === mutation.key) return
    reconciledKey.current = mutation.key
    void reconcile(mutation.key)
    // Reconciliation is tied to the failed intent's key; never creates a new mutation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mutation.key, recovery])

  if (!preview) return null
  const candidates = preview.candidates?.length ? preview.candidates : [{ patch_id: preview.patch_id, rank: preview.candidate_rank, label: preview.label, diff: preview.diff, configuration_diff: preview.configuration_diff }]
  const selected = candidates.find(candidate => candidate.patch_id === selectedId) ?? candidates[0]
  const stale = failure?.code === 'STALE_VERSION' || failure?.code === 'CONTEXT_CHANGED'
  const busy = mutation.pending || recovery === 'checking'
  const unresolved = recovery !== 'idle'

  async function approve() {
    if (!preview || !canConfirm || !online || stale || submissionBusy.current || recovery === 'unknown') return
    submissionBusy.current = true
    const body = attempted.current ?? { patch_id: selected.patch_id, base_version: preview.base_version, reason: reason.trim() }
    attempted.current = body
    setFailure(null)
    try {
      finish(await mutation.mutate<ApprovalResult>({ path: `/api/changes/${encodeURIComponent(proposal.change_id)}/approve`, body }), false)
    } catch (error) {
      const fault = error instanceof ApiError ? error : new ApiError('NETWORK', 'Status perubahan belum diketahui.', 0, null, null)
      setFailure(fault)
      if (['TIMEOUT', 'NETWORK', 'INVALID_RESPONSE', 'STORAGE_UNAVAILABLE'].includes(fault.code)) {
        reconciledKey.current = null
        setRecovery('checking')
      } else setRecovery('idle')
    } finally { submissionBusy.current = false }
  }

  return <section className="agent-preview stack" aria-label="Rekomendasi rundown">
    <div className="row"><Icon name={committed ? 'check' : 'calendar-days'} /><strong>{committed ? `Rundown diperbarui ke v${committed.new_version}` : 'Rekomendasi siap dikonfirmasi'}</strong></div>
    {committed ? <p role="status">Perubahan tersimpan · {committed.briefs} brief perubahan dibuat.</p> : <>
      <p className="muted small">Pratinjau v{preview.base_version} → v{preview.base_version + 1} · {zoneAbbrev(preview.timezone)}</p>
      {candidates.length > 1 ? <div className="field"><Label htmlFor={`${uid}-candidate`}>Rekomendasi jadwal</Label><NativeSelect id={`${uid}-candidate`} value={selected.patch_id} disabled={busy || unresolved || stale} onChange={event => { mutation.reset(); attempted.current = null; setSelectedId(event.target.value) }}>
        {candidates.map(candidate => <NativeSelectOption key={candidate.patch_id} value={candidate.patch_id}>Opsi {candidate.rank}: {candidate.label}</NativeSelectOption>)}
      </NativeSelect></div> : <p><strong>{selected.label}</strong></p>}
      <ScheduleDiff diff={selected.diff} timezone={preview.timezone} />
      <ConfigurationChanges diff={selected.configuration_diff ?? (selected.patch_id === preview.patch_id ? preview.configuration_diff : undefined)} />
      <p className="muted small"><Icon name="lock" /> Rundown aktif berubah setelah koordinator mengonfirmasi.</p>
      {stale && <p className="alert alert-action" role="alert"><Icon name="alert" /> Rundown sudah berubah. Minta AI Agent menganalisis ulang untuk menyiapkan rekomendasi terbaru.</p>}
      {canConfirm ? <Button variant="default" type="button" className="btn btn-primary btn-full" disabled={!online || busy || stale} onClick={() => setOpen(true)}><Icon name="check" /> Konfirmasi perubahan rundown</Button>
        : <p className="muted small"><Icon name="lock" /> Menunggu konfirmasi koordinator.</p>}
    </>}
    <Link href={proposal.href}>Lihat rincian perubahan</Link>
    <Dialog open={open} title="Konfirmasi perubahan rundown" onClose={() => setOpen(false)} busy={busy}>
      <form className="stack" onSubmit={event => { event.preventDefault(); void approve() }}>
        <p><strong>{selected.label}</strong> · v{preview.base_version} → v{preview.base_version + 1}</p>
        <ScheduleDiff diff={selected.diff} timezone={preview.timezone} />
        <ConfigurationChanges diff={selected.configuration_diff ?? (selected.patch_id === preview.patch_id ? preview.configuration_diff : undefined)} />
        <div className="field"><Label htmlFor={`${uid}-reason`}>Alasan persetujuan</Label><Textarea id={`${uid}-reason`} value={reason} minLength={3} maxLength={500} required rows={2} disabled={busy || unresolved} onChange={event => { attempted.current = null; setReason(event.target.value) }} /></div>
        <p className="muted">Konfirmasi akan menyimpan rundown baru dan membuat brief untuk peran terdampak.</p>
        {failure && recovery === 'idle' && <p className="alert alert-action" role="alert"><Icon name="alert" /> {stale ? 'Rundown sudah berubah. Minta analisis ulang sebelum mengonfirmasi.' : userErrorMessage(failure, 'write')}</p>}
        <div aria-live="polite">{mutation.pending && <p><Icon name="calendar-days" /> Menyimpan perubahan rundown…</p>}
          {recovery === 'checking' && <p><Icon name="calendar-days" /> Memeriksa status perubahan…</p>}
          {recovery === 'retry' && <p><Icon name="alert" /> Penyimpanan belum tercatat. Coba kembali dengan permintaan yang sama.</p>}
          {recovery === 'unknown' && <p><Icon name="alert" /> Status belum diketahui. Periksa status sebelum mencoba kembali.</p>}
        </div>
        <div className="row">
          <Button variant="outline" type="button" className="btn" disabled={busy} onClick={() => setOpen(false)}>Kembali</Button>
          {recovery === 'unknown' ? <Button variant="default" type="button" className="btn btn-primary" disabled={!online || !mutation.key} onClick={() => mutation.key && void reconcile(mutation.key)}>Periksa status</Button>
            : <Button variant="default" type="submit" className="btn btn-primary" disabled={!canConfirm || !online || busy || stale || reason.trim().length < 3}><Icon name="check" /> {recovery === 'retry' ? 'Coba simpan kembali' : 'Ya, ubah rundown'}</Button>}
        </div>
      </form>
    </Dialog>
  </section>
}
