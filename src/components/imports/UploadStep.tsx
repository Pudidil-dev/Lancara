'use client'
import { useRef, useState, type DragEvent } from 'react'
import { Icon , Button, Input, Label } from '@/components/ui'
import { api } from '@/lib/api-client'
import { userErrorMessage } from '@/lib/error-feedback'
import { notifyError } from '@/lib/notifications'
import { useEvent } from '@/hooks/useEvent'
import type { ImportRecord, ImportSettings } from '@/modules/imports/types'

const MAX_BYTES = 4 * 1024 * 1024

/** Unggah multipart (field file, pages, settings). Sukses hanya setelah server menyimpan draft. */
async function uploadPdf(eventId: string, file: File, pages: string, settings: ImportSettings): Promise<ImportRecord> {
  const form = new FormData()
  form.append('file', file)
  form.append('pages', pages)
  form.append('settings', JSON.stringify(settings))
  return api<ImportRecord>(`/api/events/${eventId}/imports`, { method: 'POST', body: form, timeoutMs: 120_000, operation: 'upload' })
}

type State = { kind: 'idle' } | { kind: 'loading'; name: string } | { kind: 'success'; record: ImportRecord } | { kind: 'error'; message: string }

/** Langkah 2 "Unggah rundown dalam PDF" (Figma 60:2291) termasuk state loading/sukses (135:7964, 135:8053). */
export function UploadStep({ settings, record, onUploaded }: { settings: ImportSettings; record: ImportRecord | null; onUploaded: (record: ImportRecord) => void }) {
  const { eventId } = useEvent()
  const [drag, setDrag] = useState(false)
  const [state, setState] = useState<State>(record ? { kind: 'success', record } : { kind: 'idle' })
  const input = useRef<HTMLInputElement>(null)

  async function handle(file: File | undefined) {
    if (!eventId || !file || state.kind === 'loading') return
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return setState({ kind: 'error', message: 'Format berkas harus PDF (.pdf).' })
    if (file.size > MAX_BYTES) return setState({ kind: 'error', message: 'Ukuran berkas melebihi 4 MB.' })
    setState({ kind: 'loading', name: file.name })
    try {
      const created = await uploadPdf(eventId, file, '', settings)
      setState({ kind: 'success', record: created })
      onUploaded(created)
    } catch (error) {
      setState({ kind: 'error', message: userErrorMessage(error, 'upload') })
      notifyError(error, { id: 'upload-rundown', context: 'upload' })
    } finally {
      if (input.current) input.current.value = ''
    }
  }
  function onDrop(event: DragEvent) {
    event.preventDefault()
    setDrag(false)
    void handle(event.dataTransfer.files[0])
  }

  const done = state.kind === 'success' ? state.record : null
  return (
    <div className="upload-grid">
      <section className="lc-card upload-main" aria-labelledby="dropzone-title">
        <div className="upload-head">
          <div className="upload-head-title"><Icon name="file-up" /><h2 id="dropzone-title" className="lc-h2">Drop Zone Berkas Rundown</h2></div>
          <span className="lc-chip">Satu panggung per impor</span>
        </div>
        <div className="dropzone" data-drag={drag || undefined} data-state={state.kind === 'loading' ? 'loading' : done ? 'success' : undefined}
          onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={onDrop} aria-busy={state.kind === 'loading'}>
          {state.kind === 'loading'
            ? <><div className="dropzone-icon"><Icon name="spinner" size={54} /></div><h3 role="status">Berkas kamu sedang di upload...</h3><p>{state.name} · AI Lancara membaca rundown</p></>
            : done
              ? <><div className="dropzone-icon"><Icon name="success-check" size={54} /></div><h3 role="status">Berkas kamu berhasil di upload...</h3>
                  <p>{done.draft.source.filename} · {done.draft.rows.length} segmen terbaca {done.draft.parser === 'ai' ? 'oleh AI Lancara' : 'dari pola tabel'}</p>
                  <Button variant="outline" type="button" className="dropzone-btn" onClick={() => input.current?.click()}><Icon name="folder-open" />Ganti file</Button></>
              : <><div className="dropzone-icon"><Icon name="file-pdf" size={30} /></div>
                  <h3>Tarik file PDF ke sini atau pilih file</h3>
                  <p>Format: PDF standar (.pdf). Kapasitas maksimal hingga 4 MB dan maksimal 40 halaman rundown per acara.</p>
                  <Button variant="outline" type="button" className="dropzone-btn" onClick={() => input.current?.click()}><Icon name="folder-open" />Pilih file dari perangkat</Button></>}
          <Input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => void handle(e.target.files?.[0])} />
        </div>
        {state.kind === 'error' && <p className="lc-alert" role="alert">{state.message}</p>}
        <div className="privacy-note">
          <Icon name="shield" size={18} />
          <div><strong>Privasi &amp; Isolasi Dokumen Operasional</strong><p className="lc-small">Dokumen rundown diproses dalam sandbox terisolasi. Tidak ada data yang dibagikan atau digunakan untuk pelatihan publik. Berkas tidak disimpan; hanya hasil baca yang disimpan sampai Anda mengaktifkannya.</p></div>
        </div>
      </section>
      <aside className="upload-aside">
        <section className="lc-card guide-card" aria-labelledby="guide-title">
          <div className="guide-head"><Icon name="list-checks" size={18} /><h2 id="guide-title" className="lc-h2">Pedoman Dokumen yang Optimal</h2></div>
          <ol className="guide-list">
            <li><span className="guide-num">1</span><div><strong>Tabel Terstruktur</strong><p className="lc-small">PDF berisi tabel teks asli (bukan hasil scan foto miring) menghasilkan akurasi yang tinggi.</p></div></li>
            <li><span className="guide-num">2</span><div><strong>Format Waktu Konsisten</strong><p className="lc-small">Disarankan menggunakan penulisan jam baku seperti 08:30 WIB, 08:30:00, atau estimasi durasi (misal: 15&apos; atau 00:15).</p></div></li>
            <li><span className="guide-num">3</span><div><strong>Struktur Cue Jelas</strong><p className="lc-small">Label seperti Cue, Segmen, Pengisi Acara, dan Operator AV akan langsung dipetakan ke konsol kendali.</p></div></li>
          </ol>
        </section>
        <section className="template-card" aria-labelledby="template-title">
          <strong id="template-title">Belum punya format rundown siap pakai?</strong>
          <p className="lc-small">Unduh contoh rundown standar broadcast resmi Lancara untuk memudahkan tim panggung Anda.</p>
          <a className="template-link" href="/templates/Template_Rundown.docx" download="Template_Rundown.docx"><Icon name="download" size={11} />Unduh Template Rundown Standar</a>
        </section>
      </aside>
    </div>
  )
}
