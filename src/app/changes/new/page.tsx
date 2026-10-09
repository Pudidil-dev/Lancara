'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AppShell } from '@/components/shell/AppShell'
import { ErrorState, Loading } from '@/components/ui'
import { useMutation } from '@/hooks/useMutation'
import { useOnline } from '@/hooks/useOnline'
import { usePolling } from '@/hooks/usePolling'
import { EVENT_ID, RUNDOWN_PATH, type RundownResponse } from '@/hooks/types'
import { ApiError } from '@/lib/api-client'
import { zoneAbbrev } from '@/lib/time'
import { inputToIso, localInput } from '@/components/changes/ManualForm'
import styles from '@/components/changes/changes.module.css'

export default function NewChange() {
  const router = useRouter()
  const rundown = usePolling<RundownResponse>(RUNDOWN_PATH)
  const online = useOnline()
  const creation = useMutation()
  const parsing = useMutation()
  const [text, setText] = useState('')
  const [reference, setReference] = useState('')
  const initialized = useRef(false)
  const busy = useRef(false)
  const [stage, setStage] = useState('')
  const [error, setError] = useState<ApiError | null>(null)
  useEffect(() => {
    if (rundown.data && !initialized.current) {
      initialized.current = true
      setReference(localInput(rundown.data.server_now, rundown.data.event.timezone))
    }
  }, [rundown.data])
  async function submit(manual = false) {
    if (!online || busy.current || !rundown.data) return
    busy.current = true
    setError(null)
    setStage('Menyimpan draft…')
    try {
      const reference_at = reference ? inputToIso(reference, rundown.data.event.timezone) : null
      const result = await creation.mutate<{ change_id: string }>({ path: `/api/events/${EVENT_ID}/changes`, body: { original_text: manual ? null : text.trim(), reference_at }, idempotent: false })
      if (!manual) {
        setStage('Menafsirkan kabar…')
        try { await parsing.mutate({ path: `/api/changes/${result.change_id}/parse`, idempotent: false }) }
        catch (parseError) {
          router.push(`/changes/${result.change_id}?parse_error=${encodeURIComponent((parseError as ApiError).code ?? 'AI_UNAVAILABLE')}`)
          return
        }
      }
      router.push(`/changes/${result.change_id}`)
    } catch (e) { setError(e instanceof ApiError ? e : new ApiError('VALIDATION_ERROR', (e as Error).message, 422, null, null)) }
    finally { busy.current = false; setStage('') }
  }
  function onSubmit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void submit() }
  const disabled = creation.pending || parsing.pending || !!stage || !online || !rundown.data
  return <AppShell title="Kabar baru"><div className={styles.steps}><strong>1. Kabar</strong><span>→ 2. Konfirmasi tafsiran</span><span>→ 3. Periksa opsi</span><span>→ 4. Persetujuan</span></div>
    <div className="grid-two"><form className="card stack" onSubmit={onSubmit}>
      <h2>Apa yang berubah di lapangan?</h2><p className="muted">Tulis item dan jam sejelas mungkin. Anda akan memeriksa tafsiran sebelum dampak dihitung.</p>
      <div className="field"><label htmlFor="change-text">Kabar perubahan</label><textarea id="change-text" className={styles.textarea} value={text} onChange={e => setText(e.target.value)} maxLength={2000} required placeholder="Contoh: Talent B baru bisa mulai jam 20.05" disabled={disabled} aria-describedby="change-counter" /><span id="change-counter" className={styles.counter}>{text.length}/2000 karakter</span></div>
      <div className="field"><label htmlFor="change-reference">Waktu acuan kabar ({zoneAbbrev(rundown.data?.event.timezone ?? 'Asia/Jakarta')})</label><input id="change-reference" type="datetime-local" value={reference} onChange={e => { initialized.current = true; setReference(e.target.value) }} disabled={disabled} aria-describedby="reference-note" /><p id="reference-note" className="muted">Default mengikuti jam simulasi server. Boleh dikosongkan; kabar relatif akan meminta klarifikasi waktu acuan.</p></div>
      <div role="status" aria-live="polite">{stage && <Loading label={stage} />}</div>
      {error && <ErrorState error={error} />}{rundown.error && <ErrorState error={rundown.error} onRetry={rundown.refresh} />}
      <div className="row"><button type="submit" className="btn btn-primary" disabled={disabled || !text.trim()}>Tafsirkan</button><button type="button" className="btn" disabled={disabled} onClick={() => void submit(true)}>Isi manual</button></div>
    </form><aside className="card stack"><h2>Dari kabar ke keputusan</h2><ol><li>Tafsirkan kabar atau isi form manual.</li><li>Konfirmasi item, jenis perubahan, dan jam.</li><li>Periksa batas serta dampak setiap opsi.</li><li>Koordinator menyetujui dan brief dikirim ke peran terdampak.</li></ol><p className="muted">Mengirim kabar dan mengonfirmasi tafsiran belum mengubah rundown aktif.</p><Link href="/rundown" className="btn">Lihat rundown aktif</Link></aside></div>
  </AppShell>
}
