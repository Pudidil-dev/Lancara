'use client'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from '@/lib/api-client'
import { createPollingStore, type PollingStore } from '@/lib/polling-store'
import { clearChatMemory } from '@/components/agent/chat-memory'

export const REFRESH_EVENT = 'ripple:refresh'
const RESET_EVENT = 'ripple:reset'
const PollingContext = createContext<PollingStore | null>(null)

export function refreshQueries() { window.dispatchEvent(new Event(REFRESH_EVENT)) }
/** Hapus data sesi/akun lama setelah login, register, atau logout berhasil di server. */
export function resetQueries() {
  try { clearChatMemory(sessionStorage) } catch { /* Penyimpanan tab opsional. */ }
  window.dispatchEvent(new Event(RESET_EVENT))
}

export function PollingProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => createPollingStore((path) => api(path), () => navigator.onLine && !document.hidden))
  useEffect(() => {
    const resume = () => { void store.refreshAll() }
    const invalidate = () => { void store.refreshAll(true) }
    const reset = () => { void store.reset() }
    for (const event of ['focus', 'online']) window.addEventListener(event, resume)
    document.addEventListener('visibilitychange', resume)
    window.addEventListener(REFRESH_EVENT, invalidate)
    window.addEventListener(RESET_EVENT, reset)
    return () => {
      for (const event of ['focus', 'online']) window.removeEventListener(event, resume)
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener(REFRESH_EVENT, invalidate)
      window.removeEventListener(RESET_EVENT, reset)
    }
  }, [store])
  return <PollingContext.Provider value={store}>{children}</PollingContext.Provider>
}

export function usePollingStore(): PollingStore {
  const store = useContext(PollingContext)
  if (!store) throw new Error('usePolling memerlukan PollingProvider.')
  return store
}
