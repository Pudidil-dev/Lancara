'use client'
import Link from 'next/link'
import type { ReactNode } from 'react'
import type { ApiError } from '@/lib/api-client'
import { errorFeedback } from '@/lib/error-feedback'
import { Button } from './button'
import { Icon } from './Icon'

export function EmptyState({ title, action }: { title: string; action?: ReactNode }) { return <div className="card empty-state"><span className="empty-icon" aria-hidden="true">○</span><h2>{title}</h2>{action}</div> }
export function ErrorState({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  const feedback = errorFeedback(error)
  if (error.operation === 'read' && ['TIMEOUT', 'NETWORK', 'STORAGE_UNAVAILABLE'].includes(error.code)) return <div className="ui-read-recovery" role="status">
    <Icon name="info" /><p>Data belum dapat diperbarui. Silakan coba kembali sebentar.</p>
    {onRetry && <Button variant="ghost" size="sm" onClick={onRetry}>Muat kembali</Button>}
  </div>
  return <div className={`ui-error alert ${feedback.tone === 'warning' ? 'alert-action' : 'alert-blocker'}`} role="alert">
    <Icon name={feedback.tone === 'warning' ? 'info' : 'alert'} />
    <div className="ui-error-content"><strong>{feedback.title}</strong><p>{feedback.message}</p>
      {(onRetry && feedback.retryable || error.code === 'UNAUTHENTICATED' || error.code === 'NOT_FOUND') && <div className="ui-error-actions">
        {onRetry && feedback.retryable && <Button variant="outline" onClick={onRetry}><Icon name="history" />Coba lagi</Button>}
        {error.code === 'UNAUTHENTICATED' && <Button asChild><Link href="/login">Masuk kembali</Link></Button>}
        {error.code === 'NOT_FOUND' && <Button variant="outline" asChild><Link href="/">Kembali ke dashboard</Link></Button>}
      </div>}
    </div>
  </div>
}
export function Loading({ label = 'Memuat…' }: { label?: string }) { return <p role="status" className="loading"><span className="spinner" aria-hidden="true" />{label}</p> }
