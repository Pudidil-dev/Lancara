'use client'
// Klien API untuk komponen React. Envelope sukses: {data, request_id}. Envelope gagal: {code, message, request_id, details}.
// Sukses hanya ditampilkan setelah respons committed; timeout approve → cek GET /api/requests/:key dengan key yang sama.

export type ApiOperation = 'read' | 'write' | 'chat' | 'upload'
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly requestId: string | null,
    readonly details: unknown,
    readonly operation: ApiOperation = 'read',
  ) {
    super(message)
  }
}

export function toApiError(error: unknown, operation: ApiOperation = 'read'): ApiError {
  return error instanceof ApiError ? error : new ApiError('INTERNAL', 'Permintaan belum dapat diselesaikan.', 500, null, null, operation)
}

export function responseError(res: Response, json: unknown, operation: ApiOperation = 'read'): ApiError {
  const value = json && typeof json === 'object' ? json as Record<string, unknown> : {}
  const fallback = ({ 401: 'UNAUTHENTICATED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'INVALID_STATE', 422: 'VALIDATION_ERROR', 429: 'RATE_LIMITED', 503: 'STORAGE_UNAVAILABLE' } as Record<number, string>)[res.status] ?? 'INTERNAL'
  return new ApiError(typeof value.code === 'string' ? value.code : fallback,
    typeof value.message === 'string' ? value.message : 'Permintaan belum dapat diselesaikan.', res.status,
    typeof value.request_id === 'string' ? value.request_id : null, value.details ?? null, operation)
}

export function newIdempotencyKey(): string {
  return `k-${crypto.randomUUID()}`
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; timeoutMs?: number; operation?: ApiOperation } = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase()
  const multipart = typeof FormData !== 'undefined' && init.body instanceof FormData
  const operation = init.operation ?? (method === 'GET' ? 'read' : multipart ? 'upload' : 'write')
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ApiError('OFFLINE', 'Tidak ada koneksi. Perubahan memerlukan server.', 0, null, null, operation)
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 15_000)
  try {
    const res = await fetch(path, {
      method,
      headers: init.body !== undefined && !multipart ? { 'content-type': 'application/json' } : undefined,
      body: multipart ? init.body as FormData : init.body !== undefined ? JSON.stringify(init.body) : undefined,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    })
    const json = await res.json().catch(() => null)
    if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (!res.ok) {
      throw responseError(res, json, operation)
    }
    if (!json || typeof json !== 'object' || !Object.hasOwn(json, 'data')) {
      throw new ApiError('INVALID_RESPONSE', 'Respons server belum lengkap.', res.status, null, null, operation)
    }
    return json.data as T
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (controller.signal.aborted || (error as Error)?.name === 'AbortError') {
      throw new ApiError('TIMEOUT', method === 'GET' ? 'Memuat data memerlukan waktu lebih lama.' : 'Status penyimpanan belum diketahui. Memeriksa permintaan…', 0, null, null, operation)
    }
    throw new ApiError('NETWORK', 'Tidak ada koneksi. Perubahan memerlukan server.', 0, null, null, operation)
  } finally {
    clearTimeout(timer)
  }
}
