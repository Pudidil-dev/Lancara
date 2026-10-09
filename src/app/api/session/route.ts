import { NextResponse } from 'next/server'
import { z } from 'zod'
import { env } from '@/lib/env'
import { body, route } from '@/lib/http'
import { createSession, encodeCookie, SESSION_COOKIE, sessionFromRequest } from '@/lib/session'
import { query } from '@/lib/db'
import { listDemoAccounts } from '@/modules/events/service'

export const dynamic = 'force-dynamic'

export const GET = route('session.get', async (req) => {
  const [session, accounts] = await Promise.all([sessionFromRequest(req), listDemoAccounts()])
  return { session, accounts, demo_mode: env().DEMO_MODE }
})

export const POST = route(
  'session.create',
  async (req) => {
    const input = await body(req, z.object({ actor_id: z.string().min(1).max(64) }))
    const created = await createSession(input.actor_id)
    const res = NextResponse.json({ data: { ok: true } })
    res.cookies.set(SESSION_COOKIE, encodeCookie(created.id), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      expires: created.expires,
    })
    return res
  },
  { mutation: true },
)

export const DELETE = route(
  'session.delete',
  async (req) => {
    const session = await sessionFromRequest(req)
    if (session) await query('DELETE FROM demo_sessions WHERE id = $1', [session.session_id])
    const res = NextResponse.json({ data: { ok: true } })
    res.cookies.delete(SESSION_COOKIE)
    return res
  },
  { mutation: true },
)
