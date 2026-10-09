import { z } from 'zod'
import { body, route } from '@/lib/http'
import { requireSession } from '@/lib/session'
import { markNotificationsRead } from '@/modules/notifications/service'

export const dynamic = 'force-dynamic'

const ReadInput = z.union([
  z.object({ all: z.literal(true) }),
  z.object({ keys: z.array(z.string().min(3).max(120)).min(1).max(100) }),
])

/** POST {keys:[...]} menandai notifikasi tertentu; POST {all:true} = "Tandai semua dibaca". */
export const POST = route<{ id: string }>(
  'notifications.read',
  async (req, { params }) => markNotificationsRead(await requireSession(req), params.id, await body(req, ReadInput)),
  { mutation: true },
)
