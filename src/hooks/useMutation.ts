'use client'
import { useRef, useState } from 'react'
import { api, ApiError, newIdempotencyKey, toApiError } from '@/lib/api-client'
import { notifyError, toast } from '@/lib/notifications'
import { errorFeedback } from '@/lib/error-feedback'
import { refreshQueries, resetQueries } from './usePolling'
export type RequestStatus<T = unknown> = { status: 'not_found'; note: string } | { status: 'committed'; operation: string; result: T }
export function checkRequest<T = unknown>(key: string) { return api<RequestStatus<T>>(`/api/requests/${encodeURIComponent(key)}`) }
type MutationInput = { path: string; method?: string; body?: Record<string, unknown>; idempotent?: boolean; timeoutMs?: number }
export function useMutation() {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const intent = useRef<{ signature: string; key: string } | null>(null)
  const busy = useRef<Promise<unknown> | null>(null)
  const [key, setKey] = useState<string | null>(null)
  function reset() { if (!busy.current) { if (intent.current) toast.dismiss(`mutation:${intent.current.key}`); intent.current = null; setKey(null); setError(null) } }
  async function mutate<T>({ path, method = 'POST', body = {}, idempotent = true, timeoutMs }: MutationInput): Promise<T> {
    // Double clicks share the promise; retries of a failed intent keep its key.
    if (busy.current) return busy.current as Promise<T>
    const signature = JSON.stringify([path, method, body])
    if (!intent.current || intent.current.signature !== signature) intent.current = { signature, key: newIdempotencyKey() }
    const requestKey = intent.current.key
    setKey(requestKey); setPending(true); setError(null)
    function accept(result: T): T { toast.dismiss(`mutation:${requestKey}`); intent.current = null; if (path === '/api/session' || path === '/api/session/event') resetQueries(); else refreshQueries(); return result }
    const task = (async () => {
    try { return accept(await api<T>(path, { method, body: idempotent ? { ...body, idempotency_key: requestKey } : body, timeoutMs })) }
    catch (e) {
      const failure = toApiError(e, 'write')
      const uncertain = errorFeedback(failure, 'write').uncertain
      // A lost response is resolved against the server record before it reaches the UI.
      if (idempotent && uncertain) {
        try { const status = await checkRequest<T>(requestKey); if (status.status === 'committed') return accept(status.result) }
        catch { /* Keep the same intent; dedicated approval flows continue reconciliation. */ }
      }
      setError(failure)
      if (!uncertain) notifyError(failure, { id: `mutation:${requestKey}`, context: 'write' })
      throw failure
    }
    finally { busy.current = null; setPending(false) }
    })()
    busy.current = task
    return task
  }
  return { mutate, pending, error, key, reset, checkRequest }
}
