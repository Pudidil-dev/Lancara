import { z } from 'zod'
import { body, IdempotencyKey, route } from '@/lib/http'
import { requireSession } from '@/lib/session'
import { setItemStatus } from '@/modules/events/service'

export const dynamic = 'force-dynamic'

const Input = z.object({ item_id: z.string().min(1).max(64), status: z.enum(['in_progress', 'completed']), base_version: z.number().int().min(1), idempotency_key: IdempotencyKey })

export const POST = route<{ id: string }>(
  'item-status.set',
  async (req, { params }) => setItemStatus(await requireSession(req), params.id, await body(req, Input)),
  { mutation: true },
)
