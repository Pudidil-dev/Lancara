import { z } from 'zod'
import { body, IdempotencyKey, route } from '@/lib/http'
import { requireSession } from '@/lib/session'
import { SnapshotSchema } from '@/modules/events/schema'
import { saveSetup } from '@/modules/events/service'
import { scheduleNotificationDrain } from '@/modules/notifier/kick'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const Input = z.object({ base_version: z.number().int().min(1), snapshot: SnapshotSchema, idempotency_key: IdempotencyKey, note: z.string().max(200).optional(), origin: z.enum(['manual_edit', 'reorder', 'settings']).optional() })

export const PUT = route<{ id: string }>(
  'setup.save',
  async (req, { params }) => {
    const result = await saveSetup(await requireSession(req), params.id, await body(req, Input))
    scheduleNotificationDrain()
    return result
  },
  { mutation: true },
)
