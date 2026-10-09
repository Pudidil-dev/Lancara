import { z } from 'zod'
import { body, parseInput, route } from '@/lib/http'
import { requireSession } from '@/lib/session'
import { updateGroup } from '@/modules/notifier/service'
export const dynamic = 'force-dynamic'
const Input = z.object({action:z.enum(['approve','revoke']),include_public_link:z.boolean().optional(),message_thread_id:z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().optional()})
export const PATCH = route<{id:string;groupId:string}>('telegram.group_update', async (req,{params}) => { const session=await requireSession(req); return updateGroup(session,params.id,parseInput(z.uuid(),params.groupId),await body(req,Input)) }, {mutation:true})
