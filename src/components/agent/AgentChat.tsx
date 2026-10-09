'use client'
import Link from 'next/link'
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { userErrorMessage } from '@/lib/error-feedback'
import { notifyError } from '@/lib/notifications'
import { streamAgent, type AgentStreamEvent } from '@/lib/agent-stream'
import { refreshQueries } from '@/hooks/usePolling'
import { useOnline } from '@/hooks/useOnline'
import { useSession } from '@/hooks/useSession'
import { Icon , Button, Label, Input, Textarea } from '@/components/ui'
import { SchedulePreview, type ScheduleProposal } from './SchedulePreview'
import { chatHistory, compactChat, readChatMemory, writeChatMemory, type ChatMessage as Message } from './chat-memory'
import { MAX_MESSAGE, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, type AgentAttachment } from '@/modules/support/limits'

interface Suggestion { label: string; href: string }
type Proposal = ScheduleProposal
interface Step { tool: string; ok: boolean; note?: string; running?: boolean }
interface AgentReply { answer: string; source: 'rule' | 'ai'; suggestions: Suggestion[]; proposals: Proposal[]; reasoning?: string[]; steps?: Step[] }
const GREETING = 'Halo, saya siap untuk membantu anda!'

/** Langkah 'running' diganti hasil 'done' untuk tool yang sama; urutan tetap. */
function upsertStep(steps: Step[], event: Extract<AgentStreamEvent, { type: 'tool' }>): Step[] {
  const step: Step = { tool: event.tool, ok: event.ok ?? true, note: event.note, running: event.status === 'running' }
  if (event.status === 'running') return [...steps, step]
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].running && steps[i].tool === event.tool) return steps.map((s, j) => (j === i ? step : s))
  }
  return [...steps, step]
}

const TOOL_LABEL: Record<string, string> = {
  get_rundown_summary: 'Membaca rundown',
  get_event_context: 'Membaca pengaturan acara',
  list_changes: 'Membaca daftar kabar',
  get_history: 'Membaca riwayat & status baca',
  get_my_inbox: 'Membaca inbox',
  propose_schedule_change: 'Menyiapkan rekomendasi jadwal',
  recommend_reschedule: 'Mencari rekomendasi yang layak',
  edit_rundown: 'Menyiapkan pratinjau perubahan',
  edit_event_configuration: 'Menyiapkan pratinjau pengaturan acara',
  undo_decision: 'Menyiapkan pratinjau pembatalan',
}

/** Jam pesan "10.38" (zona perangkat; label percakapan, bukan data jadwal). */
const clock = () => new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }).replace(':', '.')

function StepList({ steps, label }: { steps: Step[]; label: string }) {
  return <ul className="support-steps" aria-label={label}>{steps.map((s, i) => <li key={i} data-ok={s.running ? undefined : s.ok}>{s.running ? '…' : s.ok ? '✓' : '!'} {TOOL_LABEL[s.tool] ?? 'Memproses permintaan'}{!s.ok ? ' — Langkah ini belum dapat dilanjutkan. Periksa rincian perubahan.' : ''}</li>)}</ul>
}

/** Panel "Lancara Support · AI Assistant" (Figma Dashboard 159:6742): membaca konteks dan bertindak lewat tool website. */
export function AgentChat() {
  const [messages, setMessages] = useState<Message[]>([{ id: 0, role: 'assistant', text: GREETING, at: '' }])
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [uploads, setUploads] = useState<AgentAttachment[]>([])
  const [fileError, setFileError] = useState('')
  const [memorySession, setMemorySession] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [live, setLive] = useState<{ thinking: string; steps: Step[] } | null>(null)
  const nextId = useRef(1)
  const logRef = useRef<HTMLDivElement>(null)
  const online = useOnline()
  const { session } = useSession()
  const chatScope = session ? `${session.session_id}:${session.event_id}` : null
  const activeSession = useRef<string | null>(null)
  activeSession.current = chatScope
  const uid = useId()

  // Jam sapaan diisi di klien agar tidak berbeda dengan render server.
  useEffect(() => { setMessages((prev) => prev.map((m) => (m.id === 0 && !m.at ? { ...m, at: clock() } : m))) }, [])
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }) }, [messages, pending, live])
  useEffect(() => {
    if (!chatScope) { setMemorySession(null); return }
    let restored: Message[] | null = null
    try { restored = readChatMemory(sessionStorage, chatScope) } catch { /* Penyimpanan tab opsional. */ }
    setMessages(restored?.length ? restored : [{ id: 0, role: 'assistant', text: GREETING, at: clock() }])
    nextId.current = restored?.length ? Math.max(...restored.map(m => m.id)) + 1 : 1
    setPending(false); setLive(null); setUploads([]); setDraft('')
    setMemorySession(chatScope)
  }, [chatScope])
  useEffect(() => {
    if (chatScope && memorySession === chatScope) {
      try { writeChatMemory(sessionStorage, chatScope, messages) } catch { /* Penyimpanan tab opsional. */ }
    }
  }, [messages, memorySession, chatScope])

  async function attach(files: FileList | null) {
    if (!files) return
    setFileError('')
    const chosen = Array.from(files)
    if (chosen.length > MAX_ATTACHMENTS || chosen.reduce((sum, file) => sum + file.size, 0) > MAX_ATTACHMENT_BYTES) { setFileError('Maksimal dua lampiran dengan total ukuran 2 MB.'); return }
    try {
      const values = await Promise.all(chosen.map(file => new Promise<AgentAttachment>((resolve, reject) => {
        const mime = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : '')
        if (!['image/png', 'image/jpeg', 'image/webp', 'application/pdf'].includes(mime)) { reject(new Error('Format lampiran harus PNG, JPG, WebP, atau PDF.')); return }
        const reader = new FileReader()
        reader.onload = () => resolve({ name: file.name, mime_type: mime as AgentAttachment['mime_type'], data: String(reader.result).split(',')[1] })
        reader.onerror = () => reject(new Error('Lampiran tidak dapat dibaca.'))
        reader.readAsDataURL(file)
      })))
      setUploads(values)
    } catch (error) { setFileError(error instanceof Error && ['Format lampiran harus PNG, JPG, WebP, atau PDF.', 'Lampiran tidak dapat dibaca.'].includes(error.message) ? error.message : 'Lampiran belum dapat dibaca. Coba pilih kembali berkasnya.') }
    finally { if (fileRef.current) fileRef.current.value = '' }
  }

  async function send(raw: string) {
    const text = raw.trim() || (uploads.length ? 'Baca lampiran ini dan cocokkan dengan rundown aktif.' : '')
    if (!text || pending || !online) return
    const requestSession = activeSession.current
    const history = chatHistory(messages)
    const files = uploads.length ? uploads : [...messages].reverse().find(m => m.files?.length)?.files ?? []
    setMessages((prev) => compactChat([...prev, { id: nextId.current++, role: 'user', text, at: clock(), ...(uploads.length ? { files: uploads, fileNames: uploads.map(file => file.name) } : {}) }]))
    setUploads([])
    setDraft('')
    setPending(true)
    try {
      setLive({ thinking: '', steps: [] })
      const reply = await streamAgent<AgentReply>('/api/support/chat/stream', { message: text, history, attachments: files }, (event) => {
        if (activeSession.current !== requestSession) return
        if (event.type === 'thinking') setLive((prev) => prev && { ...prev, thinking: prev.thinking + event.text })
        else setLive((prev) => prev && { ...prev, steps: upsertStep(prev.steps, event) })
      })
      if (activeSession.current !== requestSession) return
      setMessages((prev) => [...prev, { id: nextId.current++, role: 'assistant', text: reply.answer, at: clock(), source: reply.source, suggestions: reply.suggestions, proposals: reply.proposals, reasoning: reply.reasoning, steps: reply.steps }])
      // Bila agen menerapkan perubahan, segarkan rundown/inbox di halaman yang sedang dibuka.
      if (reply.proposals?.some((p) => p.applied)) refreshQueries()
    } catch (error) {
      if (activeSession.current !== requestSession) return
      const message = userErrorMessage(error, 'chat')
      notifyError(error, { id: 'agent-chat', context: 'chat' })
      setMessages((prev) => [...prev, { id: nextId.current++, role: 'assistant', text: message, at: clock(), error: true }])
    } finally {
      if (activeSession.current === requestSession) { setPending(false); setLive(null) }
    }
  }

  function onInputKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void send(draft)
    }
  }

  return <section className="agent-panel" aria-labelledby={`${uid}-title`}>
    <header className="agent-head">
      <span className="agent-logo" aria-hidden="true"><Icon name="lancara-mark" size={22} /></span>
      <div><h2 id={`${uid}-title`}>Lancara Support</h2><p>AI Assistant</p></div>
    </header>
    <div ref={logRef} className="agent-log" role="log" aria-live="polite" aria-relevant="additions">
      {messages.map((m) => <div key={m.id} className="agent-msg" data-role={m.role} data-error={m.error || undefined}>
        <div className="agent-bubble">
          {m.reasoning && m.reasoning.length > 0 && <details className="support-thinking"><summary>Ringkasan analisis</summary>{m.reasoning.map((r, i) => <p key={i}>{r}</p>)}</details>}
          {m.steps && m.steps.length > 0 && <StepList steps={m.steps} label="Langkah agen" />}
          <p>{m.text}</p>
          {m.error && m.id === messages.at(-1)?.id && <Button variant="outline" size="sm" disabled={pending || !online} onClick={() => {
            const previous = [...messages].reverse().find(message => message.role === 'user')
            if (previous) { setDraft(previous.text); setUploads(previous.files ?? []) }
          }}><Icon name="history" />Siapkan pesan kembali</Button>}
          {m.fileNames?.length ? <p className="muted small"><Icon name="file-up" /> {m.fileNames.join(', ')}</p> : null}
          {m.proposals && m.proposals.length > 0 && <div className="stack">{m.proposals.map((p) => p.preview && !p.applied
            ? <SchedulePreview key={p.change_id} proposal={p} canConfirm={!!session} />
            : <div className="support-links" key={p.change_id}><Button asChild variant="default"><Link className="btn btn-primary btn-compact" href={p.href}>{p.label}</Link></Button></div>)}</div>}
          {m.suggestions && m.suggestions.length > 0 && <div className="support-links">{m.suggestions.map((s) => <Button key={s.href} asChild variant="outline"><Link className="btn btn-compact" href={s.href}>{s.label}</Link></Button>)}</div>}
        </div>
        {m.at && <span className="agent-time">{m.at}</span>}
      </div>)}
      {pending && <div className="agent-msg" data-role="assistant" role="status">
        <div className="agent-bubble">
          {live?.thinking && <details open className="support-thinking"><summary>Proses berpikir</summary><p className="support-stream">{live.thinking}</p></details>}
          {live && live.steps.length > 0 && <StepList steps={live.steps} label="Langkah agen" />}
          <p className="muted">Sedang membaca konteks dan menjalankan tugas…</p>
        </div>
      </div>}
    </div>
    <div className="agent-foot">
      {!online && <p className="lc-alert" data-tone="warning">Tidak ada koneksi. AI memerlukan server.</p>}
      {fileError && <p className="lc-alert" data-tone="warning" role="alert">{fileError}</p>}
      {uploads.length > 0 && <div className="row">{uploads.map((file, index) => <Button variant="outline" type="button" className="btn btn-compact" key={`${file.name}-${index}`} onClick={() => setUploads(prev => prev.filter((_, i) => i !== index))} aria-label={`Hapus lampiran ${file.name}`}><Icon name="file-up" />{file.name} ×</Button>)}</div>}
      <form className="agent-form" onSubmit={(event: FormEvent) => { event.preventDefault(); void send(draft) }}>
        <Label htmlFor={`${uid}-input`} className="sr-only">Pesan untuk AI Assistant</Label>
        <Input ref={fileRef} type="file" className="sr-only" accept="image/png,image/jpeg,image/webp,application/pdf" multiple disabled={pending} aria-label="Lampirkan gambar atau PDF" onChange={event => void attach(event.target.files)} />
        <Button variant="outline" type="button" className="btn btn-compact" aria-label="Pilih gambar atau PDF" title="Gambar/PDF, total maksimal 2 MB" disabled={pending || !online} onClick={() => fileRef.current?.click()}><Icon name="file-up" /></Button>
        <Textarea id={`${uid}-input`} rows={1} maxLength={MAX_MESSAGE} value={draft} disabled={pending} placeholder="Apa yang mau anda ubah?" onChange={(e) => setDraft(e.target.value)} onKeyDown={onInputKey} />
        <Button variant="default" size="icon" type="submit" className="agent-send" aria-label="Kirim pesan" disabled={pending || (!draft.trim() && !uploads.length) || !online}><Icon name="send" size={18} /></Button>
      </form>
      <p className="agent-disclaimer">*Mohon periksa kembali, AI bisa keliru.</p>
    </div>
  </section>
}
