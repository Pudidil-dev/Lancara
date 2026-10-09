import { z } from 'zod'
import { body, route } from '@/lib/http'
import { requireSession } from '@/lib/session'
import { answerSupport, MAX_MESSAGE } from '@/modules/support/service'

export const dynamic = 'force-dynamic'
// Loop tool bisa beberapa putaran model; batas durasi fungsi serverless dinaikkan agar tidak terpotong.
export const maxDuration = 120

const Input = z.object({
  message: z.string().trim().min(1).max(MAX_MESSAGE),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(MAX_MESSAGE) })).max(6).optional(),
})

export const POST = route(
  'support.chat',
  async (req) => {
    const session = await requireSession(req)
    const input = await body(req, Input)
    return answerSupport(session, input.message, input.history ?? [])
  },
  { mutation: true },
)
