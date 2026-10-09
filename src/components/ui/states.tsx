import type { ReactNode } from 'react'
import type { ApiError } from '@/lib/api-client'
export function EmptyState({ title, action }: { title: string; action?: ReactNode }) { return <div className="card empty-state"><span className="empty-icon" aria-hidden="true">○</span><h2>{title}</h2>{action}</div> }
export function ErrorState({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  return <div className="alert alert-blocker" role="alert"><strong>! {error.message}</strong><p className="error-code">{error.code}{error.requestId ? ` · Permintaan ${error.requestId}` : ''}</p>{error.details != null && <details><summary>Rincian</summary><pre>{JSON.stringify(error.details, null, 2)}</pre></details>}{onRetry && <button className="btn" onClick={onRetry}>Coba lagi</button>}</div>
}
export function Loading({ label = 'Memuat…' }: { label?: string }) { return <p role="status" className="loading"><span className="spinner" aria-hidden="true" />{label}</p> }
