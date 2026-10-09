import { z } from 'zod'
import { body, route } from '@/lib/http'
import { requireSession } from '@/lib/session'
import { createCompensation } from '@/modules/decisions/service'

export const dynamic = 'force-dynamic'

const Input = z.object({ reason: z.string().max(500).nullable().optional() })

export const POST = route<{ id: string }>(
  'decision.compensation',
  async (req, { params }) => createCompensation(await requireSession(req), params.id, await body(req, Input)),
  { mutation: true },
)
