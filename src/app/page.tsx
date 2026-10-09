'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { usePolling } from '@/hooks/usePolling'
import type { SessionResponse } from '@/hooks/types'
import { ErrorState } from '@/components/ui'
import { WorkspaceLoading } from '@/components/shell/WorkspaceLoading'
export default function Home() {
  const query = usePolling<SessionResponse>('/api/session')
  const router = useRouter()
  useEffect(() => { if (query.data) router.replace(!query.data.session ? '/login' : '/rundown') }, [query.data, router])
  if (query.error && !query.data) return <main className="container ui-error-page"><ErrorState error={query.error} onRetry={() => void query.refresh()} /></main>
  return <WorkspaceLoading />
}
