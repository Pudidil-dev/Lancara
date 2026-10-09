import { z } from 'zod'
import { body, IdempotencyKey, route } from '@/lib/http'
import { requireSession } from '@/lib/session'
import { approve } from '@/modules/decisions/service'

export const dynamic = 'force-dynamic'

const Input = z.object({ patch_id: z.string().uuid(), base_version: z.number().int().min(1), reason: z.string().trim().min(3).max(500), idempotency_key: IdempotencyKey })

export const POST = route<{ id: string }>(
  'change.approve',
  async (req, { params }) => approve(await requireSession(req), params.id, await body(req, Input)),
  { mutation: true },
)
