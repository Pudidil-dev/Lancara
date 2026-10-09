import type { ApiError } from './api-client'

export interface PollingSnapshot<T> {
  data: T | null
  error: ApiError | null
  lastRefreshed: string | null
}

export const EMPTY_SNAPSHOT: PollingSnapshot<never> = { data: null, error: null, lastRefreshed: null }

interface Entry {
  snapshot: PollingSnapshot<unknown>
  subscribers: Map<symbol, { notify: () => void; intervalMs: number }>
  inFlight: Promise<void> | null
  revision: number
  stale: boolean
  updatedAt: number
  timer: ReturnType<typeof setInterval> | null
  intervalMs: number
}

/** Satu instance per provider React di browser, bukan cache global server atau penyimpanan persisten. */
export function createPollingStore(load: (path: string) => Promise<unknown>, canFetch: () => boolean = () => true) {
  const entries = new Map<string, Entry>()

  function entryFor(path: string): Entry {
    let entry = entries.get(path)
    if (!entry) {
      entry = { snapshot: EMPTY_SNAPSHOT, subscribers: new Map(), inFlight: null, revision: 0, stale: true, updatedAt: 0, timer: null, intervalMs: 0 }
      entries.set(path, entry)
    }
    return entry
  }

  function publish(entry: Entry, snapshot: PollingSnapshot<unknown>) {
    entry.snapshot = snapshot
    for (const { notify } of entry.subscribers.values()) notify()
  }

  function refresh(path: string, invalidate = false): Promise<void> {
    const entry = entryFor(path)
    if (invalidate) { entry.revision++; entry.stale = true }
    if (entry.inFlight) return entry.inFlight
    if (!canFetch()) return Promise.resolve()
    const revision = entry.revision
    const task = (async () => {
      try {
        const data = await load(path)
        // GET yang dimulai sebelum commit/logout tidak boleh mengembalikan data lama ke layar.
        if (revision !== entry.revision) return
        entry.updatedAt = Date.now()
        entry.stale = false
        publish(entry, { data, error: null, lastRefreshed: new Date(entry.updatedAt).toISOString() })
      } catch (error) {
        if (revision === entry.revision) publish(entry, { ...entry.snapshot, error: error as ApiError })
      }
    })().finally(async () => {
      entry.inFlight = null
      if (revision !== entry.revision && entry.subscribers.size) await refresh(path)
    })
    entry.inFlight = task
    return task
  }

  function schedule(path: string, entry: Entry) {
    const intervals = [...entry.subscribers.values()].map((s) => s.intervalMs).filter((ms) => ms > 0)
    const intervalMs = intervals.length ? Math.min(...intervals) : 0
    if (intervalMs === entry.intervalMs) return
    if (entry.timer !== null) clearInterval(entry.timer)
    entry.intervalMs = intervalMs
    entry.timer = intervalMs ? setInterval(() => { void refresh(path) }, intervalMs) : null
  }

  function subscribe(path: string, notify: () => void, intervalMs: number): () => void {
    const entry = entryFor(path)
    const id = Symbol(path)
    entry.subscribers.set(id, { notify, intervalMs })
    schedule(path, entry)
    const maxAge = intervalMs > 0 ? intervalMs : 5000
    if (entry.stale || Date.now() - entry.updatedAt >= maxAge) void refresh(path)
    return () => { entry.subscribers.delete(id); schedule(path, entry) }
  }

  async function refreshAll(invalidate = false): Promise<void> {
    await Promise.all([...entries].map(([path, entry]) => {
      if (entry.subscribers.size) return refresh(path, invalidate)
      if (invalidate) { entry.revision++; entry.stale = true }
      return Promise.resolve()
    }))
  }

  async function reset(): Promise<void> {
    for (const entry of entries.values()) {
      entry.revision++; entry.stale = true; entry.updatedAt = 0
      publish(entry, EMPTY_SNAPSHOT)
    }
    await refreshAll()
  }

  return {
    getSnapshot<T>(path: string | null): PollingSnapshot<T> { return (path ? entryFor(path).snapshot : EMPTY_SNAPSHOT) as PollingSnapshot<T> },
    subscribe, refresh, refreshAll, reset,
  }
}

export type PollingStore = ReturnType<typeof createPollingStore>
