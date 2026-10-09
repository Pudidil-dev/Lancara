'use client'
import Link from 'next/link'
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { ApiError } from '@/lib/api-client'
import { streamAgent, type AgentStreamEvent } from '@/lib/agent-stream'
import { refreshQueries } from '@/hooks/usePolling'
import { useOnline } from '@/hooks/useOnline'
import { useSession } from '@/hooks/useSession'
import { Icon } from '@/components/ui'
import { SchedulePreview, type ScheduleProposal } from './SchedulePreview'

interface Suggestion { label: string; href: string }
type Proposal = ScheduleProposal
interface Step { tool: string; ok: boolean; note?: string; running?: boolean }
interface AgentReply { answer: string; source: 'rule' | 'ai'; suggestions: Suggestion[]; proposals: Proposal[]; reasoning?: string[]; steps?: Step[] }
interface Message {
  id: number
  role: 'user' | 'assistant'
  text: string
  at: string
  source?: 'rule' | 'ai'
  suggestions?: Suggestion[]
  proposals?: Proposal[]
  reasoning?: string[]
  steps?: Step[]
  error?: boolean
}

const MAX_MESSAGE = 500
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
  return <ul className="support-steps" aria-label={label}>{steps.map((s, i) => <li key={i} data-ok={s.running ? undefined : s.ok}>{s.running ? '…' : s.ok ? '✓' : '!'} {TOOL_LABEL[s.tool] ?? s.tool}{!s.ok && s.note ? ` — ${s.note}` : ''}</li>)}</ul>
}

/** Panel "Lancara Support · AI Assistant" (Figma Dashboard 159:6742): membaca konteks dan bertindak lewat tool website. */
export function AgentChat() {
  const [messages, setMessages] = useState<Message[]>([{ id: 0, role: 'assistant', text: GREETING, at: '' }])
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [live, setLive] = useState<{ thinking: string; steps: Step[] } | null>(null)
  const nextId = useRef(1)
  const logRef = useRef<HTMLDivElement>(null)
  const online = useOnline()
  const { session } = useSession()
  const uid = useId()

  // Jam sapaan diisi di klien agar tidak berbeda dengan render server.
  useEffect(() => { setMessages((prev) => prev.map((m) => (m.id === 0 && !m.at ? { ...m, at: clock() } : m))) }, [])
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }) }, [messages, pending, live])

  async function send(raw: string) {
    const text = raw.trim()
    if (!text || pending || !online) return
    const history = messages.filter((m) => !m.error && m.id !== 0).slice(-6).map((m) => ({ role: m.role, text: m.text.slice(0, MAX_MESSAGE) }))
    setMessages((prev) => [...prev, { id: nextId.current++, role: 'user', text, at: clock() }])
    setDraft('')
    setPending(true)
    try {
      setLive({ thinking: '', steps: [] })
      const reply = await streamAgent<AgentReply>('/api/support/chat/stream', { message: text, history }, (event) => {
        if (event.type === 'thinking') setLive((prev) => prev && { ...prev, thinking: prev.thinking + event.text })
        else setLive((prev) => prev && { ...prev, steps: upsertStep(prev.steps, event) })
      })
      setMessages((prev) => [...prev, { id: nextId.current++, role: 'assistant', text: reply.answer, at: clock(), source: reply.source, suggestions: reply.suggestions, proposals: reply.proposals, reasoning: reply.reasoning, steps: reply.steps }])
      // Bila agen menerapkan perubahan, segarkan rundown/inbox di halaman yang sedang dibuka.
      if (reply.proposals?.some((p) => p.applied)) refreshQueries()
    } catch (error) {
      const message = error instanceof ApiError && error.code === 'RATE_LIMITED' ? error.message : 'AI belum dapat menyelesaikan tugas sekarang. Coba lagi sebentar.'
      setMessages((prev) => [...prev, { id: nextId.current++, role: 'assistant', text: message, at: clock(), error: true }])
    } finally {
      setPending(false)
      setLive(null)
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
      <span className="agent-logo" aria-hidden="true"><Icon name="lancara" size={22} /></span>
      <div><h2 id={`${uid}-title`}>Lancara Support</h2><p>AI Assistant</p></div>
    </header>
    <div ref={logRef} className="agent-log" role="log" aria-live="polite" aria-relevant="additions">
      {messages.map((m) => <div key={m.id} className="agent-msg" data-role={m.role} data-error={m.error || undefined}>
        <div className="agent-bubble">
          {m.reasoning && m.reasoning.length > 0 && <details className="support-thinking"><summary>Ringkasan analisis</summary>{m.reasoning.map((r, i) => <p key={i}>{r}</p>)}</details>}
          {m.steps && m.steps.length > 0 && <StepList steps={m.steps} label="Langkah agen" />}
          <p>{m.text}</p>
          {m.proposals && m.proposals.length > 0 && <div className="stack">{m.proposals.map((p) => p.preview && !p.applied
            ? <SchedulePreview key={p.change_id} proposal={p} canConfirm={!!session} />
            : <div className="support-links" key={p.change_id}><Link className="btn btn-primary btn-compact" href={p.href}>{p.label}</Link></div>)}</div>}
          {m.suggestions && m.suggestions.length > 0 && <div className="support-links">{m.suggestions.map((s) => <Link key={s.href} className="btn btn-compact" href={s.href}>{s.label}</Link>)}</div>}
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
      <form className="agent-form" onSubmit={(event: FormEvent) => { event.preventDefault(); void send(draft) }}>
        <label htmlFor={`${uid}-input`} className="sr-only">Pesan untuk AI Assistant</label>
        <textarea id={`${uid}-input`} rows={1} maxLength={MAX_MESSAGE} value={draft} disabled={pending} placeholder="Apa yang mau anda ubah?" onChange={(e) => setDraft(e.target.value)} onKeyDown={onInputKey} />
        <button type="submit" className="agent-send" aria-label="Kirim pesan" disabled={pending || !draft.trim() || !online}><Icon name="send" size={18} /></button>
      </form>
      <p className="agent-disclaimer">*Mohon periksa kembali, AI bisa keliru.</p>
    </div>
  </section>
}
