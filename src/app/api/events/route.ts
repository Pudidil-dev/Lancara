import { route } from '@/lib/http'
import { requireSession } from '@/lib/session'
import { listEvents } from '@/modules/events/workspace'

export const dynamic = 'force-dynamic'
export const GET = route('events.list', async req => ({ events: await listEvents(await requireSession(req)) }))
