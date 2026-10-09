import { NextResponse } from 'next/server'
import { route } from '@/lib/http'
import { requireSession, SESSION_COOKIE } from '@/lib/session'
import { resetDemo } from '@/modules/events/service'

export const dynamic = 'force-dynamic'

export const POST = route(
  'demo.reset',
  async (req) => {
    await resetDemo(await requireSession(req))
    const res = NextResponse.json({ data: { reset: true } })
    res.cookies.delete(SESSION_COOKIE)
    return res
  },
  { mutation: true },
)
