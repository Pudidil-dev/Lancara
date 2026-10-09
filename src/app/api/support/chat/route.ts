import { body, route } from '@/lib/http'
import { requireSession } from '@/lib/session'
import { answerSupport } from '@/modules/support/service'
import { SupportInput } from '@/modules/support/input'

export const dynamic = 'force-dynamic'
// Loop tool bisa beberapa putaran model; batas durasi fungsi serverless dinaikkan agar tidak terpotong.
export const maxDuration = 240

export const POST = route(
  'support.chat',
  async (req) => {
    const session = await requireSession(req)
    const input = await body(req, SupportInput)
    return answerSupport(session, input.message, input.history ?? [], undefined, input.attachments ?? [])
  },
  { mutation: true },
)
