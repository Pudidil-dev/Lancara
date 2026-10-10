'use client'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { ErrorState, Icon, Loading , Button, Input } from '@/components/ui'
import { useMutation } from '@/hooks/useMutation'
import { useOnline } from '@/hooks/useOnline'
import { usePolling } from '@/hooks/usePolling'

interface EventOption { id: string; name: string; timezone: string; active_version: number }

export function EventSwitcher({ eventId, eventName }: { eventId: string; eventName: string }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const [switchingTo, setSwitchingTo] = useState<string | null>(null)
  const container = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const id = useId()
  const online = useOnline()
  const events = usePolling<{ events: EventOption[] }>(open ? '/api/events' : null, { intervalMs: 30000 })
  const selection = useMutation()
  const filtered = (events.data?.events ?? []).filter(event => event.name.toLocaleLowerCase('id').includes(search.trim().toLocaleLowerCase('id')))
  const activeIndex = Math.max(0, filtered.findIndex(event => event.id === highlighted))
  const activeOption = filtered[activeIndex]
  const busy = selection.pending

  function close(restoreFocus = false) {
    setOpen(false)
    if (restoreFocus) trigger.current?.focus()
  }
  useEffect(() => {
    if (!open) return
    searchInput.current?.focus()
    const outside = (event: Event) => { if (!container.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', outside)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside) }
  }, [open])

  async function select(option: EventOption) {
    if (busy || !online) return
    if (option.id === eventId) return close(true)
    setSwitchingTo(option.id)
    try {
      await selection.mutate({ path: '/api/session/event', method: 'PUT', body: { event_id: option.id } })
      // Dokumen baru membuang cache, draft impor, dan konteks percakapan event sebelumnya.
      window.location.assign(window.location.pathname === '/rundown' ? '/rundown' : '/')
    } catch { setSwitchingTo(null) }
  }
  function keys(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!filtered.length) return
      const offset = event.key === 'ArrowDown' ? 1 : -1
      const current = filtered.findIndex(option => option.id === highlighted)
      const next = current < 0 ? (offset > 0 ? 0 : filtered.length - 1) : (current + offset + filtered.length) % filtered.length
      setHighlighted(filtered[next].id)
      document.getElementById(`${id}-option-${next}`)?.scrollIntoView({ block: 'nearest' })
    } else if (event.key === 'Enter' && activeOption) {
      event.preventDefault()
      void select(activeOption)
    }
  }

  return <div className="event-switcher" ref={container} onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); close(true) }
  }}>
    <Button variant="ghost" ref={trigger} type="button" className="topbar-title event-switcher-trigger" title={eventName} aria-label={`Pilih event: ${eventName}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={`${id}-panel`} disabled={busy} onClick={() => {
      setSearch(''); setHighlighted(eventId); setOpen(value => !value)
    }}><span>{eventName}</span><Icon name="chevrons-down-up" /></Button>
    {open && <div id={`${id}-panel`} className="event-switcher-panel" role="dialog" aria-label="Pemilih event">
      <div className="event-switcher-search">
        <Icon name="search" />
        <Input ref={searchInput} role="combobox" aria-label="Cari event" aria-autocomplete="list" aria-expanded="true" aria-controls={`${id}-list`} aria-activedescendant={activeOption ? `${id}-option-${activeIndex}` : undefined} placeholder="Cari event…" value={search} onChange={event => { setSearch(event.target.value); setHighlighted(null) }} onKeyDown={keys} />
        <Button variant="ghost" type="button" className="event-switcher-escape" aria-label="Tutup pemilih event" onClick={() => close(true)}>Esc</Button>
      </div>
      {!events.data && !events.error && <div className="event-switcher-message"><Loading label="Memuat event…" /></div>}
      {events.error && <div className="event-switcher-message"><ErrorState error={events.error} onRetry={() => void events.refresh()} /></div>}
      <div id={`${id}-list`} className="event-switcher-list" role="listbox" aria-label="Daftar event" aria-busy={selection.pending}>
        {filtered.map((option, index) => <Button variant="ghost" key={option.id} id={`${id}-option-${index}`} type="button" role="option" tabIndex={-1} aria-selected={option.id === eventId} className="event-switcher-option" data-highlighted={index === activeIndex || undefined} disabled={busy || !online} onPointerMove={() => setHighlighted(option.id)} onClick={() => void select(option)}>
          <span className="event-switcher-avatar"><Icon name="calendar-days" /></span>
          <span className="event-switcher-name">{option.name}</span>
          {switchingTo === option.id ? <span className="event-switcher-current"><Icon name="spinner" />Membuka…</span> : option.id === eventId && <span className="event-switcher-current"><Icon name="check" />Aktif</span>}
        </Button>)}
      </div>
      {events.data && !filtered.length && <p className="event-switcher-message" role="status"><Icon name="search" />{search.trim() ? 'Tidak ada event yang cocok.' : 'Belum ada event tersedia.'}</p>}
      {selection.error && <div className="event-switcher-message"><ErrorState error={selection.error} /></div>}
      {!online && <p className="event-switcher-message" role="status"><Icon name="alert" />Hubungkan internet untuk berpindah event.</p>}
      <p className="event-switcher-footer">↑ ↓ navigasi · Enter pilih · Esc tutup</p>
    </div>}
  </div>
}
