import { z } from 'zod'
import { body, IdempotencyKey, route } from '@/lib/http'
import { requireSession } from '@/lib/session'
import { rejectChange } from '@/modules/changes/service'

export const dynamic = 'force-dynamic'

const Input = z.object({ reason: z.string().trim().min(3).max(500), idempotency_key: IdempotencyKey })

export const POST = route<{ id: string }>(
  'change.reject',
  async (req, { params }) => rejectChange(await requireSession(req), params.id, await body(req, Input)),
  { mutation: true },
)
