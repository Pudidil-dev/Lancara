import { body, route } from '@/lib/http'
import { z } from 'zod'
import { requireSession } from '@/lib/session'
import { groupCode } from '@/modules/notifier/service'
export const dynamic = 'force-dynamic'
export const POST = route<{id:string}>('telegram.group_code', async (req,{params}) => { const session = await requireSession(req); await body(req,z.object({})); return groupCode(session,params.id) }, {mutation:true})
