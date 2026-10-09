export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'MISSING_DATA'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'STALE_VERSION'
  | 'CONTEXT_CHANGED'
  | 'PATCH_BLOCKED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'INVALID_STATE'
  | 'RATE_LIMITED'
  | 'AI_UNAVAILABLE'
  | 'STORAGE_UNAVAILABLE'
  | 'INTERNAL'

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 422,
  MISSING_DATA: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  STALE_VERSION: 409,
  CONTEXT_CHANGED: 409,
  PATCH_BLOCKED: 422,
  IDEMPOTENCY_CONFLICT: 409,
  INVALID_STATE: 409,
  RATE_LIMITED: 429,
  AI_UNAVAILABLE: 503,
  STORAGE_UNAVAILABLE: 503,
  INTERNAL: 500,
}

export class AppError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly details: unknown

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message)
    this.code = code
    this.status = STATUS[code]
    this.details = details ?? null
  }
}

export const forbidden = (message = 'Operasi ini tidak diizinkan untuk peran Anda.') => new AppError('FORBIDDEN', message)
export const notFound = (what: string) => new AppError('NOT_FOUND', `${what} tidak ditemukan untuk session ini.`)
