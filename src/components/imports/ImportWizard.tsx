'use client'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { ErrorState, Icon, Loading } from '@/components/ui'
import { api, ApiError } from '@/lib/api-client'
import { useMutation } from '@/hooks/useMutation'
import { useOnline } from '@/hooks/useOnline'
import { usePolling } from '@/hooks/usePolling'
import { EVENT_ID, RUNDOWN_PATH, type RundownResponse } from '@/hooks/types'
import type { ImportRecord, ImportRow, ImportSettings } from '@/modules/imports/types'
import { applySettings, EventSettingsFields, settingsError, settingsFromSnapshot } from './EventSettingsFields'
import { ReviewStep } from './ReviewStep'
import { UploadStep } from './UploadStep'

type Step = 'choose' | 'upload' | 'review'
type Method = 'pdf' | 'manual'
const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'choose', label: 'Pilih cara' },
  { id: 'upload', label: 'Unggah PDF' },
  { id: 'review', label: 'Tinjau&Lengkapi data' },
]
const STORAGE_KEY = 'lancara.import.settings'

function readStored(): { settings: ImportSettings; method: Method } | null {
  try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null') } catch { return null }
}
function store(value: { settings: ImportSettings; method: Method }) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value)) } catch { /* Penyimpanan sesi opsional. */ }
}

function Stepper({ step, canUpload, canReview, go }: { step: Step; canUpload: boolean; canReview: boolean; go: (s: Step) => void }) {
  const index = STEPS.findIndex((s) => s.id === step)
  return (
    <ol className="wizard-steps" aria-label="Langkah tambah rundown">
      {STEPS.map((s, i) => {
        const enabled = s.id === 'choose' || (s.id === 'upload' && canUpload) || (s.id === 'review' && canReview)
        return <li key={s.id} style={{ display: 'contents' }}>
          {i > 0 && <span className="wizard-step-sep" aria-hidden="true">›</span>}
          <button type="button" className="wizard-step" aria-current={s.id === step ? 'step' : undefined} data-done={i < index || undefined} disabled={!enabled} onClick={() => go(s.id)}>
            <span className="wizard-step-num">{i + 1}</span><span className="wizard-step-label">{s.label}</span>
          </button>
        </li>
      })}
    </ol>
  )
}

function WizardBar({ onBack, primary }: { onBack?: () => void; primary: React.ReactNode }) {
  return (
    <div className="wizard-bar">
      {onBack ? <button type="button" className="wizard-back" onClick={onBack}><Icon name="arrow-left" size={12} />Kembali ke Pilih Cara</button> : <span />}
      <span className="wizard-secure"><Icon name="lock-closed" size={14} />Keamanan dokumen: file diproses secara terisolasi untuk sesi rundown ini.</span>
      {primary}
    </div>
  )
}

/** Wizard Figma "Tambah Rundown": Pilih cara → Unggah PDF → Tinjau & lengkapi → Aktifkan. */
export function ImportWizard() {
  const router = useRouter()
  const params = useSearchParams()
  const online = useOnline()
  const rundown = usePolling<RundownResponse>(RUNDOWN_PATH, { intervalMs: 30000 })
  const saveSettings = useMutation()
  const activation = useMutation()
  const step = (['choose', 'upload', 'review'].includes(params.get('step') ?? '') ? params.get('step') : 'choose') as Step
  const importId = params.get('import')
  const [method, setMethod] = useState<Method>('pdf')
  const [settings, setSettings] = useState<ImportSettings | null>(null)
  const [showErrors, setShowErrors] = useState(false)
  const [record, setRecord] = useState<ImportRecord | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [savingRows, setSavingRows] = useState(false)
  const [rowError, setRowError] = useState<ApiError | null>(null)
  const [activated, setActivated] = useState<number | null>(null)
  const initialized = useRef(false)

  // Nilai awal: isian sesi sebelumnya, atau pengaturan rundown aktif.
  useEffect(() => {
    if (initialized.current || !rundown.data) return
    initialized.current = true
    const stored = readStored()
    setSettings(stored?.settings ?? settingsFromSnapshot(rundown.data.snapshot))
    if (stored?.method) setMethod(stored.method)
  }, [rundown.data])
  useEffect(() => { if (settings) store({ settings, method }) }, [settings, method])
  useEffect(() => {
    if (!importId || record?.id === importId) return
    setLoadError(null)
    api<ImportRecord>(`/api/events/${EVENT_ID}/imports/${importId}`).then(setRecord, (e: ApiError) => setLoadError(e))
  }, [importId, record?.id])

  function go(next: Step, id: string | null = importId) {
    const query = new URLSearchParams({ step: next })
    if (id && next !== 'choose') query.set('import', id)
    router.replace(`/rundown/new?${query}`, { scroll: true })
  }

  async function next() {
    if (!settings || !rundown.data) return
    setShowErrors(true)
    if (settingsError(settings)) return
    if (method === 'pdf') return go('upload')
    // Isi manual: simpan pengaturan acara lalu buka grid kontrol (editor rundown).
    try {
      await saveSettings.mutate({ path: `/api/events/${EVENT_ID}/setup`, method: 'PUT', body: { base_version: rundown.data.version, snapshot: applySettings(rundown.data.snapshot, settings), note: 'Pengaturan acara (Tambah Rundown)' } })
      router.push('/rundown/setup')
    } catch { /* Error ditampilkan di bawah tombol. */ }
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
      try { sessionStorage.removeItem(STORAGE_KEY) } catch { /* Opsional. */ }
      setTimeout(() => router.push('/rundown'), 1600)
    } catch { /* Error ditampilkan di atas bilah. */ }
  }

  if (!rundown.data || !settings) return rundown.error ? <ErrorState error={rundown.error} onRetry={rundown.refresh} /> : <Loading label="Menyiapkan formulir…" />
  const heading = {
    choose: { title: 'Siapkan acara kamu!', text: 'Pilih cara memasukkan rundown. Pilihan ini bisa diubah nanti saat koordinasi produksi berlangsung.', jakarta: false },
    upload: { title: 'Unggah rundown dalam PDF', text: 'Pilih dokumen rundown acara Anda. Sistem AI Lancara akan mengekstrak semua data pada rundown.', jakarta: true },
    review: { title: 'Tinjau&Lengkapi data rundown', text: 'Pastikan durasi, penanggung jawab (PIC), durasi minimum, dependensi teknis, dan tipe segmen terisi lengkap sebelum rundown diaktifkan ke konsol panggung.', jakarta: false },
  }[step]

  return (
    <div className="wizard">
      <Stepper step={step} canUpload={!settingsError(settings) && method === 'pdf'} canReview={!!importId} go={(s) => go(s)} />
      <div className="wizard-heading"><h1>{heading.title}</h1><p data-font={heading.jakarta ? 'jakarta' : undefined}>{heading.text}</p></div>

      {step === 'choose' && <>
        <div className="choice-grid" role="radiogroup" aria-label="Metode pemasukan rundown">
          {([['pdf', 'Impor dari PDF', 'Baca rundown dari file PDF, lalu periksa hasilnya secara terstruktur.'], ['manual', 'Isi manual', 'Ketik item rundown satu per satu ke dalam grid kontrol studio']] as const).map(([value, title, text]) =>
            <button key={value} type="button" role="radio" aria-checked={method === value} className="choice-card" onClick={() => setMethod(value)}>
              <span className="choice-copy"><strong>{title}</strong><span>{text}</span></span>
              <span className="choice-radio" aria-hidden="true" />
            </button>)}
        </div>
        <EventSettingsFields value={settings} onChange={setSettings} showErrors={showErrors} />
        {saveSettings.error && <ErrorState error={saveSettings.error} />}
        <button type="button" className="btn-gradient btn-block wizard-primary" disabled={saveSettings.pending || !online} onClick={() => void next()}>{saveSettings.pending ? 'Menyimpan…' : 'Lanjut'}<Icon name="arrow-right" /></button>
      </>}

      {step === 'upload' && <>
        <UploadStep settings={settings} record={record && record.id === importId ? record : null} onUploaded={(created) => { setRecord(created); go('upload', created.id) }} />
        <WizardBar onBack={() => go('choose')} primary={<button type="button" className="btn-gradient" disabled={!importId} onClick={() => go('review')}>{importId ? 'Tinjau&Lengkapi data' : 'Lanjut'}<Icon name="arrow-right" /></button>} />
      </>}

      {step === 'review' && <>
        {loadError && <ErrorState error={loadError} />}
        {!record && !loadError && <Loading label="Memuat hasil baca PDF…" />}
        {record && <ReviewStep record={record} eventName={rundown.data.event.name} roles={rundown.data.snapshot.roles} saving={savingRows} onSaveRows={saveRows} />}
        {rowError && <ErrorState error={rowError} />}
        {activation.error && <ErrorState error={activation.error} />}
        {record?.status === 'applied' && !activated && <p className="lc-alert" data-tone="warning">Impor ini sudah diaktifkan sebagai Rundown v{record.applied_version}. <Link href="/rundown">Buka dashboard</Link></p>}
        <WizardBar onBack={() => go('choose')} primary={<button type="button" className="btn-gradient" disabled={!record || record.status !== 'draft' || activation.pending || savingRows || !online} onClick={() => void activate()}>{activation.pending ? 'Mengaktifkan…' : 'Aktifkan'}<Icon name="arrow-right" /></button>} />
      </>}

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
