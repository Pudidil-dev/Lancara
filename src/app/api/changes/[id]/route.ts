import { route } from '@/lib/http'
import { requireSession } from '@/lib/session'
import { getChangeDetail } from '@/modules/changes/service'

export const dynamic = 'force-dynamic'

export const GET = route<{ id: string }>('change.get', async (req, { params }) => getChangeDetail(await requireSession(req), params.id))
