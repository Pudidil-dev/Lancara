'use client'

import { useEffect, useState } from 'react'
import { AppShell } from '@/components/shell/AppShell'
import { EmptyState, ErrorState, Loading } from '@/components/ui'
import { BriefCard } from '@/components/briefs/BriefCard'
import type { AckResult, InboxResponse } from '@/components/briefs/types'
import { usePolling } from '@/hooks/usePolling'
import { useSession } from '@/hooks/useSession'
import { EVENT_ID } from '@/hooks/types'
import { formatClock, zoneAbbrev } from '@/lib/time'

export default function InboxPage() {
  const { session } = useSession()
  const query = usePolling<InboxResponse>(session ? `/api/events/${EVENT_ID}/inbox` : null)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [confirmedAcks, setConfirmedAcks] = useState<Record<string, string>>({})
  const [announcement, setAnnouncement] = useState('')
  const [revisionTarget, setRevisionTarget] = useState<string | null>(null)
  const data = query.data
  const briefs = data?.briefs ?? []
  const unread = briefs.filter(brief => !(brief.acknowledged_at ?? confirmedAcks[brief.id])).length
  const visible = unreadOnly ? briefs.filter(brief => !(brief.acknowledged_at ?? confirmedAcks[brief.id])) : briefs

  useEffect(() => {
    if (!revisionTarget) return
    const target = document.getElementById(`brief-${revisionTarget}`)
    if (target) {
      target.scrollIntoView({ block: 'start', behavior: 'auto' })
      target.focus({ preventScroll: true })
      window.history.replaceState(null, '', `#brief-${revisionTarget}`)
      setRevisionTarget(null)
    }
  }, [revisionTarget, unreadOnly, data])

  function acknowledged(result: AckResult) {
    setConfirmedAcks(current => ({ ...current, [result.brief_id]: result.acknowledged_at }))
    const timezone = briefs.find(brief => brief.id === result.brief_id)?.payload.timezone ?? 'Asia/Jakarta'
    setAnnouncement(`Sudah dibaca pukul ${formatClock(result.acknowledged_at, timezone)} ${zoneAbbrev(timezone)} untuk perubahan CH-${result.change_seq} versi ${result.version}.`)
  }

  return <AppShell title="Inbox"><div className="stack">
    <div role="status" aria-live="polite">{announcement}</div>
    {!data && !query.error && <Loading label="Memuat brief acara…" />}
    {query.error && <ErrorState error={query.error} onRetry={() => void query.refresh()} />}
    {data && <>
      <div className="row between"><h2>Brief acara · {unread} belum dibaca</h2><span className="muted">Rundown aktif v{data.active_version}</span></div>
      <div className="pill-filters" role="group" aria-label="Filter brief">
        <button className="btn" aria-pressed={!unreadOnly} onClick={() => setUnreadOnly(false)}>Semua</button>
        <button className="btn" aria-pressed={unreadOnly} onClick={() => setUnreadOnly(true)}>Belum dibaca ({unread})</button>
      </div>
      {briefs.length === 0 ? <EmptyState title="Belum ada brief acara." /> : visible.length === 0 ? <EmptyState title="Semua brief sudah dibaca." action={<button className="btn" onClick={() => setUnreadOnly(false)}>Lihat semua brief</button>} /> : visible.map(brief => <BriefCard key={brief.id} brief={brief} acknowledgedAt={brief.acknowledged_at ?? confirmedAcks[brief.id] ?? null} onAcknowledged={acknowledged} onShowRevision={id => { setUnreadOnly(false); setRevisionTarget(id) }} />)}
    </>}
  </div></AppShell>
}
