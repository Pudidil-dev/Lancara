import { route } from '@/lib/http'
import { requireSession } from '@/lib/session'
import { listGroups } from '@/modules/notifier/service'
export const dynamic = 'force-dynamic'
export const GET = route<{id:string}>('telegram.groups', async (req,{params}) => listGroups(await requireSession(req),params.id))
