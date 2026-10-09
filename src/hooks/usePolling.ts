'use client'
import { useCallback, useSyncExternalStore } from 'react'
import { EMPTY_SNAPSHOT, type PollingSnapshot } from '@/lib/polling-store'
import { usePollingStore } from './PollingProvider'
export { REFRESH_EVENT, refreshQueries, resetQueries } from './PollingProvider'
export function usePolling<T>(path: string | null, { intervalMs = 5000 }: { intervalMs?: number } = {}) {
  const store = usePollingStore()
  const subscribe = useCallback((notify: () => void) => path ? store.subscribe(path, notify, intervalMs) : () => {}, [store, path, intervalMs])
  const getSnapshot = useCallback(() => store.getSnapshot<T>(path), [store, path])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_SNAPSHOT as PollingSnapshot<T>)
  // Mutation sudah menginvalidasi query; refresh eksplisit bergabung dengan GET baru tersebut.
  const refresh = useCallback(() => path ? store.refresh(path) : Promise.resolve(), [store, path])
  return { ...snapshot, refresh }
}
