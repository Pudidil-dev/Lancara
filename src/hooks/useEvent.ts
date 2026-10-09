'use client'
import { usePolling } from './usePolling'
import type { SessionResponse } from './types'

/** ID aktif berasal dari sesi server; tidak ada fallback ke event demo milik akun lain. */
export function useEvent() {
  const query = usePolling<SessionResponse>('/api/session', { intervalMs: 30000 })
  const eventId = query.data?.session?.event_id ?? null
  return { eventId, rundownPath: eventId ? `/api/events/${eventId}/rundown` : null }
}
