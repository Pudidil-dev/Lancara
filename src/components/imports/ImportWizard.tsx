'use client'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { ErrorState, Icon, Loading , Button } from '@/components/ui'
import { api, ApiError } from '@/lib/api-client'
import { useMutation } from '@/hooks/useMutation'
import { useOnline } from '@/hooks/useOnline'
import { usePolling } from '@/hooks/usePolling'
import type { RundownResponse } from '@/hooks/types'
import { useEvent } from '@/hooks/useEvent'
import type { ImportRecord, ImportRow, ImportSettings } from '@/modules/imports/types'
import { EventSettingsFields, settingsError, settingsFromSnapshot } from './EventSettingsFields'
import { ManualStep, type ManualDraftRow } from './ManualStep'
import { ReviewStep } from './ReviewStep'
import { UploadStep } from './UploadStep'

type Step = 'choose' | 'upload' | 'manual' | 'review'
type Method = 'pdf' | 'manual'
const STEP_IDS: Step[] = ['choose', 'upload', 'manual', 'review']
/** Langkah 2 mengikuti metode: "Unggah PDF" (60:2291) atau "Siapkan Data" (179:1704). */
function stepsFor(second: 'upload' | 'manual'): Array<{ id: Step; label: string }> {
  return [
    { id: 'choose', label: 'Pilih cara' },
    second === 'manual' ? { id: 'manual', label: 'Siapkan Data' } : { id: 'upload', label: 'Unggah PDF' },
    { id: 'review', label: 'Tinjau&Lengkapi data' },
  ]
}
const STORAGE_KEY = 'lancara.import.settings'

interface Stored { settings: ImportSettings; method: Method; manualRows?: ManualDraftRow[] }
function readStored(eventId: string): Stored | null {
  try { return JSON.parse(sessionStorage.getItem(`${STORAGE_KEY}.${eventId}`) ?? 'null') } catch { return null }
}
function store(eventId: string, value: Stored) {
  try { sessionStorage.setItem(`${STORAGE_KEY}.${eventId}`, JSON.stringify(value)) } catch { /* Penyimpanan sesi opsional. */ }
}

function Stepper({ step, second, canPrepare, canReview, go }: { step: Step; second: 'upload' | 'manual'; canPrepare: boolean; canReview: boolean; go: (s: Step) => void }) {
  const steps = stepsFor(second)
  const index = steps.findIndex((s) => s.id === step)
  return (
    <ol className="wizard-steps" aria-label="Langkah tambah rundown">
      {steps.map((s, i) => {
        const enabled = s.id === 'choose' || (s.id === second && canPrepare) || (s.id === 'review' && canReview)
        return <li key={s.id} style={{ display: 'contents' }}>
          {i > 0 && <span className="wizard-step-sep" aria-hidden="true">›</span>}
          <Button variant="ghost" type="button" className="wizard-step" aria-current={s.id === step ? 'step' : undefined} data-done={i < index || undefined} disabled={!enabled} onClick={() => go(s.id)}>
            <span className="wizard-step-num">{i + 1}</span><span className="wizard-step-label">{s.label}</span>
          </Button>
        </li>
      })}
    </ol>
  )
}

function WizardBar({ onBack, primary, secure = true }: { onBack?: () => void; primary: React.ReactNode; secure?: boolean }) {
  return (
    <div className="wizard-bar">
      {onBack ? <Button variant="outline" type="button" className="wizard-back" onClick={onBack}><Icon name="arrow-left" size={12} />Kembali ke Pilih Cara</Button> : <span />}
      {secure && <span className="wizard-secure"><Icon name="lock-closed" size={14} />Keamanan dokumen: file diproses secara terisolasi untuk sesi rundown ini.</span>}
      {primary}
    </div>
  )
}

/** Wizard Figma "Tambah Rundown": Pilih cara → Unggah PDF / Siapkan Data → Tinjau & lengkapi → Aktifkan. */
export function ImportWizard() {
  const { eventId: EVENT_ID, rundownPath: RUNDOWN_PATH } = useEvent()
  const router = useRouter()
  const params = useSearchParams()
  const online = useOnline()
  const rundown = usePolling<RundownResponse>(RUNDOWN_PATH, { intervalMs: 30000 })
  const createManual = useMutation()
  const activation = useMutation()
  const step = (STEP_IDS.includes(params.get('step') as Step) ? params.get('step') : 'choose') as Step
  const importId = params.get('import')
  const [method, setMethod] = useState<Method>('pdf')
  const [settings, setSettings] = useState<ImportSettings | null>(null)
  const [manualRows, setManualRows] = useState<ManualDraftRow[]>([])
  const [showErrors, setShowErrors] = useState(false)
  const [record, setRecord] = useState<ImportRecord | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [savingRows, setSavingRows] = useState(false)
  const [rowError, setRowError] = useState<ApiError | null>(null)
  const [activated, setActivated] = useState<number | null>(null)
  const initialized = useRef(false)

  // Nilai awal: isian sesi sebelumnya, atau pengaturan rundown aktif.
  useEffect(() => {
    if (initialized.current || !rundown.data || !EVENT_ID) return
    initialized.current = true
    const stored = readStored(EVENT_ID)
    setSettings(stored?.settings ?? settingsFromSnapshot(rundown.data.snapshot))
    if (stored?.method) setMethod(stored.method)
    if (stored?.manualRows) setManualRows(stored.manualRows)
  }, [EVENT_ID, rundown.data])
  useEffect(() => { if (settings && EVENT_ID) store(EVENT_ID, { settings, method, manualRows }) }, [EVENT_ID, settings, method, manualRows])
  useEffect(() => {
    if (!EVENT_ID || !importId || record?.id === importId) return
    setLoadError(null)
    api<ImportRecord>(`/api/events/${EVENT_ID}/imports/${importId}`).then(setRecord, (e: ApiError) => setLoadError(e))
  }, [EVENT_ID, importId, record?.id])

  function go(next: Step, id: string | null = importId) {
    const query = new URLSearchParams({ step: next })
    if (id && next !== 'choose') query.set('import', id)
    router.replace(`/rundown/new?${query}`, { scroll: true })
  }

  function next() {
    if (!settings) return
    setShowErrors(true)
    if (settingsError(settings)) return
    go(method === 'pdf' ? 'upload' : 'manual')
  }

  /** Isian manual menjadi draft impor; langkah tinjau dan aktivasi sama dengan PDF. */
  async function reviewManual() {
    if (!settings || !manualRows.length) return
    try {
      const created = await createManual.mutate<ImportRecord>({ path: `/api/events/${EVENT_ID}/imports/manual`, body: { settings, rows: manualRows.map(({ id: _id, ...row }) => row) }, idempotent: false })
      setRecord(created)
      go('review', created.id)
    } catch { /* Error ditampilkan di atas bilah. */ }
  }

  async function saveRows(rows: ImportRow[]): Promise<boolean> {
    if (!record) return false
    setSavingRows(true)
    setRowError(null)
    try {
      setRecord(await api<ImportRecord>(`/api/events/${EVENT_ID}/imports/${record.id}`, { method: 'PATCH', body: { rows } }))
      return true
    } catch (e) {
      setRowError(e as ApiError)
      return false
    } finally {
      setSavingRows(false)
    }
  }

  async function activate() {
    if (!record || !rundown.data) return
    try {
      const result = await activation.mutate<{ new_version: number }>({ path: `/api/events/${EVENT_ID}/imports/${record.id}/apply`, body: { base_version: rundown.data.version }, timeoutMs: 30000 })
      setActivated(result.new_version)
      try { sessionStorage.removeItem(`${STORAGE_KEY}.${EVENT_ID}`) } catch { /* Opsional. */ }
      setTimeout(() => router.push('/'), 1600)
    } catch { /* Error ditampilkan di atas bilah. */ }
  }

  const second: 'upload' | 'manual' = step === 'manual' || (step !== 'upload' && (method === 'manual' || record?.draft.parser === 'manual')) ? 'manual' : 'upload'
  if (!rundown.data || !settings) return rundown.error ? <ErrorState error={rundown.error} onRetry={rundown.refresh} /> : <Loading label="Menyiapkan formulir…" />
  const heading = {
    choose: { title: 'Siapkan acara kamu!', text: 'Pilih cara memasukkan rundown. Pilihan ini bisa diubah nanti saat koordinasi produksi berlangsung.', jakarta: false },
    upload: { title: 'Unggah rundown dalam PDF', text: 'Pilih dokumen rundown acara Anda. Sistem AI Lancara akan mengekstrak semua data pada rundown.', jakarta: true },
    manual: { title: 'Masukan rundown kamu!', text: 'Isi data sesuai dengan rundown acara Anda.', jakarta: true },
    review: { title: 'Tinjau&Lengkapi data rundown', text: 'Pastikan durasi, penanggung jawab (PIC), durasi minimum, dependensi teknis, dan tipe segmen terisi lengkap sebelum rundown diaktifkan ke konsol panggung.', jakarta: false },
  }[step]

  return (
    <div className="wizard">
      <Stepper step={step} second={second} canPrepare={!settingsError(settings)} canReview={!!importId} go={(s) => go(s)} />
      <div className="wizard-heading"><h1>{heading.title}</h1><p data-font={heading.jakarta ? 'jakarta' : undefined}>{heading.text}</p></div>

      {step === 'choose' && <>
        <div className="choice-grid" role="radiogroup" aria-label="Metode pemasukan rundown">
          {([['pdf', 'Impor dari PDF', 'Baca rundown dari file PDF, lalu periksa hasilnya secara terstruktur.'], ['manual', 'Isi manual', 'Ketik item rundown satu per satu ke dalam grid kontrol studio']] as const).map(([value, title, text]) =>
            <Button variant="ghost" key={value} type="button" role="radio" aria-checked={method === value} className="choice-card" onClick={() => setMethod(value)}>
              <span className="choice-copy"><strong>{title}</strong><span>{text}</span></span>
              <span className="choice-radio" aria-hidden="true" />
            </Button>)}
        </div>
        <EventSettingsFields value={settings} onChange={setSettings} showErrors={showErrors} />
        <Button variant="default" type="button" className="btn-gradient btn-block wizard-primary" onClick={next}>Lanjut<Icon name="arrow-right" /></Button>
      </>}

      {step === 'upload' && <>
        <UploadStep settings={settings} record={record && record.id === importId ? record : null} onUploaded={(created) => { setRecord(created); go('upload', created.id) }} />
        <WizardBar onBack={() => go('choose')} primary={<Button variant="default" type="button" className="btn-gradient" disabled={!importId} onClick={() => go('review')}>{importId ? 'Tinjau&Lengkapi data' : 'Lanjut'}<Icon name="arrow-right" /></Button>} />
      </>}

      {step === 'manual' && <>
        <ManualStep title={settings.name || rundown.data.event.name} rows={manualRows} onChange={setManualRows} />
        {createManual.error && <ErrorState error={createManual.error} />}
        <WizardBar secure={false} onBack={() => go('choose')} primary={<Button variant="default" type="button" className="btn-gradient" disabled={!manualRows.length || createManual.pending || !online} onClick={() => void reviewManual()}>{createManual.pending ? 'Menyiapkan…' : <><span className="label-desktop">Tinjau&amp;Lengkapi data</span><span className="label-mobile">Lanjut</span></>}<Icon name="arrow-right" /></Button>} />
      </>}

      {step === 'review' && <>
        {loadError && <ErrorState error={loadError} />}
        {!record && !loadError && <Loading label="Memuat data rundown…" />}
        {record && <ReviewStep record={record} eventName={rundown.data.event.name} roles={rundown.data.snapshot.roles} saving={savingRows} saveError={rowError} onClearError={() => setRowError(null)} onSaveRows={saveRows} />}
        {activation.error && <ErrorState error={activation.error} />}
        {record?.status === 'applied' && !activated && <p className="lc-alert" data-tone="warning">Impor ini sudah diaktifkan sebagai Rundown v{record.applied_version}. <Link href="/">Buka dashboard</Link></p>}
        <WizardBar onBack={() => go('choose')} primary={<Button variant="default" type="button" className="btn-gradient" disabled={!record || record.status !== 'draft' || activation.pending || savingRows || !online} onClick={() => void activate()}>{activation.pending ? 'Mengaktifkan…' : 'Aktifkan'}<Icon name="arrow-right" /></Button>} />
      </>}

      {activation.pending && !activated && <div className="lc-overlay" role="alertdialog" aria-modal="true" aria-labelledby="activating-title" aria-busy="true">
        <div className="state-card">
          <div className="dropzone" data-state="loading">
            <div className="dropzone-icon"><Icon name="spinner" size={54} /></div>
            <h3 id="activating-title" role="status">Mengaktifkan rundown…</h3>
            <p>Data lama diganti dengan data baru. Jangan tutup halaman ini.</p>
          </div>
        </div>
      </div>}

      {activated && <div className="lc-overlay" role="dialog" aria-modal="true" aria-labelledby="activated-title">
        <div className="state-card">
          <div className="dropzone" data-state="success">
            <div className="dropzone-icon"><Icon name="success-check" size={54} /></div>
            <h3 id="activated-title">Rundown kamu berhasil di aktifkan</h3>
            <p>Rundown v{activated} aktif. Membuka dashboard…</p>
          </div>
        </div>
      </div>}
    </div>
  )
}
