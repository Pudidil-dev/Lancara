import { route } from '@/lib/http'
import { serverNow } from '@/lib/clock'
import { requireEvent, requireSession } from '@/lib/session'
import { getEvent, getSnapshot } from '@/modules/events/service'
import { buildAgentContext } from '@/modules/support/context'

export const dynamic = 'force-dynamic'

export const GET = route<{ id: string }>('agent.context', async (req, { params }) => {
  const session = await requireSession(req)
  requireEvent(session, params.id)
  const event = await getEvent(params.id)
  const snapshot = await getSnapshot(params.id, event.active_version)
  return buildAgentContext(session, snapshot, event.active_version, serverNow(event.sim_clock_at), 'confirm')
})
