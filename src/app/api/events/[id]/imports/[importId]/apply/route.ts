import { z } from 'zod'
import { body, IdempotencyKey, route } from '@/lib/http'
import { requireSession } from '@/lib/session'
import { applyImport } from '@/modules/imports/service'
import { scheduleNotificationDrain } from '@/modules/notifier/kick'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const Input = z.object({ base_version: z.number().int().min(1), idempotency_key: IdempotencyKey })

export const POST = route<{ id: string; importId: string }>(
  'imports.apply',
  async (req, { params }) => {
    const result = await applyImport(await requireSession(req), params.id, params.importId, await body(req, Input))
    scheduleNotificationDrain()
    return result
  },
  { mutation: true },
)
