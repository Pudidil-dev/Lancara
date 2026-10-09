import { z } from 'zod'
import { body, IdempotencyKey, route } from '@/lib/http'
import { requireSession } from '@/lib/session'
import { analyseChange } from '@/modules/changes/service'
import { DeltaInputSchema } from '@/modules/events/schema'

export const dynamic = 'force-dynamic'

const Input = z.object({ delta: DeltaInputSchema.nullable().optional(), base_version: z.number().int().min(1), idempotency_key: IdempotencyKey })

export const POST = route<{ id: string }>(
  'change.confirm',
  async (req, { params }) => analyseChange(await requireSession(req), params.id, await body(req, Input), 'confirm'),
  { mutation: true },
)
