'use client'
import { Fragment, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { usePolling } from './usePolling'
import type { SessionResponse } from './types'

/** Ganti seluruh state halaman/draft ketika sesi berpindah event, termasuk pergantian dari tab lain. */
export function EventBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const workspace = ['/rundown', '/inbox', '/history', '/settings', '/changes'].some(path => pathname === path || pathname.startsWith(`${path}/`))
  const query = usePolling<SessionResponse>(workspace ? '/api/session' : null, { intervalMs: 30000 })
  const eventId = query.data?.session?.event_id
  return <Fragment key={eventId ?? 'no-event'}>{children}</Fragment>
}
