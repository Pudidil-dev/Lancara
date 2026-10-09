import { route } from '@/lib/http'
import { requireSession } from '@/lib/session'
import { getRundown } from '@/modules/events/service'

export const dynamic = 'force-dynamic'

export const GET = route<{ id: string }>('rundown.get', async (req, { params }) => getRundown(await requireSession(req), params.id))
