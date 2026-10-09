'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { usePolling } from '@/hooks/usePolling'
import type { SessionResponse } from '@/hooks/types'
import { ErrorState, Loading } from '@/components/ui'
export default function Home() {
  const query = usePolling<SessionResponse>('/api/session')
  const router = useRouter()
  useEffect(() => { if (query.data) router.replace(!query.data.session ? '/login' : query.data.session.capability === 'coordinator' ? '/rundown' : '/inbox') }, [query.data, router])
  return <main className="container">{query.error ? <ErrorState error={query.error} onRetry={() => void query.refresh()} /> : <Loading label="Membuka ruang kerja…" />}</main>
}
