import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { env } from './env'
import { AppError } from './errors'
import { log } from './logger'

export interface RouteCtx<P> {
  params: Promise<P>
}

type Handler<P> = (req: NextRequest, ctx: { params: P; requestId: string }) => Promise<unknown>

interface RouteOptions {
  mutation?: boolean
  multipart?: boolean
  webhook?: boolean
}

function isMultipart(req: NextRequest): boolean {
  return /^multipart\/form-data(?:\s*;|$)/i.test(req.headers.get('content-type') ?? '')
}

function validWebhookSecret(req: NextRequest): boolean {
  const expected = env().TELEGRAM_WEBHOOK_SECRET
  const given = req.headers.get('x-telegram-bot-api-secret-token')
  if (!expected || !given) return false
  // Digest berukuran sama: timingSafeEqual tidak melempar untuk panjang token berbeda.
  const digest = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(digest(expected), digest(given))
}

function allowedOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return false
  const configured = env().APP_BASE_URL
  if (configured && new URL(configured).origin === origin) return true
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  return !!host && new URL(origin).host === host
}

/** Pembungkus route: request_id, envelope error {code,message,request_id,details}, proteksi origin/CSRF untuk mutation. */
export function route<P = Record<string, string>>(operation: string, handler: Handler<P>, opts: RouteOptions = {}) {
  return async (req: NextRequest, ctx: RouteCtx<P>) => {
    const requestId = randomUUID()
    const started = performance.now()
    try {
      if (opts.webhook) {
        if (opts.multipart) throw new AppError('VALIDATION_ERROR', 'Webhook tidak menerima unggahan multipart.')
        if (!validWebhookSecret(req)) throw new AppError('FORBIDDEN', 'Secret webhook tidak valid.')
      } else if (opts.mutation || opts.multipart) {
        if (!allowedOrigin(req)) throw new AppError('FORBIDDEN', 'Origin permintaan tidak diizinkan.')
        if (opts.multipart && !isMultipart(req)) {
          throw new AppError('VALIDATION_ERROR', 'Content-Type harus multipart/form-data.')
        }
        if (!opts.multipart && !(req.headers.get('content-type') ?? '').includes('application/json')) {
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
        ...(error instanceof AppError || opts.webhook ? {} : { cause: String((error as Error)?.message ?? error).slice(0, 200) }),
      })
      return NextResponse.json(
        { code: app.code, message: app.message, request_id: requestId, details: app.details },
        { status: app.status, headers: { 'x-request-id': requestId, 'cache-control': 'no-store' } },
      )
    }
  }
}

class FileTooLargeError extends AppError {
  override readonly status = 413

  constructor(maxBytes: number) {
    super('VALIDATION_ERROR', 'Ukuran berkas melebihi batas unggahan.', { max_bytes: maxBytes })
  }
}

/** Baca unggahan secara terbatas sebelum parser multipart; tanpa write filesystem. */
export async function readFile(req: NextRequest, { maxBytes }: { maxBytes: number }): Promise<{ name: string; bytes: Uint8Array; fields: Record<string, string> }> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > 4 * 1024 * 1024) {
    throw new AppError('VALIDATION_ERROR', 'Batas unggahan harus antara 1 byte dan 4 MB.')
  }
  if (!isMultipart(req)) throw new AppError('VALIDATION_ERROR', 'Content-Type harus multipart/form-data.')
  // Batas berkas ditambah overhead multipart maksimal 64 KB; field tambahan tetap dibatasi.
  const maxBodyBytes = maxBytes + 64 * 1024
  const declared = req.headers.get('content-length')
  if (declared && /^\d+$/.test(declared) && Number(declared) > maxBodyBytes) throw new FileTooLargeError(maxBytes)
  if (!req.body || req.bodyUsed) throw new AppError('VALIDATION_ERROR', 'Body unggahan kosong atau sudah dibaca.')

  const reader = req.body.getReader()
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBodyBytes) {
        await reader.cancel().catch(() => undefined)
        throw new FileTooLargeError(maxBytes)
      }
      chunks.push(new Uint8Array(value))
    }
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError('VALIDATION_ERROR', 'Unggahan tidak dapat dibaca.')
  } finally {
    reader.releaseLock()
  }

  let form: FormData
  try {
    form = await new Response(new Blob(chunks), { headers: { 'content-type': req.headers.get('content-type')! } }).formData()
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Data unggahan multipart tidak valid.')
  }
  const files = form.getAll('file')
  const file = files[0]
  if (files.length !== 1 || !file || typeof file === 'string' || file.size === 0) {
    throw new AppError('VALIDATION_ERROR', 'Pilih tepat satu berkas yang tidak kosong pada field file.')
  }
  if (file.size > maxBytes) throw new FileTooLargeError(maxBytes)
  const name = file.name.replace(/\\/g, '/').split('/').pop()!.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').slice(0, 200).trim()
  if (!name || name === '.' || name === '..') throw new AppError('VALIDATION_ERROR', 'Nama berkas tidak valid.')
  // Field teks lain (mis. rentang halaman, pengaturan) dibatasi jumlah dan panjangnya; validasi isi di pemanggil.
  const fields: Record<string, string> = {}
  for (const [key, value] of form.entries()) {
    if (key === 'file' || typeof value !== 'string' || Object.keys(fields).length >= 10) continue
    fields[key.slice(0, 40)] = value.slice(0, 2000)
  }
  return { name, bytes: new Uint8Array(await file.arrayBuffer()), fields }
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
