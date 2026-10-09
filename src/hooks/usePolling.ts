'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '@/lib/api-client'
export const REFRESH_EVENT = 'ripple:refresh'
export function refreshQueries() { window.dispatchEvent(new Event(REFRESH_EVENT)) }
export function usePolling<T>(path: string | null, { intervalMs = 5000 }: { intervalMs?: number } = {}) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null)
  const generation = useRef(0)
  const inFlight = useRef<Promise<void> | null>(null)
  const refresh = useCallback(async () => {
    if (!path || !navigator.onLine || document.hidden) return
    if (inFlight.current) return inFlight.current
    const current = generation.current
    const task = (async () => {
      try {
        const result = await api<T>(path)
        if (current !== generation.current) return
        setData(result); setError(null); setLastRefreshed(new Date().toISOString())
      } catch (e) { if (current === generation.current) setError(e as ApiError) }
    })()
    inFlight.current = task
    await task
    if (inFlight.current === task) inFlight.current = null
  }, [path])
  useEffect(() => {
    generation.current++; inFlight.current = null; setData(null); setError(null); setLastRefreshed(null)
    void refresh()
    const trigger = () => { void refresh() }
    const timer = intervalMs > 0 ? window.setInterval(trigger, intervalMs) : null
    for (const event of ['focus', 'online', REFRESH_EVENT]) window.addEventListener(event, trigger)
    document.addEventListener('visibilitychange', trigger)
    return () => {
      generation.current++
      if (timer !== null) clearInterval(timer)
      for (const event of ['focus', 'online', REFRESH_EVENT]) window.removeEventListener(event, trigger)
      document.removeEventListener('visibilitychange', trigger)
    }
  }, [refresh, intervalMs])
  return { data, error, lastRefreshed, refresh }
}
