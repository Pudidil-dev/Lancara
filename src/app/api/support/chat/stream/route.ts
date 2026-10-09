import { NextResponse } from 'next/server'
import { AppError } from '@/lib/errors'
import { body, route } from '@/lib/http'
import { log } from '@/lib/logger'
import { requireSession } from '@/lib/session'
import { answerSupport } from '@/modules/support/service'
import { SupportInput } from '@/modules/support/input'

export const dynamic = 'force-dynamic'
// Loop tool bisa beberapa putaran model; batas durasi fungsi serverless dinaikkan agar tidak terpotong.
export const maxDuration = 240

/**
 * Stream NDJSON: satu objek JSON per baris. Tipe event: thinking (potongan reasoning), tool (running/done),
 * done (jawaban final, bentuknya sama dengan /api/support/chat), error (kode dan pesan aman).
 * Validasi, origin, dan sesi tetap dijalankan route() sebelum stream dibuka.
 */
export const POST = route(
  'support.chat.stream',
  async (req) => {
    const session = await requireSession(req)
    const input = await body(req, SupportInput)
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: object) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
        try {
          const reply = await answerSupport(session, input.message, input.history ?? [], (event) => send(event), input.attachments ?? [])
          send({ type: 'done', reply })
        } catch (error) {
          const app = error instanceof AppError ? error : null
          if (!app) log('error', 'support_stream', { cause: String((error as Error)?.name ?? 'error') })
          send({ type: 'error', code: app?.code ?? 'INTERNAL', message: app?.message ?? 'AI Agent belum dapat menyelesaikan tugas sekarang. Coba lagi sebentar.' })
        } finally {
          controller.close()
        }
      },
    })
    return new NextResponse(stream, {
      headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' },
    })
  },
  { mutation: true },
)
