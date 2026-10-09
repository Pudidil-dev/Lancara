import { body, route } from '@/lib/http'
import { z } from 'zod'
import { requireSession } from '@/lib/session'
import { accountLink } from '@/modules/notifier/service'
export const dynamic = 'force-dynamic'
export const POST = route('telegram.link', async req => { const session=await requireSession(req); await body(req,z.object({})); return accountLink(session) }, {mutation:true})
