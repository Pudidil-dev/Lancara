import { randomUUID } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { env } from './env'
import { AppError } from './errors'
import { log } from './logger'

export interface RouteCtx<P> {
  params: Promise<P>
}

type Handler<P> = (req: NextRequest, ctx: { params: P; requestId: string }) => Promise<unknown>

function allowedOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return false
  const configured = env().APP_BASE_URL
  if (configured && new URL(configured).origin === origin) return true
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  return !!host && new URL(origin).host === host
}

/** Pembungkus route: request_id, envelope error {code,message,request_id,details}, proteksi origin/CSRF untuk mutation. */
export function route<P = Record<string, string>>(operation: string, handler: Handler<P>, opts: { mutation?: boolean } = {}) {
  return async (req: NextRequest, ctx: RouteCtx<P>) => {
    const requestId = randomUUID()
    const started = performance.now()
    try {
      if (opts.mutation) {
        if (!allowedOrigin(req)) throw new AppError('FORBIDDEN', 'Origin permintaan tidak diizinkan.')
        if (!(req.headers.get('content-type') ?? '').includes('application/json')) {
          throw new AppError('VALIDATION_ERROR', 'Content-Type harus application/json.')
        }
      }
      const params = ((await ctx?.params) ?? {}) as P
      const data = await handler(req, { params, requestId })
      log('info', 'request', { request_id: requestId, operation, result: 'ok', ms: Math.round(performance.now() - started) })
      if (data instanceof NextResponse) {
        data.headers.set('x-request-id', requestId)
        return data
      }
      return NextResponse.json({ data, request_id: requestId }, { headers: { 'x-request-id': requestId, 'cache-control': 'no-store' } })
    } catch (error) {
      const app = error instanceof AppError ? error : new AppError('INTERNAL', 'Terjadi kesalahan server.')
      log(app.status >= 500 ? 'error' : 'warn', 'request', {
        request_id: requestId,
        operation,
        result: app.code,
        ms: Math.round(performance.now() - started),
        ...(error instanceof AppError ? {} : { cause: String((error as Error)?.message ?? error).slice(0, 200) }),
      })
      return NextResponse.json(
        { code: app.code, message: app.message, request_id: requestId, details: app.details },
        { status: app.status, headers: { 'x-request-id': requestId, 'cache-control': 'no-store' } },
      )
    }
  }
}

export async function body<T>(req: NextRequest, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Body bukan JSON valid.')
  }
  return parseInput(schema, raw)
}

export function parseInput<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Input tidak valid.', parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })))
  }
  return parsed.data
}

export const IdempotencyKey = z.string().min(8).max(100)
