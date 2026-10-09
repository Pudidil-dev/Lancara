import { route } from '@/lib/http'
import { requireSession } from '@/lib/session'
import { history } from '@/modules/briefs/service'

export const dynamic = 'force-dynamic'

export const GET = route<{ id: string }>('history.get', async (req, { params }) => history(await requireSession(req), params.id))
