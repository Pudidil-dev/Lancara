import { body, route } from '@/lib/http'
import { z } from 'zod'
import { requireSession } from '@/lib/session'
import { myTelegram, unlinkAccount } from '@/modules/notifier/service'
export const dynamic = 'force-dynamic'
export const GET = route('telegram.me', async req => myTelegram(await requireSession(req)))
export const DELETE = route('telegram.unlink', async req => { const session=await requireSession(req); await body(req,z.object({})); return unlinkAccount(session) }, {mutation:true})
