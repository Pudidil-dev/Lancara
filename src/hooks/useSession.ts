'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { SessionResponse } from './types'
import { usePolling } from './usePolling'
export function useSession() {
  const router = useRouter()
  const query = usePolling<SessionResponse>('/api/session', { intervalMs: 30000 })
  useEffect(() => { if (query.data && !query.data.session) router.replace('/login') }, [query.data, router])
  return { session: query.data?.session ?? null, loading: !query.data && !query.error, error: query.error, refresh: query.refresh }
}
