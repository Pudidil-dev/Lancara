import { route } from '@/lib/http'
import { requireSession } from '@/lib/session'
import { parseChange } from '@/modules/changes/service'

export const dynamic = 'force-dynamic'

export const POST = route<{ id: string }>('change.parse', async (req, { params }) => parseChange(await requireSession(req), params.id), { mutation: true })
