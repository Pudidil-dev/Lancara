import { z } from 'zod'
import { body, route } from '@/lib/http'
import { sessionResponse } from '@/lib/session'
import { login } from '@/modules/auth/service'

export const dynamic = 'force-dynamic'

export const POST = route(
  'auth.login',
  async (req) => sessionResponse(await login(await body(req, z.object({ username: z.string().max(80), password: z.string().max(200) })))),
  { mutation: true },
)
