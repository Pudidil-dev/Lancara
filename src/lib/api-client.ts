'use client'
// Klien API untuk komponen React. Envelope sukses: {data, request_id}. Envelope gagal: {code, message, request_id, details}.
// Sukses hanya ditampilkan setelah respons committed; timeout approve → cek GET /api/requests/:key dengan key yang sama.

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly requestId: string | null,
    readonly details: unknown,
  ) {
    super(message)
  }
}

export function newIdempotencyKey(): string {
  return `k-${crypto.randomUUID()}`
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  if (typeof navigator !== 'undefined' && !navigator.onLine && init.method && init.method !== 'GET') {
    throw new ApiError('OFFLINE', 'Tidak ada koneksi. Perubahan memerlukan server.', 0, null, null)
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 15_000)
  try {
    const res = await fetch(path, {
      method: init.method ?? 'GET',
      headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    })
    const json = await res.json().catch(() => null)
    if (!res.ok) {
      throw new ApiError(json?.code ?? 'INTERNAL', json?.message ?? `HTTP ${res.status}`, res.status, json?.request_id ?? null, json?.details ?? null)
    }
    return json.data as T
  } catch (error) {
    if (error instanceof ApiError) throw error
    if ((error as Error).name === 'AbortError') {
      throw new ApiError('TIMEOUT', 'Status penyimpanan belum diketahui. Memeriksa permintaan…', 0, null, null)
    }
    throw new ApiError('NETWORK', 'Tidak ada koneksi. Perubahan memerlukan server.', 0, null, null)
  } finally {
    clearTimeout(timer)
  }
}
