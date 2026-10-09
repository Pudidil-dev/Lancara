import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api-client'
import { createPollingStore } from '@/lib/polling-store'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

afterEach(() => { vi.useRealTimers() })

describe('pengambilan data workspace bersama', () => {
  it('tiga konsumen berbagi satu request sesi dan satu timer', async () => {
    vi.useFakeTimers()
    const pending = deferred<unknown>()
    const load = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue({ version: 2 })
    const store = createPollingStore(load)
    const stops = Array.from({ length: 3 }, () => store.subscribe('/api/session', vi.fn(), 5000))
    expect(load).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(1)
    pending.resolve({ version: 1 })
    await store.refresh('/api/session')
    await vi.advanceTimersByTimeAsync(5000)
    expect(load).toHaveBeenCalledTimes(2)
    expect(store.getSnapshot<{ version: number }>('/api/session').data?.version).toBe(2)
    stops.forEach((stop) => stop())
    expect(vi.getTimerCount()).toBe(0)
  })

  it('pindah halaman memakai data yang sudah tersedia tanpa request tambahan selama masih segar', async () => {
    vi.useFakeTimers()
    const load = vi.fn().mockResolvedValue({ version: 1 })
    const store = createPollingStore(load)
    const stop = store.subscribe('/rundown', vi.fn(), 5000)
    await store.refresh('/rundown')
    const snapshot = store.getSnapshot('/rundown')
    stop()
    const stopNext = store.subscribe('/rundown', vi.fn(), 5000)
    expect(store.getSnapshot('/rundown')).toBe(snapshot)
    expect(load).toHaveBeenCalledTimes(1)
    stopNext()
    await vi.advanceTimersByTimeAsync(5001)
    const stopStale = store.subscribe('/rundown', vi.fn(), 5000)
    await store.refresh('/rundown')
    expect(load).toHaveBeenCalledTimes(2)
    stopStale()
  })

  it('commit saat GET masih berjalan memicu satu GET baru dan mengabaikan respons lama', async () => {
    const old = deferred<unknown>()
    const fresh = deferred<unknown>()
    const load = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    const store = createPollingStore(load)
    const stop = store.subscribe('/rundown', vi.fn(), 0)
    const refreshed = store.refresh('/rundown', true)
    old.resolve({ version: 1 })
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2))
    expect(store.getSnapshot('/rundown').data).toBeNull()
    fresh.resolve({ version: 2 })
    await refreshed
    expect(store.getSnapshot<{ version: number }>('/rundown').data?.version).toBe(2)
    stop()
  })

  it('invalidation juga menandai data halaman yang sedang tidak dibuka', async () => {
    const load = vi.fn().mockResolvedValueOnce({ version: 1 }).mockResolvedValue({ version: 2 })
    const store = createPollingStore(load)
    const stop = store.subscribe('/history', vi.fn(), 10000)
    await store.refresh('/history')
    stop()
    await store.refreshAll(true)
    expect(load).toHaveBeenCalledTimes(1)
    const stopNext = store.subscribe('/history', vi.fn(), 10000)
    await store.refresh('/history')
    expect(store.getSnapshot<{ version: number }>('/history').data?.version).toBe(2)
    stopNext()
  })

  it('refresh eksplisit setelah mutation berbagi GET yang dipicu invalidation', async () => {
    const fresh = deferred<unknown>()
    const load = vi.fn().mockResolvedValueOnce({ version: 1 }).mockReturnValue(fresh.promise)
    const store = createPollingStore(load)
    const stop = store.subscribe('/rundown', vi.fn(), 0)
    await store.refresh('/rundown')
    const invalidated = store.refreshAll(true)
    const manual = store.refresh('/rundown')
    fresh.resolve({ version: 2 })
    await Promise.all([invalidated, manual])
    expect(load).toHaveBeenCalledTimes(2)
    expect(store.getSnapshot<{ version: number }>('/rundown').data?.version).toBe(2)
    stop()
  })

  it('logout membuang data akun dan respons yang terlambat tidak mengisinya kembali', async () => {
    const pending = deferred<unknown>()
    const load = vi.fn().mockReturnValue(pending.promise)
    const store = createPollingStore(load)
    const stop = store.subscribe('/rundown', vi.fn(), 0)
    const task = store.refresh('/rundown')
    stop()
    await store.reset()
    pending.resolve({ private: 'akun lama' })
    await task
    expect(store.getSnapshot('/rundown').data).toBeNull()
  })

  it('gagal mengambil data tetap dapat retry tanpa kehilangan data sebelumnya', async () => {
    const error = new ApiError('NETWORK', 'Tidak ada koneksi.', 0, null, null)
    const load = vi.fn().mockResolvedValueOnce({ version: 1 }).mockRejectedValueOnce(error).mockResolvedValue({ version: 2 })
    const store = createPollingStore(load)
    const stop = store.subscribe('/rundown', vi.fn(), 0)
    await store.refresh('/rundown')
    await store.refresh('/rundown')
    expect(store.getSnapshot('/rundown').error).toBe(error)
    expect(store.getSnapshot<{ version: number }>('/rundown').data?.version).toBe(1)
    await store.refresh('/rundown')
    expect(store.getSnapshot('/rundown').error).toBeNull()
    expect(store.getSnapshot<{ version: number }>('/rundown').data?.version).toBe(2)
    stop()
  })

  it('tidak polling saat offline/tersembunyi dan hanya menyegarkan query aktif saat kembali', async () => {
    vi.useFakeTimers()
    let available = false
    const load = vi.fn().mockResolvedValue({ ok: true })
    const store = createPollingStore(load, () => available)
    const stop = store.subscribe('/rundown', vi.fn(), 5000)
    await vi.advanceTimersByTimeAsync(10000)
    expect(load).not.toHaveBeenCalled()
    available = true
    await store.refreshAll()
    expect(load).toHaveBeenCalledTimes(1)
    stop()
    await store.refreshAll()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('cache dan request terpisah untuk instance workspace berbeda', async () => {
    const load = vi.fn().mockResolvedValue({ ok: true })
    const first = createPollingStore(load)
    const second = createPollingStore(load)
    await Promise.all([first.refresh('/rundown'), second.refresh('/rundown')])
    expect(load).toHaveBeenCalledTimes(2)
  })
})
