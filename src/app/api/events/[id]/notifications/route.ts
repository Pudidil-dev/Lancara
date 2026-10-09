import { z } from 'zod'
import { parseInput, route } from '@/lib/http'
import { requireSession } from '@/lib/session'
import { notificationLog } from '@/modules/notifier/service'
export const dynamic='force-dynamic'
export const GET=route<{id:string}>('notifier.log',async(req,{params})=>notificationLog(await requireSession(req),params.id,parseInput(z.coerce.number().int().min(1).max(100),req.nextUrl.searchParams.get('limit')??50)))
