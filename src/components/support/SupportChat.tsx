'use client'
import Link from 'next/link'
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { api, ApiError } from '@/lib/api-client'
import { useOnline } from '@/hooks/useOnline'

interface Suggestion { label: string; href: string }
interface SupportReply { answer: string; source: 'rule' | 'ai'; suggestions: Suggestion[] }
interface Message {
  id: number
  role: 'user' | 'assistant'
  text: string
  source?: 'rule' | 'ai'
  suggestions?: Suggestion[]
  error?: boolean
}

const MAX_MESSAGE = 500
const GREETING = 'Halo. Saya asisten bantuan Ripple. Saya bisa menjelaskan cara melapor perubahan, membaca rundown, persetujuan, dan brief. Saya tidak mengubah rundown; tindakan tetap dilakukan di halaman terkait.'
const QUICK = ['Bagaimana cara melapor perubahan?', 'Kenapa tidak ada opsi?', 'Siapa yang bisa menyetujui?', 'Apa arti status Terkunci?']

/** Asisten bantuan di pojok kanan bawah. Hanya menjawab; tidak pernah mengubah data. */
export function SupportChat() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([{ id: 0, role: 'assistant', text: GREETING }])
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const nextId = useRef(1)
  const launcherRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const online = useOnline()
  const uid = useId()

  useEffect(() => { if (open) inputRef.current?.focus() }, [open])
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }) }, [messages, pending])

  async function send(raw: string) {
    const text = raw.trim()
    if (!text || pending || !online) return
    const history = messages.filter(m => !m.error).slice(-4).map(m => ({ role: m.role, text: m.text.slice(0, MAX_MESSAGE) }))
    setMessages(prev => [...prev, { id: nextId.current++, role: 'user', text }])
    setDraft('')
    setPending(true)
    try {
      const reply = await api<SupportReply>('/api/support/chat', { method: 'POST', body: { message: text, history } })
      setMessages(prev => [...prev, { id: nextId.current++, role: 'assistant', text: reply.answer, source: reply.source, suggestions: reply.suggestions }])
    } catch (error) {
      const message = error instanceof ApiError && error.code === 'RATE_LIMITED' ? error.message : 'Asisten belum bisa menjawab sekarang. Coba lagi sebentar.'
      setMessages(prev => [...prev, { id: nextId.current++, role: 'assistant', text: message, error: true }])
    } finally {
      setPending(false)
    }
  }

  function close() {
    setOpen(false)
    launcherRef.current?.focus()
  }

  function onPanelKey(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') { event.stopPropagation(); close() }
  }

  function onInputKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void send(draft)
    }
  }

  return <div className="support-root">
    {open && <section id={`${uid}-panel`} className="support-panel" role="dialog" aria-labelledby={`${uid}-title`} onKeyDown={onPanelKey}>
      <header className="support-head">
        <div>
          <h2 id={`${uid}-title`}>Asisten Ripple</h2>
          <p className="muted small">Simulasi · jawaban dibatasi pada aplikasi Ripple</p>
        </div>
        <button type="button" className="btn btn-compact" aria-label="Tutup asisten" onClick={close}>×</button>
      </header>
      <div ref={logRef} className="support-log" role="log" aria-live="polite" aria-relevant="additions">
        {messages.map(m => <div key={m.id} className={`support-msg support-${m.role}`} data-error={m.error || undefined}>
          <p>{m.text}</p>
          {m.role === 'assistant' && m.source && <span className="support-source">{m.source === 'ai' ? 'Jawaban AI' : 'Jawaban dari panduan Ripple'}</span>}
          {m.suggestions && m.suggestions.length > 0 && <div className="support-links">{m.suggestions.map(s => <Link key={s.href} className="btn btn-compact" href={s.href}>{s.label}</Link>)}</div>}
        </div>)}
        {pending && <p role="status" className="muted small">Mengetik…</p>}
      </div>
      <div className="support-quick" aria-label="Pertanyaan cepat">
        {QUICK.map(q => <button key={q} type="button" className="btn btn-compact" disabled={pending || !online} onClick={() => void send(q)}>{q}</button>)}
      </div>
      {!online && <p className="alert alert-action support-offline">Tidak ada koneksi. Asisten memerlukan server.</p>}
      <form className="support-form" onSubmit={(event: FormEvent) => { event.preventDefault(); void send(draft) }}>
        <label htmlFor={`${uid}-input`} className="sr-only">Tulis pertanyaan tentang Ripple</label>
        <textarea id={`${uid}-input`} ref={inputRef} rows={2} maxLength={MAX_MESSAGE} value={draft} disabled={pending} placeholder="Tulis pertanyaan…" onChange={e => setDraft(e.target.value)} onKeyDown={onInputKey} />
        <button type="submit" className="btn btn-primary" disabled={pending || !draft.trim() || !online}>Kirim</button>
      </form>
    </section>}
    <button ref={launcherRef} type="button" className="support-launcher" aria-expanded={open} aria-controls={`${uid}-panel`} onClick={() => setOpen(v => !v)}>
      {open ? 'Tutup bantuan' : 'Tanya bantuan'}
    </button>
  </div>
}
