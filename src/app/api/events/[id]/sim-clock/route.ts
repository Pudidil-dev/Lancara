import { z } from 'zod'
import { body, route } from '@/lib/http'
import { requireSession } from '@/lib/session'
import { setSimClock } from '@/modules/events/service'

export const dynamic = 'force-dynamic'

const Input = z.object({ sim_clock_at: z.string().refine((v) => !Number.isNaN(Date.parse(v))).nullable() })

export const POST = route<{ id: string }>(
  'sim-clock.set',
  async (req, { params }) => setSimClock(await requireSession(req), params.id, (await body(req, Input)).sim_clock_at),
  { mutation: true },
)
