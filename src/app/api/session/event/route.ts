import { body, route } from '@/lib/http'
import { requireSession } from '@/lib/session'
import { selectEvent, selectEventSchema } from '@/modules/events/workspace'

export const dynamic = 'force-dynamic'
export const PUT = route('session.event', async req => selectEvent(await requireSession(req), await body(req, selectEventSchema)), { mutation: true })
