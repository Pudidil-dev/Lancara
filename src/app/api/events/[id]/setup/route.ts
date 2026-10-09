import { z } from 'zod'
import { body, IdempotencyKey, route } from '@/lib/http'
import { requireSession } from '@/lib/session'
import { SnapshotSchema } from '@/modules/events/schema'
import { saveSetup } from '@/modules/events/service'

export const dynamic = 'force-dynamic'

const Input = z.object({ base_version: z.number().int().min(1), snapshot: SnapshotSchema, idempotency_key: IdempotencyKey, note: z.string().max(200).optional() })

export const PUT = route<{ id: string }>(
  'setup.save',
  async (req, { params }) => saveSetup(await requireSession(req), params.id, await body(req, Input)),
  { mutation: true },
)
