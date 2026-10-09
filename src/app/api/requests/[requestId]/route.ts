import { route } from '@/lib/http'
import { requireSession } from '@/lib/session'
import { requestStatus } from '@/modules/decisions/service'

export const dynamic = 'force-dynamic'

export const GET = route<{ requestId: string }>('request.status', async (req, { params }) => requestStatus(await requireSession(req), params.requestId))
