'use client'
import { useRef, useState } from 'react'
import { api, ApiError, newIdempotencyKey } from '@/lib/api-client'
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
  function reset() { if (!busy.current) { intent.current = null; setKey(null); setError(null) } }
  async function mutate<T>({ path, method = 'POST', body = {}, idempotent = true, timeoutMs }: MutationInput): Promise<T> {
    // Double clicks share the promise; retries of a failed intent keep its key.
    if (busy.current) return busy.current as Promise<T>
    const signature = JSON.stringify([path, method, body])
    if (!intent.current || intent.current.signature !== signature) intent.current = { signature, key: newIdempotencyKey() }
    const requestKey = intent.current.key
    setKey(requestKey); setPending(true); setError(null)
    const task = api<T>(path, { method, body: idempotent ? { ...body, idempotency_key: requestKey } : body, timeoutMs })
    busy.current = task
    try { const result = await task; intent.current = null; if (path === '/api/session') resetQueries(); else refreshQueries(); return result }
    catch (e) { setError(e as ApiError); throw e }
    finally { busy.current = null; setPending(false) }
  }
  return { mutate, pending, error, key, reset, checkRequest }
}
