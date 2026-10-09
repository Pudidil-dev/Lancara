import { z } from 'zod'
import { body, IdempotencyKey, parseInput, route } from '@/lib/http'
import { requireSession } from '@/lib/session'
import { retryDelivery } from '@/modules/notifier/service'
import { scheduleNotificationDrain } from '@/modules/notifier/kick'
export const dynamic='force-dynamic'
export const maxDuration=60
const Input=z.object({idempotency_key:IdempotencyKey,action:z.enum(['retry','mark_sent']).optional()})
export const POST=route<{id:string;deliveryId:string}>('notifier.retry',async(req,{params})=>{const result=await retryDelivery(await requireSession(req),params.id,parseInput(z.uuid(),params.deliveryId),await body(req,Input)); scheduleNotificationDrain(); return result},{mutation:true})
