import { z } from 'zod'
import { body, route } from '@/lib/http'
import { requireSession } from '@/lib/session'
import { setPicRoles } from '@/modules/notifier/service'
export const dynamic = 'force-dynamic'
const Input=z.object({event_id:z.string().min(1).max(100),role_ids:z.array(z.string().min(1).max(100)).max(50)})
export const PUT = route('telegram.pic_roles', async req => setPicRoles(await requireSession(req),await body(req,Input)), {mutation:true})
