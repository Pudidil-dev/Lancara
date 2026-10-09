import { route } from '@/lib/http'
import { requireSession } from '@/lib/session'
import { inbox } from '@/modules/briefs/service'

export const dynamic = 'force-dynamic'

export const GET = route<{ id: string }>('inbox.get', async (req, { params }) => inbox(await requireSession(req), params.id))
