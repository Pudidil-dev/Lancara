import { route } from '@/lib/http'
import { requireSession } from '@/lib/session'
import { acknowledge } from '@/modules/briefs/service'

export const dynamic = 'force-dynamic'

export const POST = route<{ id: string }>('brief.ack', async (req, { params }) => acknowledge(await requireSession(req), params.id), { mutation: true })
