'use client'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { AppShell } from '@/components/shell/AppShell'
import { ConstraintAlert, Dialog, EmptyState, ErrorState, Loading, StatusBadge , Button, Label, Textarea } from '@/components/ui'
import { checkRequest, useMutation } from '@/hooks/useMutation'
import { useOnline } from '@/hooks/useOnline'
import { refreshQueries, usePolling } from '@/hooks/usePolling'
import { useSession } from '@/hooks/useSession'
import { ApiError, toApiError } from '@/lib/api-client'
import { userErrorMessage } from '@/lib/error-feedback'
import { formatClock, zoneAbbrev } from '@/lib/time'
import { InterpretationCard } from './InterpretationCard'
import { ManualForm } from './ManualForm'
import { PatchCard } from './PatchCard'
import type { ApprovalResult, ChangeDetail, ManualDelta } from './types'
import styles from './changes.module.css'

const asApiError = toApiError
type ApprovalIntent = { path: string; body: { patch_id: string; base_version: number; reason: string } }

export function ChangeDetailScreen({ id, initialParseError }: { id: string; initialParseError: string | null }) {
  const { session } = useSession()
  const query = usePolling<ChangeDetail>(session ? `/api/changes/${encodeURIComponent(id)}` : null)
  const online = useOnline()
  const action = useMutation()
  const approval = useMutation()
  const rejection = useMutation()
  const parser = useMutation()
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [manualRevision, setManualRevision] = useState(0)
  const [modal, setModal] = useState<'approve' | 'reject' | null>(null)
  const [reason, setReason] = useState('')
  const [actionError, setActionError] = useState<ApiError | null>(null)
  const [parseFailure, setParseFailure] = useState(initialParseError)
  const [contextChanged, setContextChanged] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [recovery, setRecovery] = useState<'checking' | 'not_found' | 'failed'>('checking')
  const [recoveryMessage, setRecoveryMessage] = useState('')
  const [approved, setApproved] = useState<ApprovalResult | null>(null)
  const [message, setMessage] = useState('')
  const intent = useRef<ApprovalIntent | null>(null)
  const approveBusy = useRef(false)
  const settled = useRef(false)
  const complete = useCallback((result: ApprovalResult, needsRefresh = true) => {
    if (settled.current) return
    settled.current = true
    setApproved(result); setUncertain(false); setModal(null); setActionError(null)
    if (needsRefresh) refreshQueries()
  }, [query.refresh])
  const completeRef = useRef(complete)
  completeRef.current = complete
  const data = query.data
  const analysisId = data?.analysis?.id
  useEffect(() => { setSelected(null) }, [analysisId])

  // Keep checking the original request. not_found can also mean a transaction is still in flight.
  useEffect(() => {
    if (!uncertain || !approval.key || !online) return
    const key = approval.key
    let stopped = false
    let running = false
    async function poll() {
      if (stopped || running || document.hidden || !navigator.onLine) return
      running = true
      try {
        const status = await checkRequest<ApprovalResult>(key)
        if (stopped || settled.current) return
        if (status.status === 'committed') completeRef.current(status.result)
        else { setRecovery('not_found'); setRecoveryMessage(status.note) }
      } catch (error) {
        if (!stopped && !settled.current) { setRecovery('failed'); setRecoveryMessage(userErrorMessage(error)) }
      } finally { running = false }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 3000)
    window.addEventListener('focus', poll)
    document.addEventListener('visibilitychange', poll)
    return () => { stopped = true; clearInterval(timer); window.removeEventListener('focus', poll); document.removeEventListener('visibilitychange', poll) }
  }, [uncertain, approval.key, online])

  const authenticated = !!session
  const owner = !!data && authenticated
  const active = data?.change.status === 'preview_ready'
  const unresolved = approval.pending || uncertain
  const busy = action.pending || rejection.pending || parser.pending || unresolved
  const patch = data?.patches.find(p => p.id === selected) ?? null
  const canApprove = !!(authenticated && active && patch && !data?.stale && !contextChanged && !data?.analysis?.blockers.length && !busy && online)

  async function analyse(delta?: ManualDelta, reanalyse = false) {
    if (!data || !owner || busy || !online) return
    setActionError(null); setMessage('')
    try {
      await action.mutate({ path: `/api/changes/${encodeURIComponent(id)}/${reanalyse ? 'reanalyse' : 'confirm'}`, body: { base_version: data.event.active_version, ...(delta ? { delta } : {}) } })
      await query.refresh()
      setEditing(false); setContextChanged(false)
      setMessage('Tafsiran dikonfirmasi. Periksa opsi sebelum menyetujui keputusan.')
    } catch (error) {
      const failure = asApiError(error)
      setActionError(failure)
      if (failure.code === 'STALE_VERSION' || failure.code === 'CONTEXT_CHANGED') { setContextChanged(true); void query.refresh() }
    }
  }
  async function parseAgain() {
    if (!data || busy || !online) return
    setActionError(null)
    try {
      await parser.mutate({ path: `/api/changes/${encodeURIComponent(id)}/parse`, idempotent: false })
      await query.refresh(); setManualRevision(n => n + 1); setParseFailure(null)
    } catch (error) { setParseFailure(asApiError(error).code); setActionError(asApiError(error)) }
  }
  function openApproval() {
    if (!canApprove || !patch || !data) return
    approval.reset(); settled.current = false; intent.current = null
    setReason(''); setActionError(null); setRecoveryMessage(''); setModal('approve')
  }
  async function sendApproval(retry = false) {
    if (!data || !online || approveBusy.current || (!retry && (!patch || reason.trim().length < 3))) return
    if (!retry) intent.current = { path: `/api/changes/${encodeURIComponent(id)}/approve`, body: { patch_id: patch!.id, base_version: data.change.base_version!, reason: reason.trim() } }
    const request = intent.current
    if (!request) return
    approveBusy.current = true
    setActionError(null)
    if (retry) setRecovery('checking')
    try { complete(await approval.mutate<ApprovalResult>(request), false) }
    catch (error) {
      if (settled.current) return
      const failure = asApiError(error)
      if (['TIMEOUT', 'NETWORK', 'INVALID_RESPONSE', 'STORAGE_UNAVAILABLE'].includes(failure.code) || (retry && !['STALE_VERSION', 'CONTEXT_CHANGED', 'INVALID_STATE'].includes(failure.code))) { setRecovery(['TIMEOUT', 'NETWORK', 'INVALID_RESPONSE', 'STORAGE_UNAVAILABLE'].includes(failure.code) ? 'checking' : 'failed'); setRecoveryMessage(userErrorMessage(failure, 'write')); setUncertain(true) }
      else {
        // A confirmed rejection of this exact retry resolves the previous unknown request.
        setUncertain(false); setActionError(failure)
        if (failure.code === 'STALE_VERSION' || failure.code === 'CONTEXT_CHANGED') { setContextChanged(true); setModal(null); void query.refresh() }
      }
    } finally { approveBusy.current = false }
  }
  async function reject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!data || !authenticated || busy || !online) return
    setActionError(null)
    try { await rejection.mutate({ path: `/api/changes/${encodeURIComponent(id)}/reject`, body: { reason: reason.trim() } }); setModal(null); setMessage('Kabar ditolak. Rundown aktif tidak berubah.'); await query.refresh() }
    catch (error) { setActionError(asApiError(error)) }
  }
  return <AppShell title={data ? `Kabar CH-${data.change.seq}` : 'Kabar perubahan'}>
    {!data ? query.error ? <ErrorState error={query.error} onRetry={query.refresh} /> : <Loading label="Memuat kabar…" /> : <div className="stack">
      <div className={styles.steps}><span>1. Kabar</span><strong>{active || data.decision ? '✓ 2. Tafsiran dikonfirmasi' : '2. Konfirmasi tafsiran'}</strong><span>→ 3. Periksa opsi</span><span>→ 4. Persetujuan</span></div>
      <section className="card stack"><div className="row between"><h2>Kabar asli</h2><StatusBadge kind={data.change.status === 'approved' ? 'APPROVED' : data.change.status === 'rejected' ? 'BLOCKER' : data.change.status === 'needs_clarification' ? 'ACTION_REQUIRED' : 'FYI'} label={data.change.status === 'preview_ready' ? 'Opsi siap diperiksa' : data.change.status === 'draft' ? 'Draft · belum dikonfirmasi' : data.change.status === 'needs_clarification' ? 'Perlu klarifikasi' : data.change.status === 'rejected' ? 'Ditolak' : 'Disetujui'} /></div>
        {data.change.original_text ? <blockquote className={styles.quote}>{data.change.original_text}</blockquote> : <p className="muted">Kabar diisi melalui form manual.</p>}
        <div className={styles.meta}><span>Pelapor: {data.change.actor_name}</span><span>Waktu acuan: {data.change.reference_at ? `${formatClock(data.change.reference_at, data.event.timezone, data.server_now)} ${zoneAbbrev(data.event.timezone)}` : 'Belum diisi'}</span><span>Jenis: {data.change.kind === 'report' ? 'Laporan' : data.change.kind === 'correction' ? 'Koreksi' : 'Kompensasi'}</span></div>
      </section>
      <div aria-live="polite" role="status">{message && <p className="alert alert-success">✓ {message}</p>}{approved && <p className="alert alert-success">✓ Disetujui sebagai v{approved.new_version} · {approved.briefs} brief terkirim. <Link href="/history">Lihat Riwayat</Link></p>}{action.pending && <Loading label="Menghitung dampak…" />}</div>
      {query.error && <ErrorState error={query.error} onRetry={query.refresh} />}
      {actionError && modal === null && <ErrorState error={actionError} />}
      {(data.change.status === 'draft' || data.change.status === 'needs_clarification' || editing) && <>
        {parseFailure && <p className="alert alert-action" role="alert">! {parseFailure === 'AI_UNAVAILABLE' ? 'Penafsir tidak tersedia. Gunakan form manual; draft tetap tersimpan.' : 'Tafsiran belum tersedia. Gunakan form manual; draft tetap tersimpan.'}</p>}
        <div className="grid-two"><div className="stack"><InterpretationCard detail={data} />{owner && data.change.original_text && !editing && <Button variant="outline" className="btn" disabled={busy || !online} onClick={() => void parseAgain()}>{parser.pending ? 'Menafsirkan…' : 'Tafsirkan ulang'}</Button>}</div>
          {owner ? data.change.kind === 'compensation' ? <section className="card stack"><h2>Konfirmasi kompensasi</h2><p>Kompensasi dihitung dari versi aktif v{data.event.active_version}. Konfirmasi akan memeriksa batas dan aktivitas yang terkunci; belum menyetujui keputusan.</p><Button variant="default" className="btn btn-primary" disabled={busy || !online} onClick={() => void analyse()}>Konfirmasi tafsiran</Button></section> : <ManualForm key={`${id}-${manualRevision}`} detail={data} disabled={busy || !online} pending={action.pending} onConfirm={delta => analyse(delta)} /> : <EmptyState title="Hanya pelapor atau koordinator yang dapat mengonfirmasi tafsiran." />}
        </div>{editing && <Button variant="outline" className="btn" disabled={busy} onClick={() => setEditing(false)}>Kembali ke opsi</Button>}
      </>}
      {data.analysis && !editing && <>
        <section className="card stack"><h2>Perbandingan opsi pemulihan</h2><div className={styles.meta}><span>Basis v{data.analysis.base_version}</span><span>Dihitung pukul {formatClock(data.analysis.analysis_now, data.event.timezone, data.server_now)} {zoneAbbrev(data.event.timezone)}</span><span>Engine {data.analysis.engine_ms} ms</span><span>{data.analysis_count} analisis</span></div><InterpretationCard detail={data} /></section>
        {(data.stale || contextChanged) && active && <section className="alert alert-action" role="alert"><h3>↻ {data.stale ? `Rundown sudah berubah ke v${data.event.active_version}. Hitung ulang dari versi terkini.` : 'Kondisi sudah berubah sejak analisis. Hitung ulang dari kondisi terkini.'}</h3>{owner && <Button variant="outline" className="btn" disabled={busy || !online} onClick={() => void analyse(undefined, true)}>Hitung ulang</Button>}</section>}
        {data.analysis.blockers.length > 0 ? <ConstraintAlert violations={data.analysis.blockers} title={data.analysis.blockers.some(v => v.rule === 'MISSING_DATA') ? 'DATA BELUM LENGKAP' : 'ANALISIS TERHALANG — periksa batas berikut'} timezone={data.event.timezone} /> : data.patches.length === 0 ? <section className="card stack"><h2>! TIDAK ADA OPSI FEASIBLE dalam pencarian ini.</h2><p>{data.analysis.search_meta.note}</p><p className="muted">{data.analysis.search_meta.evaluated} kandidat diperiksa · {data.analysis.search_meta.valid} lolos{data.analysis.search_meta.truncated ? ' · Pencarian dibatasi' : ''}</p><div className="stack">{data.analysis.rejected.map(candidate => <details key={candidate.candidate_id}><summary>{candidate.label} · {candidate.candidate_id}</summary><ConstraintAlert violations={candidate.violations} title="Batas yang menghalangi opsi" timezone={data.event.timezone} /></details>)}</div></section> : <>
          <p className="alert alert-action">✓ Lolos batas yang tercatat. Periksa kondisi lapangan sebelum menyetujui.</p>
          <div className={styles.patches}>{data.patches.map(option => <PatchCard key={option.id} patch={option} timezone={data.event.timezone} selected={selected === option.id || data.decision?.patch_id === option.id} disabled={busy || !online || data.stale || contextChanged} onSelect={authenticated && active ? () => setSelected(option.id) : undefined} />)}</div>
        </>}
        {active && owner && <div className="row">{authenticated && data.patches.length > 0 && !data.analysis.blockers.length && <Button variant="default" className="btn btn-primary" disabled={!canApprove} onClick={openApproval}>Setujui opsi terpilih</Button>}{!data.stale && !contextChanged && <Button variant="outline" className="btn" disabled={busy || !online} onClick={() => void analyse(undefined, true)}>Hitung ulang</Button>}{data.change.kind !== 'compensation' && <Button variant="outline" className="btn" disabled={busy} onClick={() => setEditing(true)}>Perbaiki tafsiran</Button>}{authenticated && <Button variant="destructive" className="btn btn-danger" disabled={busy || !online} onClick={() => { setReason(''); setActionError(null); rejection.reset(); setModal('reject') }}>Tolak kabar</Button>}{authenticated && <Button asChild variant="outline"><Link href="/rundown/setup" className="btn">Perbaiki setup rundown</Link></Button>}</div>}
      </>}
      {data.decision && !approved && <section className="alert alert-success"><h2>✓ Disetujui sebagai v{data.decision.new_version}</h2><p>{data.decision.approved_by} · {formatClock(data.decision.approved_at, data.event.timezone, data.server_now)} {zoneAbbrev(data.event.timezone)}</p><p>Alasan: {data.decision.reason}</p>{authenticated && <Link href="/history">Lihat Riwayat</Link>}</section>}
      {data.change.status === 'rejected' && <section className="alert alert-blocker"><h2>! Kabar ditolak</h2><p>{data.change.reject_reason}</p></section>}
      <div className="row"><Button asChild variant="outline"><Link href="/rundown" className="btn">Kirim kabar lain lewat AI</Link></Button><Button asChild variant="outline"><Link href="/rundown" className="btn">Lihat rundown aktif</Link></Button></div>
    </div>}
    <Dialog open={modal === 'approve'} title="Setujui perubahan rundown" busy={unresolved} onClose={() => { if (!unresolved) setModal(null) }}>
      <form className="stack" onSubmit={event => { event.preventDefault(); if (!uncertain) void sendApproval() }}>
        <p><strong>{patch?.label ?? 'Opsi terpilih'}</strong></p><p>Rundown v{data?.change.base_version} → v{(data?.change.base_version ?? 0) + 1}. {patch?.items_changed} item berubah; {patch?.impact.filter(role => role.level === 'ACTION_REQUIRED' || role.level === 'FYI').length} peran menerima brief.</p>
        <p className="muted">Periksa kondisi lapangan sebelum menyetujui. Keputusan, rundown versi baru, dan brief disimpan bersama.</p>
        <div className="field"><Label htmlFor="approve-reason">Alasan persetujuan</Label><Textarea id="approve-reason" value={reason} onChange={event => setReason(event.target.value)} required minLength={3} maxLength={500} disabled={unresolved} /></div>
        <div aria-live="polite" role="status">{approval.pending && <Loading label="Menyimpan keputusan…" />}{uncertain && <div className="stack"><Loading label="Menyelesaikan penyimpanan perubahan…" />{recovery === 'failed' && recoveryMessage && <p className="muted">{recoveryMessage}</p>}{recovery === 'not_found' && <Button variant="outline" className="btn" type="button" disabled={approval.pending || !online} onClick={() => void sendApproval(true)}>Coba lagi</Button>}</div>}</div>
        {actionError && <ErrorState error={actionError} />}
        {!uncertain && <div className="row"><Button variant="default" type="submit" className="btn btn-primary" disabled={!canApprove || reason.trim().length < 3}>Setujui dan kirim brief</Button><Button variant="outline" className="btn" type="button" disabled={approval.pending} onClick={() => setModal(null)}>Kembali</Button></div>}
      </form>
    </Dialog>
    <Dialog open={modal === 'reject'} title="Tolak kabar perubahan" busy={rejection.pending} onClose={() => setModal(null)}><form className="stack" onSubmit={reject}><p>Penolakan mencatat alasan; rundown aktif tetap pada versi yang sama.</p><div className="field"><Label htmlFor="reject-reason">Alasan penolakan</Label><Textarea id="reject-reason" value={reason} onChange={event => setReason(event.target.value)} required minLength={3} maxLength={500} disabled={rejection.pending} /></div>{rejection.pending && <Loading label="Menyimpan penolakan…" />}{actionError && <ErrorState error={actionError} />}<Button variant="destructive" type="submit" className="btn btn-danger" disabled={rejection.pending || !online || reason.trim().length < 3}>Tolak kabar</Button></form></Dialog>
  </AppShell>
}
